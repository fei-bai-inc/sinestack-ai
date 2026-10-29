import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { packageDirectories } from './release.mjs';

// This release-only gate deliberately installs outside the workspace. A workspace
// symlink or a development-only dependency must not rescue an incomplete tarball.
const repository = fileURLToPath(new URL('..', import.meta.url));
const artifacts = resolve(process.argv[2] ?? join(repository, 'artifacts'));
const release = JSON.parse(await readFile(join(artifacts, 'manifest.json'), 'utf8'));
const core = JSON.parse(await readFile(join(repository, 'packages/core/package.json'), 'utf8'));
const root = JSON.parse(await readFile(join(repository, 'package.json'), 'utf8'));
const names = packageDirectories.map(directory => `@sinestack/ai-${directory}`);
assert.deepEqual(release.packages.map(pkg => pkg.name).sort(), [...names].sort());
const dependencies = { ai: core.peerDependencies.ai };
for (const pkg of release.packages) {
  assert.equal(pkg.version, core.version, 'The smoke test must consume the current release version.');
  assert.equal(basename(pkg.file), pkg.file, 'Tarball filenames must stay inside the artifacts directory.');
  const tarball = join(artifacts, pkg.file);
  const integrity = `sha512-${createHash('sha512').update(await readFile(tarball)).digest('base64')}`;
  assert.equal(integrity, pkg.integrity, `Tarball integrity mismatch: ${pkg.name}`);
  dependencies[pkg.name] = `file:${tarball}`;
}

const consumer = await realpath(await mkdtemp(join(tmpdir(), 'sinestack-ai-consumer-')));
const environment = { ...process.env };
delete environment.NODE_PATH;
const run = (command, args, timeout) => execFileSync(command, args, {
  cwd: consumer,
  env: environment,
  stdio: 'inherit',
  timeout,
});
try {
  await cp(join(repository, 'tests/package-consumer'), consumer, { recursive: true });
  await writeFile(join(consumer, 'package.json'), JSON.stringify({
    name: 'sinestack-ai-release-consumer',
    private: true,
    type: 'module',
    dependencies,
    devDependencies: {
      typescript: root.devDependencies.typescript,
      '@types/node': root.devDependencies['@types/node'],
    },
  }, null, 2) + '\n');
  run('npm', ['install', '--no-audit', '--no-fund', '--registry=https://registry.npmjs.org/'], 300_000);
  for (const name of names) {
    const installed = await realpath(join(consumer, 'node_modules', ...name.split('/')));
    const path = relative(consumer, installed);
    assert(path !== '..' && !path.startsWith(`..${sep}`), `${name} resolved outside the independent consumer.`);
  }
  run(process.execPath, ['node_modules/typescript/bin/tsc', '--noEmit'], 60_000);
  run(process.execPath, ['consumer.mjs'], 120_000);
  console.log(`Independent npm consumer verified all six ${core.version} tarballs, public types, and runtime execution.`);
} finally {
  await rm(consumer, { recursive: true, force: true });
}
