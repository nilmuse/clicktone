import { engine } from './engine/SharedAudioEngine';
import { abortable, clampVolume, noop } from './runtime';
import { resolveBestSource, resolveSources } from './source';
import type {
  ClickToneCacheStats,
  ClickToneEventDetail,
  ClickToneEventType,
  ClickToneOptions,
  PlayOptions,
  ReplayBehavior,
  SoundInput,
} from './types';

type ActivePlayback = {
  source: AudioBufferSourceNode;
  urls: string[];
  loop: boolean;
  stopped: boolean;
  finish: () => void;
};

type PendingPlayback = {
  controller: AbortController;
  context: AudioContext | null;
};

export class ClickTone extends EventTarget {
  #urls: string[] = [];
  #initError: Error | null = null;
  #volume: number;
  #muted: boolean;
  #throttle: number;
  #pitch: number;
  #loop: boolean;
  #replay: ReplayBehavior;
  #fallback: boolean;
  #maxVoices: number | null;
  #debug: boolean;
  #lastPlay = 0;
  #gain: GainNode | null = null;
  #activePlaybacks = new Set<ActivePlayback>();
  #pendingPlaybacks = new Set<PendingPlayback>();
  #needsGainRefresh = false;
  #visibilityHandler: (() => void) | null = null;
  #unlockUnsubscribe: (() => void) | null = null;
  #recreateUnsubscribe: (() => void) | null = null;
  #destroyed = false;

  constructor({
    src,
    volume = 1,
    muted = false,
    throttle = 0,
    pitchVariation = 0,
    preload = false,
    loop = false,
    replay = 'overlap',
    fallback = false,
    maxVoices = null,
    debug = false,
  }: ClickToneOptions) {
    super();

    if (maxVoices !== null && (!Number.isSafeInteger(maxVoices) || maxVoices < 1)) {
      throw new RangeError('maxVoices must be null or a positive safe integer.');
    }

    this.#volume = clampVolume(volume);
    this.#muted = muted;
    this.#throttle = Math.max(0, throttle);
    this.#pitch = Math.min(1, Math.max(0, pitchVariation));
    this.#loop = loop;
    this.#replay = replay;
    this.#fallback = fallback;
    this.#maxVoices = maxVoices;
    this.#debug = debug;

    try {
      this.#urls = resolveSources(src);
    } catch (error) {
      this.#initError = error as Error;
    }

    engine.prime();
    this.#unlockUnsubscribe = engine.onUnlock(() => this.#emit('unlock'));
    this.#recreateUnsubscribe = engine.onRecreate(() => this.#restartActiveLoops());

    if (typeof document !== 'undefined') {
      this.#visibilityHandler = (): void => {
        if (!document.hidden) this.#needsGainRefresh = true;
      };
      document.addEventListener('visibilitychange', this.#visibilityHandler);
    }

    if (preload) void this.preload();
  }

  static unlock(): void {
    engine.prime();
    engine.unlock();
  }

  static get unlocked(): boolean {
    return engine.unlocked;
  }

  /** Snapshot of the shared decoded-buffer cache. Does not create an AudioContext. */
  static get cacheStats(): ClickToneCacheStats {
    return engine.cacheStats;
  }

  /** Set a global PCM byte budget. null disables eviction; 0 disables retention. */
  static setCacheLimit(maxBytes: number | null): void {
    engine.setCacheLimit(maxBytes);
  }

  /** Clear all cached sources, or the selected source. Playback and loading continue. */
  static clearCache(src?: SoundInput): void {
    engine.clearCache(src === undefined ? undefined : resolveBestSource(src));
  }

  get volume(): number {
    return this.#volume;
  }

  get muted(): boolean {
    return this.#muted;
  }

  /** Whether a source has started and has not ended or been stopped. Excludes loading. */
  get playing(): boolean {
    return this.#activePlaybacks.size > 0;
  }

  /** Number of started sources, including loops. Excludes pending play requests. */
  get voiceCount(): number {
    return this.#activePlaybacks.size;
  }

  /** Load the configured sound. Failures emit error and resolve with undefined. */
  async preload(): Promise<AudioBuffer | undefined> {
    if (this.#destroyed || !this.#urls.length) return undefined;

    try {
      const loaded = await this.#decodeSources(
        this.#fallback ? this.#urls : this.#urls.slice(0, 1),
      );

      if (this.#destroyed || !loaded) return undefined;

      const { buffer } = loaded;

      this.#emit('load', buffer);

      return buffer;
    } catch (error) {
      this.#fail(error as Error);

      return undefined;
    }
  }

  /** Remove all configured source URLs from the shared cache without stopping playback. */
  unload(): boolean {
    if (this.#destroyed) return false;

    let removed = false;

    for (const url of this.#urls) {
      if (engine.unload(url)) removed = true;
    }

    return removed;
  }

  unlock(): void {
    engine.unlock();
  }

  setVolume(value: number): void {
    this.#volume = clampVolume(value);

    if (this.#gain && !this.#muted) this.#rampGain(this.#volume);
  }

  setMuted(muted: boolean): void {
    this.#muted = muted;

    if (this.#gain) this.#rampGain(muted ? 0 : this.#volume);
    if (!muted) engine.unlock();
  }

  toggleMuted(): boolean {
    this.setMuted(!this.#muted);

    return this.#muted;
  }

  /**
   * Resolve on completion, stop, cancellation, or loop start. Errors emit error.
   * Browser audio unlock can wait for a gesture; stop() and destroy() cancel it.
   */
  async play(input?: SoundInput | PlayOptions): Promise<void> {
    await this.#play(this.#normalizePlayOptions(input));
  }

  /** Cancel pending requests and stop all sources belonging to this instance. */
  stop(): void {
    this.#cancelPendingPlaybacks();
    this.#stopActivePlaybacks(true);
  }

  async #play(
    { src, loop = this.#loop, replay = this.#replay, fallback = this.#fallback }: PlayOptions,
    { skipThrottle = false, urls: restoredUrls }: { skipThrottle?: boolean; urls?: string[] } = {},
  ): Promise<void> {
    if (this.#destroyed) return;

    if ((this.playing || this.#pendingPlaybacks.size > 0) && replay === 'ignore-if-playing') return;

    const now = Date.now();

    if (!skipThrottle && replay !== 'restart' && now - this.#lastPlay < this.#throttle) return;

    const replace = replay === 'interrupt' || replay === 'restart';

    if (replace) this.#cancelPendingPlaybacks();

    this.#lastPlay = now;
    const request: PendingPlayback = { controller: new AbortController(), context: null };
    const { signal } = request.controller;

    this.#pendingPlaybacks.add(request);

    if (replace) this.#stopActivePlaybacks(true);

    let playback: ActivePlayback | undefined;
    let preparedSource: AudioBufferSourceNode | undefined;

    try {
      if (signal.aborted) return;
      engine.unlock();
      if (signal.aborted) return;

      const sources =
        restoredUrls ?? (src !== undefined ? resolveSources(src) : this.#requireSources());
      const urls = restoredUrls ?? (fallback ? sources : sources.slice(0, 1));

      request.context = engine.context();
      const ctx = await engine.ensureRunning(signal);

      if (signal.aborted) return;
      if (!ctx) throw new Error('Web Audio API is not available.');
      if (ctx !== engine.context()) return;
      if (ctx.state !== 'running') throw new Error('AudioContext is not running.');

      const loaded = await this.#decodeSources(urls, signal);

      if (!loaded || signal.aborted || ctx !== engine.context()) return;
      const { buffer, url } = loaded;
      if (ctx.state !== 'running') await abortable(ctx.resume(), signal);
      if (signal.aborted || ctx !== engine.context()) return;
      if (ctx.state !== 'running') throw new Error('AudioContext is not running.');

      const gain = this.#ensureGain(ctx);
      const source = ctx.createBufferSource();

      preparedSource = source;
      source.buffer = buffer;
      source.loop = loop;

      if (this.#pitch > 0) {
        source.playbackRate.value = Math.max(0.5, 1 + (Math.random() * 2 - 1) * this.#pitch);
      }

      source.connect(gain);
      this.#makeRoomForVoice();

      // A stop listener may cancel this request or trigger context recovery.
      if (signal.aborted || ctx !== engine.context()) return;

      let finish = noop;
      const ended = new Promise<void>((resolve) => {
        finish = resolve;
      });
      const active: ActivePlayback = {
        source,
        urls: [url, ...urls.filter((candidate) => candidate !== url)],
        loop,
        stopped: false,
        finish,
      };

      playback = active;
      this.#activePlaybacks.add(active);
      source.onended = (): void => this.#finishPlayback(active, !active.stopped);

      source.start(0);
      this.#pendingPlaybacks.delete(request);
      this.#emit('play');

      if (!loop) await ended;
    } catch (error) {
      if (playback) this.#finishPlayback(playback, false);
      this.#pendingPlaybacks.delete(request);
      if (!signal.aborted) this.#fail(error as Error);
    } finally {
      this.#pendingPlaybacks.delete(request);
      if (preparedSource && !playback) {
        try {
          preparedSource.disconnect();
        } catch {
          /* already disconnected */
        }
      }
    }
  }

  on<T extends ClickToneEventType>(
    type: T,
    listener: (detail: ClickToneEventDetail[T]) => void,
  ): () => void {
    const handler = (event: Event): void =>
      listener((event as CustomEvent<ClickToneEventDetail[T]>).detail);

    this.addEventListener(type, handler as EventListener);

    return () => this.removeEventListener(type, handler as EventListener);
  }

  once<T extends ClickToneEventType>(
    type: T,
    listener: (detail: ClickToneEventDetail[T]) => void,
  ): void {
    const handler = (event: Event): void =>
      listener((event as CustomEvent<ClickToneEventDetail[T]>).detail);

    this.addEventListener(type, handler as EventListener, { once: true });
  }

  /** Permanently dispose this instance without interrupting other sounds' loading. */
  destroy(): void {
    if (this.#destroyed) return;

    this.#destroyed = true;
    this.#cancelPendingPlaybacks();
    this.#stopActivePlaybacks(false);
    this.#unlockUnsubscribe?.();
    this.#unlockUnsubscribe = null;
    if (this.#visibilityHandler && typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.#visibilityHandler);
      this.#visibilityHandler = null;
    }
    this.#recreateUnsubscribe?.();
    this.#recreateUnsubscribe = null;
    this.#gain?.disconnect();
    this.#gain = null;
  }

  #normalizePlayOptions(input?: SoundInput | PlayOptions): PlayOptions {
    if (this.#isPlayOptions(input)) return input;

    return { src: input };
  }

  #isPlayOptions(input?: SoundInput | PlayOptions): input is PlayOptions {
    if (
      typeof input !== 'object' ||
      input === null ||
      Array.isArray(input) ||
      input instanceof URL ||
      (typeof HTMLSourceElement !== 'undefined' && input instanceof HTMLSourceElement) ||
      (typeof HTMLAudioElement !== 'undefined' && input instanceof HTMLAudioElement) ||
      'id' in input
    ) {
      return false;
    }

    return (
      'loop' in input ||
      'replay' in input ||
      'fallback' in input ||
      !('src' in input) ||
      typeof input.src !== 'string'
    );
  }

  #stopActivePlaybacks(emitStop: boolean): void {
    const playbacks = [...this.#activePlaybacks];

    if (!playbacks.length) return;

    for (const playback of playbacks) {
      this.#stopPlayback(playback);
    }

    if (emitStop) this.#emit('stop');
  }

  #makeRoomForVoice(): void {
    if (this.#maxVoices === null || this.#activePlaybacks.size < this.#maxVoices) return;

    const oldest = this.#activePlaybacks.values().next().value;

    if (!oldest) return;

    this.#stopPlayback(oldest);
    this.#emit('stop');
  }

  #stopPlayback(playback: ActivePlayback): void {
    playback.stopped = true;

    try {
      playback.source.stop(0);
    } catch {
      /* already stopped */
    }

    this.#finishPlayback(playback, false);
  }

  #cancelPendingPlaybacks(onlyBoundContexts = false): void {
    for (const request of this.#pendingPlaybacks) {
      // The play() call triggering recovery has not captured a context yet.
      // Keep it so that the same user gesture can start it on the new context.
      if (onlyBoundContexts && !request.context) continue;

      this.#pendingPlaybacks.delete(request);
      request.controller.abort();
    }
  }

  #finishPlayback(playback: ActivePlayback, emitEnd: boolean): void {
    if (!this.#activePlaybacks.delete(playback)) return;

    playback.source.onended = null;
    try {
      playback.source.disconnect();
    } catch {
      /* already disconnected */
    }

    playback.finish();
    if (emitEnd) this.#emit('end');
  }

  #restartActiveLoops(): void {
    if (this.#destroyed) return;

    const loopSources = [...this.#activePlaybacks]
      .filter((playback) => playback.loop)
      .map((playback) => playback.urls);

    this.#cancelPendingPlaybacks(true);
    this.#stopActivePlaybacks(false);
    loopSources.forEach((urls) => {
      void this.#play({ loop: true, replay: 'overlap' }, { skipThrottle: true, urls });
    });
  }

  #requireSources(): string[] {
    if (this.#urls.length) return this.#urls;

    throw this.#initError ?? new Error('No valid sound source.');
  }

  async #decodeSources(
    urls: string[],
    signal?: AbortSignal,
  ): Promise<{ buffer: AudioBuffer; url: string } | undefined> {
    if (this.#destroyed) return undefined;
    if (signal?.aborted) throw signal.reason;
    if (!engine.context()) throw new Error('Web Audio API is not available.');

    const errors: unknown[] = [];

    for (const url of urls) {
      if (this.#destroyed) return undefined;
      if (signal?.aborted) throw signal.reason;

      try {
        const buffer = await abortable(engine.decode(url), signal);

        return { buffer, url };
      } catch (error) {
        if (signal?.aborted || this.#destroyed) throw error;

        errors.push(error);
      }
    }

    if (errors.length === 1) throw errors[0];

    throw new AggregateError(errors, `Unable to load any sound source: ${urls.join(', ')}.`);
  }

  #ensureGain(ctx: AudioContext): GainNode {
    if (!this.#gain || this.#gain.context !== ctx) {
      this.#gain?.disconnect();
      this.#gain = ctx.createGain();
      this.#gain.gain.value = this.#muted ? 0 : this.#volume;
      this.#gain.connect(ctx.destination);
      this.#needsGainRefresh = false;
    } else if (this.#needsGainRefresh) {
      this.#gain.disconnect();
      this.#gain.connect(ctx.destination);
      this.#needsGainRefresh = false;
    }

    return this.#gain;
  }

  #rampGain(target: number): void {
    const gain = this.#gain;

    if (!gain) return;

    const now = gain.context.currentTime;

    gain.gain.cancelScheduledValues(now);
    gain.gain.setValueAtTime(gain.gain.value, now);
    gain.gain.linearRampToValueAtTime(target, now + 0.015);
  }

  #emit<T extends ClickToneEventType>(type: T, detail?: ClickToneEventDetail[T]): void {
    if (this.#destroyed) return;

    if (typeof CustomEvent !== 'undefined') {
      this.dispatchEvent(new CustomEvent(type, { detail }));
    } else if (typeof Event !== 'undefined') {
      const event = new Event(type) as Event & { detail?: unknown };

      event.detail = detail;
      this.dispatchEvent(event);
    }
  }

  #fail(error: Error): void {
    if (this.#destroyed) return;

    if (this.#debug) console.error('[ClickTone]', error);

    this.#emit('error', error);
  }
}
