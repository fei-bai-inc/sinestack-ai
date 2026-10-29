import assert from 'node:assert/strict';
import test from 'node:test';
import { createHmac } from 'node:crypto';
import { generateAsset, generate3D, startAsset, getAssetStatus, startTask, getTaskStatus, waitForTask,
  processModel3D, checkRigging, rigModel, animateModel, cancelTask } from '@sinestack/ai-core';
import { createTripoProvider, verifyTripoWebhook, TripoAPIError } from '@sinestack/ai-tripo';

const BASE = 'https://openapi.tripo3d.ai/v3';
const ID = '764cabcf-b745-4b3e-ae38-1200304cf45b';
const VERSION = 'future-version-2040';
const MODEL = 'https://assets.example/model.glb';
const IMAGE = 'https://assets.example/image.png';
const modelOutput = { model_url: MODEL, rendered_image_url: IMAGE, normalize_scale: 0.25, normalize_translation: [0, 1, -1] };
const poll = { intervalMs: 0, delay: async () => {} };
const ok = data => Response.json({ code: 0, data });
const finished = output => ok({ task_id: ID, status: 'success', output, credits_consumed: 1.25 });
function wire(...steps) {
  const calls = [];
  return { calls, fetch: async (url, init) => {
    const call = { url: String(url), ...init, headers: new Headers(init.headers) }; calls.push(call);
    assert.ok(steps.length, `Unexpected ${call.method} ${url}`);
    const next = steps.shift(); return typeof next === 'function' ? next(call) : next;
  } };
}
const provider = fetch => createTripoProvider({ apiKey: 'fixture-secret', fetch });
const geometry = { model_seed: 1, face_limit: 12000, texture: true, pbr: true, texture_seed: 2,
  texture_quality: 'fast', texture_version: 'future-texture', delight: false, auto_size: true,
  export_uv: true, export_orientation: '-y', geometry_quality: 'detailed', quad: false,
  smart_low_poly: false, generate_parts: false, compress: 'geometry' };
const scenarios = [
  ['textTo3D', 'generation/text-to-model', 'asset', VERSION, { ...geometry, prompt: 'robot', negative_prompt: 'blur', image_seed: 3 }, modelOutput],
  ['imageTo3D', 'generation/image-to-model', 'asset', VERSION, { ...geometry, input: IMAGE, enable_image_autofix: true, texture_alignment: 'geometry', orientation: 'align_image' }, modelOutput],
  ['multiviewTo3D', 'generation/multiview-to-model', 'asset', VERSION, { ...geometry, inputs: [IMAGE, '', IMAGE + '?back', ''], texture_alignment: 'geometry', orientation: 'align_image' }, modelOutput],
  ['imageToSplat', 'generation/image-to-splat', 'asset', undefined, { input: IMAGE, model_seed: 4 }, { model_url: 'https://assets.example/a.splat' }],
  ['textToImage', 'generation/text-to-image', 'asset', VERSION, { prompt: 'robot', size: '2K', quality: 'high', background: 'transparent', aspect_ratio: '1:1', output_format: 'png', watermark: false, template: 'figure' }, { image_url: IMAGE }],
  ['imageToImage', 'generation/image-to-image', 'asset', VERSION, { inputs: [IMAGE, IMAGE + '?second'], prompt: 'robot', size: '2K', quality: 'high', background: 'opaque', aspect_ratio: '1:1', output_format: 'png', template: 'figure' }, { generated_image_url: IMAGE }],
  ['imageToMultiview', 'generation/image-to-multiview', 'asset', undefined, { input: IMAGE }, { front_view_url: IMAGE, left_view_url: IMAGE + '?left', back_view_url: IMAGE + '?back', right_view_url: IMAGE + '?right' }],
  ['editMultiview', 'generation/edit-multiview', 'asset', undefined, { input: 'views-task', prompts: [{ prompt: 'add hat', view: 'front' }] }, { generate_multiview_image: { front: IMAGE, left: IMAGE + '?left', back: IMAGE + '?back', right: IMAGE + '?right' } }],
  ['imageToDepth', 'generation/image-to-depth', 'asset', undefined, { input: IMAGE, kind: 'color', process_res: 504 }, { depth_image_url: IMAGE }],
  ['texture', 'models/texture', 'process', VERSION, { input: 'model-task', texture_prompt: { text: 'wood', style_image: { url: IMAGE } }, pbr: true, texture_seed: 5, texture_alignment: 'geometry', texture_quality: 'fast', part_names: ['head'], compress: 'geometry', bake: false, delight: false }, modelOutput],
  ['segment', 'mesh/segment', 'process', VERSION, { input: 'model-task', segmentation_granularity: 'detailed', split_by_connectivity: false, ref_image: IMAGE }, { ...modelOutput, parts: ['head', 'body'] }],
  ['smartSegment', 'mesh/smartsegment', 'process', undefined, { input: MODEL, seg_type: 'model', granularity: 'fine', hint: 'head', transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] }, { seg_model_url: MODEL, mask_url: IMAGE, seg_task_id: 'seg-child', model_task_id: 'model-child', prompt: 'head' }],
  ['complete', 'mesh/complete', 'process', VERSION, { input: 'seg-child', part_names: ['head'], completion_mode: 'quick_cap' }, modelOutput],
  ['retopology', 'mesh/decimate', 'process', VERSION, { input: 'model-task', face_limit: 10000, quad: true, smart_uv: true, bake: false, part_names: ['head'] }, modelOutput],
  ['unwrapUV', 'mesh/uv', 'process', VERSION, { input: 'model-task', bake: true, export_orientation: '+x', compress: 'geometry' }, { ...modelOutput, uv_render_url: IMAGE + '?uv' }],
  ['convert', 'models/convert', 'process', undefined, { input: 'model-task', format: 'FBX', quad: true, force_symmetry: true, face_limit: 10000, flatten_bottom: true, flatten_bottom_threshold: 0.01, texture_size: 2048, texture_format: 'PNG', bake: true, pack_uv: true, export_vertex_colors: false, pivot_to_center_bottom: true, scale_factor: 2, export_orientation: '-x', with_animation: true, animate_in_place: true, part_names: ['head'], fbx_preset: 'mixamo' }, { model_url: 'https://assets.example/actual.fbx' }],
  ['importModel', 'models/import', 'process', undefined, { input: MODEL }, modelOutput],
  ['rigCheck', 'animations/rig-check', 'check', undefined, { input: 'model-task' }, { riggable: false, rig_type: 'biped' }],
  ['rig', 'animations/rig', 'rig', VERSION, { input: 'model-task', rig_type: 'biped', spec: 'unreal', out_format: 'fbx' }, { ...modelOutput, rig_type: 'biped', spec: 'unreal' }],
  ['retarget', 'animations/retarget', 'animate', undefined, { input: 'rig-task', animations: ['preset:walk', 'preset:run'], out_format: 'glb', export_with_geometry: false, animate_in_place: true }, { model_urls: { walk: MODEL, run: MODEL + '?run' }, rendered_video_url: 'https://assets.example/preview.mp4' }],
];
const invoke = (domain, capability, input) => domain === 'asset' ? generateAsset({ model: capability, input, poll })
  : domain === 'process' ? processModel3D({ processor: capability, input, poll })
  : domain === 'check' ? checkRigging({ checker: capability, input, poll })
  : domain === 'rig' ? rigModel({ rigger: capability, input, poll }) : animateModel({ animator: capability, input, poll });

for (const [factory, path, domain, version, input, output] of scenarios) {
  test(`Tripo ${factory}: exact route, complete native parameters, domain result and no downloads`, async () => {
    const script = wire(ok({ task_id: ID }), finished(output));
    const tripo = provider(script.fetch); const capability = version === undefined ? tripo[factory]() : tripo[factory](version);
    const native = { ...input, future_option: { nested: [false, 0, null] } };
    const result = await invoke(domain, capability, native);
    assert.deepEqual(script.calls.map(c => [c.method, c.url]), [['POST', `${BASE}/${path}`], ['GET', `${BASE}/tasks/${ID}`]]);
    assert.deepEqual(JSON.parse(script.calls[0].body), { ...native, ...(version === undefined ? {} : { model: version }) });
    assert.ok(script.calls.every(c => c.headers.get('authorization') === 'Bearer fixture-secret' && c.redirect === 'error'));
    assert.deepEqual(domain === 'asset' ? result.providerMetadata.tripo.output : result.raw, output);
    if (domain === 'asset') { assert.ok(result.asset); assert.equal(result.usage.credits, 1.25); }
    else { assert.equal(result.taskId, ID); assert.equal(result.creditsConsumed, 1.25); assert.equal(result.execution.responses.length, 2); }
    if (domain === 'check') { assert.equal(result.riggable, false); assert.equal('assets' in result, false); }
    if (factory === 'smartSegment') { assert.equal(result.segmentationTaskId, 'seg-child'); assert.equal(result.modelTaskId, 'model-child'); assert.equal(result.mask.url, IMAGE); }
    if (factory === 'unwrapUV') assert.equal(result.uvPreview.url, IMAGE + '?uv');
    if (factory === 'importModel') { assert.equal(result.normalizeScale, 0.25); assert.deepEqual(result.normalizeTranslation, [0, 1, -1]); }
    if (factory === 'convert') assert.notEqual(result.model.mediaType, 'model/gltf-binary');
    if (factory === 'retarget') { assert.equal(result.files.length, 3); assert.equal(result.clips, undefined); }
    if (factory === 'imageToMultiview' || factory === 'editMultiview') assert.equal(result.assets.length, 4);
  });
}

test('generation model version is explicit, never selected by SDK', () => {
  const tripo = provider(async () => assert.fail('no HTTP'));
  for (const name of ['textTo3D', 'imageTo3D', 'multiviewTo3D', 'textToImage', 'imageToImage']) {
    for (const id of [undefined, '', null]) assert.throws(() => tripo[name](id), /modelId/);
  }
});
test('generation supports all three multiview encodings without changing slot order', async () => {
  const sources = [[IMAGE, '', IMAGE + '?back', ''], [{ front: { file_token: 'token1' } }, { right: { url: IMAGE } }], [{ task_id: 'views-task' }]];
  const script = wire(...sources.map(() => ok({ task_id: ID })));
  const model = provider(script.fetch).multiviewTo3D(VERSION);
  for (const inputs of sources) await startAsset({ model, input: { inputs } });
  assert.deepEqual(script.calls.map(c => JSON.parse(c.body).inputs), sources);
});
test('invalid multiview encodings fail before any paid submission', async () => {
  const script = wire(); const model = provider(script.fetch).multiviewTo3D(VERSION);
  for (const inputs of [[IMAGE, '', '', ''], ['', IMAGE, IMAGE, ''], [{ left: IMAGE }, { back: IMAGE }], [{ front: IMAGE }, { front: IMAGE }], [{ task_id: 'views-task' }, { front: IMAGE }], [IMAGE, null, IMAGE, null]]) {
    await assert.rejects(startAsset({ model, input: { inputs } }));
  }
  assert.equal(script.calls.length, 0);
});
test('Texture supports text with style, single image and null-slot multi-image guidance', async () => {
  const prompts = [{ text: 'wood', style_image: { file_token: 'style' } }, { image: { url: IMAGE } }, { images: [{ url: IMAGE }, null, { file_token: 'back' }, null] }, { images: [{ front: IMAGE }, { back: { url: IMAGE } }] }];
  const script = wire(...prompts.map(() => ok({ task_id: ID }))); const model = provider(script.fetch).texture();
  for (const texture_prompt of prompts) await startTask({ model, input: { input: 'model-task', texture_prompt } });
  assert.deepEqual(script.calls.map(c => JSON.parse(c.body).texture_prompt), prompts);
  for (const c of script.calls) assert.equal('model' in JSON.parse(c.body), false, 'omission is preserved');
});
test('conflicting texture prompts and invalid transforms fail before submission', async () => {
  const script = wire(); const tripo = provider(script.fetch);
  for (const texture_prompt of [{ text: 'wood', image: IMAGE }, { image: IMAGE, style_image: IMAGE }, { images: [{ task_id: 'views-task' }] }]) {
    await assert.rejects(startTask({ model: tripo.texture(), input: { input: 'model-task', texture_prompt } }));
  }
  await assert.rejects(startTask({ model: tripo.smartSegment(), input: { seg_type: 'model', input: MODEL, transform: [1, 2] } }));
  assert.equal(script.calls.length, 0);
});
test('Smart Segmentation image branch does not require a model transform', async () => {
  const script = wire(ok({ task_id: ID }));
  await startTask({ model: provider(script.fetch).smartSegment(), input: { seg_type: 'image', input: IMAGE, hint: 'wheel', granularity: 'coarse' } });
  assert.equal(JSON.parse(script.calls[0].body).transform, undefined);
});
test('retarget single and batch inputs are mutually exclusive with a five-action limit', async () => {
  const script = wire(ok({ task_id: ID })); const model = provider(script.fetch).retarget();
  await startTask({ model, input: { input: 'rig-task', animation: 'future:action' } });
  for (const input of [{ input: 'rig-task' }, { input: 'rig-task', animation: 'a', animations: ['b'] }, { input: 'rig-task', animations: [] }, { input: 'rig-task', animations: ['a', 'b', 'c', 'd', 'e', 'f'] }]) {
    await assert.rejects(startTask({ model, input }));
  }
  assert.equal(script.calls.length, 1);
});
test('image editing permits a template-only request and rejects ambiguous image input', async () => {
  const script = wire(ok({ task_id: ID })); const model = provider(script.fetch).imageToImage(VERSION);
  await startAsset({ model, input: { input: IMAGE, template: 't_pose' } });
  for (const input of [{ input: IMAGE }, { input: IMAGE, inputs: [IMAGE], prompt: 'x' }, { inputs: [], prompt: 'x' }]) await assert.rejects(startAsset({ model, input }));
  assert.equal(script.calls.length, 1);
});
test('provider options supplement native input but cannot override it or selected model', async () => {
  const script = wire(ok({ task_id: ID })); const model = provider(script.fetch).textTo3D(VERSION);
  await startAsset({ model, input: { prompt: 'robot' }, providerOptions: { tripo: { face_limit: 123 } } });
  assert.equal(JSON.parse(script.calls[0].body).face_limit, 123);
  await assert.rejects(startAsset({ model, input: { prompt: 'robot' }, providerOptions: { tripo: { prompt: 'other' } } }), /cannot override/);
  await assert.rejects(startAsset({ model, input: { prompt: 'robot', model: 'different' } }), /conflicts/);
  assert.equal(script.calls.length, 1);
});
test('native JSON accessors and non-finite numbers never reach the transport', async () => {
  const script = wire(); const model = provider(script.fetch).textTo3D(VERSION); let getters = 0;
  for (const input of [{ get prompt() { getters++; return 'robot'; } }, { prompt: 'robot', face_limit: Infinity }]) await assert.rejects(startAsset({ model, input }));
  assert.equal(getters, 0); assert.equal(script.calls.length, 0);
});
test('custom future asset paths retain arbitrary parameters and independent external mappings', async () => {
  const script = wire(ok({ task_id: ID }), finished({ delivery: MODEL, seed: 42 }));
  class Mapping {
    kind = 'model-3d'; #prefix = 'mapped:';
    mapInput(input) { return { description: this.#prefix + input.text }; }
    mapResult(output) { const url = output.delivery; output.seed = 0; return { assets: [{ type: 'url', url, mediaType: 'model/gltf-binary' }] }; }
  }
  const definition = new Mapping(); const model = provider(script.fetch).asset('generation/future-mesh', definition);
  definition.mapInput = () => assert.fail('must use captured method');
  const result = await generate3D({ model, input: { text: 'robot' }, poll });
  assert.deepEqual(JSON.parse(script.calls[0].body), { description: 'mapped:robot' });
  assert.equal(result.providerMetadata.tripo.output.seed, 42); assert.equal(result.response.body.data.output.seed, 42);
});
test('domain tasks restore from JSON with fresh provider and reject altered connection or route before hooks', async () => {
  const submitWire = wire(ok({ task_id: ID }));
  const settings = { apiKey: 'secret', connectionId: 'account-one', baseURL: 'https://proxy.example/tripo/v3', fetch: submitWire.fetch };
  const { task } = await startTask({ model: createTripoProvider(settings).rig(VERSION), input: { input: 'model-task' } });
  const readWire = wire(finished(modelOutput));
  const model = createTripoProvider({ ...settings, fetch: readWire.fetch }).rig(VERSION);
  const result = await waitForTask({ model, task: JSON.parse(JSON.stringify(task)), poll });
  assert.equal(result.result.model.url, MODEL); assert.equal(readWire.calls[0].method, 'GET');
  for (const patch of [{ baseURL: BASE }, { path: 'models/texture' }, { taskId: '../other' }, { connectionId: 'other' }]) {
    let hooks = 0;
    await assert.rejects(getTaskStatus({ model, task: { ...task, handle: { ...task.handle, ...patch } }, hooks: { onStart() { hooks++; } } }));
    assert.equal(hooks, 0);
  }
  assert.equal(readWire.calls.length, 1);
  assert.equal(JSON.stringify(task).includes('secret'), false);
});
test('queued/running progress is normalized; failed, banned, expired and cancelled are terminal', async () => {
  const script = wire(ok({ task_id: ID }), ...['queued', 'running', 'failed', 'banned', 'expired', 'cancelled'].map(status => ok({ task_id: ID, status, progress: 25, error_code: 3100, error_msg: 'provider detail' })));
  const model = provider(script.fetch).rigCheck(); const { task } = await startTask({ model, input: { input: 'model-task' } });
  for (const expected of ['pending', 'running', 'failed', 'failed', 'failed', 'cancelled']) {
    const result = await getTaskStatus({ model, task }); assert.equal(result.status, expected);
    if (expected === 'pending' || expected === 'running') assert.equal(result.progress, 0.25);
    if (expected === 'failed') { assert.equal(result.error.code, '3100'); assert.equal(result.error.message, 'provider detail'); }
  }
  assert.equal(script.calls.filter(c => c.method === 'POST').length, 1);
});
test('rig check accepts topology alias and unavailable rig type without inventing one', async () => {
  for (const output of [{ riggable: true, topology: 'avian' }, { riggable: false }]) {
    const script = wire(ok({ task_id: ID }), finished(output));
    const result = await checkRigging({ checker: provider(script.fetch).rigCheck(), input: { input: MODEL } });
    assert.equal(result.rigType, output.topology); assert.equal(result.riggable, output.riggable);
  }
});
test('model aliases are files but thumbnails alone never count as generated geometry', async () => {
  for (const field of ['model_url', 'pbr_model_url', 'base_model_url', 'model', 'pbr_model']) {
    const script = wire(ok({ task_id: ID }), finished({ [field]: MODEL }));
    assert.equal((await generate3D({ model: provider(script.fetch).textTo3D(VERSION), input: { prompt: 'robot' } })).asset.url, MODEL);
  }
  const script = wire(ok({ task_id: ID }), finished({ rendered_image_url: IMAGE, metadata: { docs: MODEL } }));
  await assert.rejects(generate3D({ model: provider(script.fetch).textTo3D(VERSION), input: { prompt: 'robot' } }), /no primary/);
  assert.equal(script.calls.length, 2);
});
test('foreign task IDs, unknown statuses and malformed checks fail without resubmission', async () => {
  for (const data of [{ task_id: 'foreign', status: 'success', output: {} }, { task_id: ID, status: 'unknown' }, { task_id: ID, status: 'success', output: { riggable: 'false' } }]) {
    const script = wire(ok({ task_id: ID }), ok(data));
    await assert.rejects(checkRigging({ checker: provider(script.fetch).rigCheck(), input: { input: MODEL } }));
    assert.equal(script.calls.length, 2);
  }
});
test('uncertain or rejected submissions are never retried and preserve API error codes', async () => {
  for (const response of [Response.json({ code: 2001, message: 'no credits' }), Response.json({ error: 'busy' }, { status: 503 }), new Response('{', { status: 200 })]) {
    const script = wire(response); const model = provider(script.fetch).rigCheck();
    await assert.rejects(startTask({ model, input: { input: MODEL } }), error => {
      if (error.cause instanceof TripoAPIError) assert.equal(error.cause.code, 2001);
      return true;
    });
    assert.equal(script.calls.length, 1);
  }
});
test('Tripo does not pretend to support submission callbacks or remote cancellation', async () => {
  const script = wire(ok({ task_id: ID })); const model = provider(script.fetch).rigCheck();
  await assert.rejects(startTask({ model, input: { input: MODEL }, webhookUrl: 'https://app.example/hook' }), /unsupported/);
  const { task } = await startTask({ model, input: { input: MODEL } });
  await assert.rejects(cancelTask({ model, task }), /unsupported/); assert.equal(script.calls.length, 1);
});
test('account balance preserves decimal credits and task batch maps include missing IDs', async () => {
  const script = wire(ok({ balance: 42.125, frozen: 1.25 }), ok({ rows: [{ used: 0.25 }], total: 1 }),
    ok({ tasks: { [ID]: { task_id: ID, status: 'queued' } }, missed: ['missing-task'] }));
  const tripo = provider(script.fetch);
  assert.equal((await tripo.account.balance()).balance, 42.125);
  assert.equal((await tripo.account.usage({ page: 1, page_size: 10 })).total, 1);
  const result = await tripo.tasks.batch([ID, 'missing-task']); assert.deepEqual(result.missed, ['missing-task']);
  assert.deepEqual(JSON.parse(script.calls[2].body), { task_ids: [ID, 'missing-task'] });
  assert.match(script.calls[1].url, /account\/usage\?page=1&page_size=10/);
});
test('multipart upload and presigned PUT never leak API credentials to storage', async () => {
  const presign = { presigned_url: 'https://storage.example/upload?signature=xyz', file_token: 'file-token', expires_in: 1800 };
  const script = wire(ok({ file_token: 'form-token' }), ok(presign), new Response(null, { status: 200 }));
  const tripo = createTripoProvider({ apiKey: 'private-key', headers: { 'x-tenant-secret': 'private', 'Content-Type': 'application/json' }, fetch: script.fetch });
  const blob = new Blob(['model'], { type: 'model/gltf-binary' });
  assert.equal((await tripo.files.upload(blob, 'model.glb')).fileToken, 'form-token');
  assert.ok(script.calls[0].body instanceof FormData); assert.equal(script.calls[0].body.get('file').name, 'model.glb');
  assert.equal(script.calls[0].headers.has('content-type'), false, 'fetch creates the multipart boundary');
  const upload = await tripo.files.presign('glb'); assert.deepEqual(upload, presign);
  assert.equal((await tripo.files.put(upload, blob)).fileToken, 'file-token');
  const call = script.calls[2]; assert.equal(call.url, presign.presigned_url); assert.equal(call.method, 'PUT');
  assert.equal(call.headers.has('authorization'), false); assert.equal(call.headers.has('x-tenant-secret'), false);
  assert.equal(call.redirect, 'error'); assert.equal(call.credentials, 'omit');
});
test('redirects cannot move authenticated Tripo calls to a different origin', async () => {
  const response = ok({ task_id: ID }); Object.defineProperty(response, 'redirected', { value: true });
  const script = wire(response);
  await assert.rejects(startTask({ model: provider(script.fetch).rigCheck(), input: { input: MODEL } }), /redirect/);
  assert.equal(script.calls.length, 1);
});

function signedEvent(body, now = 1800000000000) {
  const timestamp = Math.floor(now / 1000); const secret = 'literal-signing-secret';
  const signature = createHmac('sha256', secret).update(`${timestamp}.`).update(body).digest('hex');
  return { body, secret, now, expectedEndpointId: 'endpoint-1', headers: {
    'Tripo-Webhook-Signature': `t=${timestamp},v1=${signature}`, 'Tripo-Webhook-Id': 'endpoint-1',
    'Tripo-Webhook-Delivery': 'delivery-1', 'Tripo-Webhook-Event': 'task.completed',
  } };
}
const eventBody = JSON.stringify({ id: 'event-1', type: 'task.completed', created_at: '2027-01-15T08:00:00Z', data: { task_id: ID } });
test('webhook verifies original bytes and provides signed event deduplication identity', async () => {
  const options = signedEvent(eventBody); const verified = await verifyTripoWebhook(options);
  assert.equal(verified.taskId, ID); assert.equal(verified.deliveryId, 'delivery-1'); assert.equal(verified.deduplicationKey, 'event-1');
  const bytes = new TextEncoder().encode(eventBody);
  assert.equal((await verifyTripoWebhook({ ...options, body: bytes })).event.id, 'event-1');
  const duplicate = await verifyTripoWebhook({ ...options, headers: { ...options.headers, 'Tripo-Webhook-Delivery': 'changed-header' } });
  assert.equal(duplicate.deduplicationKey, verified.deduplicationKey, 'unsigned delivery header cannot bypass event dedup');
});
test('webhook rejects modified content, stale signatures and wrong configured endpoints', async () => {
  const original = signedEvent(eventBody);
  for (const options of [{ ...original, body: eventBody + ' ' }, { ...original, secret: 'wrong' },
    { ...original, now: original.now + 301000 }, { ...original, expectedEndpointId: 'other' },
    { ...original, headers: { ...original.headers, 'Tripo-Webhook-Event': 'task.failed' } }]) await assert.rejects(verifyTripoWebhook(options));
});
