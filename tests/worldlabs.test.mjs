import assert from 'node:assert/strict';
import test from 'node:test';
import { APICallError } from '@ai-sdk/provider';
import { AssetExecutionError, cancelAsset, generateAsset, getAssetStatus, startAsset, waitForAsset } from '@sinestack/ai-core';
import { createWorldLabsProvider } from '@sinestack/ai-worldlabs';

const BASE = 'https://api.worldlabs.ai/marble/v1';
const OP = 'operation-one';
const WORLD = 'world-one';
const VERSION = 'future-marble-model';
const CDN = 'https://assets.example.test';
const INPUT = { world_prompt: { type: 'text', text_prompt: 'A sunlit greenhouse' } };
const poll = { intervalMs: 0, delay: async () => {} };
const semantics = { metric_scale_factor: 1.5, ground_plane_offset: -0.25 };
const world = (extra = {}) => ({
  world_id: WORLD, display_name: 'Greenhouse', world_marble_url: 'https://marble.worldlabs.ai/worlds/world-one',
  assets: {
    splats: { spz_urls: { '100k': `${CDN}/100k.spz`, full_res: `${CDN}/full.spz`, '500k': `${CDN}/500k.spz` }, semantics_metadata: semantics },
    mesh: { collider_mesh_url: `${CDN}/collider.glb`, full_res_mesh_url: `${CDN}/full.glb`, hq_mesh_url: `${CDN}/hq.glb` },
    imagery: { pano_url: `${CDN}/pano.png` }, thumbnail_url: `${CDN}/thumb.webp`, caption: `${CDN}/not-an-asset.txt`,
  }, ...extra,
});
const pending = (extra = {}) => ({ operation_id: OP, done: false, ...extra });
const completed = (response = world(), extra = {}) => ({ operation_id: OP, done: true, response, cost: { total_credits: 42, line_items: [{ name: 'generation', credits: 42 }] }, ...extra });
function wire(...steps) {
  const calls = [];
  return { calls, fetch: async (url, init = {}) => {
    const call = { url: String(url), ...init, headers: new Headers(init.headers) };
    calls.push(call);
    assert.ok(steps.length, `Unexpected ${call.method} ${call.url}`);
    const next = steps.shift();
    return typeof next === 'function' ? next(call) : next;
  } };
}
const provider = fetch => createWorldLabsProvider({ apiKey: 'test-key', fetch });
const startOptions = (input = INPUT, extra = {}) => ({ input, providerOptions: {}, headers: {}, abortSignal: new AbortController().signal, ...extra });
const statusOptions = operation => ({ operation, headers: {}, abortSignal: new AbortController().signal });

test('World Labs generates ordered mixed assets, retains native semantics and costs, and never downloads files', async () => {
  const output = world(); const operation = completed(output);
  const script = wire(Response.json(pending()), Response.json(operation, { headers: { 'x-request-id': 'native-request' } }));
  const input = { ...INPUT, display_name: 'Greenhouse', seed: 0, tags: ['nature'], permission: { public: false }, future_option: { enabled: false, values: [0, null] } };
  const model = createWorldLabsProvider({ apiKey: 'test-key', fetch: script.fetch, name: 'worldlabs-custom', headers: { 'x-tenant': 'one', 'WLT-Api-Key': 'wrong-default' } }).world(VERSION);
  const result = await generateAsset({ model, input, poll, headers: { 'WLT-Api-Key': 'wrong-call', 'x-trace': 'trace' } });
  assert.equal(model.provider, 'worldlabs-custom');
  assert.equal(model.kind, 'gaussian-splat');
  assert.deepEqual(script.calls.map(call => [call.method, call.url]), [['POST', `${BASE}/worlds:generate`], ['GET', `${BASE}/operations/${OP}`]]);
  assert.deepEqual(JSON.parse(script.calls[0].body), { ...input, model: VERSION });
  for (const call of script.calls) {
    assert.equal(call.headers.get('wlt-api-key'), 'test-key');
    assert.equal(call.headers.has('authorization'), false);
    assert.equal(call.headers.get('x-tenant'), 'one');
    assert.equal(call.headers.get('x-trace'), 'trace');
    assert.equal(call.redirect, 'manual');
  }
  assert.equal(result.asset.url, `${CDN}/full.spz`);
  assert.equal(result.assets.length, 8);
  assert.ok(result.assets.slice(0, 3).every(asset => asset.url.endsWith('.spz')));
  assert.deepEqual(new Set(result.assets.map(asset => asset.url)), new Set([
    `${CDN}/full.spz`, `${CDN}/500k.spz`, `${CDN}/100k.spz`, `${CDN}/collider.glb`, `${CDN}/full.glb`, `${CDN}/hq.glb`, `${CDN}/pano.png`, `${CDN}/thumb.webp`,
  ]));
  assert.deepEqual(result.providerMetadata.worldlabs.output, output);
  assert.deepEqual(result.providerMetadata.worldlabs.operation, operation);
  assert.equal(result.providerMetadata.worldlabs.operationId, OP);
  assert.equal(result.providerMetadata.worldlabs.worldId, WORLD);
  assert.equal(result.usage.credits, 42);
  assert.equal(result.response.headers['x-request-id'], 'native-request');
  for (const splat of result.assets.slice(0, 3)) assert.deepEqual(splat.metadata.semantics_metadata, semantics);
});

test('multi-image reconstruction raises the accepted input limit from four to eight views', async () => {
  const script = wire(Response.json(pending()), Response.json(pending()));
  const model = provider(script.fetch).world(VERSION);
  const views = count => Array.from({ length: count }, (_, index) => ({ content: { source: 'uri', uri: `${CDN}/view-${index}.png` } }));
  await startAsset({ model, input: { world_prompt: { type: 'multi-image', multi_image_prompt: views(4) } } });
  await assert.rejects(startAsset({ model, input: { world_prompt: { type: 'multi-image', multi_image_prompt: views(5) } } }));
  await startAsset({ model, input: { world_prompt: { type: 'multi-image', multi_image_prompt: views(8), reconstruct_images: true } } });
  await assert.rejects(startAsset({ model, input: { world_prompt: { type: 'multi-image', multi_image_prompt: views(9), reconstruct_images: true } } }));
  assert.equal(script.calls.length, 2, 'Invalid view counts cannot create paid operations');
});

test('depth-to-panorama sends native references and normalizes the completed panorama', async () => {
  const output = { pano_url: `${CDN}/depth-result.png`, future_result: { preserved: true } };
  const script = wire(Response.json(pending()), Response.json(completed(output)));
  const input = { depth_pano_image: { source: 'uri', uri: `${CDN}/depth.png` }, text_prompt: 'Warm timber interior', z_min: 0.1, z_max: 100, seed: 0 };
  const result = await generateAsset({ model: provider(script.fetch).depthToPanorama(), input, poll });
  assert.equal(script.calls[0].url, `${BASE}/pano:depth_to_rgb`);
  assert.deepEqual(JSON.parse(script.calls[0].body), input);
  assert.equal(result.asset.url, output.pano_url);
  assert.match(result.asset.mediaType, /^image\//);
  assert.deepEqual(result.providerMetadata.worldlabs.output, output);
});

for (const [factory, input, output] of [
  ['exportSplat', { world_id: WORLD, resolution: '150k' }, { asset_type: 'splats', format: 'ply', resolution: '150k', url: `${CDN}/export.ply` }],
  ['exportMesh', { world_id: WORLD, mesh_variant: 'vertex_colored' }, { asset_type: 'mesh', format: 'glb', mesh_variant: 'vertex_colored', url: `${CDN}/export.glb` }],
]) {
  test(`${factory} completes from the submitted operation without another HTTP request`, async () => {
    const script = wire(Response.json(completed(output)));
    const model = provider(script.fetch)[factory]();
    const { operation } = await startAsset({ model, input });
    const restored = provider(script.fetch)[factory]();
    const result = await waitForAsset({ model: restored, operation: JSON.parse(JSON.stringify(operation)), poll });
    const { world_id, ...parameters } = input;
    assert.deepEqual(JSON.parse(script.calls[0].body), { ...parameters, asset_type: output.asset_type, format: output.format });
    assert.equal(script.calls[0].url, `${BASE}/worlds/${world_id}:export`);
    assert.equal(script.calls.length, 1);
    assert.equal(result.asset.url, output.url);
    assert.equal(result.usage.credits, 42);
    assert.deepEqual(result.providerMetadata.worldlabs.output, output);
  });
}

test('running operations expose descriptive progress without inventing a number', async () => {
  const script = wire(Response.json(pending()), Response.json(pending({ metadata: { progress: { description: 'Building splats' } } })));
  const model = provider(script.fetch).world(VERSION);
  const { operation } = await startAsset({ model, input: INPUT });
  const status = await getAssetStatus({ model, operation });
  assert.equal(status.status, 'running');
  assert.equal(status.message, 'Building splats');
  assert.equal(status.progress, undefined);
});

test('operation failures retain native diagnostics in status, thrown errors and hooks', async () => {
  const failed = { operation_id: OP, done: true, error: { code: 422, message: 'Image could not be reconstructed' }, metadata: { trace: 'native-trace' } };
  const script = wire(Response.json(pending()), Response.json(failed), Response.json(failed));
  const model = provider(script.fetch).world(VERSION);
  const { operation } = await startAsset({ model, input: INPUT });
  const status = await getAssetStatus({ model, operation });
  assert.equal(status.status, 'failed');
  assert.equal(status.error.message, failed.error.message);
  assert.equal(String(status.error.code), '422');
  assert.deepEqual(status.providerMetadata.worldlabs.operation, failed);
  assert.deepEqual(status.response.body, failed);
  let observed;
  let thrown;
  await assert.rejects(waitForAsset({ model, operation, poll, retry: { status: 3 }, hooks: { onError(event) { observed = event.error; } } }), error => {
    thrown = error;
    assert.ok(error instanceof AssetExecutionError);
    assert.equal(error.code, 'ASSET_JOB_FAILED');
    assert.deepEqual(error.providerMetadata.worldlabs.operation, failed);
    assert.deepEqual(error.response.body, failed);
    return true;
  });
  assert.equal(observed, thrown);
  assert.equal(script.calls.length, 3);
});

test('JSON receipts resume with a fresh provider and bind connection, origin, factory and model before HTTP', async () => {
  const submit = wire(Response.json(pending()));
  const settings = { apiKey: 'restore-test-key', connectionId: 'account-one', baseURL: 'https://proxy.example.test/marble/v1' };
  const { operation } = await startAsset({ model: createWorldLabsProvider({ ...settings, fetch: submit.fetch }).world(VERSION), input: INPUT });
  const saved = JSON.parse(JSON.stringify(operation));
  assert.equal(JSON.stringify(saved).includes(settings.apiKey), false);
  const resume = wire(Response.json(completed()));
  const fresh = createWorldLabsProvider({ ...settings, fetch: resume.fetch });
  const result = await waitForAsset({ model: fresh.world(saved.modelId), operation: saved, poll });
  assert.equal(result.asset.url, `${CDN}/full.spz`);
  assert.deepEqual(resume.calls.map(call => [call.method, call.url]), [['GET', `${settings.baseURL}/operations/${OP}`]]);
  const blocked = wire();
  for (const model of [
    createWorldLabsProvider({ ...settings, fetch: blocked.fetch, connectionId: 'account-two' }).world(VERSION),
    createWorldLabsProvider({ ...settings, fetch: blocked.fetch, baseURL: BASE }).world(VERSION),
    createWorldLabsProvider({ ...settings, fetch: blocked.fetch }).world('different-model'),
    createWorldLabsProvider({ ...settings, fetch: blocked.fetch }).exportSplat(),
    createWorldLabsProvider({ ...settings, fetch: blocked.fetch }).depthToPanorama(),
  ]) await assert.rejects(getAssetStatus({ model, operation: saved }));
  const matching = createWorldLabsProvider({ ...settings, fetch: blocked.fetch }).world(VERSION);
  for (const operationId of ['', '../other', '%2e%2e', 'one?other=two']) {
    await assert.rejects(matching.doStatus(statusOptions({ ...saved.operation, operationId })));
  }
  assert.equal(blocked.calls.length, 0);
});

test('provider options supplement input without overriding native input or factory parameters', async () => {
  const script = wire(Response.json(pending())); const worldlabs = provider(script.fetch);
  await startAsset({ model: worldlabs.world(VERSION), input: INPUT, providerOptions: { worldlabs: { future_option: { value: 0 } } } });
  assert.deepEqual(JSON.parse(script.calls[0].body), { ...INPUT, model: VERSION, future_option: { value: 0 } });
  for (const options of [{ world_prompt: { type: 'text', text_prompt: 'other' } }, { model: 'other' }]) {
    await assert.rejects(startAsset({ model: worldlabs.world(VERSION), input: INPUT, providerOptions: { worldlabs: options } }));
  }
  await assert.rejects(startAsset({ model: worldlabs.world(VERSION), input: { ...INPUT, model: 'other' } }));
  for (const factory of ['exportSplat', 'exportMesh']) {
    for (const extra of [{ world_id: 'other' }, { asset_type: 'other' }, { format: 'other' }]) {
      await assert.rejects(startAsset({ model: worldlabs[factory](), input: { world_id: WORLD }, providerOptions: { worldlabs: extra } }));
    }
  }
  assert.equal(script.calls.length, 1);
});

test('mapping callbacks preserve receiver binding, native snapshots and additional metadata', async () => {
  const output = world(); const nativeOperation = completed(output);
  const script = wire(Response.json(pending()), Response.json(nativeOperation));
  let received;
  class Mapping {
    #prefix = 'Mapped: ';
    mapInput(input) { return { world_prompt: { type: 'text', text_prompt: this.#prefix + input.description } }; }
    mapResult(native) {
      received = structuredClone(native);
      native.assets.splats.semantics_metadata.metric_scale_factor = 999;
      return { assets: [{ type: 'url', url: `${CDN}/mapped.spz`, mediaType: 'application/octet-stream' }], providerMetadata: { custom: { label: this.#prefix } }, usage: { images: 1 } };
    }
  }
  const mapping = new Mapping(); const model = provider(script.fetch).world(VERSION, mapping);
  mapping.mapInput = () => assert.fail('Factory must capture the mapping callback');
  const result = await generateAsset({ model, input: { description: 'greenhouse' }, poll });
  assert.equal(JSON.parse(script.calls[0].body).world_prompt.text_prompt, 'Mapped: greenhouse');
  assert.deepEqual(received, output);
  assert.equal(result.asset.url, `${CDN}/mapped.spz`);
  assert.deepEqual(result.providerMetadata.custom, { label: 'Mapped: ' });
  assert.deepEqual(result.providerMetadata.worldlabs.output, output);
  assert.deepEqual(result.providerMetadata.worldlabs.operation, nativeOperation);
  assert.equal(result.usage.images, 1);
  assert.equal(result.usage.credits, 42);
});

test('world ID aliases are accepted but conflicting identifiers and operation IDs are rejected', async () => {
  const { world_id, ...rest } = world();
  for (const output of [{ ...rest, id: world_id }, { ...rest, world_id, id: world_id }]) {
    const script = wire(Response.json(pending()), Response.json(completed(output)));
    const result = await generateAsset({ model: provider(script.fetch).world(VERSION), input: INPUT, poll });
    assert.equal(result.providerMetadata.worldlabs.worldId, WORLD);
  }
  for (const operation of [completed({ ...rest, world_id, id: 'foreign-world' }), completed(world(), { operation_id: 'foreign-operation' })]) {
    const script = wire(Response.json(pending()), Response.json(operation));
    await assert.rejects(generateAsset({ model: provider(script.fetch).world(VERSION), input: INPUT, poll, retry: { status: 0 } }));
    assert.equal(script.calls.length, 2);
  }
});

test('empty results and thumbnails or viewer links alone cannot masquerade as generated splats', async () => {
  for (const output of [null, {}, world({ assets: {} }), world({ assets: { imagery: { pano_url: `${CDN}/pano.png` }, thumbnail_url: `${CDN}/thumb.png`, caption: `${CDN}/caption.spz` } })]) {
    const script = wire(Response.json(pending()), Response.json(completed(output)));
    await assert.rejects(generateAsset({ model: provider(script.fetch).world(VERSION), input: INPUT, poll, retry: { status: 0 } }));
    assert.equal(script.calls.length, 2);
  }
  const script = wire(Response.json(pending()), Response.json(completed(world())));
  await assert.rejects(generateAsset({ model: provider(script.fetch).world(VERSION, { mapResult: () => ({ assets: [] }) }), input: INPUT, poll, retry: { status: 0 } }));
});

test('native resources preserve direct and wrapped worlds, pagination, operation data and fractional credits', async () => {
  const direct = world(); const wrapped = { world: direct }; const list = { worlds: [direct], next_page_token: 'next-page' };
  const deleted = { world_id: WORLD, deleted: true }; const nativeOperation = pending({ metadata: { future: true } });
  const media = { media_asset_id: 'media-one', kind: 'image', file_name: 'input.png', future_field: [1] };
  const prepared = { media_asset: media, upload_info: { upload_url: 'https://storage.example.test/upload?signature=test', upload_method: 'PUT', required_headers: { 'Content-Type': 'image/png' } } };
  const script = wire(...[direct, wrapped, list, deleted, nativeOperation, { remaining_credits: 125.5 }, prepared, media].map(data => Response.json(data)));
  const worldlabs = provider(script.fetch); const signal = new AbortController().signal;
  assert.deepEqual(await worldlabs.worlds.get(WORLD, { abortSignal: signal, headers: { 'x-resource': 'one' } }), direct);
  assert.deepEqual(await worldlabs.worlds.get(WORLD), direct);
  const filter = { page_size: 2, page_token: 'previous-page', tags: ['garden'], is_public: false, model: VERSION };
  assert.deepEqual(await worldlabs.worlds.list(filter), list);
  assert.deepEqual(await worldlabs.worlds.delete(WORLD), deleted);
  assert.deepEqual(await worldlabs.operations.get(OP), nativeOperation);
  assert.deepEqual(await worldlabs.credits.get(), { remaining_credits: 125.5 });
  const prepareInput = { file_name: 'input.png', kind: 'image', extension: 'png', metadata: { user_tag: 'garden' } };
  assert.deepEqual(await worldlabs.mediaAssets.prepareUpload(prepareInput), prepared);
  assert.deepEqual(await worldlabs.mediaAssets.get('media-one'), media);
  assert.deepEqual(script.calls.map(call => [call.method, call.url]), [
    ['GET', `${BASE}/worlds/${WORLD}`], ['GET', `${BASE}/worlds/${WORLD}`], ['POST', `${BASE}/worlds:list`], ['DELETE', `${BASE}/worlds/${WORLD}`],
    ['GET', `${BASE}/operations/${OP}`], ['GET', `${BASE}/credits`], ['POST', `${BASE}/media-assets:prepare_upload`], ['GET', `${BASE}/media-assets/media-one`],
  ]);
  assert.deepEqual(JSON.parse(script.calls[2].body), filter);
  assert.deepEqual(JSON.parse(script.calls[6].body), prepareInput);
  assert.equal(script.calls[0].signal, signal);
  assert.equal(script.calls[0].headers.get('x-resource'), 'one');
});

test('signed upload sends Blob or bytes once using only storage headers and omits API credentials', async () => {
  const prepared = { media_asset: { media_asset_id: 'media-one', file_name: 'input.png', kind: 'image' }, upload_info: { upload_url: 'https://storage.example.test/upload?signature=test', upload_method: 'PUT', required_headers: { 'Content-Type': 'image/png', 'x-upload-token': 'storage-only' } } };
  const script = wire(new Response(null, { status: 200 }), new Response(null, { status: 204 }));
  const worldlabs = createWorldLabsProvider({ apiKey: 'private-api-fixture', headers: { 'x-private-tenant': 'private', Authorization: 'private-bearer' }, fetch: script.fetch });
  const signal = new AbortController().signal;
  for (const body of [new Blob(['image'], { type: 'image/png' }), new Uint8Array([1, 2, 3])]) {
    assert.equal(await worldlabs.mediaAssets.upload(prepared, body, { abortSignal: signal }), undefined);
    const call = script.calls.at(-1);
    assert.equal(call.url, prepared.upload_info.upload_url);
    assert.equal(call.method, 'PUT');
    assert.deepEqual(Object.fromEntries(call.headers), { 'content-type': 'image/png', 'x-upload-token': 'storage-only' });
    assert.equal(call.credentials, 'omit');
    assert.equal(call.redirect, 'manual');
    assert.equal(call.signal, signal);
  }
  assert.equal(script.calls.length, 2);
});

test('signed upload rejects redirect responses without following or leaking API credentials', async () => {
  const prepared = { media_asset: { media_asset_id: 'media-one', file_name: 'input.png', kind: 'image' }, upload_info: { upload_url: 'https://storage.example.test/upload', upload_method: 'PUT' } };
  const script = wire(new Response(null, { status: 307, headers: { location: 'https://attacker.example.test/steal' } }));
  await assert.rejects(provider(script.fetch).mediaAssets.upload(prepared, new Uint8Array([1])));
  assert.equal(script.calls.length, 1);
  assert.equal(script.calls[0].headers.has('wlt-api-key'), false);
  assert.equal(script.calls[0].credentials, 'omit');
  assert.equal(script.calls[0].redirect, 'manual');
});

test('invalid model, prompt and reference inputs fail before any HTTP request', async () => {
  const script = wire(); const worldlabs = provider(script.fetch);
  for (const modelId of [undefined, null, '', 123]) assert.throws(() => worldlabs.world(modelId));
  const inputs = [{}, { world_prompt: { type: 'text' } }, { world_prompt: { type: 'unsupported', text_prompt: 'x' } },
    { world_prompt: { type: 'image', image_prompt: { source: 'uri' } } },
    { world_prompt: { type: 'image', image_prompt: { source: 'media_asset' } } },
    { world_prompt: { type: 'image', image_prompt: { source: 'data_base64' } } },
    { world_prompt: { type: 'image', image_prompt: { source: 'uri', uri: `${CDN}/a.png` }, is_pano: 'sometimes' } },
    { world_prompt: { type: 'multi-image', multi_image_prompt: [] } },
    { world_prompt: { type: 'video' } },
    { ...INPUT, seed: Infinity },
  ];
  for (const input of inputs) await assert.rejects(startAsset({ model: worldlabs.world(VERSION), input }));
  for (const input of [{}, { depth_pano_image: { source: 'uri', uri: `${CDN}/depth.exr` } }]) await assert.rejects(startAsset({ model: worldlabs.depthToPanorama(), input }));
  await assert.rejects(startAsset({ model: worldlabs.exportSplat(), input: { world_id: WORLD, resolution: 'tiny' } }));
  await assert.rejects(startAsset({ model: worldlabs.exportMesh(), input: { world_id: WORLD, mesh_variant: 'wireframe' } }));
  let reads = 0;
  await assert.rejects(startAsset({ model: worldlabs.world(VERSION), input: { get world_prompt() { reads++; return INPUT.world_prompt; } } }));
  assert.equal(reads, 0);
  assert.equal(script.calls.length, 0);
});

test('unsafe resource IDs never reach HTTP', async () => {
  const script = wire(); const worldlabs = provider(script.fetch);
  for (const id of ['', '../other', 'one/two', 'one?key=value', 'one#fragment', '%2e%2e']) {
    for (const invoke of [() => worldlabs.worlds.get(id), () => worldlabs.worlds.delete(id), () => worldlabs.operations.get(id), () => worldlabs.mediaAssets.get(id), () => startAsset({ model: worldlabs.exportSplat(), input: { world_id: id } })]) await assert.rejects(async () => invoke());
  }
  assert.equal(script.calls.length, 0);
});

test('environment credentials are loaded when needed and missing credentials fail before HTTP', async () => {
  const previous = process.env.WORLDLABS_API_KEY;
  const script = wire(Response.json({ remaining_credits: 10 }));
  try {
    process.env.WORLDLABS_API_KEY = 'environment-fixture';
    await createWorldLabsProvider({ fetch: script.fetch }).credits.get();
    assert.equal(script.calls[0].headers.get('wlt-api-key'), 'environment-fixture');
    delete process.env.WORLDLABS_API_KEY;
    await assert.rejects(createWorldLabsProvider({ fetch: script.fetch }).credits.get());
    assert.equal(script.calls.length, 1);
  } finally {
    if (previous === undefined) delete process.env.WORLDLABS_API_KEY;
    else process.env.WORLDLABS_API_KEY = previous;
  }
});

test('unsupported webhooks and cancellation do not issue provider requests', async () => {
  const script = wire(Response.json(pending())); const model = provider(script.fetch).world(VERSION);
  await assert.rejects(startAsset({ model, input: INPUT, webhookUrl: 'https://app.example.test/hook' }), error => error.code === 'ASSET_UNSUPPORTED');
  const { operation } = await startAsset({ model, input: INPUT });
  await assert.rejects(cancelAsset({ model, operation }), error => error.code === 'ASSET_UNSUPPORTED');
  assert.equal(script.calls.length, 1);
});

test('HTTP failures retain status and response bodies without retrying submissions', async () => {
  for (const status of [401, 429, 503]) {
    const script = wire(Response.json({ detail: 'native error detail' }, { status, headers: { 'x-request-id': 'http-failure' } }));
    await assert.rejects(provider(script.fetch).world(VERSION).doStart(startOptions()), error => {
      assert.ok(APICallError.isInstance(error));
      assert.equal(error.statusCode, status);
      assert.equal(error.responseHeaders['x-request-id'], 'http-failure');
      assert.match(error.responseBody, /native error detail/);
      return true;
    });
    assert.equal(script.calls.length, 1);
  }
  const script = wire(new Response('{', { headers: { 'content-type': 'application/json' } }));
  await assert.rejects(provider(script.fetch).world(VERSION).doStart(startOptions()));
  assert.equal(script.calls.length, 1);
});

test('completed receipts reject operation ID mismatch before any HTTP request', async () => {
  const output = { asset_type: 'splats', format: 'ply', url: `${CDN}/export.ply` };
  const submit = wire(Response.json(completed(output)));
  const model = provider(submit.fetch).exportSplat();
  const started = await model.doStart(startOptions({ world_id: WORLD }));
  const blocked = wire();
  await assert.rejects(provider(blocked.fetch).exportSplat().doStatus(statusOptions({ ...started.operation, operationId: 'different-operation' })));
  assert.equal(blocked.calls.length, 0);
});

test('signed upload rejects credential-bearing plans, insecure URLs and non-PUT methods before HTTP', async () => {
  const script = wire(); const worldlabs = provider(script.fetch);
  const media_asset = { media_asset_id: 'media-one', file_name: 'input.png', kind: 'image' };
  const info = { upload_url: 'https://storage.example.test/upload', upload_method: 'PUT' };
  const plans = [
    { ...info, upload_url: 'http://storage.example.test/upload' },
    { ...info, upload_url: 'https://user@storage.example.test/upload' },
    { ...info, upload_method: 'POST' },
    ...['Authorization', 'WLT-Api-Key', 'Cookie', 'Proxy-Authorization'].map(header => ({ ...info, required_headers: { [header]: 'sensitive-fixture' } })),
  ];
  for (const upload_info of plans) await assert.rejects(worldlabs.mediaAssets.upload({ media_asset, upload_info }, new Uint8Array([1])));
  assert.equal(script.calls.length, 0);
});

test('depth PNG inputs require ordered bounds and mixed reference branches cannot be submitted', async () => {
  const script = wire(); const worldlabs = provider(script.fetch);
  const depth_pano_image = { source: 'uri', uri: `${CDN}/depth.png` };
  for (const bounds of [{}, { z_min: 1 }, { z_max: 10 }, { z_min: 10, z_max: 1 }, { z_min: 0, z_max: 1 }]) {
    await assert.rejects(startAsset({ model: worldlabs.depthToPanorama(), input: { depth_pano_image, text_prompt: 'Garden', ...bounds } }));
  }
  await assert.rejects(startAsset({ model: worldlabs.world(VERSION), input: { world_prompt: { type: 'image', image_prompt: { source: 'uri', uri: `${CDN}/image.png`, media_asset_id: 'media-one' } } } }));
  assert.equal(script.calls.length, 0);
});

test('API redirects fail after one request without contacting the redirect destination', async () => {
  const script = wire(new Response(null, { status: 307, headers: { location: 'https://attacker.example.test/steal' } }));
  await assert.rejects(provider(script.fetch).credits.get());
  assert.equal(script.calls.length, 1);
  assert.equal(script.calls[0].url, `${BASE}/credits`);
  assert.equal(script.calls[0].redirect, 'manual');
});
