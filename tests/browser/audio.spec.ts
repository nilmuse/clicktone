import { expect, type Page, test } from '@playwright/test';
import type { ClickTone, ClickToneOptions, ReplayBehavior } from '../../src/main';

declare global {
  interface Window {
    check: {
      ClickTone: typeof ClickTone;
      sound: ClickTone;
      events: string[];
      errors: Error[];
      promises: Promise<void>[];
      settled: number;
      replay: ReplayBehavior;
    };
  }
}

test.beforeEach(async ({ page, browserName }) => {
  if (browserName !== 'webkit' || process.platform !== 'win32') return;
  const available = await page.evaluate(() =>
    Boolean(window.AudioContext ?? window.webkitAudioContext),
  );
  test.skip(!available, 'This Windows WebKit build has no Web Audio. Run WebKit on Linux/macOS.');
});

async function create(page: Page, options: ClickToneOptions): Promise<void> {
  await page.goto('/fixture.html');
  await page.evaluate(async (options) => {
    const moduleUrl = '/dist/index.js';
    const { ClickTone } = (await import(moduleUrl)) as typeof import('../../src/main');
    const sound = new ClickTone(options);
    const check: Window['check'] = {
      ClickTone,
      sound,
      events: [],
      errors: [],
      promises: [],
      settled: 0,
      replay: 'overlap',
    };
    window.check = check;
    for (const event of ['play', 'end', 'stop', 'load'] as const) {
      sound.on(event, () => check.events.push(event));
    }
    sound.on('error', (error) => check.errors.push(error));
    const play = (): void => {
      const pending = sound.play({ replay: check.replay });
      check.promises.push(pending);
      void pending.then(() => check.settled++);
    };
    document.getElementById('start')?.addEventListener('click', play);
    document.getElementById('burst')?.addEventListener('click', () => {
      for (let i = 0; i < 8; i++) play();
    });
    document.getElementById('stop')?.addEventListener('click', () => sound.stop());
  }, options);
}

async function snapshot(page: Page) {
  return page.evaluate(() => ({
    events: window.check.events,
    errors: window.check.errors.map((error) => ({ name: error.name, message: error.message })),
    settled: window.check.settled,
    voices: window.check.sound.voiceCount,
  }));
}

test('decodes real PCM and plays to a natural end after a gesture', async ({ page }) => {
  await create(page, { src: '/audio/tone.wav' });
  const buffer = await page.evaluate(async () => {
    const buffer = await window.check.sound.preload();
    return (
      buffer && {
        duration: buffer.duration,
        channels: buffer.numberOfChannels,
        length: buffer.length,
      }
    );
  });
  expect(buffer?.duration).toBeCloseTo(0.18, 2);
  expect(buffer?.channels).toBe(1);
  expect(buffer?.length).toBeGreaterThan(1000);
  await page.click('#start');
  await expect
    .poll(() => snapshot(page))
    .toEqual({ events: ['load', 'play', 'end'], errors: [], settled: 1, voices: 0 });
});

test('stops a loop and settles its play promise at start', async ({ page }) => {
  await create(page, { src: '/audio/loop.wav', loop: true });
  await page.click('#start');
  await expect
    .poll(() => snapshot(page))
    .toEqual({ events: ['play'], errors: [], settled: 1, voices: 1 });
  await page.click('#stop');
  await expect
    .poll(() => snapshot(page))
    .toEqual({ events: ['play', 'stop'], errors: [], settled: 1, voices: 0 });
});

for (const failure of ['missing', 'corrupt']) {
  test(`falls back after a real ${failure === 'missing' ? 'HTTP' : 'decode'} failure`, async ({
    page,
  }) => {
    const requests: string[] = [];
    page.on('request', (request) => {
      if (request.url().includes('/audio/')) requests.push(new URL(request.url()).pathname);
    });
    await create(page, { src: [`/audio/${failure}.wav`, '/audio/tone.wav'], fallback: true });
    await page.click('#start');
    await expect
      .poll(() => snapshot(page))
      .toEqual({ events: ['play', 'end'], errors: [], settled: 1, voices: 0 });
    expect(requests).toEqual([`/audio/${failure}.wav`, '/audio/tone.wav']);
  });
}

test('keeps fallback disabled by default', async ({ page }) => {
  const requests: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/audio/')) requests.push(new URL(request.url()).pathname);
  });
  await create(page, { src: ['/audio/missing.wav', '/audio/tone.wav'] });
  await page.click('#start');
  await expect.poll(async () => (await snapshot(page)).settled).toBe(1);
  expect(requests).toEqual(['/audio/missing.wav']);
  expect((await snapshot(page)).errors).toHaveLength(1);
  expect((await snapshot(page)).events).toEqual([]);
});

test('reports all original errors after exhausting fallback', async ({ page }) => {
  await create(page, { src: ['/audio/missing.wav', '/audio/corrupt.wav'], fallback: true });
  await page.click('#start');
  await expect.poll(async () => (await snapshot(page)).settled).toBe(1);
  const errors = await page.evaluate(() =>
    window.check.errors.map((error) => ({
      name: error.name,
      causes: error instanceof AggregateError ? error.errors.length : 0,
    })),
  );
  expect(errors).toEqual([{ name: 'AggregateError', causes: 2 }]);
  expect((await snapshot(page)).events).toEqual([]);
});

test('cancels a slow load without starting it when the response arrives', async ({ page }) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/audio/slow.wav', async (route) => {
    await gate;
    const response = await page.request.get('/audio/tone.wav');
    await route.fulfill({ response });
  });
  await create(page, { src: '/audio/slow.wav' });
  const requested = page.waitForRequest('**/audio/slow.wav');
  await page.click('#start');
  await requested;
  await page.click('#stop');
  await expect.poll(async () => (await snapshot(page)).settled).toBe(1);
  const loaded = page.waitForResponse('**/audio/slow.wav');
  release();
  await loaded;
  // A preload joins the same operation and proves the old response has decoded.
  await page.evaluate(() => window.check.sound.preload());
  expect(await snapshot(page)).toEqual({ events: ['load'], errors: [], settled: 1, voices: 0 });
});

for (const replay of ['restart', 'ignore-if-playing'] as const) {
  test(`${replay} admits only one burst request during loading`, async ({ page }) => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let requests = 0;
    await page.route('**/audio/slow.wav', async (route) => {
      requests++;
      await gate;
      await route.fulfill({ response: await page.request.get('/audio/tone.wav') });
    });
    await create(page, { src: '/audio/slow.wav' });
    await page.evaluate((replay) => {
      window.check.replay = replay;
    }, replay);
    const requested = page.waitForRequest('**/audio/slow.wav');
    await page.click('#burst');
    await requested;
    await expect.poll(async () => (await snapshot(page)).settled).toBe(7);
    release();
    await expect
      .poll(() => snapshot(page))
      .toEqual({ events: ['play', 'end'], errors: [], settled: 8, voices: 0 });
    expect(requests).toBe(1);
  });
}

test('limits real overlapping loops and emits stop when stealing a voice', async ({ page }) => {
  await create(page, { src: '/audio/loop.wav', loop: true, maxVoices: 2 });
  await page.click('#burst');
  await expect.poll(async () => (await snapshot(page)).settled).toBe(8);
  const result = await snapshot(page);
  expect(result.voices).toBe(2);
  expect(result.events.filter((event) => event === 'play')).toHaveLength(8);
  expect(result.events.filter((event) => event === 'stop')).toHaveLength(6);
  expect(result.errors).toEqual([]);
  await page.click('#stop');
  expect((await snapshot(page)).voices).toBe(0);
});

test('shares decoded buffers and reloads after explicit eviction', async ({ page }) => {
  let requests = 0;
  page.on('request', (request) => {
    if (request.url().includes('/audio/tone.wav')) requests++;
  });
  await create(page, { src: '/audio/tone.wav' });
  const result = await page.evaluate(async () => {
    const { ClickTone, sound } = window.check;
    const other = new ClickTone({ src: '/audio/tone.wav' });
    const [a, b] = await Promise.all([sound.preload(), other.preload()]);
    const same = a === b;
    const stats = ClickTone.cacheStats;
    const removed = sound.unload();
    await other.preload();
    other.destroy();
    return { same, stats, removed };
  });
  expect(result.same).toBe(true);
  expect(result.stats.entries).toBe(1);
  expect(result.stats.bytes).toBeGreaterThan(1000);
  expect(result.removed).toBe(true);
  expect(requests).toBe(2);
});

test('a destroyed consumer cannot start after another consumer finishes a shared load', async ({
  page,
}) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/audio/slow.wav', async (route) => {
    await gate;
    await route.fulfill({ response: await page.request.get('/audio/tone.wav') });
  });
  await create(page, { src: '/audio/slow.wav' });
  const requested = page.waitForRequest('**/audio/slow.wav');
  await page.click('#start');
  await requested;
  await page.evaluate(() => window.check.sound.destroy());
  await expect.poll(async () => (await snapshot(page)).settled).toBe(1);
  release();
  const loaded = await page.evaluate(async () => {
    const other = new window.check.ClickTone({ src: '/audio/slow.wav' });
    const buffer = await other.preload();
    other.destroy();
    return Boolean(buffer);
  });
  expect(loaded).toBe(true);
  expect(await snapshot(page)).toEqual({ events: [], errors: [], settled: 1, voices: 0 });
});
