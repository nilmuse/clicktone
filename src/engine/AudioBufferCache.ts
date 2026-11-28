import type { ClickToneCacheStats } from '../types';

type CacheEntry = {
  promise: Promise<AudioBuffer>;
  bytes: number | null;
};

export class AudioBufferCache {
  #entries = new Map<string, CacheEntry>();
  #bytes = 0;
  #maxBytes: number | null = null;

  get stats(): ClickToneCacheStats {
    let entries = 0;

    for (const entry of this.#entries.values()) {
      if (entry.bytes !== null) entries++;
    }

    return {
      entries,
      pending: this.#entries.size - entries,
      bytes: this.#bytes,
      maxBytes: this.#maxBytes,
    };
  }

  setLimit(maxBytes: number | null): void {
    if (maxBytes !== null && (!Number.isSafeInteger(maxBytes) || maxBytes < 0)) {
      throw new RangeError('Cache limit must be null or a non-negative safe integer in bytes.');
    }

    this.#maxBytes = maxBytes;
    if (maxBytes !== null) {
      for (const [url, entry] of this.#entries) {
        if (entry.bytes !== null && (maxBytes === 0 || entry.bytes > maxBytes)) this.delete(url);
      }
    }
    this.#trim();
  }

  clear(): void {
    this.#entries.clear();
    this.#bytes = 0;
  }

  delete(url: string): boolean {
    const entry = this.#entries.get(url);

    if (!entry) return false;
    if (entry.bytes !== null) this.#bytes -= entry.bytes;

    return this.#entries.delete(url);
  }

  load(url: string, loader: () => Promise<AudioBuffer>): Promise<AudioBuffer> {
    const cached = this.#entries.get(url);

    if (cached) {
      this.#entries.delete(url);
      this.#entries.set(url, cached);

      return cached.promise;
    }

    const promise = Promise.resolve().then(loader);
    const entry: CacheEntry = { promise, bytes: null };

    this.#entries.set(url, entry);
    void promise.then(
      (buffer) => {
        // An explicit unload, clear, or context recovery may have replaced it.
        if (this.#entries.get(url) !== entry) return;

        const bytes = buffer.length * buffer.numberOfChannels * Float32Array.BYTES_PER_ELEMENT;

        // A sound larger than the budget must not displace useful smaller sounds.
        if (this.#maxBytes !== null && (this.#maxBytes === 0 || bytes > this.#maxBytes)) {
          this.delete(url);

          return;
        }

        entry.bytes = bytes;
        this.#bytes += bytes;
        this.#trim();
      },
      () => {
        if (this.#entries.get(url) === entry) this.delete(url);
      },
    );

    return promise;
  }

  #trim(): void {
    if (this.#maxBytes === null) return;

    for (const [url, entry] of this.#entries) {
      if (this.#bytes <= this.#maxBytes) break;
      if (entry.bytes !== null) this.delete(url);
    }
  }
}
