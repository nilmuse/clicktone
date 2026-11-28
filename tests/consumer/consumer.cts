import clicktone = require('clicktone');

const options: clicktone.PlayOptions = {
  src: ['/click.wav', '/click.mp3'],
  replay: 'interrupt',
  fallback: true,
};
const sound = new clicktone.ClickTone({ src: '/default.wav', maxVoices: 1, fallback: false });
sound.play({ fallback: true });
const voices: number = sound.voiceCount;
clicktone.ClickTone.setCacheLimit(1024);
const stats: clicktone.ClickToneCacheStats = clicktone.ClickTone.cacheStats;
const removed: boolean = sound.unload();
clicktone.ClickTone.clearCache('/default.wav');
clicktone.ClickTone.setCacheLimit(null);
const result: Promise<void> = sound.play(options);
sound.on('error', (error: Error) => console.error(error));
// @ts-expect-error CommonJS fallback must also be a boolean.
sound.play({ fallback: 'yes' });
// @ts-expect-error CommonJS cache statistics must also be read-only.
stats.entries = 0;
// @ts-expect-error The CommonJS declaration must reject invalid replay modes too.
sound.play({ replay: 'invalid' });
void result;
void removed;
void voices;
sound.destroy();
