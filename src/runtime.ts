export const hasDOM = typeof window !== 'undefined' && typeof document !== 'undefined';

export const noop = (): void => {};

export const abortable = <T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> => {
  if (!signal) return promise;

  return new Promise<T>((resolve, reject) => {
    const cancel = (): void => reject(signal.reason);

    if (signal.aborted) {
      void promise.catch(noop);
      cancel();

      return;
    }

    signal.addEventListener('abort', cancel, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', cancel);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', cancel);
        reject(error);
      },
    );
  });
};

/**
 * iOS Safari (and desktop Safari) can leave an AudioContext in a "zombie"
 * state after a tab switch / lock-screen return: `state === 'running'` yet no
 * audio is produced. The only deterministic fix is recreating the context, but
 * that cost is pointless on engines without the bug (e.g. desktop Chrome), so
 * we gate the hard-recovery path behind this detection.
 */
export const isAppleWebAudioFlaky = (): boolean => {
  if (!hasDOM) return false;

  const ua = navigator.userAgent;
  const iOS = /iP(hone|ad|od)/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  const safari = /^((?!chrome|android|crios|fxios|edg).)*safari/i.test(ua);

  return iOS || safari;
};

export const clampVolume = (value: number): number => {
  if (!Number.isFinite(value) || value < 0) return 0;

  return value > 1 ? 1 : value;
};
