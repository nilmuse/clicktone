import { describe, expect, it, vi } from 'vitest';
import { AudioBufferCache } from './AudioBufferCache';

const buffer = (length = 4, numberOfChannels = 1): AudioBuffer =>
  ({ length, numberOfChannels, sampleRate: 44100, duration: length / 44100 }) as AudioBuffer;

const deferred = <T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
} => {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, resolve, reject };
};

describe('AudioBufferCache', () => {
  it('retains decoded sounds without a byte limit by default', async () => {
    const cache = new AudioBufferCache();
    const mono = vi.fn(async () => buffer(4));
    const stereo = vi.fn(async () => buffer(4, 2));
    const first = await cache.load('/mono.wav', mono);
    const second = await cache.load('/stereo.wav', stereo);

    expect(await cache.load('/mono.wav', mono)).toBe(first);
    expect(await cache.load('/stereo.wav', stereo)).toBe(second);
    expect(mono).toHaveBeenCalledOnce();
    expect(stereo).toHaveBeenCalledOnce();
    expect(cache.stats).toEqual({ entries: 2, pending: 0, bytes: 48, maxBytes: null });
  });

  it('deduplicates in-progress loads even when retention is disabled', async () => {
    const cache = new AudioBufferCache();
    cache.setLimit(0);
    const pending = deferred<AudioBuffer>();
    const loader = vi.fn(() => pending.promise);

    const first = cache.load('/click.wav', loader);
    const second = cache.load('/click.wav', loader);

    expect(second).toBe(first);
    expect(cache.stats).toEqual({ entries: 0, pending: 1, bytes: 0, maxBytes: 0 });
    pending.resolve(buffer());
    await first;
    expect(loader).toHaveBeenCalledOnce();
    expect(cache.stats).toEqual({ entries: 0, pending: 0, bytes: 0, maxBytes: 0 });

    await cache.load('/click.wav', loader);
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it('evicts the least recently requested decoded buffer', async () => {
    const cache = new AudioBufferCache();
    cache.setLimit(32);
    const a = vi.fn(async () => buffer());
    const b = vi.fn(async () => buffer());
    const c = vi.fn(async () => buffer());

    const first = await cache.load('/a.wav', a);
    await cache.load('/b.wav', b);
    await cache.load('/a.wav', a);
    const third = await cache.load('/c.wav', c);

    expect(cache.stats).toEqual({ entries: 2, pending: 0, bytes: 32, maxBytes: 32 });
    expect(await cache.load('/a.wav', a)).toBe(first);
    expect(await cache.load('/c.wav', c)).toBe(third);
    expect(a).toHaveBeenCalledOnce();
    expect(c).toHaveBeenCalledOnce();
    await cache.load('/b.wav', b);
    expect(b).toHaveBeenCalledTimes(2);
  });

  it('enforces a smaller budget immediately and preserves recent sounds', async () => {
    const cache = new AudioBufferCache();
    const a = vi.fn(async () => buffer());
    const b = vi.fn(async () => buffer());
    const c = vi.fn(async () => buffer());
    await cache.load('/a.wav', a);
    await cache.load('/b.wav', b);
    await cache.load('/c.wav', c);
    await cache.load('/a.wav', a);

    cache.setLimit(32);

    expect(cache.stats.bytes).toBe(32);
    await cache.load('/a.wav', a);
    await cache.load('/c.wav', c);
    expect(a).toHaveBeenCalledOnce();
    expect(c).toHaveBeenCalledOnce();
    await cache.load('/b.wav', b);
    expect(b).toHaveBeenCalledTimes(2);
  });

  it('delivers oversized sounds without evicting useful smaller sounds', async () => {
    const cache = new AudioBufferCache();
    cache.setLimit(16);
    const small = vi.fn(async () => buffer());
    const large = vi.fn(async () => buffer(8));
    await cache.load('/small.wav', small);
    const oversized = await cache.load('/large.wav', large);

    expect(oversized.length).toBe(8);
    expect(cache.stats).toEqual({ entries: 1, pending: 0, bytes: 16, maxBytes: 16 });
    await cache.load('/small.wav', small);
    await cache.load('/large.wav', large);
    expect(small).toHaveBeenCalledOnce();
    expect(large).toHaveBeenCalledTimes(2);
  });

  it('discards oversized entries before trimming smaller ones when the limit changes', async () => {
    const cache = new AudioBufferCache();
    const small = vi.fn(async () => buffer());
    await cache.load('/small.wav', small);
    await cache.load('/large.wav', async () => buffer(16));

    cache.setLimit(16);
    await cache.load('/small.wav', small);

    expect(small).toHaveBeenCalledOnce();
    expect(cache.stats.bytes).toBe(16);
    expect(cache.stats.entries).toBe(1);
  });

  it('keeps pending work alive while shrinking the decoded-buffer budget', async () => {
    const cache = new AudioBufferCache();
    const pending = deferred<AudioBuffer>();
    const loading = cache.load('/pending.wav', () => pending.promise);
    await cache.load('/ready.wav', async () => buffer());

    cache.setLimit(8);
    expect(cache.stats).toEqual({ entries: 0, pending: 1, bytes: 0, maxBytes: 8 });
    const result = buffer();
    pending.resolve(result);

    expect(await loading).toBe(result);
    expect(cache.stats).toEqual({ entries: 0, pending: 0, bytes: 0, maxBytes: 8 });
  });

  it('allows disabling eviction again with null', async () => {
    const cache = new AudioBufferCache();
    cache.setLimit(16);
    await cache.load('/a.wav', async () => buffer());
    cache.setLimit(null);
    await cache.load('/b.wav', async () => buffer(8));

    expect(cache.stats).toEqual({ entries: 2, pending: 0, bytes: 48, maxBytes: null });
  });

  it.each([
    -1,
    NaN,
    Infinity,
    -Infinity,
    1.5,
    Number.MAX_SAFE_INTEGER + 1,
  ])('rejects an invalid budget %s without changing cache state', async (limit) => {
    const cache = new AudioBufferCache();
    cache.setLimit(16);
    await cache.load('/click.wav', async () => buffer());

    expect(() => cache.setLimit(limit)).toThrow(RangeError);
    expect(cache.stats).toEqual({ entries: 1, pending: 0, bytes: 16, maxBytes: 16 });
  });

  it('unloads only the selected buffer and allows it to be loaded again', async () => {
    const cache = new AudioBufferCache();
    const a = vi.fn(async () => buffer());
    const b = vi.fn(async () => buffer());
    await cache.load('/a.wav', a);
    await cache.load('/b.wav', b);

    expect(cache.delete('/a.wav')).toBe(true);
    expect(cache.delete('/a.wav')).toBe(false);
    expect(cache.stats.bytes).toBe(16);
    await cache.load('/b.wav', b);
    await cache.load('/a.wav', a);

    expect(a).toHaveBeenCalledTimes(2);
    expect(b).toHaveBeenCalledOnce();
  });

  it('does not restore an unloaded entry when its pending load completes', async () => {
    const cache = new AudioBufferCache();
    const pending = deferred<AudioBuffer>();
    const loading = cache.load('/click.wav', () => pending.promise);

    expect(cache.delete('/click.wav')).toBe(true);
    const result = buffer();
    pending.resolve(result);

    expect(await loading).toBe(result);
    expect(cache.stats).toEqual({ entries: 0, pending: 0, bytes: 0, maxBytes: null });
  });

  it('clears ready and pending entries without resetting the configured limit', async () => {
    const cache = new AudioBufferCache();
    cache.setLimit(32);
    await cache.load('/ready.wav', async () => buffer());
    const pending = deferred<AudioBuffer>();
    const loading = cache.load('/pending.wav', () => pending.promise);

    cache.clear();

    expect(cache.stats).toEqual({ entries: 0, pending: 0, bytes: 0, maxBytes: 32 });
    pending.resolve(buffer());
    await loading;
    expect(cache.stats.entries).toBe(0);
  });

  it.each([
    'resolve',
    'reject',
  ] as const)('keeps a replacement entry when a cleared load later %ss', async (outcome) => {
    const cache = new AudioBufferCache();
    const pending = deferred<AudioBuffer>();
    const stale = cache.load('/click.wav', () => pending.promise);
    const settled = stale.catch(() => undefined);
    cache.clear();
    const loader = vi.fn(async () => buffer(8));
    const current = await cache.load('/click.wav', loader);

    if (outcome === 'resolve') pending.resolve(buffer());
    else pending.reject(new Error('Old load failed'));
    await settled;

    expect(await cache.load('/click.wav', loader)).toBe(current);
    expect(loader).toHaveBeenCalledOnce();
    expect(cache.stats).toEqual({ entries: 1, pending: 0, bytes: 32, maxBytes: null });
  });

  it.each(['sync', 'async'] as const)('allows retry after a %s loader failure', async (kind) => {
    const cache = new AudioBufferCache();
    const error = new Error('Load failed');

    await expect(
      cache.load('/click.wav', () => {
        if (kind === 'sync') throw error;

        return Promise.reject(error);
      }),
    ).rejects.toBe(error);

    expect(cache.stats.entries).toBe(0);
    expect(cache.stats.pending).toBe(0);
    expect(await cache.load('/click.wav', async () => buffer())).toHaveProperty('length', 4);
  });

  it('returns independent snapshots of the cache statistics', async () => {
    const cache = new AudioBufferCache();
    const before = cache.stats;
    await cache.load('/click.wav', async () => buffer());

    expect(before.entries).toBe(0);
    expect(cache.stats.entries).toBe(1);
    expect(cache.stats).not.toBe(cache.stats);
  });
});
