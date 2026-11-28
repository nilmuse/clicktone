import { describe, expect, it, vi } from 'vitest';
import {
  deferred,
  installAudioMocks,
  soundSources,
  useAudioTestEnvironment,
  withAppleUA,
} from './test/audio';

describe('ClickTone voice limits', () => {
  useAudioTestEnvironment();

  it.each([undefined, null])('keeps overlap unlimited with maxVoices=%s', async (maxVoices) => {
    const { sources } = installAudioMocks();
    const { ClickTone } = await import('./main');
    const sound = new ClickTone({ src: '/click.wav', loop: true, maxVoices });

    await Promise.all([sound.play(), sound.play(), sound.play()]);

    expect(sound.voiceCount).toBe(3);
    expect(soundSources(sources).every((source) => source.started && !source.stopped)).toBe(true);
    sound.destroy();
    expect(sound.voiceCount).toBe(0);
  });

  it('stops only the oldest started voice when a new voice reaches the limit', async () => {
    const { sources } = installAudioMocks();
    const { ClickTone } = await import('./main');
    const sound = new ClickTone({ src: '/click.wav', loop: true, maxVoices: 2 });
    const stop = vi.fn();
    const end = vi.fn();
    sound.on('stop', stop);
    sound.on('end', end);

    await sound.play();
    await sound.play();
    await sound.play();

    const voices = soundSources(sources);
    expect(voices.map((voice) => voice.stopped)).toEqual([true, false, false]);
    expect(voices[0].disconnect).toHaveBeenCalledOnce();
    expect(sound.voiceCount).toBe(2);
    expect(sound.playing).toBe(true);
    expect(stop).toHaveBeenCalledOnce();
    expect(end).not.toHaveBeenCalled();
    sound.destroy();
  });

  it('settles the displaced one-shot promise without relying on a native ended event', async () => {
    const { sources } = installAudioMocks({ autoEnd: false });
    const { ClickTone } = await import('./main');
    const sound = new ClickTone({ src: '/click.wav', maxVoices: 1 });
    const end = vi.fn();
    sound.on('end', end);
    const original = sound.play();
    await vi.waitFor(() => expect(sound.voiceCount).toBe(1));
    const oldest = soundSources(sources)[0];
    oldest.stop = vi.fn();

    await sound.play({ loop: true });
    await original;

    expect(oldest.stop).toHaveBeenCalledOnce();
    expect(oldest.onended).toBeNull();
    expect(sound.voiceCount).toBe(1);
    expect(end).not.toHaveBeenCalled();
    sound.destroy();
  });

  it('keeps the current voice until a pending replacement has loaded', async () => {
    const loaded = deferred<Response>();
    const { fetchSpy, sources } = installAudioMocks();
    const { ClickTone } = await import('./main');
    const sound = new ClickTone({ src: '/ready.wav', maxVoices: 1, loop: true });
    await sound.play();
    fetchSpy.mockReturnValueOnce(loaded.promise);

    const replacement = sound.play('/slow.wav');
    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalledWith('/slow.wav'));
    expect(sound.voiceCount).toBe(1);
    expect(soundSources(sources)[0].stopped).toBe(false);
    loaded.resolve(new Response(new ArrayBuffer(8)));
    await replacement;

    expect(sound.voiceCount).toBe(1);
    expect(soundSources(sources).map((source) => source.stopped)).toEqual([true, false]);
    sound.destroy();
  });

  it('uses actual start order when requests finish loading out of order', async () => {
    const loaded = deferred<Response>();
    const { fetchSpy, sources } = installAudioMocks();
    fetchSpy.mockReturnValueOnce(loaded.promise);
    const { ClickTone } = await import('./main');
    const sound = new ClickTone({ src: '/slow.wav', maxVoices: 1, loop: true });
    const slow = sound.play();
    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalledWith('/slow.wav'));

    await sound.play('/fast.wav');
    const fastVoice = soundSources(sources)[0];
    expect(fastVoice.stopped).toBe(false);
    loaded.resolve(new Response(new ArrayBuffer(8)));
    await slow;

    expect(fastVoice.stopped).toBe(true);
    expect(sound.voiceCount).toBe(1);
    expect(soundSources(sources)).toHaveLength(2);
    sound.destroy();
  });

  it('preserves the existing voice if loading the new sound fails', async () => {
    const { fetchSpy, sources } = installAudioMocks();
    const { ClickTone } = await import('./main');
    const sound = new ClickTone({ src: '/ready.wav', maxVoices: 1, loop: true });
    const stop = vi.fn();
    const error = vi.fn();
    sound.on('stop', stop);
    sound.on('error', error);
    await sound.play();
    fetchSpy.mockRejectedValueOnce(new Error('Network failed'));

    await sound.play('/failed.wav');

    expect(error).toHaveBeenCalledWith(new Error('Network failed'));
    expect(stop).not.toHaveBeenCalled();
    expect(sound.voiceCount).toBe(1);
    expect(soundSources(sources)[0].stopped).toBe(false);
    sound.destroy();
  });

  it('preserves the existing voice if preparing a new source fails', async () => {
    const { sources } = installAudioMocks();
    const { ClickTone } = await import('./main');
    const sound = new ClickTone({ src: '/ready.wav', maxVoices: 1, loop: true });
    const error = vi.fn();
    sound.on('error', error);
    await sound.play();
    vi.spyOn(AudioContext.prototype, 'createBufferSource').mockImplementation(() => {
      throw new Error('Source creation failed');
    });

    await sound.play();

    expect(error).toHaveBeenCalledWith(new Error('Source creation failed'));
    expect(sound.voiceCount).toBe(1);
    expect(soundSources(sources)[0].stopped).toBe(false);
    sound.destroy();
  });

  it('releases a slot when a sound ends naturally', async () => {
    const { sources } = installAudioMocks({ autoEnd: false });
    const { ClickTone } = await import('./main');
    const sound = new ClickTone({ src: '/click.wav', maxVoices: 1 });
    const stop = vi.fn();
    sound.on('stop', stop);
    const first = sound.play();
    await vi.waitFor(() => expect(sound.voiceCount).toBe(1));

    soundSources(sources)[0].onended?.();
    await first;
    expect(sound.voiceCount).toBe(0);
    await sound.play({ loop: true });

    expect(sound.voiceCount).toBe(1);
    expect(stop).not.toHaveBeenCalled();
    sound.destroy();
  });

  it('keeps voice limits local to each instance', async () => {
    const { sources } = installAudioMocks();
    const { ClickTone } = await import('./main');
    const first = new ClickTone({ src: '/click.wav', maxVoices: 1, loop: true });
    const second = new ClickTone({ src: '/click.wav', maxVoices: 1, loop: true });
    await first.play();
    await second.play();
    await first.play();

    expect(first.voiceCount).toBe(1);
    expect(second.voiceCount).toBe(1);
    expect(soundSources(sources).map((source) => source.stopped)).toEqual([true, false, false]);
    first.destroy();
    second.destroy();
  });

  it('does not steal a voice for throttled or ignored requests, and restart bypasses throttle', async () => {
    const { sources } = installAudioMocks();
    vi.spyOn(Date, 'now').mockReturnValue(1000);
    const { ClickTone } = await import('./main');
    const sound = new ClickTone({ src: '/click.wav', maxVoices: 1, loop: true, throttle: 500 });
    await sound.play();

    await sound.play();
    await sound.play({ replay: 'ignore-if-playing' });

    expect(soundSources(sources)).toHaveLength(1);
    expect(soundSources(sources)[0].stopped).toBe(false);
    await sound.play({ replay: 'restart' });
    expect(soundSources(sources).map((source) => source.stopped)).toEqual([true, false]);
    expect(sound.voiceCount).toBe(1);
    sound.destroy();
  });

  it('honors destroy in a voice-eviction stop listener and releases the prepared source', async () => {
    const { sources } = installAudioMocks();
    const { ClickTone } = await import('./main');
    const sound = new ClickTone({ src: '/click.wav', maxVoices: 1, loop: true });
    await sound.play();
    sound.once('stop', () => sound.destroy());

    await sound.play();

    const voices = soundSources(sources);
    expect(sound.voiceCount).toBe(0);
    expect(voices.filter((voice) => voice.started)).toHaveLength(1);
    expect(voices[1].disconnect).toHaveBeenCalledOnce();
  });

  it('honors a newer restart requested from a voice-eviction stop listener', async () => {
    const { sources } = installAudioMocks();
    const { ClickTone } = await import('./main');
    const sound = new ClickTone({ src: '/click.wav', maxVoices: 1, loop: true });
    await sound.play();
    let queued: Promise<void> | undefined;
    sound.once('stop', () => {
      queued = sound.play({ replay: 'restart' });
    });

    await sound.play();
    expect(queued).toBeDefined();
    await queued;

    expect(sound.voiceCount).toBe(1);
    expect(soundSources(sources).filter((voice) => voice.started)).toHaveLength(2);
    expect(soundSources(sources)[1].disconnect).toHaveBeenCalledOnce();
    sound.destroy();
  });

  it('restores only surviving loops after context recovery and respects the limit', async () => {
    await withAppleUA(async () => {
      vi.useFakeTimers();
      const { fetchSpy } = installAudioMocks();
      const { ClickTone } = await import('./main');
      const sound = new ClickTone({ src: '/default.wav', maxVoices: 2, loop: true });
      await sound.play('/a.wav');
      await sound.play('/b.wav');
      await sound.play('/c.wav');

      document.dispatchEvent(new Event('visibilitychange'));
      await vi.advanceTimersByTimeAsync(201);
      ClickTone.unlock();
      await vi.waitFor(() => expect(sound.voiceCount).toBe(2));

      const urls = fetchSpy.mock.calls.map(([url]) => url);
      expect(urls.filter((url) => url === '/a.wav')).toHaveLength(1);
      expect(urls.filter((url) => url === '/b.wav')).toHaveLength(2);
      expect(urls.filter((url) => url === '/c.wav')).toHaveLength(2);
      expect(sound.voiceCount).toBe(2);
      sound.destroy();
    });
  });

  it.each([
    0,
    -1,
    1.5,
    NaN,
    Infinity,
    -Infinity,
    Number.MAX_SAFE_INTEGER + 1,
  ])('rejects maxVoices=%s before installing instance listeners', async (maxVoices) => {
    installAudioMocks();
    const { ClickTone } = await import('./main');
    const add = vi.spyOn(window, 'addEventListener');
    const registrations = add.mock.calls.length;

    expect(() => new ClickTone({ src: '/click.wav', maxVoices })).toThrow(RangeError);
    expect(add.mock.calls).toHaveLength(registrations);
  });
});
