import assert from 'node:assert/strict';
import { generate3D, generateAnimation3D, processModel3D, analyzeModel3D, rigModel, animateModel, startTask, waitForTask, deleteTask } from '@sinestack/ai-core';
import { createMeshyProvider, parseMeshyWebhook } from '@sinestack/ai-meshy';

// This file runs from installed tarballs in an isolated directory, not workspaces.
const MODEL = 'https://assets.example/mesh.glb';
const inputs = [];
const stages = new Map();
const meshy = createMeshyProvider({ apiKey: 'mock-only', connectionId: 'consumer', fetch: async (url, init) => {
  const path = new URL(String(url)).pathname.replace('/openapi/', '');
  if (init.method === 'POST') {
    const body = JSON.parse(init.body); const id = `task-${stages.size}`;
    stages.set(id, { path, body }); inputs.push(body);
    return Response.json({ result: id }, { status: 202 });
  }
  if (init.method === 'DELETE') return new Response(null, { status: 200 });
  const id = path.slice(path.lastIndexOf('/') + 1); const stage = stages.get(id);
  assert.ok(stage); assert.equal(path, `${stage.path}/${id}`);
  let output = { model_urls: { glb: MODEL } };
  if (stage.path === 'v1/print/analyze') output = { printability: { status: 'warning', issue_count: 1 } };
  if (stage.path === 'v1/rigging') output = { result: { rigged_character_glb_url: MODEL, basic_animations: { walking_glb_url: MODEL + '?walk' } } };
  if (stage.path === 'v1/animations') output = { result: { animation_glb_url: MODEL, clips: [{ name: 'walk' }, { name: 'run' }] } };
  if (stage.path === 'v1/text-to-motion') output = { result: { motion_url: 'https://assets.example/motion.bvh', motion_format: 'bvh' } };
  return Response.json({ id, status: 'SUCCEEDED', ...output });
} });
const geometry = await generate3D({ model: meshy.textTo3D('consumer-future-version'), input: { prompt: 'robot' } });
assert.equal(geometry.asset.url, MODEL); assert.equal(inputs.length, 1, 'Preview must not silently start refine');
const refined = await processModel3D({ processor: meshy.refine(), input: { preview_task_id: geometry.providerMetadata.meshy.taskId } });
assert.equal(refined.model.url, MODEL); assert.equal(inputs[1].ai_model, undefined);
const model = meshy.analyzePrintability();
const { task } = await startTask({ model, input: { input_task_id: refined.taskId } });
const before = inputs.length;
const resumed = await waitForTask({ model, task: JSON.parse(JSON.stringify(task)) });
assert.equal(resumed.result.printability.status, 'warning'); assert.equal(inputs.length, before);
const analyzed = await analyzeModel3D({ analyzer: model, input: { input_task_id: refined.taskId } });
assert.equal('assets' in analyzed, false);
assert.equal((await deleteTask({ model, task })).status, 'deleted');
const rigged = await rigModel({ rigger: meshy.rig(), input: { input_task_id: refined.taskId } });
assert.equal(rigged.animations.length, 1);
const animated = await animateModel({ animator: meshy.animate(), input: { rig_task_id: rigged.taskId, action_ids: [0, 1] } });
assert.equal(animated.files.length, 1); assert.equal(animated.clips.length, 2);
const motion = await generateAnimation3D({ model: meshy.textToMotion('swift'), input: { prompt: 'walk', duration: 3 } });
assert.equal(motion.asset.role, 'motion');
assert.equal(parseMeshyWebhook({ id: 'one', status: 'SUCCEEDED' }).authenticated, false);
console.log('Installed Meshy package verified preview/refine, analysis, rigging, animation, motion, resume and DELETE.');
