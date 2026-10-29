import assert from 'node:assert/strict';
import test from 'node:test';
import { cancelTask, generateAnimation3D, getAssetStatus, getTaskStatus, startAsset, startTask, waitForTask } from '@sinestack/ai-core';
import { createViggleProvider } from '@sinestack/ai-viggle';

const IMAGE = 'https://media.example/character.png';
const VIDEO = 'https://media.example/motion.mp4';
const BATCH_A = '10000000-0000-0000-0000-000000000001';
const BATCH_B = '10000000-0000-0000-0000-000000000002';
const MATRIX = [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]];
const character = (status = 'queued', extra = {}) => ({ id: 'char_one', status, type: 'render', name: '', progress: 0, capabilities: [], error: null, vsplat: null, glb: null, ...extra });
const motion = (status = 'queued', extra = {}) => ({ id: 'mot_one', status, type: 'glb', name: '', progress: 0, capabilities: [], error: null, vsplat: null, glb: { status, skeletons: [], error: null }, ...extra });
const exported = (format = 'glb', extra = {}) => ({ id: 'mot_one', status: 'ready', download_type: format,
  mixamo_url: `https://assets.example/mixamo.${format}`, metahuman_url: `https://assets.example/metahuman.${format}`,
  metahuman_body_url: `https://assets.example/body.${format}`, thumbnail_url: null, ...extra });
function batch(id, kind = 'initial') {
  return { batchId: id, kind, manifest: { url: `https://assets.example/${id}.json` },
    views: [{ index: 0, url: IMAGE, c2w: MATRIX, intrinsic: [0.5, 0.5, 0.5, 0.5] }] };
}
function scene(operation = 'pano', status = 'queued', extra = {}) {
  return { id: `scn_${operation}.room`, sessionId: 'room', operation, status, credits: 6, result: status === 'ready' ? {
    operation, sessionId: 'room', spz: operation === 'generate' ? null : { url: 'https://assets.example/scene.spz' },
    outputBatch: operation === 'reconstruct' ? null : batch(operation === 'pano' ? BATCH_A : BATCH_B, operation === 'pano' ? 'initial' : 'generated'),
    newViewCount: operation === 'reconstruct' ? 0 : 1, referenceViewCount: operation === 'pano' ? 0 : 6,
  } : null, error: null, ...extra };
}
function fixture(handler, settings = {}) {
  const calls = [];
  const provider = createViggleProvider({ apiKey: 'fixture-only', ...settings, fetch: async (url, init) => {
    const call = { url: String(url), ...init }; calls.push(call);
    const value = await handler(call, calls);
    return value instanceof Response ? value : Response.json(value);
  } });
  return { provider, calls };
}
const json = call => JSON.parse(call.body);

test('Viggle character uses native multipart fields, open model IDs, structured scale and Blob input', async () => {
  const { provider, calls } = fixture(() => character());
  await provider.characters.create({ image: new Blob(['png'], { type: 'image/png' }), type: 'all', model: 'future-model-17',
    enhance: true, enhance_prompt: 'A performer', variant: 'optimized', model_precision: 0.9, quality: 0.8,
    prune_preset: 'compact_hq', prune_budget: 50000, joint_set: 'full', scale_parts: { legs: 1.1 }, use_sparse_W: true, render_thumbnail: true });
  const form = calls[0].body;
  assert.ok(form instanceof FormData); assert.ok(form.get('image') instanceof Blob);
  assert.equal(form.get('model'), 'future-model-17'); assert.equal(form.get('type'), 'all');
  assert.equal(form.get('scale_parts'), '{"legs":1.1}'); assert.equal(form.get('use_sparse_W'), 'true');
  assert.equal(new Headers(calls[0].headers).has('Content-Type'), false);
  assert.equal(calls.length, 1);
});

test('Viggle accepts text-only vsplat, rejects missing or ambiguous image sources before I/O', async () => {
  const { provider, calls } = fixture(() => character('queued', { type: 'vsplat' }));
  await provider.characters.create({ type: 'vsplat', enhance_prompt: 'A blue character', task_id: 'stable-character' });
  assert.equal(calls[0].body.has('image'), false); assert.equal(calls[0].body.get('task_id'), 'stable-character');
  for (const input of [
    { type: 'all', enhance_prompt: 'Missing image' },
    { type: 'vsplat', enhance_prompt: 'Cannot enhance', enhance: false },
    { image_url: IMAGE, ref_url: IMAGE },
    { image_url: IMAGE, type: 'vsplat', scale_parts: { legs: 1 }, joint_set: 'body' },
  ]) await assert.rejects(provider.characters.create(input), TypeError);
  assert.equal(calls.length, 1);
});

test('Viggle character creation completes as a resource without fabricating or implicitly exporting a file', async () => {
  const { provider, calls } = fixture(call => character(call.method === 'POST' ? 'queued' : 'ready', { capabilities: call.method === 'POST' ? [] : ['video_render'] }));
  const model = provider.createCharacter();
  const { task } = await startTask({ model, input: { image_url: IMAGE } });
  const ready = await waitForTask({ model, task });
  assert.equal(ready.result.id, 'char_one'); assert.deepEqual(ready.result.capabilities, ['video_render']);
  assert.equal(calls.length, 2); assert.ok(!calls.some(call => call.url.includes('/export')));
  assert.equal(model.doCancel, undefined);
  await assert.rejects(cancelTask({ model, task }), /unsupported/i);
  assert.equal(calls.length, 2);
});

test('Viggle all-resource failure retains extraction state and reports nested error despite null top-level error', async () => {
  const { provider } = fixture(call => character(call.method === 'POST' ? 'queued' : 'failed', {
    type: 'all', error: null, vsplat: { status: 'failed', error: { code: 'EXTRACTION_FAILED', message: 'Extraction failed' } },
  }));
  const model = provider.createCharacter(); const { task } = await startTask({ model, input: { image_url: IMAGE, type: 'all' } });
  const status = await getTaskStatus({ model, task });
  assert.equal(status.status, 'failed'); assert.equal(status.error.code, 'EXTRACTION_FAILED');
  assert.equal(status.providerMetadata.viggle.output.error, null);
  assert.equal(status.providerMetadata.viggle.output.vsplat.status, 'failed');
});

test('Viggle resources list once, preserve native records, and expose deletion separately from cancellation', async () => {
  const { provider, calls } = fixture(call => call.method === 'DELETE' ? { status: 'deleted' } : { data: [call.url.endsWith('characters') ? character('failed', { progress: null }) : motion('ready', { progress: null })] });
  const chars = await provider.characters.list(); const motions = await provider.motions.list();
  assert.equal(chars.data[0].progress, null); assert.equal(chars.data[0].status, 'failed');
  assert.equal(motions.data[0].id, 'mot_one'); assert.equal(calls.length, 2);
  assert.deepEqual(await provider.characters.delete('char_one'), { status: 'deleted' });
  assert.deepEqual(await provider.motions.delete('mot_one'), { status: 'deleted' });
  assert.ok(calls.slice(2).every(call => call.method === 'DELETE'));
  await assert.rejects(provider.characters.get('mot_one'), /char_/);
  await assert.rejects(provider.motions.delete('mot_..%2Fcharacters'), /resource ID/);
  assert.equal(calls.length, 4);
});

test('Viggle character export does not fabricate a thumbnail and accepts only vsplat', async () => {
  const { provider, calls } = fixture(call => ({ id: 'char_one', status: 'ready', download_type: call.url.includes('?') ? 'vsplat' : null,
    vsplat_url: call.url.includes('?') ? 'https://assets.example/one.vsplat' : null, thumbnail_url: null }));
  const status = await provider.characters.export('char_one');
  const file = await provider.characters.export('char_one', 'vsplat');
  assert.equal(status.vsplat_url, null); assert.equal(file.thumbnail_url, null); assert.match(file.vsplat_url, /\.vsplat$/);
  await assert.rejects(provider.characters.export('char_one', 'thumbnail'), /download_type/);
  assert.equal(calls.length, 2);
});

test('Viggle text motion task uses JSON and a stable native idempotency key; no model is invented', async () => {
  const { provider, calls } = fixture(() => motion());
  const model = provider.createMotionFromText();
  await startTask({ model, input: { text: 'A cartwheel', duration_seconds: 3.5, guidance_scale: 7.5, smooth: false }, headers: { 'Idempotency-Key': 'stable-motion' } });
  assert.equal(json(calls[0]).task_id, 'stable-motion'); assert.equal(json(calls[0]).smooth, false);
  assert.equal(json(calls[0]).model, undefined); assert.equal(json(calls[0]).duration_seconds, 3.5);
  assert.equal(model.capabilities.idempotentStart, true);
  await provider.motions.createFromText({ text: 'A wave', task_id: 'explicit-native' });
  assert.equal(json(calls[1]).task_id, 'explicit-native');
  for (const input of [{ text: '' }, { text: 'A wave', duration_seconds: 2.9 }, { text: 'A wave', guidance_scale: 31 }]) {
    await assert.rejects(provider.motions.createFromText(input), TypeError);
  }
  assert.equal(calls.length, 2);
});

test('Viggle video motion preserves 2D and extraction controls with no model whitelist', async () => {
  const { provider, calls } = fixture(() => motion('queued', { type: 'all' }));
  await provider.motions.createFromVideo({ motion_video_url: VIDEO, type: 'all', model: 'next-preprocessing-model', target_fps: 60,
    enable_smoothing: true, smooth_velocity_threshold: 0, apply_std_joints: false, thumbnail_path: 'native-thumbnail-path' });
  assert.equal(calls[0].body.get('target_fps'), '60'); assert.equal(calls[0].body.get('model'), 'next-preprocessing-model');
  assert.equal(calls[0].body.get('apply_std_joints'), 'false');
  assert.equal(provider.createMotionFromVideo().capabilities.idempotentStart, false);
  await assert.rejects(provider.motions.createFromVideo({ motion_video_url: VIDEO, video_url: VIDEO }), /exactly one/);
  await assert.rejects(provider.motions.createFromVideo({ motion_video_url: VIDEO, target_fps: 0 }), /target_fps/);
  assert.equal(calls.length, 1);
});

test('Viggle imports an official template as a distinct owned motion resource', async () => {
  const { provider, calls } = fixture(call => motion(call.method === 'POST' ? 'queued' : 'ready', { type: 'render', glb: null, capabilities: ['video_render'] }));
  const model = provider.importMotion();
  const { task } = await startTask({ model, input: { template_id: 'official-template', model: 'future-template-model' } });
  assert.equal(calls[0].url, 'https://apis.viggle.ai/v1/motions/import');
  assert.equal(json(calls[0]).model, 'future-template-model');
  const result = await getTaskStatus({ model, task }); assert.equal(result.status, 'completed');
  assert.deepEqual(result.result.capabilities, ['video_render']);
  await assert.rejects(provider.motions.import({ template_id: 'a', template_uuid: 'b' }), /exactly one/);
  assert.equal(calls.length, 2);
});

test('Viggle text-to-motion uses the shared animation facade and preserves all GLB rig variants', async () => {
  const { provider, calls } = fixture(call => call.method === 'POST' ? motion() : exported());
  const result = await generateAnimation3D({ model: provider.textToMotion(), input: { text: 'A person doing a cartwheel' } });
  assert.equal(result.assets.length, 3);
  assert.deepEqual(result.assets.map(file => file.metadata.rig), ['mixamo', 'metahuman', 'metahuman_body']);
  assert.deepEqual(result.assets.map(file => file.metadata.joints), [50, 441, 86]);
  assert.ok(result.assets.every(file => file.mediaType === 'model/gltf-binary' && file.role === 'animation'));
  assert.equal(calls[1].url, 'https://apis.viggle.ai/v1/motions/mot_one/export?download_type=glb');
  assert.equal(calls.length, 2); assert.ok(json(calls[0]).task_id);
  assert.equal(result.providerMetadata.viggle.output.metahuman_body_url, exported().metahuman_body_url);
});

test('Viggle video-to-motion requests glb extraction explicitly and can deliver pre-generated FBX rigs', async () => {
  const { provider, calls } = fixture(call => call.method === 'POST' ? motion() : exported('fbx'));
  const result = await generateAnimation3D({ model: provider.videoToMotion({ format: 'fbx' }), input: { motion_video: new Blob(['video']), enable_smoothing: true } });
  assert.equal(calls[0].body.get('type'), 'glb'); assert.ok(calls[0].body.get('task_id'));
  assert.ok(result.assets.every(file => file.filename.endsWith('.fbx') && file.metadata.format === 'fbx'));
  assert.equal(calls.length, 2);
  await assert.rejects(generateAnimation3D({ model: provider.videoToMotion(), input: { motion_video_url: VIDEO, type: 'all' } }), /type=glb/);
  assert.equal(calls.length, 2);
});

test('Viggle motion format selection is a read-only export and does not trigger regeneration', async () => {
  const { provider, calls } = fixture(call => exported(new URL(call.url).searchParams.get('download_type')));
  const glb = await provider.motions.export('mot_one', 'glb'); const fbx = await provider.motions.export('mot_one', 'fbx');
  assert.equal(glb.download_type, 'glb'); assert.equal(fbx.download_type, 'fbx');
  assert.ok(calls.every(call => call.method === 'GET')); assert.equal(calls.length, 2);
});

test('Viggle animation resume rejects a different export format before an authenticated request', async () => {
  const { provider, calls } = fixture(() => motion());
  const { operation } = await startAsset({ model: provider.textToMotion(), input: { text: 'Walk' } });
  await assert.rejects(getAssetStatus({ model: provider.textToMotion({ format: 'fbx' }), operation }), /match|model/i);
  assert.equal(calls.length, 1);
});

test('Viggle ready motion with no exported files is a protocol failure, with no paid resubmission', async () => {
  const { provider, calls } = fixture(call => call.method === 'POST' ? motion() : exported('glb', { mixamo_url: null, metahuman_url: null, metahuman_body_url: null }));
  await assert.rejects(generateAnimation3D({ model: provider.textToMotion(), input: { text: 'Walk' } }), /no animation files/);
  assert.equal(calls.filter(call => call.method === 'POST').length, 1);
});

test('Viggle scene creation supports both native JSON URLs and multipart reference files', async () => {
  const { provider, calls } = fixture(() => scene());
  await provider.scenes.create({ sessionId: 'room', prompt: 'A room', referenceImages: [IMAGE], quality: 'high' });
  assert.deepEqual(json(calls[0]).referenceImages, [IMAGE]);
  await provider.scenes.create({ sessionId: 'room', prompt: 'A room', referenceImageFiles: [new Blob(['a']), new Blob(['b'])] });
  assert.equal(calls[1].body.getAll('referenceImageFiles').length, 2); assert.equal(calls[1].body.get('sessionId'), 'room');
  await provider.scenes.create({ sessionId: 'room', panorama: new Blob(['pano']) });
  assert.ok(calls[2].body.get('panorama') instanceof Blob);
  await assert.rejects(provider.scenes.create({ sessionId: 'room', prompt: 'A room', referenceImages: [], referenceImageFiles: [new Blob(['x'])] }), /referenceImages or referenceImageFiles/);
  assert.equal(calls.length, 3);
});

test('Viggle custom panorama encodes matrices once and preserves world-frame placement', async () => {
  const { provider, calls } = fixture(() => scene());
  await provider.scenes.customPanorama({ sessionId: 'room', panorama: new Blob(['pano']), panoramaC2w: MATRIX, metersPerUnit: 1.5 });
  assert.equal(calls[0].url, 'https://apis.viggle.ai/v1/scenes/custom-pano');
  assert.deepEqual(calls[0].body.getAll('panoramaC2w'), [JSON.stringify(MATRIX)]);
  assert.equal(calls[0].body.get('metersPerUnit'), '1.5');
  const mirrored = MATRIX.map(row => [...row]); mirrored[0][0] = -1;
  await assert.rejects(provider.scenes.customPanorama({ sessionId: 'room', panoramaUri: IMAGE, panoramaC2w: mirrored }), /mirroring/);
  await assert.rejects(provider.scenes.customPanorama({ sessionId: 'room', panoramaUri: IMAGE, panoramaC2w: MATRIX, metersPerUnit: 0.01 }), /metersPerUnit/);
  assert.equal(calls.length, 1);
});

test('Viggle scene stages retain session/batch/camera state and each paid operation stays explicit', async () => {
  const { provider, calls } = fixture(call => {
    const path = new URL(call.url).pathname;
    const operation = call.method === 'POST' ? path.split('/').at(-1) : /scn_([^.]*)/.exec(path)[1];
    return scene(operation, call.method === 'POST' ? 'queued' : 'ready');
  });
  const create = provider.createScene(); const first = await startTask({ model: create, input: { sessionId: 'room', prompt: 'A room' } });
  const created = await getTaskStatus({ model: create, task: JSON.parse(JSON.stringify(first.task)) });
  assert.equal(created.status, 'completed'); assert.equal(created.result.result.outputBatch.batchId, BATCH_A);
  assert.deepEqual(created.result.result.outputBatch.views[0].c2w, MATRIX);
  assert.equal(first.task.handle.sessionId, 'room'); assert.equal(calls.length, 2);
  const generate = provider.generateSceneViews(); const second = await startTask({ model: generate, input: { sessionId: 'room', referenceBatchIds: [BATCH_A], targetPosition: { position: [1, 0, 0], yaw: 90, pitch: 0 }, projection: 'perspective', fov: 90, seed: 0 } });
  const generated = await getTaskStatus({ model: generate, task: second.task });
  assert.equal(generated.result.result.spz, null); assert.equal(generated.result.result.outputBatch.batchId, BATCH_B);
  assert.equal(calls.length, 4);
  const reconstruct = provider.reconstructScene(); const third = await startTask({ model: reconstruct, input: { sessionId: 'room', referenceBatchIds: [BATCH_A, BATCH_B] } });
  const rebuilt = await getTaskStatus({ model: reconstruct, task: third.task });
  assert.equal(rebuilt.result.result.outputBatch, null); assert.match(rebuilt.result.result.spz.url, /\.spz$/);
  assert.equal(calls.filter(call => call.method === 'POST').length, 3); assert.equal(calls.length, 6);
});

test('Viggle scene malformed camera/batch/source requests fail before I/O', async () => {
  const { provider, calls } = fixture(() => scene());
  const invalid = [
    () => provider.scenes.create({ sessionId: 'bad/session', prompt: 'A room' }),
    () => provider.scenes.create({ sessionId: 'room', panoramaUri: IMAGE, prompt: 'Conflict' }),
    () => provider.scenes.generateViews({ sessionId: 'room', referenceBatchIds: [BATCH_A, BATCH_A], targetC2w: MATRIX }),
    () => provider.scenes.generateViews({ sessionId: 'room', referenceBatchIds: [BATCH_A], targetC2w: MATRIX, targetPosition: { position: [0, 0, 0] } }),
    () => provider.scenes.generateViews({ sessionId: 'room', referenceBatchIds: [BATCH_A], targetPosition: { position: [0, 0, 0], pitch: 91 } }),
    () => provider.scenes.reconstruct({ sessionId: 'room', referenceBatchIds: [BATCH_A], seed: 1 }),
  ];
  for (const call of invalid) await assert.rejects(call(), TypeError);
  assert.equal(calls.length, 0);
});

test('Viggle session conflict preserves running task ID and never creates an implicit queue or retries a submission', async () => {
  const error = { code: 'INVALID_REQUEST', message: 'Scene session busy', retryable: false, details: { running_task_id: 'scn_pano.room' } };
  const { provider, calls } = fixture(() => Response.json({ error }, { status: 409 }));
  await assert.rejects(startTask({ model: provider.createScene(), input: { sessionId: 'room', prompt: 'A room' } }), /Scene session busy/);
  assert.equal(calls.length, 1);
});

test('Viggle scene query validates task/session/operation identity and retains old manifest-only batches', async () => {
  const old = scene('pano', 'ready'); delete old.result.outputBatch.views; delete old.result.outputBatch.kind;
  const { provider } = fixture(() => old);
  const raw = await provider.scenes.get('scn_pano.room'); assert.equal(raw.result.outputBatch.batchId, BATCH_A);
  const mismatch = fixture(call => call.method === 'POST' ? scene() : scene('pano', 'ready', { sessionId: 'different-room' }));
  const model = mismatch.provider.createScene(); const { task } = await startTask({ model, input: { sessionId: 'room', prompt: 'Room' } });
  await assert.rejects(getTaskStatus({ model, task }), /different scene session|different operation or session/);
  assert.equal(mismatch.calls.length, 2);
});

test('Viggle ready scene files refresh through GET and cancelled tasks remain terminal without deletion', async () => {
  let reads = 0;
  const { provider, calls } = fixture(call => {
    if (call.method === 'POST') return scene();
    const ready = scene('pano', 'ready'); ready.result.spz.url = `https://assets.example/scene.spz?signature=${++reads}`; return ready;
  });
  const first = await provider.scenes.get('scn_pano.room'); const second = await provider.scenes.get('scn_pano.room');
  assert.notEqual(first.result.spz.url, second.result.spz.url); assert.ok(calls.every(call => call.method === 'GET'));
  const stopped = fixture(call => scene('pano', call.method === 'POST' ? 'queued' : 'cancelled', { credits: 0 }));
  const model = stopped.provider.createScene(); const { task } = await startTask({ model, input: { sessionId: 'room', prompt: 'Room' } });
  const status = await getTaskStatus({ model, task }); assert.equal(status.status, 'cancelled');
  assert.equal(stopped.calls.length, 2); assert.equal(model.doCancel, undefined);
});
