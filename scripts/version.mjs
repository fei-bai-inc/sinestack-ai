import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { packageDirectories, repository, validateVersion } from './release.mjs';

const version = process.argv[2];
assert(version && process.argv.length === 3, 'Usage: npm run version:release -- <version>');
validateVersion(version);

for (const directory of ['', ...packageDirectories.map(name => `packages/${name}`)]) {
  const path = join(repository, directory, 'package.json');
  const manifest = JSON.parse(await readFile(path, 'utf8'));
  manifest.version = version;
  if (manifest.dependencies) {
    for (const dep of Object.keys(manifest.dependencies)) {
      if (dep.startsWith('@sinestack/ai-')) manifest.dependencies[dep] = version;
    }
  }
  await writeFile(path, JSON.stringify(manifest, null, 2) + '\n');
}

const lockPath = join(repository, 'package-lock.json');
const lock = JSON.parse(await readFile(lockPath, 'utf8'));
lock.version = version;
if (lock.packages?.['']) lock.packages[''].version = version;
for (const directory of packageDirectories) {
  const entry = lock.packages?.[`packages/${directory}`];
  if (entry) {
    entry.version = version;
    if (entry.dependencies) {
      for (const dep of Object.keys(entry.dependencies)) {
        if (dep.startsWith('@sinestack/ai-')) entry.dependencies[dep] = version;
      }
    }
  }
}
await writeFile(lockPath, JSON.stringify(lock, null, 2) + '\n');

const executorPath = join(repository, 'packages/core/src/internal/executor.ts');
const executorSource = await readFile(executorPath, 'utf8');
assert(/sinestack-ai\/[0-9A-Za-z.-]+/u.test(executorSource), 'Failed to find version in packages/core/src/internal/executor.ts');
const updatedExecutor = executorSource.replace(/sinestack-ai\/[0-9A-Za-z.-]+/u, `sinestack-ai/${version}`);
await writeFile(executorPath, updatedExecutor);

const integrationTestPath = join(repository, 'tests/integration.test.mjs');
const integrationSource = await readFile(integrationTestPath, 'utf8');
assert(/\/sinestack-ai\\\/[0-9A-Za-z.\\-]+\//u.test(integrationSource), 'Failed to find version in tests/integration.test.mjs');
const escapedVersion = version.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
const updatedIntegration = integrationSource.replace(/\/sinestack-ai\\\/[0-9A-Za-z.\\-]+\//u, `/sinestack-ai\\/${escapedVersion}/`);
await writeFile(integrationTestPath, updatedIntegration);

console.log(`All six packages are now ${version}. Review and commit package.json, package-lock.json, and versioned files before releasing.`);
