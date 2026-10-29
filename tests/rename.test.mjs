import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { getTaskStatus } from '@sinestack/ai-core';
import { packageDirectories, readPackages, repository } from '../scripts/release.mjs';
import { assertDirtyStatusAllowed } from '../scripts/publish.mjs';

test('all workspaces participate in the renamed release and lockfile', async () => {
  const directories = (await readdir(join(repository, 'packages'), { withFileTypes: true }))
    .filter(entry => entry.isDirectory()).map(entry => entry.name).sort();
  assert.deepEqual([...packageDirectories].sort(), directories);
  const packages = await readPackages();
  const lock = JSON.parse(await readFile(join(repository, 'package-lock.json'), 'utf8'));
  assert.equal(lock.name, 'sinestack-ai-workspace');
  for (const { directory, manifest } of packages) {
    assert.equal(manifest.repository.url, 'https://github.com/fei-bai-inc/sinestack-ai.git');
    assert.equal(lock.packages[`packages/${directory}`].name, manifest.name);
    assert.deepEqual(lock.packages[`node_modules/${manifest.name}`], { resolved: `packages/${directory}`, link: true });
  }
});

test('tracked source, examples and docs do not reintroduce retired package names or repository links', async () => {
  const filenames = execFileSync('git', ['ls-files', '-z'], { cwd: repository, encoding: 'utf8' }).split('\0').filter(Boolean);
  // Construct retired names so the regression check does not match its own source.
  const oldName = ['sine', 'ai'].join('-');
  const retired = [`@${oldName}/`, `fei-bai-inc/${oldName}`, ['Sine', 'AI'].join(' '), `${oldName}/`];
  for (const filename of filenames) {
    const content = await readFile(join(repository, filename), 'utf8');
    for (const name of retired) assert.equal(content.includes(name), false, `${filename} still contains retired branding: ${name}`);
  }
});

test('version stamping updates every renamed package and the shared runtime', async t => {
  const temporary = await mkdtemp(join(tmpdir(), 'sinestack-ai-version-test-'));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const files = ['package.json', 'package-lock.json', 'scripts/version.mjs', 'scripts/release.mjs',
    'packages/core/src/internal/runtime.ts', 'tests/integration.test.mjs',
    ...packageDirectories.map(name => `packages/${name}/package.json`)];
  for (const filename of files) {
    const target = join(temporary, filename);
    await mkdir(dirname(target), { recursive: true });
    await copyFile(join(repository, filename), target);
  }
  const version = '1.2.3-rename.1';
  execFileSync(process.execPath, [join(temporary, 'scripts/version.mjs'), version], { cwd: temporary, timeout: 10_000 });
  const packages = await readPackages(temporary);
  const lock = JSON.parse(await readFile(join(temporary, 'package-lock.json'), 'utf8'));
  for (const { directory, manifest } of packages) {
    assert.equal(manifest.version, version);
    assert.equal(lock.packages[`packages/${directory}`].version, version);
    for (const [name, value] of Object.entries(manifest.dependencies ?? {})) {
      if (name.startsWith('@sinestack/ai-')) assert.equal(value, version);
    }
  }
  const runtime = await readFile(join(temporary, 'packages/core/src/internal/runtime.ts'), 'utf8');
  assert.ok(runtime.includes(`sinestack-ai/${version}`));
  const integration = await readFile(join(temporary, 'tests/integration.test.mjs'), 'utf8');
  assert.ok(integration.includes('sinestack-ai\\/1\\.2\\.3-rename\\.1'));
  assertDirtyStatusAllowed(files.filter(name => !name.startsWith('scripts/')).map(name => ` M ${name}`).join('\n'), true);
});

test('persisted v1 tasks created before the package rename still resume without resubmission', async () => {
  const task = JSON.parse('{"type":"sine-ai-task","specificationVersion":"v1","provider":"fixture","driverId":"rig-check","domain":"model3d.rig.check","handle":{"id":"accepted-before-rename"}}');
  let reads = 0;
  const model = {
    specificationVersion: 'v1', provider: 'fixture', driverId: 'rig-check', domain: 'model3d.rig.check',
    async doStart() { assert.fail('Renaming must not resubmit a saved task'); },
    async doStatus({ handle }) {
      reads++;
      assert.equal(handle.id, 'accepted-before-rename');
      return { status: 'completed', result: { riggable: false } };
    },
  };
  const status = await getTaskStatus({ model, task });
  assert.equal(status.status, 'completed');
  assert.equal(status.result.riggable, false);
  assert.deepEqual(status.task, task);
  assert.equal(reads, 1);
});
