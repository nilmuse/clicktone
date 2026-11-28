import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  audioBuffer,
  deferred,
  installAudioMocks,
  soundSources,
  useAudioTestEnvironment,
  withAppleUA,
} from './test/audio';

describe('ClickTone source fallback', () => {
  useAudioTestEnvironment();

  beforeEach(() => {
    vi.spyOn(HTMLMediaElement.prototype, 'canPlayType').mockReturnValue('');
  });

  it.each([
    'play',
    'preload',
  ] as const)('preserves single-source behavior by default for %s', async (operation) => {
    const { fetchSpy } = installAudioMocks();
    const failure = new Error('Network unavailable');
    fetchSpy.mockRejectedValueOnce(failure);
    const { ClickTone } = await import('./main');
    const sound = new ClickTone({ src: ['/first.wav', '/second.wav'] });
    const error = vi.fn();
    sound.on('error', error);

    await sound[operation]();

    expect(fetchSpy.mock.calls).toEqual([['/first.wav']]);
    expect(error).toHaveBeenCalledExactlyOnceWith(failure);
    sound.destroy();
  });

  it('tries alternatives after network, HTTP, response-body, and decode failures', async () => {
    const { fetchSpy, decodeSpy, sources } = installAudioMocks();
    fetchSpy
      .mockRejectedValueOnce(new Error('Network failure'))
      .mockResolvedValueOnce(new Response(null, { status: 404, statusText: 'Not Found' }))
      .mockResolvedValueOnce({
        ok: true,
        arrayBuffer: () => Promise.reject(new Error('Body failure')),
      });
    decodeSpy.mockRejectedValueOnce(new Error('Invalid audio'));
    const { ClickTone } = await import('./main');
    const sound = new ClickTone({
      src: ['/network.wav', '/missing.wav', '/body.wav', '/invalid.wav', '/ready.wav'],
      fallback: true,
    });
    const error = vi.fn();
    const play = vi.fn();
    const end = vi.fn();
    sound.on('error', error);
    sound.on('play', play);
    sound.on('end', end);

    await sound.play();

    expect(fetchSpy.mock.calls.map(([url]) => url)).toEqual([
      '/network.wav',
      '/missing.wav',
      '/body.wav',
      '/invalid.wav',
      '/ready.wav',
    ]);
    expect(decodeSpy).toHaveBeenCalledTimes(2);
    expect(soundSources(sources)).toHaveLength(1);
    expect(play).toHaveBeenCalledOnce();
    expect(end).toHaveBeenCalledOnce();
    expect(error).not.toHaveBeenCalled();
    expect(ClickTone.cacheStats.entries).toBe(1);
    sound.destroy();
  });

  it('starts with the selected format, then tries unique URLs in declared order', async () => {
    vi.mocked(HTMLMediaElement.prototype.canPlayType).mockImplementation((type) =>
      type === 'audio/mpeg' ? 'probably' : '',
    );
    const { fetchSpy } = installAudioMocks();
    fetchSpy.mockRejectedValueOnce(new Error('MP3 failure'));
    fetchSpy.mockRejectedValueOnce(new Error('OGG failure'));
    const { ClickTone } = await import('./main');
    const sound = new ClickTone({
      src: ['/first.ogg', '/preferred.mp3', '/first.ogg', '/last.wav', '/preferred.mp3'],
      fallback: true,
    });

    await sound.play();

    expect(fetchSpy.mock.calls.map(([url]) => url)).toEqual([
      '/preferred.mp3',
      '/first.ogg',
      '/last.wav',
    ]);
    sound.destroy();
  });

  it('preloads an alternative and emits load once with its buffer', async () => {
    const buffer = audioBuffer();
    const { fetchSpy } = installAudioMocks({ decode: async () => buffer });
    fetchSpy.mockRejectedValueOnce(new Error('Primary unavailable'));
    const { ClickTone } = await import('./main');
    const sound = new ClickTone({
      src: ['/first.wav', '/second.wav'],
      fallback: true,
      preload: true,
    });
    const load = vi.fn();
    const error = vi.fn();
    sound.on('load', load);
    sound.on('error', error);

    await vi.waitFor(() => expect(load).toHaveBeenCalledExactlyOnceWith(buffer));

    expect(error).not.toHaveBeenCalled();
    expect(fetchSpy.mock.calls.map(([url]) => url)).toEqual(['/first.wav', '/second.wav']);
    sound.destroy();
  });

  it.each([
    'play',
    'preload',
  ] as const)('emits one AggregateError containing all failures when %s exhausts the list', async (operation) => {
    const { fetchSpy, sources } = installAudioMocks();
    const first = new Error('First failure');
    const second = new Error('Second failure');
    fetchSpy.mockRejectedValueOnce(first).mockRejectedValueOnce(second);
    const { ClickTone } = await import('./main');
    const sound = new ClickTone({ src: ['/first.wav', '/second.wav'], fallback: true });
    const error = vi.fn();
    sound.on('error', error);

    expect(await sound[operation]()).toBeUndefined();

    expect(error).toHaveBeenCalledOnce();
    const failure = error.mock.calls[0][0];
    expect(failure).toBeInstanceOf(AggregateError);
    expect(failure.errors).toEqual([first, second]);
    expect(failure.message).toContain('/first.wav, /second.wav');
    expect(soundSources(sources)).toHaveLength(0);
    expect(ClickTone.cacheStats).toMatchObject({ entries: 0, pending: 0 });
    sound.destroy();
  });

  it('preserves the original error for one unique URL', async () => {
    const { fetchSpy } = installAudioMocks();
    const failure = new Error('Original failure');
    fetchSpy.mockRejectedValue(failure);
    const { ClickTone } = await import('./main');
    const sound = new ClickTone({ src: ['/only.wav', '/only.wav'], fallback: true });
    const error = vi.fn();
    sound.on('error', error);

    await sound.play();

    expect(error).toHaveBeenCalledExactlyOnceWith(failure);
    expect(fetchSpy).toHaveBeenCalledOnce();
    sound.destroy();
  });

  it('allows fallback to be enabled for one call using the configured sources', async () => {
    const { fetchSpy } = installAudioMocks();
    const { ClickTone } = await import('./main');
    const sound = new ClickTone({ src: ['/first.wav', '/second.wav'] });
    fetchSpy.mockRejectedValueOnce(new Error('Unavailable'));

    await sound.play({ fallback: true });

    expect(fetchSpy.mock.calls.map(([url]) => url)).toEqual(['/first.wav', '/second.wav']);
    sound.destroy();
  });

  it('allows fallback to be disabled for one call and inherits it for a source override', async () => {
    const { fetchSpy } = installAudioMocks();
    const { ClickTone } = await import('./main');
    const sound = new ClickTone({ src: ['/first.wav', '/second.wav'], fallback: true });
    const error = vi.fn();
    sound.on('error', error);
    fetchSpy.mockRejectedValueOnce(new Error('Unavailable'));

    await sound.play({ fallback: false });
    expect(fetchSpy.mock.calls).toEqual([['/first.wav']]);
    expect(error).toHaveBeenCalledOnce();
    fetchSpy.mockRejectedValueOnce(new Error('Override unavailable'));
    await sound.play(['/override.wav', '/ready.wav']);

    expect(fetchSpy.mock.calls.map(([url]) => url)).toEqual([
      '/first.wav',
      '/override.wav',
      '/ready.wav',
    ]);
    sound.destroy();
  });

  it('accepts fallback with a string override without treating the options as a descriptor', async () => {
    const { fetchSpy } = installAudioMocks();
    const { ClickTone } = await import('./main');
    const sound = new ClickTone({ src: '/default.wav' });

    await sound.play({ src: '/override.wav', fallback: true });

    expect(fetchSpy.mock.calls).toEqual([['/override.wav']]);
    sound.destroy();
  });

  it('resolves alternatives from an audio element referenced by id', async () => {
    document.body.innerHTML =
      '<audio id="sound"><source src="/first.wav"><source src="/second.wav"></audio>';
    const first = (document.querySelectorAll('source')[0] as HTMLSourceElement).src;
    const second = (document.querySelectorAll('source')[1] as HTMLSourceElement).src;
    const { fetchSpy } = installAudioMocks();
    fetchSpy.mockRejectedValueOnce(new Error('Unavailable'));
    const { ClickTone } = await import('./main');
    const sound = new ClickTone({ src: { id: 'sound' }, fallback: true });

    await sound.play();

    expect(fetchSpy.mock.calls.map(([url]) => url)).toEqual([first, second]);
    sound.destroy();
  });

  it('shares each load across concurrent preload and play requests', async () => {
    const loaded = deferred<Response>();
    const { fetchSpy, decodeSpy } = installAudioMocks();
    fetchSpy.mockReturnValueOnce(loaded.promise);
    const { ClickTone } = await import('./main');
    const first = new ClickTone({ src: ['/first.wav', '/second.wav'], fallback: true });
    const second = new ClickTone({ src: ['/first.wav', '/second.wav'], fallback: true });
    const preloading = first.preload();
    const playing = second.play();
    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalledOnce());
    loaded.reject(new Error('Primary unavailable'));

    expect(await preloading).toBeDefined();
    await playing;

    expect(fetchSpy.mock.calls.map(([url]) => url)).toEqual(['/first.wav', '/second.wav']);
    expect(decodeSpy).toHaveBeenCalledOnce();
    first.destroy();
    second.destroy();
  });

  it('retries the primary on the next request and reuses the cached alternative', async () => {
    const { fetchSpy, decodeSpy } = installAudioMocks();
    const { ClickTone } = await import('./main');
    const sound = new ClickTone({ src: ['/first.wav', '/second.wav'], fallback: true });
    fetchSpy.mockRejectedValueOnce(new Error('Unavailable'));
    await sound.play();
    fetchSpy.mockRejectedValueOnce(new Error('Still unavailable'));

    await sound.play();

    expect(fetchSpy.mock.calls.map(([url]) => url)).toEqual([
      '/first.wav',
      '/second.wav',
      '/first.wav',
    ]);
    expect(decodeSpy).toHaveBeenCalledOnce();
    sound.destroy();
  });

  it('unloads all configured alternatives, including one used by a per-call fallback', async () => {
    const { fetchSpy } = installAudioMocks();
    const { ClickTone } = await import('./main');
    const sound = new ClickTone({ src: ['/first.wav', '/second.wav', '/third.wav'] });
    await sound.preload();
    await sound.play('/second.wav');
    await sound.play('/unrelated.wav');
    ClickTone.clearCache(['/first.wav', '/second.wav']);
    fetchSpy.mockRejectedValueOnce(new Error('Unavailable'));
    await sound.play({ fallback: true });
    expect(ClickTone.cacheStats.entries).toBe(2);

    expect(sound.unload()).toBe(true);
    expect(sound.unload()).toBe(false);

    expect(ClickTone.cacheStats.entries).toBe(1);
    sound.destroy();
  });

  it.each([
    'stop',
    'destroy',
    'restart',
  ] as const)('cancels a pending attempt on %s without starting its remaining alternatives', async (action) => {
    const loaded = deferred<Response>();
    const { fetchSpy, sources } = installAudioMocks();
    fetchSpy
      .mockRejectedValueOnce(new Error('First unavailable'))
      .mockReturnValueOnce(loaded.promise);
    const { ClickTone } = await import('./main');
    const sound = new ClickTone({
      src: ['/first.wav', '/slow.wav', '/second.wav'],
      fallback: true,
    });
    const error = vi.fn();
    sound.on('error', error);
    const playing = sound.play();
    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalledWith('/slow.wav'));

    if (action === 'restart') {
      await sound.play({ src: '/latest.wav', replay: 'restart' });
    } else {
      sound[action]();
    }
    await playing;
    loaded.reject(new Error('Late failure'));
    await Promise.resolve();
    await Promise.resolve();

    expect(fetchSpy.mock.calls.map(([url]) => url)).toEqual(
      action === 'restart'
        ? ['/first.wav', '/slow.wav', '/latest.wav']
        : ['/first.wav', '/slow.wav'],
    );
    expect(error).not.toHaveBeenCalled();
    expect(soundSources(sources)).toHaveLength(action === 'restart' ? 1 : 0);
    sound.destroy();
  });

  it('does not cancel another instance sharing the failed load', async () => {
    const loaded = deferred<Response>();
    const { fetchSpy } = installAudioMocks();
    fetchSpy.mockReturnValueOnce(loaded.promise);
    const { ClickTone } = await import('./main');
    const first = new ClickTone({ src: ['/slow.wav', '/ready.wav'], fallback: true });
    const second = new ClickTone({ src: ['/slow.wav', '/ready.wav'], fallback: true });
    const cancelled = first.play();
    const playing = second.play();
    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalledOnce());
    first.destroy();
    await cancelled;
    loaded.reject(new Error('Shared failure'));

    await playing;

    expect(fetchSpy.mock.calls.map(([url]) => url)).toEqual(['/slow.wav', '/ready.wav']);
    second.destroy();
  });

  it('does not start another preload attempt after destruction', async () => {
    const loaded = deferred<Response>();
    const { fetchSpy } = installAudioMocks();
    fetchSpy.mockReturnValueOnce(loaded.promise);
    const { ClickTone } = await import('./main');
    const sound = new ClickTone({ src: ['/slow.wav', '/second.wav'], fallback: true });
    const error = vi.fn();
    const load = vi.fn();
    sound.on('error', error);
    sound.on('load', load);
    const preloading = sound.preload();
    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalledOnce());
    sound.destroy();
    loaded.reject(new Error('Late failure'));

    expect(await preloading).toBeUndefined();

    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(error).not.toHaveBeenCalled();
    expect(load).not.toHaveBeenCalled();
  });

  it('reports source-start errors without trying other URLs', async () => {
    const failure = new Error('Cannot start source');
    const { fetchSpy } = installAudioMocks({ startError: failure });
    const { ClickTone } = await import('./main');
    const sound = new ClickTone({ src: ['/first.wav', '/second.wav'], fallback: true });
    const error = vi.fn();
    sound.on('error', error);

    await sound.play();

    expect(fetchSpy.mock.calls).toEqual([['/first.wav']]);
    expect(error).toHaveBeenCalledExactlyOnceWith(failure);
    expect(sound.voiceCount).toBe(0);
    sound.destroy();
  });

  it('waits for audio unlock before loading and cancels that wait without fallback', async () => {
    const resumed = deferred<void>();
    const { fetchSpy, instances } = installAudioMocks({ resume: () => resumed.promise });
    const { ClickTone } = await import('./main');
    const sound = new ClickTone({ src: ['/first.wav', '/second.wav'], fallback: true });
    const error = vi.fn();
    sound.on('error', error);
    const playing = sound.play();
    await vi.waitFor(() => expect(instances).toHaveLength(1));
    expect(fetchSpy).not.toHaveBeenCalled();

    sound.stop();
    await playing;
    resumed.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    sound.destroy();
  });

  it.each([
    'play',
    'preload',
  ] as const)('reports missing Web Audio once without fetching alternatives during %s', async (operation) => {
    const { fetchSpy } = installAudioMocks();
    vi.stubGlobal('AudioContext', undefined);
    vi.stubGlobal('webkitAudioContext', undefined);
    const { ClickTone } = await import('./main');
    const sound = new ClickTone({ src: ['/first.wav', '/second.wav'], fallback: true });
    const error = vi.fn();
    sound.on('error', error);

    await sound[operation]();

    expect(error).toHaveBeenCalledExactlyOnceWith(new Error('Web Audio API is not available.'));
    expect(fetchSpy).not.toHaveBeenCalled();
    sound.destroy();
  });

  it('restores a loop using its last working URL and retains its alternatives', async () => {
    await withAppleUA(async () => {
      vi.useFakeTimers();
      const { fetchSpy } = installAudioMocks();
      fetchSpy.mockRejectedValueOnce(new Error('First unavailable'));
      const { ClickTone } = await import('./main');
      const sound = new ClickTone({
        src: ['/first.wav', '/second.wav'],
        fallback: true,
        loop: true,
      });
      await sound.play();
      fetchSpy.mockRejectedValueOnce(new Error('Second now unavailable'));

      document.dispatchEvent(new Event('visibilitychange'));
      await vi.advanceTimersByTimeAsync(201);
      ClickTone.unlock();
      await vi.waitFor(() => expect(sound.voiceCount).toBe(1));

      expect(fetchSpy.mock.calls.map(([url]) => url)).toEqual([
        '/first.wav',
        '/second.wav',
        '/second.wav',
        '/first.wav',
      ]);
      sound.destroy();
    });
  });
});
