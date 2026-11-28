import { describe, expect, it, vi } from 'vitest';
import {
  audioBuffer,
  deferred,
  installAudioMocks,
  soundSources,
  useAudioTestEnvironment,
  withAppleUA,
} from './test/audio';

describe('ClickTone', () => {
  useAudioTestEnvironment();

  it('emits play and end events on successful playback', async () => {
    installAudioMocks();
    const { ClickTone } = await import('./main');
    const sound = new ClickTone({ src: '/assets/click.wav' });

    const playHandler = vi.fn();
    const endHandler = vi.fn();
    sound.on('play', playHandler);
    sound.on('end', endHandler);

    await sound.play();

    expect(playHandler).toHaveBeenCalledTimes(1);
    expect(endHandler).toHaveBeenCalledTimes(1);
  });

  it('emits load event on preload', async () => {
    installAudioMocks();
    const { ClickTone } = await import('./main');
    const sound = new ClickTone({ src: '/assets/click.wav' });

    const loadHandler = vi.fn();
    sound.on('load', loadHandler);

    await sound.preload();

    expect(loadHandler).toHaveBeenCalledTimes(1);
  });

  it('unloads configured sources globally without stopping either instance', async () => {
    const { fetchSpy, sources } = installAudioMocks();
    const { ClickTone } = await import('./main');
    const first = new ClickTone({ src: '/assets/shared.wav', loop: true });
    const second = new ClickTone({ src: '/assets/shared.wav', loop: true });
    await first.play();
    await second.play();

    expect(first.unload()).toBe(true);
    expect(first.unload()).toBe(false);
    expect(ClickTone.cacheStats.entries).toBe(0);
    expect(first.playing).toBe(true);
    expect(second.playing).toBe(true);
    expect(soundSources(sources).every((source) => !source.stopped)).toBe(true);
    await second.preload();

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(ClickTone.cacheStats).toEqual({ entries: 1, pending: 0, bytes: 8820, maxBytes: null });
    first.destroy();
    second.destroy();
  });

  it('clears a selected source without discarding other loaded sounds', async () => {
    const { fetchSpy } = installAudioMocks();
    const { ClickTone } = await import('./main');
    const first = new ClickTone({ src: '/assets/a.wav' });
    const second = new ClickTone({ src: '/assets/b.wav' });
    await first.preload();
    await second.preload();

    ClickTone.clearCache('/assets/a.wav');
    expect(ClickTone.cacheStats.entries).toBe(1);
    await second.preload();
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    await first.preload();
    expect(fetchSpy).toHaveBeenCalledTimes(3);

    ClickTone.clearCache();
    expect(ClickTone.cacheStats.entries).toBe(0);
    first.destroy();
    second.destroy();
  });

  it('keeps shared pending playback alive when its cache is cleared', async () => {
    const decoded = deferred<AudioBuffer>();
    const { decodeSpy, fetchSpy, sources } = installAudioMocks({ decode: () => decoded.promise });
    const { ClickTone } = await import('./main');
    const first = new ClickTone({ src: '/assets/shared.wav', loop: true });
    const second = new ClickTone({ src: '/assets/shared.wav', loop: true });
    const pending = Promise.all([first.play(), second.play()]);
    await vi.waitFor(() => expect(decodeSpy).toHaveBeenCalledOnce());

    expect(ClickTone.cacheStats.pending).toBe(1);
    ClickTone.clearCache();
    decoded.resolve(audioBuffer());
    await pending;

    expect(first.playing).toBe(true);
    expect(second.playing).toBe(true);
    expect(soundSources(sources)).toHaveLength(2);
    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(ClickTone.cacheStats.entries).toBe(0);
    expect(ClickTone.cacheStats.pending).toBe(0);
    first.destroy();
    second.destroy();
  });

  it('evicts cached buffers without stopping playback when retention is disabled', async () => {
    const { fetchSpy, sources } = installAudioMocks();
    const { ClickTone } = await import('./main');
    const sound = new ClickTone({ src: '/assets/loop.wav', loop: true });
    await sound.play();

    ClickTone.setCacheLimit(0);

    expect(ClickTone.cacheStats).toEqual({ entries: 0, pending: 0, bytes: 0, maxBytes: 0 });
    expect(sound.playing).toBe(true);
    expect(soundSources(sources)[0].stopped).toBe(false);
    expect(await sound.preload()).toBeDefined();
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(ClickTone.cacheStats.bytes).toBe(0);
    ClickTone.setCacheLimit(null);
    await sound.preload();
    expect(ClickTone.cacheStats.entries).toBe(1);
    sound.destroy();
  });

  it('only unloads the configured source and leaves override sources explicit', async () => {
    installAudioMocks();
    const { ClickTone } = await import('./main');
    const sound = new ClickTone({ src: '/assets/default.wav' });
    await sound.play('/assets/override.wav');

    expect(sound.unload()).toBe(false);
    expect(ClickTone.cacheStats.entries).toBe(1);
    ClickTone.clearCache('/assets/override.wav');
    expect(ClickTone.cacheStats.entries).toBe(0);
    sound.destroy();
    expect(sound.unload()).toBe(false);
  });

  it('emits error when source is invalid', async () => {
    installAudioMocks();
    const { ClickTone } = await import('./main');
    const sound = new ClickTone({ src: { src: '' } });

    const errorHandler = vi.fn();
    sound.on('error', errorHandler);

    await sound.play();

    expect(errorHandler).toHaveBeenCalledTimes(1);
    const [error] = errorHandler.mock.calls[0] as [Error];
    expect(error.message).toContain('Source descriptor has an empty "src".');
  });

  it('applies throttle to suppress rapid sequential play requests', async () => {
    const { fetchSpy } = installAudioMocks();
    const nowSpy = vi.spyOn(Date, 'now');
    nowSpy.mockReturnValue(1000).mockReturnValue(1000);

    const { ClickTone } = await import('./main');
    const sound = new ClickTone({ src: '/assets/click.wav', throttle: 500 });

    await sound.play('/assets/a.wav');
    await sound.play('/assets/b.wav');

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledWith('/assets/a.wav');
  });

  it('keeps loop playback active until stopped', async () => {
    const { sources } = installAudioMocks();
    const { ClickTone } = await import('./main');
    const sound = new ClickTone({ src: '/assets/loop.wav', loop: true });

    const stopHandler = vi.fn();
    const endHandler = vi.fn();
    sound.on('stop', stopHandler);
    sound.on('end', endHandler);

    await sound.play();

    expect(sound.playing).toBe(true);
    expect(sources.some((source) => source.loop)).toBe(true);

    sound.stop();

    expect(sound.playing).toBe(false);
    expect(stopHandler).toHaveBeenCalledTimes(1);
    expect(endHandler).not.toHaveBeenCalled();
  });

  it('can ignore play requests while already playing', async () => {
    const { fetchSpy } = installAudioMocks();
    const { ClickTone } = await import('./main');
    const sound = new ClickTone({ src: '/assets/loop.wav', loop: true });

    await sound.play();
    await sound.play({ src: '/assets/ignored.wav', replay: 'ignore-if-playing' });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledWith('/assets/loop.wav');
  });

  it('can interrupt active playback before starting another sound', async () => {
    const { fetchSpy, sources } = installAudioMocks();
    const { ClickTone } = await import('./main');
    const sound = new ClickTone({ src: '/assets/loop.wav', loop: true });

    const stopHandler = vi.fn();
    sound.on('stop', stopHandler);

    await sound.play();
    await sound.play({ src: '/assets/hit.wav', replay: 'interrupt' });

    expect(fetchSpy).toHaveBeenCalledWith('/assets/loop.wav');
    expect(fetchSpy).toHaveBeenCalledWith('/assets/hit.wav');
    expect(sources.some((source) => source.loop && source.stopped)).toBe(true);
    expect(stopHandler).toHaveBeenCalledTimes(1);
  });

  it.each([
    'resolve',
    'reject',
  ] as const)('does not start or emit events when decoding %ss after destroy', async (outcome) => {
    const decode = deferred<AudioBuffer>();
    const { sources, decodeSpy } = installAudioMocks({ decode: () => decode.promise });
    const { ClickTone } = await import('./main');
    const sound = new ClickTone({ src: '/assets/click.wav', loop: true });
    const playHandler = vi.fn();
    const errorHandler = vi.fn();
    sound.on('play', playHandler);
    sound.on('error', errorHandler);

    const pending = sound.play();
    await vi.waitFor(() => expect(decodeSpy).toHaveBeenCalledOnce());
    sound.destroy();
    if (outcome === 'resolve') decode.resolve(audioBuffer());
    else decode.reject(new Error('Decoding failed'));
    await pending;

    expect(sound.playing).toBe(false);
    expect(soundSources(sources)).toHaveLength(0);
    expect(playHandler).not.toHaveBeenCalled();
    expect(errorHandler).not.toHaveBeenCalled();
  });

  it('does not emit load after destruction during preload', async () => {
    const decode = deferred<AudioBuffer>();
    installAudioMocks({ decode: () => decode.promise });
    const { ClickTone } = await import('./main');
    const sound = new ClickTone({ src: '/assets/click.wav' });
    const loadHandler = vi.fn();
    sound.on('load', loadHandler);

    const pending = sound.preload();
    sound.destroy();
    decode.resolve(audioBuffer());

    expect(await pending).toBeUndefined();
    expect(loadHandler).not.toHaveBeenCalled();
  });

  it('unsubscribes destroyed instances from the first engine unlock', async () => {
    installAudioMocks();
    const { ClickTone } = await import('./main');
    const { engine } = await import('./engine/SharedAudioEngine');
    const unsubscribe = vi.fn();
    vi.spyOn(engine, 'onUnlock').mockReturnValue(unsubscribe);
    const sound = new ClickTone({ src: '/assets/click.wav' });
    const unlockHandler = vi.fn();
    sound.on('unlock', unlockHandler);

    sound.destroy();
    sound.destroy();
    ClickTone.unlock();
    await Promise.resolve();

    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(unlockHandler).not.toHaveBeenCalled();
  });

  it('settles stopped playback without depending on a native ended event', async () => {
    const { sources } = installAudioMocks({ autoEnd: false });
    const { ClickTone } = await import('./main');
    const sound = new ClickTone({ src: '/assets/click.wav' });
    const pending = sound.play();
    await vi.waitFor(() => expect(sound.playing).toBe(true));
    const source = soundSources(sources)[0];
    source.stop = vi.fn();

    sound.stop();
    await pending;

    expect(sound.playing).toBe(false);
    expect(source.disconnect).toHaveBeenCalledOnce();
    expect(source.onended).toBeNull();
  });

  it('cleans up a source when starting playback fails', async () => {
    const { sources } = installAudioMocks({ startError: new Error('Start failed') });
    const { ClickTone } = await import('./main');
    const sound = new ClickTone({ src: '/assets/click.wav' });
    const errorHandler = vi.fn();
    sound.on('error', errorHandler);

    await sound.play();

    const source = soundSources(sources)[0];
    expect(sound.playing).toBe(false);
    expect(source.disconnect).toHaveBeenCalledOnce();
    expect(source.onended).toBeNull();
    expect(errorHandler).toHaveBeenCalledWith(new Error('Start failed'));
  });

  it('uses the configured source for empty play options', async () => {
    const { fetchSpy } = installAudioMocks();
    const { ClickTone } = await import('./main');
    const sound = new ClickTone({ src: '/assets/default.wav' });

    await sound.play({});

    expect(fetchSpy).toHaveBeenCalledWith('/assets/default.wav');
  });

  it.each(['direct', 'options'] as const)('resolves every source form passed %s', async (form) => {
    const { fetchSpy, sources } = installAudioMocks();
    const { ClickTone } = await import('./main');
    const sound = new ClickTone({ src: '/assets/default.wav', loop: true });
    const audio = document.createElement('audio');
    const child = document.createElement('source');
    child.src = '/assets/child.wav';
    audio.id = 'test-audio';
    audio.append(child);
    document.body.append(audio);
    const sourceElement = document.createElement('source');
    sourceElement.src = '/assets/element.wav';

    const cases = [
      { input: '/assets/string.wav', expected: '/assets/string.wav' },
      { input: new URL('https://cdn.test/url.wav'), expected: 'https://cdn.test/url.wav' },
      {
        input: { src: '/assets/descriptor.wav', type: 'audio/wav' },
        expected: '/assets/descriptor.wav',
      },
      { input: audio, expected: child.src },
      { input: { id: audio.id }, expected: child.src },
      { input: sourceElement, expected: sourceElement.src },
      { input: ['/assets/first.wav', '/assets/second.mp3'], expected: '/assets/first.wav' },
    ];

    for (const { input, expected } of cases) {
      await sound.play(form === 'direct' ? input : { src: input });
      expect(fetchSpy).toHaveBeenLastCalledWith(expected);
      expect(soundSources(sources).at(-1)?.loop).toBe(true);
      sound.stop();
    }

    sound.destroy();
  });

  it.each([
    'stop',
    'destroy',
  ] as const)('settles pending playback on %s during fetch', async (action) => {
    const fetchResult = deferred<Response>();
    const { fetchSpy, sources } = installAudioMocks();
    fetchSpy.mockReturnValue(fetchResult.promise);
    const { ClickTone } = await import('./main');
    const { engine } = await import('./engine/SharedAudioEngine');
    const sound = new ClickTone({ src: '/assets/pending.wav', loop: true });
    const errorHandler = vi.fn();
    sound.on('error', errorHandler);

    const pending = sound.play();
    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalledOnce());
    sound[action]();
    await pending;
    expect(sound.playing).toBe(false);

    fetchResult.resolve(new Response(new ArrayBuffer(8)));
    await engine.decode('/assets/pending.wav');

    expect(soundSources(sources)).toHaveLength(0);
    expect(errorHandler).not.toHaveBeenCalled();
    sound.destroy();
  });

  it.each([
    'stop',
    'destroy',
  ] as const)('settles pending playback on %s during decode', async (action) => {
    const decode = deferred<AudioBuffer>();
    const { decodeSpy, sources } = installAudioMocks({ decode: () => decode.promise });
    const { ClickTone } = await import('./main');
    const { engine } = await import('./engine/SharedAudioEngine');
    const sound = new ClickTone({ src: '/assets/pending.wav', loop: true });
    const pending = sound.play();
    await vi.waitFor(() => expect(decodeSpy).toHaveBeenCalledOnce());

    sound[action]();
    await pending;
    decode.resolve(audioBuffer());
    await engine.decode('/assets/pending.wav');

    expect(soundSources(sources)).toHaveLength(0);
    expect(sound.playing).toBe(false);
    sound.destroy();
  });

  it.each([
    'stop',
    'destroy',
  ] as const)('settles pending playback on %s while waiting for a gesture', async (action) => {
    const resumed = deferred<void>();
    const resume = vi.fn(() => resumed.promise);
    const { fetchSpy } = installAudioMocks({ resume });
    const { ClickTone } = await import('./main');
    const sound = new ClickTone({ src: '/assets/pending.wav' });
    const pending = sound.play();
    expect(resume).toHaveBeenCalled();

    sound[action]();
    await pending;

    expect(fetchSpy).not.toHaveBeenCalled();
    resumed.resolve();
    sound.destroy();
  });

  it('keeps waiting for a user gesture without a new timeout', async () => {
    vi.useFakeTimers();
    const resumed = deferred<void>();
    const { fetchSpy } = installAudioMocks({ resume: () => resumed.promise });
    const { ClickTone } = await import('./main');
    const sound = new ClickTone({ src: '/assets/click.wav' });
    const settled = vi.fn();
    const pending = sound.play().then(settled);

    await vi.advanceTimersByTimeAsync(5000);

    expect(settled).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    resumed.resolve();
    await pending;
    expect(settled).toHaveBeenCalledOnce();
    sound.destroy();
  });

  it.each([
    'stop',
    'destroy',
  ] as const)('settles pending playback on %s when suspended after decode', async (action) => {
    const decoded = deferred<AudioBuffer>();
    const resumed = deferred<void>();
    const { decodeSpy, instances, sources } = installAudioMocks({ decode: () => decoded.promise });
    const { ClickTone } = await import('./main');
    const sound = new ClickTone({ src: '/assets/click.wav' });
    const pending = sound.play();
    await vi.waitFor(() => expect(decodeSpy).toHaveBeenCalledOnce());
    instances[0].state = 'suspended';
    const resume = vi.spyOn(instances[0], 'resume').mockReturnValue(resumed.promise);
    decoded.resolve(audioBuffer());
    await vi.waitFor(() => expect(resume).toHaveBeenCalledOnce());

    sound[action]();
    await pending;

    expect(soundSources(sources)).toHaveLength(0);
    resumed.resolve();
    sound.destroy();
  });

  it('ignores concurrent play requests while the first is loading', async () => {
    const decoded = deferred<AudioBuffer>();
    const { fetchSpy, sources } = installAudioMocks({ decode: () => decoded.promise });
    const { ClickTone } = await import('./main');
    const sound = new ClickTone({
      src: '/assets/click.wav',
      loop: true,
      replay: 'ignore-if-playing',
    });

    const pending = sound.play();
    await sound.play('/assets/ignored.wav');
    decoded.resolve(audioBuffer());
    await pending;

    expect(fetchSpy).toHaveBeenCalledExactlyOnceWith('/assets/click.wav');
    expect(soundSources(sources)).toHaveLength(1);
    sound.destroy();
  });

  it.each([
    'interrupt',
    'restart',
  ] as const)('only starts the latest pending request with %s', async (replay) => {
    const slow = deferred<Response>();
    const { fetchSpy, sources } = installAudioMocks();
    fetchSpy.mockImplementation((url: string) =>
      url === '/assets/slow.wav' ? slow.promise : Promise.resolve(new Response(new ArrayBuffer(8))),
    );
    const { ClickTone } = await import('./main');
    const { engine } = await import('./engine/SharedAudioEngine');
    const sound = new ClickTone({ src: '/assets/slow.wav', loop: true });

    const first = sound.play();
    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalledWith('/assets/slow.wav'));
    await sound.play({ src: '/assets/fast.wav', replay });
    await first;
    expect(soundSources(sources)).toHaveLength(1);
    slow.resolve(new Response(new ArrayBuffer(8)));
    await engine.decode('/assets/slow.wav');

    expect(soundSources(sources)).toHaveLength(1);
    sound.destroy();
  });

  it('keeps overlapping requests and deduplicates their shared loading', async () => {
    const decoded = deferred<AudioBuffer>();
    const { fetchSpy, decodeSpy, sources } = installAudioMocks({ decode: () => decoded.promise });
    const { ClickTone } = await import('./main');
    const sound = new ClickTone({ src: '/assets/click.wav', loop: true });

    const first = sound.play();
    const second = sound.play();
    decoded.resolve(audioBuffer());
    await Promise.all([first, second]);

    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(decodeSpy).toHaveBeenCalledOnce();
    expect(soundSources(sources)).toHaveLength(2);
    sound.destroy();
  });

  it('does not cancel another instance using the same loading buffer', async () => {
    const decoded = deferred<AudioBuffer>();
    const { fetchSpy, decodeSpy, sources } = installAudioMocks({ decode: () => decoded.promise });
    const { ClickTone } = await import('./main');
    const first = new ClickTone({ src: '/assets/shared.wav', loop: true });
    const second = new ClickTone({ src: '/assets/shared.wav', loop: true });
    const cancelled = first.play();
    const pending = second.play();
    await vi.waitFor(() => expect(decodeSpy).toHaveBeenCalledOnce());

    first.destroy();
    await cancelled;
    decoded.resolve(audioBuffer());
    await pending;

    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(soundSources(sources)).toHaveLength(1);
    expect(second.playing).toBe(true);
    second.destroy();
  });

  it('honors destroy called from an interrupt stop listener', async () => {
    const { fetchSpy, sources } = installAudioMocks();
    const { ClickTone } = await import('./main');
    const sound = new ClickTone({ src: '/assets/loop.wav', loop: true });
    await sound.play();
    sound.on('stop', () => sound.destroy());

    await sound.play({ src: '/assets/replacement.wav', replay: 'interrupt' });

    expect(sound.playing).toBe(false);
    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(soundSources(sources)).toHaveLength(1);
  });

  it('honors stop called from an unlock listener', async () => {
    const { fetchSpy } = installAudioMocks();
    const { ClickTone } = await import('./main');
    const sound = new ClickTone({ src: '/assets/click.wav' });
    sound.on('unlock', () => sound.stop());

    await sound.play();

    expect(fetchSpy).not.toHaveBeenCalled();
    sound.destroy();
  });

  it('allows retrying a sound after a failed HTTP request', async () => {
    const { fetchSpy } = installAudioMocks();
    fetchSpy.mockResolvedValueOnce({ ok: false, status: 503, statusText: 'Unavailable' });
    const { ClickTone } = await import('./main');
    const sound = new ClickTone({ src: '/assets/click.wav' });
    const errorHandler = vi.fn();
    const playHandler = vi.fn();
    sound.on('error', errorHandler);
    sound.on('play', playHandler);

    await sound.play();
    expect(sound.playing).toBe(false);
    await sound.play();

    expect(errorHandler).toHaveBeenCalledOnce();
    expect(playHandler).toHaveBeenCalledOnce();
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    sound.destroy();
  });

  it('allows retrying a sound after decoding fails', async () => {
    const decode = vi
      .fn<() => Promise<AudioBuffer>>()
      .mockRejectedValueOnce(new Error('Invalid audio'))
      .mockResolvedValue(audioBuffer());
    installAudioMocks({ decode });
    const { ClickTone } = await import('./main');
    const sound = new ClickTone({ src: '/assets/click.wav' });
    const errorHandler = vi.fn();
    const endHandler = vi.fn();
    sound.on('error', errorHandler);
    sound.on('end', endHandler);

    await sound.play();
    await sound.play();

    expect(errorHandler).toHaveBeenCalledWith(new Error('Invalid audio'));
    expect(endHandler).toHaveBeenCalledOnce();
    sound.destroy();
  });

  it('reports missing Web Audio support through the error event', async () => {
    vi.stubGlobal('AudioContext', undefined);
    vi.stubGlobal('webkitAudioContext', undefined);
    const { ClickTone } = await import('./main');
    const sound = new ClickTone({ src: '/assets/click.wav' });
    const errorHandler = vi.fn();
    sound.on('error', errorHandler);

    await sound.play();

    expect(errorHandler).toHaveBeenCalledWith(new Error('Web Audio API is not available.'));
    expect(sound.playing).toBe(false);
    sound.destroy();
  });

  it('removes a pending unlock subscription when unsubscribed', async () => {
    installAudioMocks();
    const { engine } = await import('./engine/SharedAudioEngine');
    const handler = vi.fn();
    const off = engine.onUnlock(handler);

    off();
    engine.unlock();
    await Promise.resolve();

    expect(engine.unlocked).toBe(true);
    expect(handler).not.toHaveBeenCalled();
  });

  const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

  it('settles one-shot playback when recovery closes its context', async () => {
    await withAppleUA(async () => {
      vi.useFakeTimers();
      const { instances, sources } = installAudioMocks({ autoEnd: false });
      const { ClickTone } = await import('./main');
      const sound = new ClickTone({ src: '/assets/click.wav' });
      const endHandler = vi.fn();
      sound.on('end', endHandler);
      const pending = sound.play();
      await vi.waitFor(() => expect(sound.playing).toBe(true));

      document.dispatchEvent(new Event('visibilitychange'));
      await vi.advanceTimersByTimeAsync(201);
      ClickTone.unlock();
      await pending;

      expect(instances).toHaveLength(2);
      expect(instances[0].closed).toBe(true);
      expect(sound.playing).toBe(false);
      expect(soundSources(sources)[0].stopped).toBe(true);
      expect(endHandler).not.toHaveBeenCalled();
      sound.destroy();
    });
  });

  it('restarts active loops on the replacement context', async () => {
    await withAppleUA(async () => {
      vi.useFakeTimers();
      const { instances, sources } = installAudioMocks();
      const { ClickTone } = await import('./main');
      const sound = new ClickTone({ src: '/assets/loop.wav', loop: true });
      await sound.play();

      document.dispatchEvent(new Event('visibilitychange'));
      await vi.advanceTimersByTimeAsync(201);
      ClickTone.unlock();
      await vi.waitFor(() => expect(soundSources(sources)).toHaveLength(2));

      expect(instances[0].closed).toBe(true);
      expect(soundSources(sources)[0].stopped).toBe(true);
      expect(soundSources(sources)[1].loop).toBe(true);
      expect(sound.playing).toBe(true);
      sound.destroy();
    });
  });

  it('cancels old-context requests while recovery is decoding a sound', async () => {
    await withAppleUA(async () => {
      vi.useFakeTimers();
      const decoded = deferred<AudioBuffer>();
      const { decodeSpy, sources } = installAudioMocks({ decode: () => decoded.promise });
      const { ClickTone } = await import('./main');
      const sound = new ClickTone({ src: '/assets/pending.wav', loop: true });
      const pending = sound.play();
      await vi.waitFor(() => expect(decodeSpy).toHaveBeenCalledOnce());

      document.dispatchEvent(new Event('visibilitychange'));
      await vi.advanceTimersByTimeAsync(201);
      ClickTone.unlock();
      await pending;
      decoded.resolve(audioBuffer());
      await vi.advanceTimersByTimeAsync(0);

      expect(sound.playing).toBe(false);
      expect(soundSources(sources)).toHaveLength(0);
      sound.destroy();
    });
  });

  it('does not evict a replacement cache entry when an old request fails', async () => {
    await withAppleUA(async () => {
      vi.useFakeTimers();
      const staleFetch = deferred<Response>();
      const freshFetch = deferred<Response>();
      const { fetchSpy } = installAudioMocks();
      fetchSpy.mockReturnValueOnce(staleFetch.promise).mockReturnValueOnce(freshFetch.promise);
      const { ClickTone } = await import('./main');
      const { engine } = await import('./engine/SharedAudioEngine');
      ClickTone.unlock();
      await Promise.resolve();
      const stale = engine.decode('/assets/shared.wav');
      const failed = stale.catch((error: unknown) => error);

      document.dispatchEvent(new Event('visibilitychange'));
      await vi.advanceTimersByTimeAsync(201);
      ClickTone.unlock();
      const fresh = engine.decode('/assets/shared.wav');
      staleFetch.reject(new Error('Old network request failed'));
      await failed;

      expect(engine.decode('/assets/shared.wav')).toBe(fresh);
      expect(fetchSpy).toHaveBeenCalledTimes(2);
      freshFetch.resolve(new Response(new ArrayBuffer(8)));
      await fresh;
    });
  });

  it('hard-recreates a zombie AudioContext after a lifecycle return on Apple WebKit', async () => {
    await withAppleUA(async () => {
      const { fetchSpy, instances } = installAudioMocks({ advancingTime: false });
      const { ClickTone } = await import('./main');
      ClickTone.setCacheLimit(1024 * 1024);
      const sound = new ClickTone({ src: '/assets/click.wav' });

      await sound.play();

      expect(instances).toHaveLength(1);
      expect(fetchSpy).toHaveBeenCalledTimes(1);

      // Returning to the tab kicks off a background zombie probe; the frozen
      // currentTime marks the context as dead.
      document.dispatchEvent(new Event('visibilitychange'));
      await wait(300);

      await sound.play();

      // Old context closed, a fresh one built, and the decode cache dropped.
      expect(instances).toHaveLength(2);
      expect(instances[0].closed).toBe(true);
      expect(fetchSpy).toHaveBeenCalledTimes(2);
      expect(ClickTone.cacheStats.maxBytes).toBe(1024 * 1024);
    });
  });

  it('keeps a healthy AudioContext after a lifecycle return on Apple WebKit', async () => {
    await withAppleUA(async () => {
      const { fetchSpy, instances } = installAudioMocks({ advancingTime: true });
      const { ClickTone } = await import('./main');
      const sound = new ClickTone({ src: '/assets/click.wav' });

      await sound.play();

      expect(instances).toHaveLength(1);
      expect(fetchSpy).toHaveBeenCalledTimes(1);

      // Advancing currentTime means the probe finds the context alive, so no
      // recreate and the decode cache survives.
      document.dispatchEvent(new Event('visibilitychange'));
      await wait(300);

      await sound.play();

      expect(instances).toHaveLength(1);
      expect(instances[0].closed).toBe(false);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });
  });
});
