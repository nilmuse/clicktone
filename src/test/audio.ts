import { afterEach, beforeEach, vi } from 'vitest';

export type FakeBufferSource = {
  buffer: AudioBuffer | null;
  loop: boolean;
  playbackRate: { value: number };
  onended: (() => void) | null;
  connect: () => void;
  disconnect: () => void;
  start: () => void;
  stop: () => void;
  stopped: boolean;
  started: boolean;
};

export const audioBuffer = (): AudioBuffer =>
  ({ duration: 0.05, length: 2205, numberOfChannels: 1 }) as AudioBuffer;

export const installAudioMocks = (
  options: {
    advancingTime?: boolean;
    autoEnd?: boolean;
    decode?: () => Promise<AudioBuffer>;
    resume?: () => Promise<void>;
    startError?: Error;
  } = {},
): {
  fetchSpy: ReturnType<typeof vi.fn>;
  decodeSpy: ReturnType<typeof vi.fn>;
  instances: {
    closed: boolean;
    state: AudioContextState;
    resume: () => Promise<void>;
  }[];
  sources: FakeBufferSource[];
} => {
  const { advancingTime = false, autoEnd = true } = options;
  const fetchSpy = vi.fn(async () => ({
    ok: true,
    status: 200,
    statusText: 'OK',
    arrayBuffer: async () => new ArrayBuffer(8),
  }));

  const instances: {
    closed: boolean;
    state: AudioContextState;
    resume: () => Promise<void>;
  }[] = [];
  const sources: FakeBufferSource[] = [];
  const decodeSpy = vi.fn(async (): Promise<AudioBuffer> => {
    if (options.decode) return options.decode();

    return audioBuffer();
  });

  const fakeAudioContextClass = class FakeAudioContext {
    state: AudioContextState = 'suspended';
    sampleRate = 44100;
    #t = 0;
    destination = {};
    closed = false;

    constructor() {
      instances.push(this);
    }

    get currentTime(): number {
      // A healthy running context keeps advancing currentTime; a zombie one
      // reports "running" but stays frozen at 0.
      if (advancingTime) this.#t += 0.05;

      return this.#t;
    }

    async resume(): Promise<void> {
      if (options.resume) await options.resume();
      this.state = 'running';
    }

    async close(): Promise<void> {
      this.closed = true;
      this.state = 'closed';
    }

    createGain(): GainNode {
      const gain = {
        value: 1,
        cancelScheduledValues: () => {},
        setValueAtTime: () => {},
        linearRampToValueAtTime: () => {},
      };

      return {
        context: this,
        gain,
        connect: () => {},
        disconnect: vi.fn(),
      } as unknown as GainNode;
    }

    createBuffer(): AudioBuffer {
      return { duration: 1 / this.sampleRate } as AudioBuffer;
    }

    createBufferSource(): AudioBufferSourceNode {
      const node: FakeBufferSource = {
        buffer: null,
        loop: false,
        playbackRate: { value: 1 },
        onended: null,
        connect: () => {},
        disconnect: vi.fn(),
        start: () => {
          if (options.startError) throw options.startError;
          node.started = true;
          if (autoEnd && !node.loop) queueMicrotask(() => node.onended?.());
        },
        stop: () => {
          node.stopped = true;
          queueMicrotask(() => node.onended?.());
        },
        stopped: false,
        started: false,
      };

      sources.push(node);

      return node as unknown as AudioBufferSourceNode;
    }

    async decodeAudioData(): Promise<AudioBuffer> {
      return decodeSpy();
    }
  };

  vi.stubGlobal('fetch', fetchSpy);
  vi.stubGlobal('AudioContext', fakeAudioContextClass);
  vi.stubGlobal('webkitAudioContext', fakeAudioContextClass);

  return { fetchSpy, decodeSpy, instances, sources };
};

export const deferred = <T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: Error) => void;
} => {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, resolve, reject };
};

export const soundSources = (sources: FakeBufferSource[]): FakeBufferSource[] =>
  sources.filter((source) => source.buffer?.duration === 0.05);

export const useAudioTestEnvironment = (): void => {
  const listeners: {
    target: EventTarget;
    type: string;
    listener: EventListenerOrEventListenerObject;
    options?: boolean | AddEventListenerOptions;
  }[] = [];

  beforeEach(() => {
    vi.resetModules();
    document.body.replaceChildren();

    for (const target of [window, document]) {
      const add = target.addEventListener.bind(target);

      vi.spyOn(target, 'addEventListener').mockImplementation((type, listener, options) => {
        listeners.push({ target, type, listener, options });
        add(type, listener, options);
      });
    }
  });

  afterEach(() => {
    for (const { target, type, listener, options } of listeners.splice(0)) {
      target.removeEventListener(type, listener, options);
    }

    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });
};

export const withAppleUA = async (run: () => Promise<void>): Promise<void> => {
  const originalUA = navigator.userAgent;
  Object.defineProperty(navigator, 'userAgent', {
    value:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    configurable: true,
  });

  try {
    await run();
  } finally {
    Object.defineProperty(navigator, 'userAgent', {
      value: originalUA,
      configurable: true,
    });
  }
};
