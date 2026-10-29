import assert from 'node:assert/strict';
import test from 'node:test';
import { getTaskStatus } from '@sinestack/ai-core';

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
