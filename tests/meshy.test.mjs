import assert from 'node:assert/strict';
import test from 'node:test';
import { APICallError } from '@ai-sdk/provider';
import { generate3D, generateAsset, generateAnimation3D, startAsset, getAssetStatus, waitForAsset,
  startTask, getTaskStatus, waitForTask, cancelTask, deleteTask,
  processModel3D, analyzeModel3D, rigModel, animateModel, TaskExecutionError } from '@sinestack/ai-core';
import { AssetProviderTransport } from '@sinestack/ai-provider-utils';
import { createMeshyProvider, parseMeshyWebhook } from '@sinestack/ai-meshy';

const BASE = 'https://api.meshy.ai/openapi';
const ID = 'meshy-task-1';
const MODEL = 'https://assets.example/model.glb';
const IMAGE = 'https://assets.example/front.png';
const VERSION = 'future-native-version';
const poll = { intervalMs: 0, delay: async () => {} };
const json = (value, status = 200, headers) => Response.json(value, { status, headers });
const accepted = (id = ID) => json({ result: id }, 202);
const done = (output, extra = {}) => json({ id: ID, status: 'SUCCEEDED', progress: 100, consumed_credits: 1.25, expires_at: 1900000000000, ...output, ...extra });
function wire(...steps) {
  const calls = [];
  return { calls, fetch: async (url, init) => {
    const call = { url: String(url), ...init, headers: new Headers(init.headers) }; calls.push(call);
    assert.ok(steps.length, `Unexpected ${call.method} ${call.url}`);
    const step = steps.shift(); return typeof step === 'function' ? step(call) : step;
  } };
}
const provider = fetch => createMeshyProvider({ apiKey: 'fixture-secret', fetch });
const modelOutput = {
  model_urls: { fbx: 'https://assets.example/model.fbx', glb: MODEL, obj: 'https://assets.example/model.obj', mtl: 'https://assets.example/model.mtl' },
  thumbnail_url: IMAGE, alpha_thumbnail_url: IMAGE + '?alpha', thumbnail_urls: { front: IMAGE, back: IMAGE + '?back' },
  texture_urls: [{ base_color: IMAGE + '?base', metallic: IMAGE + '?metal', roughness: IMAGE + '?rough', normal: IMAGE + '?normal' }],
};
const rigOutput = { result: { rigged_character_glb_url: MODEL, rigged_character_fbx_url: MODEL + '.fbx',
  basic_animations: { walking_glb_url: MODEL + '?walk', walking_fbx_url: MODEL + '?walk-fbx', walking_armature_glb_url: MODEL + '?walk-armature', running_glb_url: MODEL + '?run', running_fbx_url: MODEL + '?run-fbx', running_armature_glb_url: MODEL + '?run-armature' } } };
const animationOutput = { result: { animation_glb_url: MODEL, animation_fbx_url: MODEL + '.fbx', processed_usdz_url: MODEL + '.usdz', processed_armature_fbx_url: MODEL + '?armature', processed_animation_fps_fbx_url: MODEL + '?fps', clips: [{ name: 'walk' }, { name: 'run' }] } };
const geometry = { name: 'robot', model_type: 'standard', topology: 'triangle', target_polycount: 12000, should_remesh: true,
  geometry_resolution: '2k', pose_mode: 't-pose', seed: 42, moderation: true, save_pre_remeshed_model: true,
  auto_size: false, origin_at: 'bottom', decimation_mode: 2, target_formats: ['glb', 'fbx'],
  experimental: { turbo: false, enable_tsr: true, optimize_texture_seams: null }, alpha_thumbnail: true,
  ultra_mode: null, is_a_t_pose: false, symmetry_mode: 'auto', surface_mode: 'hard' };
const texture = { enable_pbr: true, texture_resolution: '4k', texture_prompt: 'wood', texture_image_url: IMAGE, remove_lighting: false, hd_texture: null };
const scenarios = [
  ['textTo3D', 'v2/text-to-3d', 'asset', VERSION, { ...geometry, prompt: 'robot', negative_prompt: 'blurry', art_style: 'realistic', texture_richness: 'high' }, { ...modelOutput, mode: 'preview', pre_remeshed_glb_url: MODEL + '?pre' }, { mode: 'preview', ai_model: VERSION }],
  ['imageTo3D', 'v1/image-to-3d', 'asset', VERSION, { ...geometry, ...texture, image_url: IMAGE, input_task_id: 'image-task', should_texture: true, image_enhancement: null, multi_view_thumbnails: true }, modelOutput, { ai_model: VERSION }],
  ['multiImageTo3D', 'v1/multi-image-to-3d', 'asset', VERSION, { ...geometry, image_urls: [IMAGE, IMAGE + '?back'], should_texture: true, image_enhancement: false, enable_pbr: true, texture_image_urls: [IMAGE, IMAGE + '?texture'] }, modelOutput, { ai_model: VERSION }],
  ['textToImage', 'v1/text-to-image', 'asset', VERSION, { prompt: 'robot', generate_multi_view: false, pose_mode: 'a-pose', aspect_ratio: '1:1', remove_background: true }, { image_urls: [IMAGE, IMAGE + '?second'] }, { ai_model: VERSION }],
  ['imageToImage', 'v1/image-to-image', 'asset', VERSION, { prompt: 'red robot', reference_image_urls: [IMAGE], input_task_id: 'image-task', generate_multi_view: true, pose_mode: 't-pose', remove_background: true }, { image_urls: [IMAGE, IMAGE + '?back'] }, { ai_model: VERSION }],
  ['textToMotion', 'v1/text-to-motion', 'asset', 'swift', { prompt: 'walk', duration: 3.5 }, { result: { motion_url: 'https://assets.example/walk.bvh', motion_format: 'bvh', duration_ms: 3500, mode: 'swift' } }, { mode: 'swift' }],
  ['refine', 'v2/text-to-3d', 'process', undefined, { ...texture, preview_task_id: 'preview-task', name: 'refine', target_formats: ['glb'], auto_size: true, alpha_thumbnail: true, experimental: { optimize_texture_seams: true } }, { ...modelOutput, mode: 'refine' }, { mode: 'refine' }],
  ['retexture', 'v1/retexture', 'process', VERSION, { input_task_id: 'source-task', model_url: MODEL, name: 'new material', art_style: 'realistic', text_style_prompt: 'wood', image_style_url: IMAGE, enable_original_uv: false, enable_pbr: true, remove_lighting: true, texture_resolution: '4k', hd_texture: null, target_formats: ['glb'], alpha_thumbnail: true }, modelOutput, { ai_model: VERSION }],
  ['remesh', 'v1/remesh', 'process', undefined, { model_url: MODEL, target_formats: ['glb', 'obj'], topology: 'quad', target_polycount: 8000, decimation_mode: 1, alpha_thumbnail: true, resize_height: 2, resize_longest_side: 3, auto_size: false, origin_at: 'center', convert_format_only: false }, modelOutput, {}],
  ['convert', 'v1/convert', 'process', undefined, { input_task_id: 'source-task', target_formats: ['fbx', 'stl'] }, { model_urls: { fbx: 'https://assets.example/out.fbx', stl: 'https://assets.example/out.stl' } }, {}],
  ['resize', 'v1/resize', 'process', undefined, { input_task_id: 'source-task', resize_height: 1.8, origin_at: 'bottom' }, modelOutput, {}],
  ['unwrapUV', 'v1/uv-unwrap', 'process', undefined, { model_url: MODEL }, modelOutput, {}],
  ['multiColorPrint', 'v1/print/multi-color', 'process', undefined, { model_url: MODEL, style: 'cartoon', max_colors: 4, max_depth: 5, printer_brand: 'custom' }, modelOutput, {}],
  ['repairPrintability', 'v1/print/repair', 'process', undefined, { input_task_id: 'source-task', printer_type: 'fdm', intended_print_height_mm: 120, alpha_thumbnail: true }, { ...modelOutput, intended_print: { height_mm: 120 }, print_repair_report: { repaired: true } }, {}],
  ['autoSplit', 'v1/print/split', 'process', undefined, { input_task_id: 'source-task', mode: 'by_parts', prompt: 'split the limbs', target_formats: ['glb'], layout: 'on_plate', connectors: true, connector_type: 'cube', connector_size: 0.4, connector_height: 0.3 }, { ...modelOutput, part_count: 8, prompt_ignored: false }, {}],
  ['analyzePrintability', 'v1/print/analyze', 'analyze', undefined, { model_url: MODEL, printer_type: 'sla', intended_print_longest_side_mm: 140 }, { printability: { status: 'error', error_count: 2, warning_count: 1, issue_count: 3, metrics: { watertight: false }, thin_walls: { min_mm: 0.1 } } }, {}],
  ['rig', 'v1/rigging', 'rig', undefined, { input_task_id: 'source-task', model_url: MODEL, name: 'character', height_meters: 1.7, animation_type: 'biped', texture_image_url: IMAGE }, rigOutput, {}],
  ['animate', 'v1/animations', 'animate', undefined, { rig_task_id: 'rig-task', action_ids: [0, 8], name: 'walk-run', post_process: { operation_type: 'change_fps', fps: 30 } }, animationOutput, {}],
];
function invoke(domain, model, input) {
  return domain === 'asset' ? generateAsset({ model, input, poll })
    : domain === 'process' ? processModel3D({ processor: model, input, poll })
    : domain === 'analyze' ? analyzeModel3D({ analyzer: model, input, poll })
    : domain === 'rig' ? rigModel({ rigger: model, input, poll })
    : animateModel({ animator: model, input, poll });
}
for (const [factory, route, domain, version, input, output, added] of scenarios) {
  test(`Meshy ${factory}: native parameters, exact route, outputs and shared runtime`, async () => {
    const script = wire(accepted(), done(output)); const meshy = provider(script.fetch);
    const capability = version === undefined ? meshy[factory]() : meshy[factory](version);
    const native = { ...input, future_option: { nested: [false, 0, null] } };
    const result = await invoke(domain, capability, native);
    assert.deepEqual(script.calls.map(c => [c.method, c.url]), [['POST', `${BASE}/${route}`], ['GET', `${BASE}/${route}/${ID}`]]);
    assert.deepEqual(JSON.parse(script.calls[0].body), { ...native, ...added });
    assert.ok(script.calls.every(c => c.headers.get('authorization') === 'Bearer fixture-secret' && c.redirect === 'error'));
    const raw = domain === 'asset' ? result.providerMetadata.meshy.output : result.raw;
    for (const [key, value] of Object.entries(output)) assert.deepEqual(raw[key], value);
    if (domain === 'asset') { assert.ok(result.asset); assert.equal(result.usage.credits, 1.25); }
    else { assert.equal(result.taskId, ID); assert.equal(result.creditsConsumed, 1.25); assert.equal(result.execution.responses.length, 2); }
    if (factory === 'refine') assert.equal('ai_model' in JSON.parse(script.calls[0].body), false, 'Refine inherits upstream model when omitted');
    if (domain === 'analyze') { assert.equal(result.printability.status, 'error'); assert.equal('assets' in result, false); assert.equal('model' in result, false); }
    if (factory === 'rig') { assert.equal(result.animations.length, 4); assert.equal(result.armatures.length, 2); }
    if (factory === 'animate') { assert.equal(result.animations.length, 4); assert.equal(result.clips.length, 2); assert.equal(result.armatures.length, 1); }
    if (factory === 'autoSplit') { assert.equal(result.partCount, 8); assert.equal(result.promptIgnored, false); }
    if (factory === 'repairPrintability') assert.equal(result.repairReport.repaired, true);
  });
}

test('Meshy models are explicit, open strings; no automatic latest selection', () => {
  const meshy = provider(async () => assert.fail('no HTTP'));
  for (const name of ['textTo3D', 'imageTo3D', 'multiImageTo3D', 'textToImage', 'imageToImage', 'textToMotion']) {
    for (const value of [undefined, '', null]) assert.throws(() => meshy[name](value), /modelId/);
    assert.ok(meshy[name]('future-version'));
  }
});
test('preview and refine are separate paid stages and restored independently', async () => {
  const script = wire(accepted('preview'), done({ ...modelOutput, mode: 'preview' }, { id: 'preview' }), accepted('refine'), done({ ...modelOutput, mode: 'refine' }, { id: 'refine' }));
  const meshy = provider(script.fetch); const model = meshy.textTo3D(VERSION);
  const started = await startAsset({ model, input: { prompt: 'robot' } });
  assert.equal(script.calls.length, 1);
  const preview = await waitForAsset({ model, operation: JSON.parse(JSON.stringify(started.operation)), poll });
  const processor = meshy.refine();
  const next = await startTask({ model: processor, input: { preview_task_id: preview.providerMetadata.meshy.taskId } });
  const final = await waitForTask({ model: processor, task: JSON.parse(JSON.stringify(next.task)), poll });
  assert.equal(final.result.taskId, 'refine');
  assert.deepEqual(script.calls.filter(c => c.method === 'POST').map(c => JSON.parse(c.body)), [
    { prompt: 'robot', mode: 'preview', ai_model: VERSION }, { preview_task_id: 'preview', mode: 'refine' },
  ]);
});
test('models, routes, domains, stages and connections cannot be changed on resume', async () => {
  const first = wire(accepted());
  const config = { apiKey: 'private-key', connectionId: 'tenant-one', baseURL: 'https://proxy.example/mesh/openapi', fetch: first.fetch };
  const { task } = await startTask({ model: createMeshyProvider(config).refine(), input: { preview_task_id: 'preview' } });
  const script = wire(done({ ...modelOutput, mode: 'refine' }));
  const model = createMeshyProvider({ ...config, fetch: script.fetch }).refine();
  assert.equal((await waitForTask({ model, task: JSON.parse(JSON.stringify(task)), poll })).result.model.url, MODEL);
  assert.equal(script.calls[0].method, 'GET');
  for (const patch of [{ route: 'v1/rigging' }, { variant: 'preview' }, { modelId: 'other' }, { modelField: 'mode' }, { domain: 'model3d.rig' }, { baseURL: BASE }, { connectionId: 'other' }, { taskId: '../foreign' }]) {
    let observed = 0;
    await assert.rejects(getTaskStatus({ model, task: { ...task, handle: { ...task.handle, ...patch } }, hooks: { onStart() { observed++; } } }));
    assert.equal(observed, 0);
  }
  assert.equal(script.calls.length, 1); assert.equal(JSON.stringify(task).includes('private-key'), false);
});
test('Meshy sources keep documented precedence rather than silently dropping input fields', async () => {
  const inputs = [
    ['rig', { input_task_id: 'task', model_url: MODEL }],
    ['retexture', { input_task_id: 'task', model_url: MODEL, text_style_prompt: 'wood', image_style_url: IMAGE }],
  ];
  const script = wire(...inputs.map(() => accepted())); const meshy = provider(script.fetch);
  for (const [name, input] of inputs) await startTask({ model: meshy[name](), input });
  assert.deepEqual(script.calls.map(c => JSON.parse(c.body)), inputs.map(item => item[1]));
});
test('multi-image inputs support one to four images without Tripo direction constraints', async () => {
  const script = wire(accepted(), accepted()); const model = provider(script.fetch).multiImageTo3D(VERSION);
  for (const image_urls of [[IMAGE], [IMAGE, IMAGE + '?2', IMAGE + '?3', IMAGE + '?4']]) await startAsset({ model, input: { image_urls } });
  await assert.rejects(startAsset({ model, input: { image_urls: [] } }));
  await assert.rejects(startAsset({ model, input: { image_urls: Array(5).fill(IMAGE) } }));
  assert.equal(script.calls.length, 2);
});
test('unknown native fields survive while model, stage and providerOption conflicts fail locally', async () => {
  const script = wire(accepted()); const model = provider(script.fetch).textTo3D(VERSION);
  await startAsset({ model, input: { prompt: 'robot', future_geometry: 7 }, providerOptions: { meshy: { custom_flag: true } } });
  assert.deepEqual(JSON.parse(script.calls[0].body), { prompt: 'robot', future_geometry: 7, custom_flag: true, mode: 'preview', ai_model: VERSION });
  for (const options of [
    { input: { prompt: 'robot', mode: 'refine' } },
    { input: { prompt: 'robot', ai_model: 'other' } },
    { input: { prompt: 'robot' }, providerOptions: { meshy: { prompt: 'different' } } },
  ]) await assert.rejects(startAsset({ model, ...options }));
  assert.equal(script.calls.length, 1);
});
test('invalid endpoint structures are rejected before any billable POST', async () => {
  const script = wire(); const meshy = provider(script.fetch);
  const invalid = [
    ['refine', {}], ['rig', {}], ['convert', { model_url: MODEL, target_formats: [] }],
    ['resize', { model_url: MODEL }], ['resize', { model_url: MODEL, resize_height: 1, auto_size: true }],
    ['resize', { model_url: MODEL, resize_height: 0 }], ['resize', { model_url: MODEL, auto_size: 'yes' }],
    ['retexture', { model_url: MODEL }], ['retexture', { model_url: MODEL, multiview_image_urls: [IMAGE], text_style_prompt: 'x' }],
    ['analyzePrintability', { model_url: MODEL, intended_print_height_mm: 100, intended_print_longest_side_mm: 100 }],
    ['repairPrintability', { model_url: MODEL, intended_print_height_mm: 0 }],
    ['multiColorPrint', { model_url: MODEL, max_colors: 17 }], ['autoSplit', { model_url: MODEL }],
    ['autoSplit', { input_task_id: 'source', mode: 'by_parts' }],
    ['autoSplit', { input_task_id: 'source', connector_size: 1 }],
    ['animate', { rig_task_id: 'rig' }], ['animate', { rig_task_id: 'rig', action_id: 1, motion_task_id: 'motion' }],
    ['animate', { rig_task_id: 'rig', action_ids: [1, 1] }], ['animate', { rig_task_id: 'rig', action_ids: Array.from({ length: 11 }, (_, i) => i) }],
  ];
  for (const [name, input] of invalid) await assert.rejects(startTask({ model: meshy[name](), input }), undefined, name);
  const image = meshy.imageToImage(VERSION);
  await assert.rejects(startAsset({ model: image, input: { prompt: 'x', reference_image_urls: [] } }));
  await assert.rejects(startAsset({ model: image, input: { prompt: 'x', reference_image_urls: [IMAGE], generate_multi_view: true, aspect_ratio: '1:1' } }));
  for (const duration of [1, 2.1, 11]) await assert.rejects(startAsset({ model: meshy.textToMotion('prime'), input: { prompt: 'walk', duration } }));
  assert.equal(script.calls.length, 0);
});
test('animation accepts ID zero, unique action batches and independent text-to-motion references', async () => {
  const inputs = [{ rig_task_id: 'rig', action_id: 0 }, { rig_task_id: 'rig', action_ids: [0, 1, 2] }, { rig_task_id: 'rig', motion_task_id: 'motion' }];
  const script = wire(...inputs.map(() => accepted())); const model = provider(script.fetch).animate();
  for (const input of inputs) await startTask({ model, input });
  assert.deepEqual(script.calls.map(c => JSON.parse(c.body)), inputs);
});
test('animation files do not invent a clip count when several actions share one file', async () => {
  const script = wire(accepted(), done({ result: { animation_glb_url: MODEL } }));
  const result = await animateModel({ animator: provider(script.fetch).animate(), input: { rig_task_id: 'rig', action_ids: [1, 2, 3] } });
  assert.equal(result.animations.length, 1); assert.equal(result.clips, undefined);
});
test('motion output remains independent of a character and uses the returned file format', async () => {
  const script = wire(accepted(), done({ result: { motion_url: 'https://assets.example/dance.fbx', motion_format: 'fbx', duration_ms: 4500 } }));
  const result = await generateAnimation3D({ model: provider(script.fetch).textToMotion('prime'), input: { prompt: 'dance', duration: 4.5 } });
  assert.equal(result.asset.role, 'motion'); assert.equal(result.asset.metadata.format, 'fbx');
  assert.equal(JSON.parse(script.calls[0].body).rig_task_id, undefined);
});
test('result roles retain PBR maps, primary format, preview variants and reported expiration', async () => {
  const script = wire(accepted(), done(modelOutput, { consumed_credits: 0 }));
  const result = await processModel3D({ processor: provider(script.fetch).unwrapUV(), input: { model_url: MODEL } });
  assert.equal(result.model.url, MODEL); assert.equal(result.models.glb.url, MODEL);
  assert.equal(result.models.fbx.mediaType, 'application/octet-stream');
  assert.equal(result.textures.length, 4); assert.equal(result.previews.length, 4);
  assert.equal(result.creditsConsumed, 0); assert.equal(result.expiresAt, 1900000000000);
  assert.equal(result.model.metadata.expiresAt, result.expiresAt);
  assert.ok(result.files.some(file => file.role === 'material'));
});
test('thumbnails or source URLs cannot masquerade as generated model files', async () => {
  for (const output of [{ thumbnail_url: IMAGE }, { model_url: '', image_url: IMAGE, prompt: MODEL, metadata: { url: MODEL } }, { model_urls: {} }]) {
    const script = wire(accepted(), done(output));
    await assert.rejects(generate3D({ model: provider(script.fetch).textTo3D(VERSION), input: { prompt: 'robot' } }), /no primary/);
    assert.equal(script.calls.length, 2);
  }
});
test('custom mappings retain their receiver and cannot corrupt retained native output', async () => {
  const script = wire(accepted(), done({ delivery: MODEL, note: 'original' }));
  class Mapping {
    kind = 'model-3d'; #prefix = 'mapped:';
    mapInput(input) { return { description: this.#prefix + input.description }; }
    mapResult(task) { const url = task.delivery; task.note = 'mutated'; return { assets: [{ type: 'url', url, mediaType: 'model/gltf-binary' }] }; }
  }
  const mapping = new Mapping(); const model = provider(script.fetch).asset('v9/custom-mesh', mapping);
  mapping.mapInput = () => assert.fail('captured method required');
  const result = await generate3D({ model, input: { description: 'robot' } });
  assert.deepEqual(JSON.parse(script.calls[0].body), { description: 'mapped:robot' });
  assert.equal(result.providerMetadata.meshy.output.note, 'original'); assert.equal(result.response.body.note, 'original');
});
test('domain processors accept injected input mapping without reimplementing execution', async () => {
  const script = wire(accepted(), done(modelOutput));
  const processor = provider(script.fetch).remesh({ mapInput: ({ source, polygons }) => ({ input_task_id: source, target_polycount: polygons }) });
  await processModel3D({ processor, input: { source: 'old', polygons: 42 } });
  assert.deepEqual(JSON.parse(script.calls[0].body), { input_task_id: 'old', target_polycount: 42 });
});
test('input accessors, nonfinite fields and protocol path injection fail without I/O', async () => {
  const script = wire(); const meshy = provider(script.fetch); let getters = 0;
  const model = meshy.textTo3D(VERSION);
  await assert.rejects(startAsset({ model, input: { get prompt() { getters++; return 'robot'; } } }));
  await assert.rejects(startAsset({ model, input: { prompt: 'robot', target_polycount: Infinity } }));
  for (const route of ['v1/../balance', 'https://evil.example', '/v1/rigging', 'v1/rigging?x=1']) assert.throws(() => meshy.asset(route, { kind: 'model-3d' }));
  for (const id of ['../balance', 'x?key=1', 'x%2fy', '.', '']) await assert.rejects(meshy.tasks.get('rigging', id));
  assert.equal(getters, 0); assert.equal(script.calls.length, 0);
});
test('task statuses preserve progress, native errors and cancellation without resubmission', async () => {
  const script = wire(accepted(), ...['PENDING', 'IN_PROGRESS', 'FAILED', 'CANCELED'].map(status => json({ id: ID, status, progress: 12.5, task_error: { type: 'InputError', message: 'invalid mesh' } })));
  const model = provider(script.fetch).rig(); const { task } = await startTask({ model, input: { model_url: MODEL } });
  for (const state of ['pending', 'running', 'failed', 'cancelled']) {
    const result = await getTaskStatus({ model, task }); assert.equal(result.status, state);
    if (state === 'running' || state === 'pending') assert.equal(result.progress, 0.125);
    if (state === 'failed') { assert.equal(result.error.code, 'InputError'); assert.equal(result.error.message, 'invalid mesh'); }
  }
  assert.equal(script.calls.filter(c => c.method === 'POST').length, 1);
});
test('status retries only re-read the accepted task and retain Retry-After', async () => {
  const script = wire(accepted(), json({ message: 'busy' }, 503, { 'retry-after-ms': '0' }), done(modelOutput));
  const result = await processModel3D({ processor: provider(script.fetch).remesh(), input: { model_url: MODEL }, poll });
  assert.equal(result.model.url, MODEL); assert.deepEqual(script.calls.map(c => c.method), ['POST', 'GET', 'GET']);
});
test('uncertain paid submissions, malformed responses and terminal failures never create a second task', async () => {
  for (const response of [json({ message: 'rate limited' }, 429), new Response('{', { status: 202 }), json({ result: '../other' }, 202), json({ task_id: ID }, 202)]) {
    const script = wire(response);
    await assert.rejects(startTask({ model: provider(script.fetch).rig(), input: { model_url: MODEL } }));
    assert.equal(script.calls.length, 1);
  }
  const script = wire(accepted(), json({ id: ID, status: 'FAILED', task_error: { message: 'no credits' } }));
  await assert.rejects(rigModel({ rigger: provider(script.fetch).rig(), input: { model_url: MODEL } }), e => e instanceof TaskExecutionError && e.code === 'TASK_JOB_FAILED');
  assert.equal(script.calls.length, 2);
});
test('unknown status, identity mismatch and wrong stage are explicit failures', async () => {
  for (const data of [{ id: 'foreign', status: 'SUCCEEDED' }, { id: ID, status: 'UNKNOWN' }, { id: ID, status: 'IN_PROGRESS', progress: 101 }, { id: ID, status: 'SUCCEEDED', mode: 'preview', ...modelOutput }]) {
    const script = wire(accepted(), json(data));
    await assert.rejects(processModel3D({ processor: provider(script.fetch).refine(), input: { preview_task_id: 'preview' } }));
    assert.equal(script.calls.length, 2);
  }
});
test('DELETE accepts documented empty 200/204 and is never exposed as cancel', async () => {
  for (const response of [new Response(null, { status: 200 }), new Response(null, { status: 204 }), json({})]) {
    const script = wire(accepted(), response); const model = provider(script.fetch).rig();
    const { task } = await startTask({ model, input: { model_url: MODEL } });
    await assert.rejects(cancelTask({ model, task }), /unsupported/);
    assert.equal((await deleteTask({ model, task })).status, 'deleted');
    assert.deepEqual(script.calls.map(c => c.method), ['POST', 'DELETE']);
    assert.equal(script.calls[1].body, undefined); assert.equal(script.calls[1].url, `${BASE}/v1/rigging/${ID}`);
  }
});
test('DELETE 409 is not cancellation and never succeeds on a malformed acknowledgement', async () => {
  for (const response of [json({ message: 'task is running' }, 409), json({ status: 'queued' }), new Response('not json')]) {
    const script = wire(accepted(), response); const model = provider(script.fetch).rig(); const { task } = await startTask({ model, input: { model_url: MODEL } });
    await assert.rejects(deleteTask({ model, task })); assert.equal(script.calls.length, 2);
  }
});
test('local abort and unsupported submission callbacks send no cancellation/delete request', async () => {
  const script = wire(accepted()); const meshy = provider(script.fetch); const model = meshy.rig();
  await assert.rejects(startTask({ model, input: { model_url: MODEL }, webhookUrl: 'https://app.example/callback' }), /unsupported/);
  await assert.rejects(startTask({ model, input: { model_url: MODEL }, retry: { start: 1 } }), /idempotent/);
  const { task } = await startTask({ model, input: { model_url: MODEL } });
  await assert.rejects(waitForTask({ model, task, abortSignal: AbortSignal.abort() }));
  assert.equal(script.calls.length, 1);
});
test('shared transport allows empty DELETE but still rejects empty JSON submission responses', async () => {
  const script = wire(new Response(null, { status: 200 }), new Response(null, { status: 200 }));
  const transport = new AssetProviderTransport({ provider: 'fixture', baseURL: BASE, apiKey: 'key', environmentVariableName: 'UNUSED', fetch: script.fetch });
  const options = { headers: {}, abortSignal: new AbortController().signal };
  assert.equal((await transport.request(`${BASE}/v1/rigging/${ID}`, 'DELETE', options, undefined, true)).value, undefined);
  await assert.rejects(transport.request(`${BASE}/v1/rigging`, 'POST', options, {}));
  assert.equal(script.calls.length, 2);
});
test('credentials and proxy base paths stay bound across submit/get/delete with no redirect following', async () => {
  const headers = { 'x-tenant': 'original' }; const script = wire(accepted(), done(rigOutput), new Response(null, { status: 200 }));
  const meshy = createMeshyProvider({ apiKey: 'private', headers, baseURL: 'https://proxy.example/service/openapi', fetch: script.fetch });
  headers['x-tenant'] = 'mutated'; const model = meshy.rig();
  const { task } = await startTask({ model, input: { model_url: MODEL }, headers: { Authorization: 'Bearer attacker', 'X-Meshy-Metadata': 'project=robot' } });
  await getTaskStatus({ model, task }); await deleteTask({ model, task });
  for (const call of script.calls) {
    assert.ok(call.url.startsWith('https://proxy.example/service/openapi/'));
    assert.equal(call.headers.get('authorization'), 'Bearer private'); assert.equal(call.headers.get('x-tenant'), 'original'); assert.equal(call.redirect, 'error');
  }
  assert.equal(script.calls[0].headers.get('x-meshy-metadata'), 'project=robot');
  const redirected = accepted(); Object.defineProperty(redirected, 'redirected', { value: true });
  const bad = wire(redirected);
  await assert.rejects(startTask({ model: provider(bad.fetch).rig(), input: { model_url: MODEL } }), /redirect/);
  assert.equal(bad.calls.length, 1);
});
test('resource queries preserve native arrays, zero balance, pagination and CSV encoding', async () => {
  const task = { id: ID, status: 'PENDING' };
  const preset = { action_id: 0, name: 'Walking', key: 'walk', category: 'Locomotion' };
  const usage = { task_id: ID, endpoint: 'text-to-3d', status: 'SUCCEEDED', consumed_credits: 0.25, metadata: { project: 'robot' } };
  const script = wire(json(task), json([task]), new Response(null, { status: 200 }), json([preset]), json({ balance: 0, monthly_credits: 0.5, permanent_credits: 3, monthly_resets_at: null }), json([usage]));
  const meshy = provider(script.fetch);
  assert.deepEqual(await meshy.tasks.get('text-to-3d', ID), task);
  assert.deepEqual(await meshy.tasks.list('text-to-3d', { page_num: 2, page_size: 10, sort_by: '+created_at' }), [task]);
  assert.equal((await meshy.tasks.delete('text-to-3d', ID)).status, 'deleted');
  assert.deepEqual(await meshy.animations.list({ action_ids: [0, 8], search: 'walk & run' }), [preset]);
  assert.equal((await meshy.account.balance()).balance, 0);
  assert.deepEqual(await meshy.account.usage({ endpoints: ['text-to-3d', 'rigging'], start_time: '2026-10-01T00:00:00Z', page_num: 1 }), [usage]);
  assert.equal(new URL(script.calls[1].url).searchParams.get('sort_by'), '+created_at');
  assert.equal(new URL(script.calls[3].url).searchParams.get('action_ids'), '0,8');
  assert.equal(new URL(script.calls[5].url).searchParams.get('endpoints'), 'text-to-3d,rigging');
  assert.ok(script.calls.every(c => c.method !== 'POST'));
});
test('malformed resource responses and out-of-range pages are rejected', async () => {
  const script = wire(json({ data: [] }), json({ balance: 'ten' }), json([{ action_id: 1, name: 'Walk' }])); const meshy = provider(script.fetch);
  await assert.rejects(meshy.tasks.list('rigging'), e => APICallError.isInstance(e));
  await assert.rejects(meshy.account.balance()); await assert.rejects(meshy.animations.list());
  await assert.rejects(meshy.tasks.list('rigging', { page_num: 0 }));
  await assert.rejects(meshy.tasks.list('unknown-family'));
  assert.equal(script.calls.length, 3);
});
test('webhook parsing explicitly remains unauthenticated and never accepts it as task completion', async () => {
  const event = { id: ID, status: 'SUCCEEDED', ...rigOutput };
  const parsed = parseMeshyWebhook(JSON.stringify(event));
  assert.equal(parsed.authenticated, false); assert.equal(parsed.eventKey, `${ID}:SUCCEEDED`);
  assert.deepEqual(parseMeshyWebhook(new TextEncoder().encode(JSON.stringify(event))).task, event);
  const script = wire(accepted(), json({ id: ID, status: 'IN_PROGRESS' }), done(rigOutput));
  const model = provider(script.fetch).rig(); const { task } = await startTask({ model, input: { model_url: MODEL } });
  await waitForTask({ model, task, notification: Promise.resolve(parsed), poll });
  assert.deepEqual(script.calls.map(c => c.method), ['POST', 'GET', 'GET']);
  assert.throws(() => parseMeshyWebhook('{')); assert.throws(() => parseMeshyWebhook({ id: '../foreign', status: 'SUCCEEDED' }));
});
