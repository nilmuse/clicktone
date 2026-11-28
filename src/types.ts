declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext;
  }
}

export interface SoundDescriptor {
  src: string;
  type?: string;
}

export type SoundSource =
  | string
  | URL
  | SoundDescriptor
  | { id: string }
  | HTMLSourceElement
  | HTMLAudioElement;

export type SoundInput = SoundSource | SoundSource[];

export type ReplayBehavior = 'overlap' | 'interrupt' | 'ignore-if-playing' | 'restart';

export interface ClickToneCacheStats {
  /** Number of retained decoded buffers. */
  readonly entries: number;
  /** Number of in-progress loads currently tracked for deduplication. */
  readonly pending: number;
  /** Retained PCM bytes; does not measure total playback or application memory. */
  readonly bytes: number;
  /** PCM byte budget, or null for unlimited retention. */
  readonly maxBytes: number | null;
}

export interface PlayOptions {
  /** Override the configured source for this request. */
  src?: SoundInput;
  /** Resolve play() when the loop starts; use stop() to end it. */
  loop?: boolean;
  /** Control pending requests and started sources; restart bypasses throttle. */
  replay?: ReplayBehavior;
  /** Try other source URLs on fetch/decode failure. Overrides the instance default. */
  fallback?: boolean;
}

export interface ClickToneOptions {
  src: SoundInput;
  volume?: number;
  muted?: boolean;
  /** Minimum interval between accepted play requests, in milliseconds. */
  throttle?: number;
  /** Random playback-rate variation from 0 to 1; also changes sound duration. */
  pitchVariation?: number;
  preload?: boolean;
  loop?: boolean;
  replay?: ReplayBehavior;
  /** Try other source URLs on fetch/decode failure. Disabled by default. */
  fallback?: boolean;
  /** Maximum started voices per instance. null (default) is unlimited; must otherwise be a positive safe integer. */
  maxVoices?: number | null;
  debug?: boolean;
}

export interface ClickToneEventDetail {
  play: undefined;
  end: undefined;
  stop: undefined;
  unlock: undefined;
  load: AudioBuffer;
  error: Error;
}

export type ClickToneEventType = keyof ClickToneEventDetail;
