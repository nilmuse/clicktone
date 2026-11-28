import { ClickTone, type ClickToneCacheStats, type PlayOptions, type SoundInput } from 'clicktone';

const sources: SoundInput = [new URL('https://example.test/click.wav'), { src: '/click.mp3' }];
const options: PlayOptions = { src: sources, replay: 'restart', fallback: true };
const sound = new ClickTone({ src: '/default.wav', maxVoices: 4, fallback: true });
sound.play({ fallback: false });
const voices: number = sound.voiceCount;
new ClickTone({ src: '/unlimited.wav', maxVoices: null }).destroy();
ClickTone.setCacheLimit(1024 * 1024);
const stats: ClickToneCacheStats = ClickTone.cacheStats;
const budget: number | null = stats.maxBytes;
const removed: boolean = sound.unload();
ClickTone.clearCache(sources);
ClickTone.clearCache();
ClickTone.setCacheLimit(null);
const result: Promise<void> = sound.play(options);
const off: () => void = sound.on('error', (error: Error) => console.error(error));
sound.on('load', (buffer: AudioBuffer) => void buffer.duration);
// @ts-expect-error Fallback must be a boolean.
sound.play({ fallback: 'yes' });
// @ts-expect-error The constructor also requires a boolean fallback.
new ClickTone({ src: '/invalid.wav', fallback: 1 });
// @ts-expect-error Voice limits must be numbers or null.
new ClickTone({ src: '/invalid.wav', maxVoices: '4' });
// @ts-expect-error Cache statistics are read-only snapshots.
stats.bytes = 0;
// @ts-expect-error The byte budget must be a number or null.
ClickTone.setCacheLimit('16 MiB');
// @ts-expect-error Invalid replay modes must be rejected by the public types.
sound.play({ replay: 'invalid' });
// @ts-expect-error Error listeners must receive Error, not a number.
sound.on('error', (value: number) => console.log(value));
void result;
void budget;
void removed;
void voices;
off();
sound.destroy();
