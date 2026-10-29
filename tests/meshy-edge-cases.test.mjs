import assert from 'node:assert/strict';
import test from 'node:test';
import { animateModel, rigModel, processModel3D, startTask, getTaskStatus } from '@sinestack/ai-core';
import { createMeshyProvider } from '@sinestack/ai-meshy';
const MODEL = 'https://assets.example/model.glb';
function fixture(output, extra = {}) {
  const calls = [];
  const provider = createMeshyProvider({ apiKey: 'fixture-only', fetch: async (url, init) => {
    calls.push({ url: String(url), ...init });
    return Response.json(init.method === 'POST' ? { result: 'one' } : { id: 'one', status: 'SUCCEEDED', ...output, ...extra }, { status: init.method === 'POST' ? 202 : 200 });
  } });
  return { provider, calls };
}
test('Meshy post_process.operation_type may be omitted; GLB-only animation is valid', async () => {
  for (const post_process of [{}, { fps: 30 }, null]) {
    const { provider, calls } = fixture({ result: { animation_glb_url: MODEL, animation_fbx_url: '', processed_usdz_url: '', processed_armature_fbx_url: '', processed_animation_fps_fbx_url: '' } });
    const result = await animateModel({ animator: provider.animate(), input: { rig_task_id: 'rig', motion_task_id: 'motion', post_process } });
    assert.equal(result.files.length, 1); assert.equal(result.files[0].url, MODEL);
    assert.deepEqual(JSON.parse(calls[0].body).post_process, post_process);
  }
});
test('Meshy rigging does not require optional default animations', async () => {
  const { provider } = fixture({ result: { rigged_character_glb_url: MODEL, rigged_character_fbx_url: '', basic_animations: null } });
  const result = await rigModel({ rigger: provider.rig(), input: { input_task_id: 'source' } });
  assert.equal(result.model.url, MODEL); assert.deepEqual(result.animations, []); assert.deepEqual(result.armatures, []);
});
test('expired result timestamps remain metadata, never a reason to create a replacement task', async () => {
  const { provider, calls } = fixture({ model_urls: { glb: MODEL } }, { expires_at: 1, consumed_credits: 0 });
  const model = provider.remesh(); const { task } = await startTask({ model, input: { input_task_id: 'source' } });
  const status = await getTaskStatus({ model, task });
  assert.equal(status.status, 'completed'); assert.equal(status.result.expiresAt, 1);
  assert.equal(calls.filter(call => call.method === 'POST').length, 1);
});
test('absent files on a historical succeeded task fail material results but raw task history remains accessible', async () => {
  const { provider, calls } = fixture({ model_urls: {} }, { expires_at: 1 });
  await assert.rejects(processModel3D({ processor: provider.remesh(), input: { input_task_id: 'source' } }), /no processed model/);
  const record = await provider.tasks.get('remesh', 'one');
  assert.equal(record.status, 'SUCCEEDED'); assert.equal(record.expires_at, 1);
  assert.equal(calls.filter(call => call.method === 'POST').length, 1);
});
