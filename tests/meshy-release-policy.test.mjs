import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { packageDirectories } from '../scripts/release.mjs';
import { checkReleaseVersion } from '../scripts/version-policy.mjs';
import { parsePublishOptions, publishReleasePackages } from '../scripts/publish.mjs';

const json = async (path, value) => {
  await mkdir(join(path, '..'), { recursive: true });
  await writeFile(path, JSON.stringify(value, null, 2) + '\n');
};
const git = (repo, ...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const newPackage = { directory: 'meshy', name: '@sinestack/ai-meshy', version: '0.1.0', previousVersion: null, isNew: true };

async function fixture(t, { oldDirectory = false, oldMalformedManifest = false } = {}) {
  const repo = await mkdtemp(join(tmpdir(), 'meshy-release-policy-'));
  t.after(() => rm(repo, { recursive: true, force: true }));
  git(repo, 'init', '-q'); git(repo, 'config', 'user.name', 'Test'); git(repo, 'config', 'user.email', 'test@example.com');
  const root = { name: 'test-workspace', version: '9.0.0', workspaces: ['packages/*'] };
  const lock = { version: root.version, lockfileVersion: 3, packages: { '': { ...root } } };
  await json(join(repo, 'package.json'), root);
  for (const directory of packageDirectories.filter(name => name !== 'meshy')) {
    const manifest = { name: `@sinestack/ai-${directory}`, version: '0.1.1', publishConfig: { registry: 'https://registry.npmjs.org' } };
    await json(join(repo, `packages/${directory}/package.json`), manifest);
    lock.packages[`packages/${directory}`] = { ...manifest };
  }
  await json(join(repo, 'package-lock.json'), lock);
  await mkdir(join(repo, 'packages/core/src/internal'), { recursive: true });
  await writeFile(join(repo, 'packages/core/src/internal/runtime.ts'), "withUserAgentSuffix(options.headers, 'sinestack-ai/0.1.1');\n");
  await mkdir(join(repo, 'tests'));
  await writeFile(join(repo, 'tests/integration.test.mjs'), "assert.match(headers.get('user-agent'), /sinestack-ai\\/0\\.1\\.1/);\n");
  if (oldDirectory || oldMalformedManifest) {
    await mkdir(join(repo, 'packages/meshy'), { recursive: true });
    await writeFile(join(repo, 'packages/meshy/README.md'), 'An existing package directory.\n');
    if (oldMalformedManifest) await writeFile(join(repo, 'packages/meshy/package.json'), '{bad JSON');
  }
  git(repo, 'add', '.'); git(repo, 'commit', '-qm', 'base without Meshy manifest');
  const manifest = { name: newPackage.name, version: newPackage.version, publishConfig: { registry: 'https://registry.npmjs.org' } };
  await json(join(repo, 'packages/meshy/package.json'), manifest);
  lock.packages['packages/meshy'] = { ...manifest };
  await json(join(repo, 'package-lock.json'), lock);
  return { repo, manifest, lock };
}

test('registered new package has an explicit initial release, without a fictitious base version', async t => {
  const { repo } = await fixture(t);
  assert.deepEqual((await checkReleaseVersion('HEAD', repo)).changed, [newPackage]);
  git(repo, 'add', '.'); git(repo, 'commit', '-qm', 'add Meshy');
  assert.deepEqual((await checkReleaseVersion('HEAD^', repo)).changed, [newPackage]);
  assert.deepEqual((await checkReleaseVersion('HEAD', repo)).changed, []);
});

test('existing directories with missing or malformed base metadata cannot masquerade as a new package', async t => {
  for (const options of [{ oldDirectory: true }, { oldMalformedManifest: true }]) {
    const { repo } = await fixture(t, options);
    await assert.rejects(checkReleaseVersion('HEAD', repo), /Cannot read packages\/meshy\/package.json/);
  }
});

test('new package still requires stable version, matching lockfile and publishing configuration', async t => {
  for (const kind of ['prerelease', 'lock-mismatch', 'registry', 'private']) {
    const { repo, manifest, lock } = await fixture(t);
    if (kind === 'prerelease') manifest.version = lock.packages['packages/meshy'].version = '0.1.0-rc.1';
    if (kind === 'lock-mismatch') manifest.version = '0.1.1';
    if (kind === 'registry') delete manifest.publishConfig;
    if (kind === 'private') manifest.private = true;
    await json(join(repo, 'packages/meshy/package.json'), manifest);
    await json(join(repo, 'package-lock.json'), lock);
    await assert.rejects(checkReleaseVersion('HEAD', repo));
  }
});

test('new-package detection does not hide a bad base ref or an unregistered package', async t => {
  const { repo } = await fixture(t);
  await assert.rejects(checkReleaseVersion('missing-base', repo), /Cannot read/);
  await json(join(repo, 'packages/unregistered/package.json'), { name: '@sinestack/ai-unregistered', version: '0.1.0' });
  await assert.rejects(checkReleaseVersion('HEAD', repo), /Unknown package path/);
});

test('existing package changes beside a new package still require their own version increase', async t => {
  const { repo, lock } = await fixture(t);
  await writeFile(join(repo, 'packages/provider/new-contract.ts'), 'export {};\n');
  await assert.rejects(checkReleaseVersion('HEAD', repo), /ai-provider changed/);
  const path = join(repo, 'packages/provider/package.json');
  const manifest = JSON.parse(await readFile(path, 'utf8'));
  manifest.version = lock.packages['packages/provider'].version = '0.1.2';
  await json(path, manifest); await json(join(repo, 'package-lock.json'), lock);
  assert.deepEqual((await checkReleaseVersion('HEAD', repo)).changed, [
    { directory: 'provider', name: manifest.name, version: '0.1.2', previousVersion: '0.1.1' }, newPackage,
  ]);
});

const absent = { status: 1, stdout: JSON.stringify({ error: { code: 'E404' } }), stderr: 'npm error code E404' };
const success = value => ({ status: 0, stdout: JSON.stringify(value), stderr: '' });
function publication(options = {}) {
  const packages = [
    { name: '@sinestack/ai-provider', version: '0.1.2' },
    { name: '@sinestack/ai-provider-utils', version: '0.1.1' },
    { name: '@sinestack/ai-meshy', version: '0.1.0' },
  ].map(pkg => ({ ...pkg, file: `${pkg.name.slice(1).replace('/', '-')}-${pkg.version}.tgz`, integrity: 'sha512-fixture' }));
  const release = {
    source: { commit: 'fixture-commit', tree: 'fixture-tree', dirty: false }, packages,
    manifests: packages.map(pkg => ({ name: pkg.name, version: pkg.version, dependencies: pkg.name === newPackage.name
      ? { '@sinestack/ai-provider': '0.1.2', '@sinestack/ai-provider-utils': '0.1.1' } : {} })),
  };
  const calls = [];
  return {
    calls,
    log() {},
    readRelease: async () => release,
    sourceIdentity: () => release.source,
    checkReleaseVersion: async () => ({ changed: options.changed ?? [
      { directory: 'provider', name: packages[0].name, version: packages[0].version, previousVersion: '0.1.1' }, newPackage,
    ] }),
    runCommand(command, args) {
      calls.push([command, ...args]);
      if (command === 'git') return { status: 0, stdout: '', stderr: '' };
      if (args[0] === '--version') return { status: 0, stdout: '11.6.0', stderr: '' };
      if (args[0] === 'publish') return { status: 0, stdout: '', stderr: '' }; // Never executes npm.
      assert.equal(command, 'npm'); assert.equal(args[0], 'view');
      const [_, spec, field] = args;
      const overridden = options.view?.(spec, field);
      if (overridden !== undefined) return overridden;
      if (spec === '@sinestack/ai-provider@0.1.1' || spec === '@sinestack/ai-provider-utils@0.1.1') return success('0.1.1');
      if (spec === '@sinestack/ai-provider@latest') return success('0.1.1');
      if (spec === '@sinestack/ai-meshy@latest') return success('0.0.0'); // Existing bootstrap, not a previous main release.
      if (field === 'dist.integrity') return absent;
      assert.fail(`Unexpected registry lookup ${spec} ${field}`);
    },
  };
}
const publish = deps => publishReleasePackages(parsePublishOptions(['--base-ref', 'base', '--access', 'public']), deps);
const writes = deps => deps.calls.filter(call => call[0] === 'npm' && call[1] === 'publish');

test('new publication supports bootstrap and keeps exact dependency checks and topological order', async () => {
  const deps = publication();
  await publish(deps);
  assert.equal(deps.calls.some(call => call[2]?.includes('@null') || call[2]?.includes('@undefined')), false);
  assert(deps.calls.some(call => call[2] === '@sinestack/ai-provider-utils@0.1.1' && call[3] === 'version'));
  assert.equal(deps.calls.some(call => call[2] === '@sinestack/ai-provider@0.1.2' && call[3] === 'version'), false);
  assert.deepEqual(writes(deps).map(call => call[2].split('/').at(-1)), ['sinestack-ai-provider-0.1.2.tgz', 'sinestack-ai-meshy-0.1.0.tgz']);
});

test('new release retry skips only matching integrity at the expected latest', async () => {
  const deps = publication({ view(spec, field) {
    if (spec === '@sinestack/ai-meshy@latest') return success('0.1.0');
    if (spec === '@sinestack/ai-meshy@0.1.0' && field === 'dist.integrity') return success('sha512-fixture');
  } });
  await publish(deps);
  assert.equal(writes(deps).length, 1);
  assert.match(writes(deps)[0][2], /ai-provider-0\.1\.2\.tgz$/);
});

for (const [name, view, pattern] of [
  ['newer latest', spec => spec === '@sinestack/ai-meshy@latest' ? success('0.2.0') : undefined, /latest is newer/],
  ['conflicting target integrity', (spec, field) => spec === '@sinestack/ai-meshy@0.1.0' && field === 'dist.integrity' ? success('sha512-other') : undefined, /different bytes/],
  ['unauthorized latest', spec => spec === '@sinestack/ai-meshy@latest' ? { status: 1, stdout: '', stderr: 'npm error code E401' } : undefined, /Cannot check/],
  ['missing exact dependency', spec => spec === '@sinestack/ai-provider-utils@0.1.1' ? absent : undefined, /required dependency/],
]) {
  test(`new package ${name} aborts the complete selected set before any writes`, async () => {
    const deps = publication({ view });
    await assert.rejects(publish(deps), pattern);
    assert.equal(writes(deps).length, 0);
  });
}

test('missing existing base metadata is not accepted without explicit new-package classification', async () => {
  for (const change of [{ ...newPackage, isNew: undefined }, { ...newPackage, previousVersion: '0.0.0' }]) {
    const deps = publication({ changed: [change] });
    await assert.rejects(publish(deps), /Missing base version|must not invent/);
    assert.equal(writes(deps).length, 0);
  }
});
