import assert from 'node:assert/strict';
import test from 'node:test';
import { APICallError } from '@ai-sdk/provider';
import { startAsset, getAssetStatus } from '@sinestack/ai-core';
import { createFalAssetProvider, FalAssetModel } from '@sinestack/ai-fal';

const MUSIC_MODEL = 'future-org/music-engine/v99';
const ANIMATION_3D_MODEL = 'future-org/motion-engine/v99';

const BASE = 'https://queue.fal.run';
const REQUEST_ID = 'media-request-1';

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function receipt(modelId) {
  const response_url = `${BASE}/${modelId.split('/').slice(0, 2).join('/')}/requests/${REQUEST_ID}`;
  return { request_id: REQUEST_ID, response_url, status_url: `${response_url}/status`, cancel_url: `${response_url}/cancel` };
}

function operation(modelId) {
  const body = receipt(modelId);
  return {
    type: 'fal-queue', version: 1, modelId, requestId: REQUEST_ID,
    statusUrl: body.status_url, responseUrl: body.response_url, cancelUrl: body.cancel_url,
  };
}

function options(input, providerOptions = {}) {
  return { input, providerOptions, headers: {}, abortSignal: new AbortController().signal, idempotencyKey: 'one-submission' };
}

function operationOptions(modelId) {
  return { operation: operation(modelId), headers: {}, abortSignal: new AbortController().signal };
}

function scripted(...steps) {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url: String(url), ...init });
    assert.ok(steps.length, `Unexpected request ${init.method} ${url}`);
    const response = steps.shift();
    return typeof response === 'function' ? response(calls.at(-1)) : response;
  };
  return { calls, fetch };
}

test('fal music passes native inputs and model options and resumes through the existing core', async () => {
  const native = {
    audio: { url: 'https://files.example/song.wav', content_type: 'audio/wav', file_name: 'song.wav', file_size: 1024 },
    extra_model_metadata: { duration: 123, sample_rate: 44100 },
  };
  const wire = scripted(json(receipt(MUSIC_MODEL)), json({ status: 'COMPLETED' }), json(native));
  const settings = { apiKey: 'test:key', fetch: wire.fetch };
  const model = createFalAssetProvider(settings).music(MUSIC_MODEL);
  assert.equal(model.kind, 'music');
  assert.equal(model.modelId, MUSIC_MODEL);
  const started = await startAsset({
    model,
    input: { prompt: 'Warm orchestral music with a cinematic rise', lyrics: '[Verse]\nThe sun is rising', is_instrumental: false },
    providerOptions: { fal: { lyrics_optimizer: false, audio_setting: { format: 'wav', sample_rate: 44100, bitrate: 256000 } } },
  });
  assert.deepEqual(JSON.parse(wire.calls[0].body), {
    prompt: 'Warm orchestral music with a cinematic rise', lyrics: '[Verse]\nThe sun is rising', is_instrumental: false,
    lyrics_optimizer: false, audio_setting: { format: 'wav', sample_rate: 44100, bitrate: 256000 },
  });
  assert.equal(wire.calls[0].url, `${BASE}/${MUSIC_MODEL}`);
  const restored = JSON.parse(JSON.stringify(started.operation));
  const status = await getAssetStatus({ model: createFalAssetProvider(settings).music(MUSIC_MODEL), operation: restored });
  assert.equal(status.status, 'completed');
  assert.deepEqual(status.result.assets, [{
    type: 'url', url: native.audio.url, mediaType: 'audio/wav', filename: 'song.wav', metadata: { fileSize: 1024 },
  }]);
  assert.deepEqual(status.result.providerMetadata.fal.output, native);
  assert.equal(status.result.providerMetadata.fal.requestId, REQUEST_ID);
  assert.equal(wire.calls.filter(call => call.method === 'POST').length, 1);
  assert.equal(wire.calls.length, 3);
  assert.ok(wire.calls.every(call => new URL(call.url).origin === BASE));
});

test('fal music accepts instrumental and generated-lyrics requests without inventing audio MIME types', async () => {
  const wire = scripted(
    json(receipt(MUSIC_MODEL)), json(receipt(MUSIC_MODEL)),
    json({ status: 'COMPLETED' }), json({ audio: { url: 'https://files.example/raw-output' } }),
  );
  const model = createFalAssetProvider({ apiKey: 'test:key', fetch: wire.fetch }).music(MUSIC_MODEL);
  await model.doStart(options({ prompt: 'A gentle acoustic instrumental', is_instrumental: true }));
  await model.doStart(options({ prompt: 'A city pop song about coming home', lyrics: '', is_instrumental: false }, { fal: { lyrics_optimizer: true } }));
  assert.deepEqual(JSON.parse(wire.calls[0].body), { prompt: 'A gentle acoustic instrumental', is_instrumental: true });
  assert.deepEqual(JSON.parse(wire.calls[1].body), {
    prompt: 'A city pop song about coming home', lyrics: '', is_instrumental: false, lyrics_optimizer: true,
  });
  const status = await model.doStatus(operationOptions(MUSIC_MODEL));
  assert.equal(status.result.assets[0].mediaType, 'application/octet-stream');
});

test('fal animation passes native formats and retains both returned file types', async () => {
  const native = {
    fbx_file: { url: 'https://files.example/walk.fbx', file_name: 'walk.fbx' },
    motion_json: { url: 'https://files.example/walk.json', file_size: 256 },
    seed: 42,
  };
  const wire = scripted(json(receipt(ANIMATION_3D_MODEL)), json({ status: 'COMPLETED' }), json(native));
  const model = createFalAssetProvider({ apiKey: 'test:key', fetch: wire.fetch }).animation3D(ANIMATION_3D_MODEL);
  assert.equal(model.kind, 'animation-3d');
  assert.equal(model.modelId, ANIMATION_3D_MODEL);
  const started = await model.doStart(options({
    prompt: 'A person walks then jumps over a puddle', duration: 3, seed: 42, output_format: 'dict',
  }, { fal: { guidance_scale: 3 } }));
  assert.deepEqual(JSON.parse(wire.calls[0].body), {
    prompt: 'A person walks then jumps over a puddle', duration: 3, seed: 42, output_format: 'dict', guidance_scale: 3,
  });
  const result = await model.doStatus({ ...operationOptions(ANIMATION_3D_MODEL), operation: started.operation });
  assert.deepEqual(result.result.assets, [
    { type: 'url', url: native.fbx_file.url, mediaType: 'application/octet-stream', filename: 'walk.fbx' },
    { type: 'url', url: native.motion_json.url, mediaType: 'application/json', metadata: { fileSize: 256 } },
  ]);
  assert.deepEqual(result.result.providerMetadata.fal, { requestId: REQUEST_ID, output: native });
  assert.equal(wire.calls.length, 3);
});

test('fal animation accepts either FBX or JSON file output and rejects no-file or inline-only results', async () => {
  const outputs = [
    { fbx_file: { url: 'https://files.example/walk.fbx', content_type: 'application/x-fbx' }, motion_json: null, seed: 1 },
    { fbx_file: null, motion_json: { url: 'https://files.example/walk.json' }, seed: 1 },
    { fbx_file: null, motion_json: null, seed: 1 },
    { motion_json: { frames: [1, 2, 3] }, seed: 1 },
    { motion_json: { url: 'data:application/json,{}' }, seed: 1 },
  ];
  const wire = scripted(...outputs.flatMap(output => [json({ status: 'COMPLETED' }), json(output)]));
  const model = createFalAssetProvider({ apiKey: 'test:key', fetch: wire.fetch }).animation3D(ANIMATION_3D_MODEL);
  const first = await model.doStatus(operationOptions(ANIMATION_3D_MODEL));
  assert.equal(first.result.assets[0].mediaType, 'application/x-fbx');
  const second = await model.doStatus(operationOptions(ANIMATION_3D_MODEL));
  assert.equal(second.result.assets[0].mediaType, 'application/json');
  for (let i = 0; i < 3; i++) {
    await assert.rejects(model.doStatus(operationOptions(ANIMATION_3D_MODEL)), error => APICallError.isInstance(error) && !error.isRetryable);
  }
  assert.equal(wire.calls.length, 10);
});

test('every fal capability accepts an unseen model and arbitrary native JSON without a preset', async () => {
  const id = 'independent-owner/never-registered-model/v2040';
  const input = { description: 'x', duration: 900, arbitrary_new_option: { scale: 7 }, output_format: 'new-format' };
  const wire = scripted(...Array.from({ length: 5 }, () => json(receipt(id))));
  const fal = createFalAssetProvider({ apiKey: 'test:key', fetch: wire.fetch });
  const methods = [['threeD', 'model-3d'], ['soundEffect', 'sound-effect'], ['music', 'music'], ['animation3D', 'animation-3d']];
  for (const [method, kind] of methods) {
    const model = fal[method](id);
    assert.equal(model.kind, kind);
    assert.equal(model.modelId, id);
    await model.doStart(options(input, { fal: { prompt: 'provider-native extra field' } }));
    for (const missing of [undefined, null, '']) assert.throws(() => fal[method](missing), TypeError);
  }
  await fal.asset(id, { kind: 'future-asset-kind' }).doStart(options(input, { fal: { prompt: 'provider-native extra field' } }));
  assert.equal(wire.calls.length, 5);
  for (const call of wire.calls) {
    assert.equal(call.url, `${BASE}/${id}`);
    assert.deepEqual(JSON.parse(call.body), { ...input, prompt: 'provider-native extra field' });
  }
});

test('fal native capabilities reject input accessors without invoking caller code', async () => {
  let getterCalls = 0;
  const input = Object.defineProperty({ is_instrumental: true }, 'prompt', {
    enumerable: true, get() { getterCalls++; return 'An instrumental acoustic piece'; },
  });
  const wire = scripted();
  const fal = createFalAssetProvider({ apiKey: 'test:key', fetch: wire.fetch });
  await assert.rejects(fal.music(MUSIC_MODEL).doStart(options(input)), TypeError);
  await assert.rejects(fal.animation3D(ANIMATION_3D_MODEL).doStart(options(input)), TypeError);
  await assert.rejects(fal.threeD('future-org/mesh/v99').doStart(options(input)), TypeError);
  await assert.rejects(fal.soundEffect('future-org/sound/v99').doStart(options(input)), TypeError);
  assert.equal(getterCalls, 0);
  assert.equal(wire.calls.length, 0);
});

test('fal output metadata snapshots the native body before custom mappings can mutate or override it', async () => {
  const id = 'my-org/document';
  const native = { document: { url: 'https://files.example/report.pdf' }, page_count: 2 };
  const wire = scripted(json({ status: 'COMPLETED' }), json(native));
  const model = createFalAssetProvider({ apiKey: 'test:key', fetch: wire.fetch }).asset(id, {
    kind: 'document', mapInput: input => input,
    async mapResult(raw) {
      const url = raw.document.url;
      raw.document.url = 'https://files.example/replaced.pdf';
      await Promise.resolve();
      return {
        assets: [{ type: 'url', url, mediaType: 'application/pdf' }],
        providerMetadata: { fal: { output: { replaced: true }, requestId: 'wrong-id', custom: true } },
      };
    },
  });
  const status = await model.doStatus(operationOptions(id));
  assert.deepEqual(status.result.providerMetadata.fal.output, native);
  assert.deepEqual(status.result.response.body, native);
  assert.equal(status.result.providerMetadata.fal.requestId, REQUEST_ID);
  assert.equal(status.result.providerMetadata.fal.custom, true);
});

test('fal permits omitted mapping functions, validates supplied functions and snapshots definitions', async () => {
  const id = 'my-org/document';
  const native = { url: 'https://files.example/report.pdf' };
  const wire = scripted(json(receipt(id)), json({ status: 'COMPLETED' }), json(native));
  const fal = createFalAssetProvider({ apiKey: 'test:key', fetch: wire.fetch });
  for (const definition of [
    { kind: 'document', mapInput: 'not a function', mapResult: () => ({ assets: [] }) },
    { kind: 'document', mapInput: input => input, mapResult: null },
  ]) assert.throws(() => fal.asset(id, definition), /map(Input|Result) must be a function/);
  assert.equal(wire.calls.length, 0);
  assert.doesNotThrow(() => fal.asset(id, { kind: 'document' }));
  assert.doesNotThrow(() => fal.asset(id, { kind: 'document', mapInput: input => input }));
  assert.doesNotThrow(() => fal.asset(id, { kind: 'document', mapResult: () => ({ assets: [] }) }));

  const definition = {
    kind: 'document', mapInput: input => ({ prompt: input.prompt }),
    mapResult: raw => ({ assets: [{ type: 'url', url: raw.url, mediaType: 'application/pdf' }] }),
  };
  const model = fal.asset(id, definition);
  definition.kind = 'mutated-kind';
  definition.mapInput = () => { throw new Error('Changed after construction'); };
  definition.mapResult = () => { throw new Error('Changed after construction'); };
  const started = await model.doStart(options({ prompt: 'A short report' }));
  const result = await model.doStatus({ ...operationOptions(id), operation: started.operation });
  assert.equal(model.kind, 'document');
  assert.deepEqual(JSON.parse(wire.calls[0].body), { prompt: 'A short report' });
  assert.equal(result.result.assets[0].url, native.url);
});

test('fal direct status and cancel reject operation getters without invoking them or sending credentials', async () => {
  let getterCalls = 0;
  const handle = Object.defineProperty(operation(MUSIC_MODEL), 'requestId', {
    enumerable: true, get() { getterCalls++; return REQUEST_ID; },
  });
  const wire = scripted();
  const model = createFalAssetProvider({ apiKey: 'test:key', fetch: wire.fetch }).music(MUSIC_MODEL);
  const input = { ...operationOptions(MUSIC_MODEL), operation: handle };
  await assert.rejects(model.doStatus(input), TypeError);
  await assert.rejects(model.doCancel(input), TypeError);
  assert.equal(getterCalls, 0);
  assert.equal(wire.calls.length, 0);
});

test('fal accepts class mapping services and snapshots prototype methods with their original receiver', async () => {
  const id = 'external-team/independent-model';
  const native = { generated: 'https://files.example/external.asset' };
  for (const entry of ['music', 'threeD', 'soundEffect', 'animation3D', 'asset', 'constructor']) {
    class ExternalMapping {
      kind = 'external-asset';
      #prefix = 'External: ';
      #mediaType = 'application/x-external';
      async mapInput(input) {
        await Promise.resolve();
        return { description: this.#prefix + input.title };
      }
      async mapResult(output) {
        await Promise.resolve();
        return { assets: [{ type: 'url', url: output.generated, mediaType: this.#mediaType }] };
      }
    }
    const wire = scripted(json(receipt(id)), json({ status: 'COMPLETED' }), json(native));
    const settings = { apiKey: 'test:key', fetch: wire.fetch };
    const provider = createFalAssetProvider(settings);
    const mapping = new ExternalMapping();
    const model = entry === 'constructor'
      ? new FalAssetModel(id, settings, mapping)
      : provider[entry](id, mapping);
    const initialKind = model.kind;
    mapping.kind = 'changed-kind';
    mapping.mapInput = () => { throw new Error('Instance method was replaced'); };
    ExternalMapping.prototype.mapResult = () => { throw new Error('Prototype method was replaced'); };
    const started = await model.doStart(options({ title: 'A custom asset' }));
    const status = await model.doStatus({ ...operationOptions(id), operation: started.operation });
    assert.equal(model.kind, initialKind);
    assert.deepEqual(JSON.parse(wire.calls[0].body), { description: 'External: A custom asset' });
    assert.deepEqual(status.result.assets, [{ type: 'url', url: native.generated, mediaType: 'application/x-external' }]);
    assert.equal(wire.calls.length, 3);
  }
});

test('fal custom mappings cannot present empty assets as successful asset generation', async () => {
  const id = 'my-org/no-files';
  const wire = scripted(json({ status: 'COMPLETED' }), json({ text: 'Plain text has no file' }));
  const model = createFalAssetProvider({ apiKey: 'test:key', fetch: wire.fetch }).asset(id, {
    kind: 'document', mapInput: input => input, mapResult: () => ({ assets: [] }),
  });
  await assert.rejects(model.doStatus(operationOptions(id)), error => APICallError.isInstance(error) && !error.isRetryable && /nonempty/.test(error.message));
});

test('fal motion uses the same cancellation path and keeps local abort separate from remote cancellation', async () => {
  const wire = scripted(json({ status: 'CANCELLATION_REQUESTED' }, 202));
  const model = createFalAssetProvider({ apiKey: 'test:key', fetch: wire.fetch }).animation3D(ANIMATION_3D_MODEL);
  assert.equal((await model.doCancel(operationOptions(ANIMATION_3D_MODEL))).status, 'requested');
  assert.equal(wire.calls[0].method, 'PUT');
  assert.equal(wire.calls[0].url, receipt(ANIMATION_3D_MODEL).cancel_url);
  const reason = new Error('Stop waiting for this request');
  await assert.rejects(model.doStatus({ ...operationOptions(ANIMATION_3D_MODEL), abortSignal: AbortSignal.abort(reason) }), error => error === reason);
  assert.equal(wire.calls.length, 1);
});

test('fal capability mapping can independently replace input or result handling for any model', async () => {
  const id = 'independent-owner/experimental-synthesis';
  const wire = scripted(json(receipt(id)), json({ status: 'COMPLETED' }), json({ audio_blob: 'AQI=', codec: 'custom' }));
  const fal = createFalAssetProvider({ apiKey: 'test:key', fetch: wire.fetch });
  const model = fal.music(id, {
    mapInput: input => ({ description: input.prompt, generator: input.version }),
    mapResult: output => ({
      assets: [{ type: 'base64', data: output.audio_blob, mediaType: 'audio/x-custom' }],
    }),
  });
  const started = await startAsset({ model, input: { prompt: 'An ambient score', version: 17 } });
  const status = await getAssetStatus({ model, operation: started.operation });
  assert.deepEqual(JSON.parse(wire.calls[0].body), { description: 'An ambient score', generator: 17 });
  assert.equal(status.result.assets[0].type, 'base64');
  assert.deepEqual(status.result.providerMetadata.fal.output, { audio_blob: 'AQI=', codec: 'custom' });
  assert.equal(wire.calls.length, 3);
});
