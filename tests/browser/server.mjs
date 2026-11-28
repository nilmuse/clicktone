import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';

// Deterministic PCM fixtures for automated tests; no external audio services.
function tone(duration, hz) {
  const sampleRate = 22050;
  const samples = Math.round(duration * sampleRate);
  const wav = Buffer.alloc(44 + samples * 2);
  wav.write('RIFF', 0);
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(sampleRate * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36);
  wav.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) {
    const envelope = Math.min(1, i / 220, (samples - 1 - i) / 220);
    wav.writeInt16LE(
      Math.round(Math.sin((i * hz * 2 * Math.PI) / sampleRate) * 4000 * envelope),
      44 + i * 2,
    );
  }
  return wav;
}

const fixtures = new Map([
  [
    '/fixture.html',
    [
      'text/html; charset=utf-8',
      '<!doctype html><html lang="en"><meta charset="utf-8"><title>Audio fixture</title><button id="start">Play</button><button id="burst">Burst</button><button id="stop">Stop</button></html>',
    ],
  ],
  ['/info.json', ['application/json', '{"ready":true}']],
  ['/audio/tone.wav', ['audio/wav', tone(0.18, 660)]],
  ['/audio/loop.wav', ['audio/wav', tone(1, 440)]],
  ['/audio/corrupt.wav', ['audio/wav', 'This response is deliberately not an audio file.']],
]);

const server = createServer(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self'; connect-src 'self'; media-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'",
  );
  const send = (status, type, body) => {
    if (res.destroyed) return;
    res.writeHead(status, { 'Content-Type': type, 'Content-Length': Buffer.byteLength(body) });
    res.end(req.method === 'HEAD' ? undefined : body);
  };
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    send(405, 'text/plain', 'Method not allowed');
    return;
  }
  try {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    if (pathname === '/dist/index.js') {
      send(
        200,
        'text/javascript; charset=utf-8',
        await readFile(new URL('../../dist/index.js', import.meta.url)),
      );
      return;
    }
    const fixture = fixtures.get(pathname);
    if (fixture) send(200, fixture[0], fixture[1]);
    else send(404, 'text/plain', 'Not found');
  } catch (error) {
    console.error(error);
    send(500, 'text/plain', 'Fixture server error. Build the package first.');
  }
});

server.listen(4173, '127.0.0.1', () => {
  console.log('Audio fixtures: http://127.0.0.1:4173');
});
