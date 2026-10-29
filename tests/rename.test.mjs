import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { getTaskStatus } from '@sinestack/ai-core';
import { packageDirectories, readPackages, repository } from '../scripts/release.mjs';

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
