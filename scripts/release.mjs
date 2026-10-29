import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const repository = fileURLToPath(new URL('..', import.meta.url));
export const registry = 'https://registry.npmjs.org';
export const packageDirectories = [
  'provider',
  'provider-utils',
  'core',
  'fal',
  'wavespeed',
  'replicate',
];
export const artifacts = join(repository, 'artifacts');

export function validateVersion(version) {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/u.exec(version);
  assert(match, 'Use a release version such as 0.1.0 or 0.2.0-rc.1 (without v or build metadata).');
  for (const part of match[4]?.split('.') ?? []) {
    assert(!/^\d+$/u.test(part) || part === '0' || !part.startsWith('0'), 'Numeric prerelease identifiers cannot have leading zeroes.');
  }
}

export async function readPackages(repo = repository) {
  const sections = ['dependencies', 'optionalDependencies', 'peerDependencies', 'devDependencies'];
  const packages = [];
  for (const directory of packageDirectories) {
    const path = join(repo, 'packages', directory);
    const manifest = JSON.parse(await readFile(join(path, 'package.json'), 'utf8'));
    assert.equal(manifest.name, `@sinestack/ai-${directory}`);
    validateVersion(manifest.version);
    assert.notEqual(manifest.private, true, `${manifest.name} is marked private and cannot be published.`);
    assert.equal(manifest.publishConfig?.registry, registry, `${manifest.name} must target the npm registry explicitly.`);
    assert.equal(manifest.publishConfig?.access, undefined, 'Choose access explicitly in the publish command, not in package metadata.');
    packages.push({ directory, path, manifest });
  }
  const indices = new Map(packages.map((pkg, index) => [pkg.manifest.name, index]));
  for (const [index, { manifest }] of packages.entries()) {
    for (const section of sections) {
      for (const [name, version] of Object.entries(manifest[section] ?? {})) {
        if (!name.startsWith('@sinestack/ai-')) continue;
        const dependencyIndex = indices.get(name);
        assert.notEqual(dependencyIndex, undefined, `Unknown internal dependency in ${manifest.name}: ${name}`);
        assert(dependencyIndex < index, `Internal dependency ${name} must precede ${manifest.name} in release order.`);
        validateVersion(version);
      }
    }
  }
  return packages;
}

export function sourceIdentity(repo = repository) {
  const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
  return {
    commit: git('rev-parse', 'HEAD'),
    tree: git('rev-parse', 'HEAD^{tree}'),
    dirty: git('status', '--porcelain', '--untracked-files=all') !== '',
  };
}

export function checksums(bytes) {
  return {
    sha256: createHash('sha256').update(bytes).digest('hex'),
    integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}`,
    bytes: bytes.length,
  };
}

/** Validate the actual archive produced by npm pack. */
export function inspectArchive(path, expected) {
  const files = new Set(execFileSync('tar', ['-tzf', path], { encoding: 'utf8' }).trim().split('\n'));
  const packed = JSON.parse(execFileSync('tar', ['-xOf', path, 'package/package.json'], { encoding: 'utf8' }));
  assert.equal(packed.name, expected.name);
  assert.equal(packed.version, expected.version);
  assert.notEqual(packed.private, true);
  assert.equal(packed.publishConfig?.registry, registry);
  assert.equal(packed.publishConfig?.access, undefined);
  const checkExports = value => {
    if (typeof value === 'string') {
      assert(value.startsWith('./') && files.has(`package/${value.slice(2)}`), `Missing export ${expected.name}: ${value}`);
    } else if (value && typeof value === 'object') {
      for (const target of Object.values(value)) checkExports(target);
    }
  };
  checkExports(packed.exports);
  for (const section of ['dependencies', 'optionalDependencies', 'peerDependencies', 'devDependencies']) {
    for (const [name, version] of Object.entries(packed[section] ?? {})) {
      assert(!/^(workspace|file|link):/u.test(version), `Unresolved local dependency in ${expected.name}: ${name}@${version}`);
      if (name.startsWith('@sinestack/ai-')) {
        assert.equal(version, expected[section]?.[name], `Packed internal dependency ${name} differs from ${expected.name}'s workspace manifest.`);
      }
    }
    for (const name of Object.keys(expected[section] ?? {})) {
      if (name.startsWith('@sinestack/ai-')) {
        assert.equal(packed[section]?.[name], expected[section][name], `Missing or changed internal dependency ${name} in ${expected.name}.`);
      }
    }
  }
  for (const required of ['README.md', 'LICENSE', 'NOTICE', 'src/index.ts']) {
    assert(files.has(`package/${required}`), `Missing required file in ${expected.name}: ${required}`);
  }
}

/** Verify selected artifacts (all by default); manifests align with the full packages list. */
export async function readRelease(repo = repository, artifactsDir = join(repo, 'artifacts'), selectedNames) {
  const packages = await readPackages(repo);
  const release = JSON.parse(await readFile(join(artifactsDir, 'manifest.json'), 'utf8'));
  assert.equal(release.schemaVersion, 1);
  assert.equal(release.repository, 'https://github.com/fei-bai-inc/sinestack-ai');
  assert.deepEqual(release.packages.map(pkg => pkg.name), packages.map(pkg => pkg.manifest.name));
  const selected = selectedNames === undefined ? null : new Set(selectedNames);
  if (selected) {
    for (const name of selected) assert(release.packages.some(pkg => pkg.name === name), `Unknown selected package: ${name}`);
  }
  for (const [index, pkg] of release.packages.entries()) {
    const expected = packages[index].manifest;
    assert.equal(pkg.version, expected.version);
    assert.equal(pkg.file, basename(pkg.file), 'A release file must stay inside artifacts/.');
    if (selected && !selected.has(pkg.name)) continue;
    const path = join(artifactsDir, pkg.file);
    const actual = checksums(await readFile(path));
    assert.equal(pkg.sha256, actual.sha256, `SHA-256 mismatch for ${pkg.name}`);
    assert.equal(pkg.integrity, actual.integrity, `Integrity mismatch for ${pkg.name}`);
    assert.equal(pkg.bytes, actual.bytes, `Size mismatch for ${pkg.name}`);
    inspectArchive(path, expected);
  }
  return { ...release, manifests: packages.map(pkg => pkg.manifest) };
}
