import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { readPackages } from './release.mjs';

const stableVersion = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u;
const dependencySections = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'];

export function compareStableVersions(a, b) {
  const left = typeof a === 'string' && stableVersion.exec(a);
  const right = typeof b === 'string' && stableVersion.exec(b);
  assert(left && right, `Expected stable semver versions without prerelease or build metadata: ${a}, ${b}`);
  for (let i = 1; i <= 3; i++) {
    if (left[i].length !== right[i].length) return left[i].length < right[i].length ? -1 : 1;
    if (left[i] !== right[i]) return left[i] < right[i] ? -1 : 1;
  }
  return 0;
}

export async function checkReleaseVersion(baseRef, repo = process.cwd()) {
  assert(typeof baseRef === 'string' && baseRef && !baseRef.startsWith('-'), 'Provide a valid base Git ref.');
  const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const readJson = async path => JSON.parse(await readFile(join(repo, path), 'utf8'));
  const baseJson = path => {
    try { return JSON.parse(git('show', `${baseRef}:${path}`)); }
    catch (error) { throw new Error(`Cannot read ${path} from base ref ${baseRef}: ${error.message}`); }
  };
  const root = await readJson('package.json');
  const lock = await readJson('package-lock.json');
  const baseLock = baseJson('package-lock.json');
  const packages = await readPackages(repo);
  const versions = new Map(packages.map(({ manifest }) => [manifest.name, manifest.version]));
  assert.equal(versions.size, packages.length, 'Package names must be unique.');
  assert.equal(lock.version, root.version, 'package-lock.json version must match root version.');
  for (const [path, manifest] of [['', root], ...packages.map(({ directory, manifest }) => [`packages/${directory}`, manifest])]) {
    const entry = lock.packages?.[path];
    assert(entry, `package-lock.json is missing workspace ${path || '(root)'}.`);
    assert.equal(entry.name, manifest.name, `package-lock.json workspace ${path || '(root)'} name must match manifest.`);
    assert.equal(entry.version, manifest.version, `package-lock.json workspace ${path || '(root)'} version must match manifest.`);
    for (const section of dependencySections) {
      const manifestDeps = manifest[section] ?? {};
      const lockDeps = entry[section] ?? {};
      assert(isDeepStrictEqual(manifestDeps, lockDeps), `package-lock.json ${path || '(root)'} ${section} must match manifest.`);
      for (const [name, pin] of Object.entries(manifestDeps)) {
        if (name.startsWith('@sinestack/ai-')) {
          assert(versions.has(name), `${path || 'package.json'} references unknown internal package ${name}.`);
          assert(typeof pin === 'string' && stableVersion.test(pin), `${path || 'package.json'} ${section}.${name} must be pinned to an exact stable version.`);
        }
      }
    }
  }
  const coreVersion = packages.find(({ directory }) => directory === 'core').manifest.version;
  const executor = await readFile(join(repo, 'packages/core/src/internal/executor.ts'), 'utf8');
  const agents = [...executor.matchAll(/withUserAgentSuffix\s*\([^\n]*?['"]sinestack-ai\/([^'"\s]+)['"]/gu)];
  assert.equal(agents.length, 1, 'Expected exactly one sinestack-ai user-agent in executor.ts.');
  assert.equal(agents[0][1], coreVersion, 'executor.ts user-agent version must match core version.');
  const integration = await readFile(join(repo, 'tests/integration.test.mjs'), 'utf8');
  const assertions = [...integration.matchAll(/assert\.match\s*\(\s*headers\.get\(['"]user-agent['"]\)\s*,\s*\/sinestack-ai\\\/([^/]+)\//gu)];
  assert.equal(assertions.length, 1, 'Expected exactly one sinestack-ai user-agent assertion in integration.test.mjs.');
  const escaped = coreVersion.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  assert.equal(assertions[0][1], escaped, 'integration.test.mjs user-agent assertion must match core version with escaped dots.');

  // Diff the final working tree against the base, including staged changes and untracked, nonignored files.
  const paths = new Set((git('diff', '--name-only', '-z', '--no-renames', baseRef, '--') + git('ls-files', '--others', '--exclude-standard', '-z')).split('\0').filter(Boolean));
  for (const path of paths) {
    if (!path.startsWith('packages/')) continue;
    const directory = path.split('/')[1];
    assert(packages.some(pkg => pkg.directory === directory), `Unknown package path ${path}; add its release configuration before merging.`);
  }
  const sharedChanged = paths.has('tsconfig.base.json') || !isDeepStrictEqual(baseLock.packages?.['node_modules/typescript'], lock.packages?.['node_modules/typescript']);
  const changed = [];
  for (const { directory, manifest } of packages) {
    const base = baseJson(`packages/${directory}/package.json`);
    assert.equal(base.name, manifest.name, `Package ${directory} was renamed.`);
    const comparison = compareStableVersions(manifest.version, base.version);
    assert(comparison >= 0, `${manifest.name} version ${manifest.version} must not decrease from ${base.version}.`);
    if (sharedChanged || [...paths].some(path => path.startsWith(`packages/${directory}/`))) {
      assert(comparison > 0, `${manifest.name} changed; version ${manifest.version} must be strictly newer than base ${base.version}.`);
      changed.push({ directory, name: manifest.name, version: manifest.version, previousVersion: base.version });
    }
  }
  return { changed };
}
