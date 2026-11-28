import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import test from 'node:test';

const require = createRequire(import.meta.url);
const packageRoot = dirname(dirname(require.resolve('clicktone')));

const expectedArtifacts = [
  'dist/index.js',
  'dist/index.cjs',
  'dist/index.d.ts',
  'dist/index.d.cts',
];

test('dist artifacts exist', () => {
  for (const artifact of expectedArtifacts) {
    assert.equal(existsSync(join(packageRoot, artifact)), true, `${artifact} should exist`);
  }
});

test('public ESM API exports ClickTone class', async () => {
  const mod = await import('clicktone');

  assert.equal(typeof mod.ClickTone, 'function');
});

test('public CJS API can be required', () => {
  const mod = require('clicktone');

  assert.equal(typeof mod.ClickTone, 'function');
});

test('ESM and CJS instances can be created and disposed without a DOM', async () => {
  const esm = await import('clicktone');
  const cjs = require('clicktone');

  assert.equal(typeof window, 'undefined');
  assert.equal(typeof document, 'undefined');

  for (const { ClickTone } of [esm, cjs]) {
    assert.deepEqual(ClickTone.cacheStats, { entries: 0, pending: 0, bytes: 0, maxBytes: null });
    ClickTone.setCacheLimit(1024);
    ClickTone.clearCache();
    assert.equal(ClickTone.cacheStats.maxBytes, 1024);
    ClickTone.setCacheLimit(null);
    const sound = new ClickTone({
      src: ['/audio/click.wav', '/audio/click.mp3'],
      maxVoices: 2,
      fallback: true,
    });

    assert.equal(sound.playing, false);
    assert.equal(sound.voiceCount, 0);
    sound.destroy();
    sound.destroy();
    await sound.play();
    assert.equal(await sound.preload(), undefined);
    assert.equal(sound.unload(), false);
    assert.equal(sound.voiceCount, 0);
  }
});
