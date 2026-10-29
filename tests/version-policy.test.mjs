import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { compareStableVersions } from '../scripts/version-policy.mjs';

const sourceScripts = fileURLToPath(new URL('../scripts/', import.meta.url));
const directories = ['provider', 'provider-utils', 'core', 'fal', 'wavespeed', 'replicate'];
const json = async (path, value) => { await mkdir(join(path, '..'), { recursive: true }); await writeFile(path, JSON.stringify(value, null, 2) + '\n'); };
const git = (repo, ...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' });
const cli = (repo, base = 'HEAD') => spawnSync(process.execPath, ['scripts/check-release-version.mjs', base], { cwd: repo, encoding: 'utf8' });
const bump = (repo, directory, version) => spawnSync(process.execPath, ['scripts/version.mjs', directory, version], { cwd: repo, encoding: 'utf8' });
const readJson = async (repo, path) => JSON.parse(await readFile(join(repo, path), 'utf8'));
async function changeJson(repo, path, change) { const value = await readJson(repo, path); change(value); await json(join(repo, path), value); }

async function fixture(t) {
  const repo = await mkdtemp(join(tmpdir(), 'version-policy-'));
  t.after(() => rm(repo, { recursive: true, force: true }));
  await mkdir(join(repo, 'scripts'));
  for (const name of ['release.mjs', 'version-policy.mjs', 'check-release-version.mjs', 'version.mjs']) await cp(join(sourceScripts, name), join(repo, 'scripts', name));
  git(repo, 'init', '-q'); git(repo, 'config', 'user.name', 'Test'); git(repo, 'config', 'user.email', 'test@example.com');
  const root = { name: 'workspace', version: '9.0.0', workspaces: ['packages/*'] };
  const lock = { version: root.version, lockfileVersion: 3, packages: { '': { ...root }, 'node_modules/typescript': { version: '6.0.3', integrity: 'sha512-original' } } };
  await json(join(repo, 'package.json'), root);
  for (const directory of directories) {
    const manifest = { name: `@sinestack/ai-${directory}`, version: '1.2.3', publishConfig: { registry: 'https://registry.npmjs.org' } };
    if (directory === 'provider-utils') manifest.dependencies = { '@sinestack/ai-provider': '1.2.3' };
    if (directory === 'core') manifest.dependencies = { '@sinestack/ai-provider-utils': '1.2.3' };
    await json(join(repo, 'packages', directory, 'package.json'), manifest);
    lock.packages[`packages/${directory}`] = { ...manifest };
  }
  await json(join(repo, 'package-lock.json'), lock);
  await mkdir(join(repo, 'packages/core/src/internal'), { recursive: true });
  await writeFile(join(repo, 'packages/core/src/internal/executor.ts'), "withUserAgentSuffix(options.headers, 'sinestack-ai/1.2.3');\n");
  await mkdir(join(repo, 'tests'), { recursive: true });
  await writeFile(join(repo, 'tests/integration.test.mjs'), "assert.match(headers.get('user-agent'), /sinestack-ai\\/1\\.2\\.3/);\n");
  await writeFile(join(repo, 'tsconfig.base.json'), '{}\n');
  await writeFile(join(repo, '.gitignore'), 'dist/\n');
  git(repo, 'add', '.'); git(repo, 'commit', '-qm', 'base');
  return repo;
}

function succeeds(result) { assert.equal(result.status, 0, result.stderr); }
function fails(result, pattern) { assert.notEqual(result.status, 0); if (pattern) assert.match(result.stderr, pattern); }

test('stable comparator handles large components and rejects invalid versions', () => {
  assert.equal(compareStableVersions('999999999999999999999.0.0', '1000000000000000000000.0.0'), -1);
  assert.equal(compareStableVersions('1.10.0', '1.9.999'), 1);
  assert.equal(compareStableVersions('1.2.3', '1.2.3'), 0);
  for (const invalid of ['1.2.3-rc.1', '01.2.3', '1.2.3+build', '1.2']) assert.throws(() => compareStableVersions(invalid, '1.2.3'));
});

test('doc-only changes select nothing; package changes require bumps, including committed and untracked files', async t => {
  const repo = await fixture(t);
  await writeFile(join(repo, 'README.md'), 'documentation\n');
  await mkdir(join(repo, 'packages/fal/dist'), { recursive: true });
  await writeFile(join(repo, 'packages/fal/dist/generated.js'), 'ignored\n');
  let result = cli(repo); succeeds(result); assert.match(result.stdout, /\(none\)/);
  await writeFile(join(repo, 'packages/fal/source.ts'), 'export {};\n');
  fails(cli(repo), /ai-fal changed/);
  succeeds(bump(repo, 'fal', '1.2.4'));
  result = cli(repo); succeeds(result); assert.match(result.stdout, /ai-fal@1\.2\.4/); assert.doesNotMatch(result.stdout, /ai-core@/);
  const policy = await import(new URL(`file://${repo}/scripts/version-policy.mjs`).href);
  assert.deepEqual((await policy.checkReleaseVersion('HEAD', repo)).changed, [{ directory: 'fal', name: '@sinestack/ai-fal', version: '1.2.4', previousVersion: '1.2.3' }]);
  git(repo, 'add', '.'); git(repo, 'commit', '-qm', 'release');
  result = cli(repo, 'HEAD^'); succeeds(result); assert.match(result.stdout, /ai-fal@1\.2\.4/);
  fails(cli(repo, 'missing-base'), /Cannot read/);
});

test('dependency bumps do not cascade; explicitly updated pins require dependent bumps', async t => {
  const repo = await fixture(t);
  succeeds(bump(repo, 'provider', '1.2.4'));
  let result = cli(repo); succeeds(result);
  assert.match(result.stdout, /ai-provider@1\.2\.4/);
  assert.doesNotMatch(result.stdout, /ai-provider-utils@/);
  assert.equal((await readJson(repo, 'packages/provider-utils/package.json')).dependencies['@sinestack/ai-provider'], '1.2.3');
  assert.equal((await readJson(repo, 'package-lock.json')).packages['packages/provider-utils'].dependencies['@sinestack/ai-provider'], '1.2.3');
  await changeJson(repo, 'packages/provider-utils/package.json', x => { x.dependencies['@sinestack/ai-provider'] = '1.2.4'; });
  await changeJson(repo, 'package-lock.json', x => { x.packages['packages/provider-utils'].dependencies['@sinestack/ai-provider'] = '1.2.4'; });
  fails(cli(repo), /ai-provider-utils changed/);
  succeeds(bump(repo, 'provider-utils', '1.3.0'));
  result = cli(repo); succeeds(result);
  assert.match(result.stdout, /ai-provider@1\.2\.4, @sinestack\/ai-provider-utils@1\.3\.0/);
  assert.doesNotMatch(result.stdout, /ai-core@/);
  assert.equal((await readJson(repo, 'packages/core/package.json')).dependencies['@sinestack/ai-provider-utils'], '1.2.3');
  succeeds(bump(repo, 'core', '2.0.0'));
  result = cli(repo); succeeds(result);
  assert.match(result.stdout, /ai-core@2\.0\.0/);
  assert.equal((await readJson(repo, 'package.json')).version, '9.0.0');
  assert.match(await readFile(join(repo, 'tests/integration.test.mjs'), 'utf8'), /2\\\.0\\\.0/);
});

test('policy rejects decreased versions, invalid pins and lock mismatches', async t => {
  const repo = await fixture(t);
  fails(bump(repo, 'fal', '1.2.3'));
  fails(bump(repo, 'fal', '1.2.2'));
  fails(bump(repo, 'fal', '1.2.4-rc.1'));
  const originalLock = await readJson(repo, 'package-lock.json');
  const originalFal = await readJson(repo, 'packages/fal/package.json');
  await changeJson(repo, 'packages/fal/package.json', x => { x.version = '1.2.2'; });
  await changeJson(repo, 'package-lock.json', x => { x.packages['packages/fal'].version = '1.2.2'; });
  fails(cli(repo), /must not decrease/);
  await json(join(repo, 'package-lock.json'), originalLock); await json(join(repo, 'packages/fal/package.json'), originalFal);
  for (const [path, mutation] of [
    ['package-lock.json', x => { x.version = '1.0.0'; }],
    ['package-lock.json', x => { x.packages[''].version = '1.0.0'; }],
    ['package-lock.json', x => { x.packages['packages/fal'].version = '1.0.0'; }],
    ['package-lock.json', x => { x.packages['packages/core'].dependencies['@sinestack/ai-provider-utils'] = '1.0.0'; }],
    ['package-lock.json', x => { x.packages['packages/fal'].dependencies = { external: '1.0.0' }; }],
    ['packages/fal/package.json', x => { x.version = '1.2.2'; }],
    ['packages/fal/package.json', x => { x.dependencies = { '@sinestack/ai-provider': '^1.2.3' }; }],
  ]) {
    await json(join(repo, 'package-lock.json'), originalLock); await json(join(repo, 'packages/fal/package.json'), originalFal);
    await changeJson(repo, path, mutation); fails(cli(repo));
  }
  await json(join(repo, 'package-lock.json'), originalLock); await json(join(repo, 'packages/fal/package.json'), originalFal);
  await changeJson(repo, 'packages/core/package.json', x => { x.dependencies['@sinestack/ai-provider-utils'] = '^1.2.3'; });
  await changeJson(repo, 'package-lock.json', x => { x.packages['packages/core'].dependencies['@sinestack/ai-provider-utils'] = '^1.2.3'; });
  fails(cli(repo));
});

test('shared compiler configuration and compiler lock changes require every package to bump', async t => {
  const repo = await fixture(t);
  await writeFile(join(repo, 'tsconfig.base.json'), '{"compilerOptions":{}}\n');
  fails(cli(repo), /ai-provider changed/);
  await writeFile(join(repo, 'tsconfig.base.json'), '{}\n');
  await changeJson(repo, 'package-lock.json', x => { x.packages['node_modules/typescript'].integrity = 'sha512-new'; });
  fails(cli(repo), /ai-provider changed/);
});

test('deleted package metadata and user-agent inconsistencies fail closed', async t => {
  const repo = await fixture(t);
  await writeFile(join(repo, 'tests/integration.test.mjs'), "assert.match(headers.get('user-agent'), /sinestack-ai\\/0\\.0\\.0/);\n");
  fails(cli(repo), /integration.test.mjs/);
  await writeFile(join(repo, 'tests/integration.test.mjs'), "assert.match(headers.get('user-agent'), /sinestack-ai\\/1\\.2\\.3/);\n");
  await rm(join(repo, 'packages/fal/package.json'));
  fails(cli(repo));
});

test('unknown package paths fail instead of silently avoiding a release', async t => {
  const repo = await fixture(t);
  await json(join(repo, 'packages/new-provider/package.json'), { name: '@sinestack/ai-new-provider', version: '0.1.0' });
  fails(cli(repo), /Unknown package path/);
});
