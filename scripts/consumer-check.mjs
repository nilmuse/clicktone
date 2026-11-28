import { spawnSync } from 'node:child_process';
import { copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const npm = process.env.npm_execpath;
if (!npm) throw new Error('Run this check through npm run test:consumer.');
const temporaryRoot = resolve(tmpdir());
const consumer = await mkdtemp(join(temporaryRoot, 'clicktone-consumer-'));
const child = relative(temporaryRoot, resolve(consumer));
if (isAbsolute(child) || child.startsWith('..') || !child.startsWith('clicktone-consumer-')) {
  throw new Error('Refusing to clean a directory outside the consumer test workspace.');
}

function run(script, args, cwd = consumer) {
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd,
    encoding: 'utf8',
    env: process.env,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${script} failed\n${result.stdout}\n${result.stderr}`);
  return result.stdout;
}

try {
  const metadata = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  const output = JSON.parse(
    run(npm, ['pack', '--json', '--ignore-scripts', '--pack-destination', consumer], root),
  );
  // npm 10/11 return an array; npm 12 keys the result by package name.
  const packed = Array.isArray(output)
    ? output.find((entry) => entry.name === metadata.name)
    : output[metadata.name];
  if (!packed?.filename || !Array.isArray(packed.files)) {
    throw new Error(`npm pack did not return metadata for ${metadata.name}.`);
  }
  const tarball = join(consumer, packed.filename);
  await writeFile(
    join(consumer, 'package.json'),
    JSON.stringify({ private: true, type: 'module' }),
  );
  run(npm, [
    'install',
    tarball,
    '--offline',
    '--ignore-scripts',
    '--no-audit',
    '--no-fund',
    '--package-lock=false',
  ]);
  for (const file of ['consumer.mts', 'consumer.cts']) {
    await copyFile(join(root, 'tests/consumer', file), join(consumer, file));
  }
  await copyFile(join(root, 'tests/smoke.test.js'), join(consumer, 'smoke.test.mjs'));
  console.log(run('--test', ['smoke.test.mjs']));
  const tsc = require.resolve('typescript/bin/tsc');
  const common = ['--strict', '--noEmit', '--target', 'es2022', '--lib', 'es2022,dom'];
  run(tsc, [
    ...common,
    '--module',
    'nodenext',
    '--moduleResolution',
    'nodenext',
    'consumer.mts',
    'consumer.cts',
  ]);
  run(tsc, [...common, '--module', 'esnext', '--moduleResolution', 'bundler', 'consumer.mts']);
  console.log(
    `Packed ${metadata.name}@${metadata.version}: ESM, CommonJS, NodeNext, and bundler types passed on ${process.version}.`,
  );
  const contents = packed.files.map((file) => file.path);
  if (
    contents.some(
      (path) =>
        path.startsWith('testing/') || path.startsWith('tests/') || path.startsWith('scripts/'),
    )
  ) {
    throw new Error('The npm tarball must not include the separate test page or test tooling.');
  }
} finally {
  // Only remove the unique directory created above, inside the resolved OS temp directory.
  await rm(consumer, { recursive: true, force: true });
}
