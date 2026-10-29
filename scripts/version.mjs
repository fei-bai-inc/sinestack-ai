import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { packageDirectories, repository } from './release.mjs';
import { compareStableVersions } from './version-policy.mjs';

const [directory, version] = process.argv.slice(2);
assert(process.argv.length === 4 && packageDirectories.includes(directory), 'Usage: npm run version:release -- <package-directory> <new-version>');
const readJson = async path => JSON.parse(await readFile(join(repository, path), 'utf8'));
const targetPath = `packages/${directory}`;
const target = await readJson(join(targetPath, 'package.json'));
assert(compareStableVersions(version, target.version) > 0, `New version must be strictly newer than ${target.version}.`);
const lockPath = join(repository, 'package-lock.json');
const lock = await readJson('package-lock.json');
assert(lock.packages?.[targetPath], `package-lock.json is missing workspace ${targetPath}.`);

let runtimePath, runtime;
if (directory === 'core') {
  runtimePath = join(repository, 'packages/core/src/internal/runtime.ts');
  runtime = await readFile(runtimePath, 'utf8');
  assert(/sinestack-ai\/[0-9A-Za-z.-]+/u.test(runtime), 'Failed to find runtime user-agent version.');
}

target.version = version;
lock.packages[targetPath].version = version;
await writeFile(join(repository, targetPath, 'package.json'), JSON.stringify(target, null, 2) + '\n');
await writeFile(lockPath, JSON.stringify(lock, null, 2) + '\n');
if (directory === 'core') {
  await writeFile(runtimePath, runtime.replace(/sinestack-ai\/[0-9A-Za-z.-]+/u, `sinestack-ai/${version}`));
}
console.log(`Updated ${target.name} to ${version}. After all version and dependency changes, run npm install --package-lock-only --ignore-scripts --no-audit --no-fund and commit the lockfile.`);
