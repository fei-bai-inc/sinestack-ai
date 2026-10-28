import assert from 'node:assert/strict';
import test from 'node:test';
import { APICallError } from '@ai-sdk/provider';
import { startAsset, getAssetStatus } from '@sine-ai/core';
import {
  createFalAssetProvider, FAL_MUSIC_MODEL, FAL_ANIMATION_3D_MODEL,
} from '@sine-ai/fal';

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

test('fal music maps common inputs and model options and resumes through the existing core', async () => {
  const native = {
    audio: { url: 'https://files.example/song.wav', content_type: 'audio/wav', file_name: 'song.wav', file_size: 1024 },
    extra_model_metadata: { duration: 123, sample_rate: 44100 },
  };
  const wire = scripted(json(receipt(FAL_MUSIC_MODEL)), json({ status: 'COMPLETED' }), json(native));
  const settings = { apiKey: 'test:key', fetch: wire.fetch };
  const model = createFalAssetProvider(settings).music();
  assert.equal(model.kind, 'music');
  assert.equal(model.modelId, FAL_MUSIC_MODEL);
  const started = await startAsset({
    model,
    input: { prompt: 'Warm orchestral music with a cinematic rise', lyrics: '[Verse]\nThe sun is rising', instrumental: false },
    providerOptions: { fal: { lyrics_optimizer: false, audio_setting: { format: 'wav', sample_rate: 44100, bitrate: 256000 } } },
  });
  assert.deepEqual(JSON.parse(wire.calls[0].body), {
    prompt: 'Warm orchestral music with a cinematic rise', lyrics: '[Verse]\nThe sun is rising', is_instrumental: false,
    lyrics_optimizer: false, audio_setting: { format: 'wav', sample_rate: 44100, bitrate: 256000 },
  });
  assert.equal(wire.calls[0].url, `${BASE}/${FAL_MUSIC_MODEL}`);
  const restored = JSON.parse(JSON.stringify(started.operation));
  const status = await getAssetStatus({ model: createFalAssetProvider(settings).music(), operation: restored });
  assert.equal(status.status, 'completed');
  assert.deepEqual(status.result.assets, [{
    type: 'url', url: native.audio.url, mediaType: 'audio/wav', filename: 'song.wav', role: 'audio', metadata: { fileSize: 1024 },
  }]);
  assert.deepEqual(status.result.providerMetadata.fal.output, native);
  assert.equal(status.result.providerMetadata.fal.requestId, REQUEST_ID);
  assert.equal(wire.calls.filter(call => call.method === 'POST').length, 1);
  assert.equal(wire.calls.length, 3);
  assert.ok(wire.calls.every(call => new URL(call.url).origin === BASE));
});

test('fal music accepts instrumental and generated-lyrics requests without inventing audio MIME types', async () => {
  const wire = scripted(
    json(receipt(FAL_MUSIC_MODEL)), json(receipt(FAL_MUSIC_MODEL)),
    json({ status: 'COMPLETED' }), json({ audio: { url: 'https://files.example/raw-output' } }),
  );
  const model = createFalAssetProvider({ apiKey: 'test:key', fetch: wire.fetch }).music();
  await model.doStart(options({ prompt: 'A gentle acoustic instrumental', instrumental: true }));
  await model.doStart(options({ prompt: 'A city pop song about coming home', lyrics: '', instrumental: false }, { fal: { lyrics_optimizer: true } }));
  assert.deepEqual(JSON.parse(wire.calls[0].body), { prompt: 'A gentle acoustic instrumental', is_instrumental: true });
  assert.deepEqual(JSON.parse(wire.calls[1].body), {
    prompt: 'A city pop song about coming home', lyrics: '', is_instrumental: false, lyrics_optimizer: true,
  });
  const status = await model.doStatus(operationOptions(FAL_MUSIC_MODEL));
  assert.equal(status.result.assets[0].mediaType, 'application/octet-stream');
});

test('fal animation maps JSON format to dict and retains both returned file types', async () => {
  const native = {
    fbx_file: { url: 'https://files.example/walk.fbx', file_name: 'walk.fbx' },
    motion_json: { url: 'https://files.example/walk.json', file_size: 256 },
    seed: 42,
  };
  const wire = scripted(json(receipt(FAL_ANIMATION_3D_MODEL)), json({ status: 'COMPLETED' }), json(native));
  const model = createFalAssetProvider({ apiKey: 'test:key', fetch: wire.fetch }).animation3D();
  assert.equal(model.kind, 'animation-3d');
  assert.equal(model.modelId, FAL_ANIMATION_3D_MODEL);
  const started = await model.doStart(options({
    prompt: 'A person walks then jumps over a puddle', durationSeconds: 3, seed: 42, format: 'json',
  }, { fal: { guidance_scale: 3 } }));
  assert.deepEqual(JSON.parse(wire.calls[0].body), {
    prompt: 'A person walks then jumps over a puddle', duration: 3, seed: 42, output_format: 'dict', guidance_scale: 3,
  });
  const result = await model.doStatus({ ...operationOptions(FAL_ANIMATION_3D_MODEL), operation: started.operation });
  assert.deepEqual(result.result.assets, [
    { type: 'url', url: native.fbx_file.url, mediaType: 'application/octet-stream', role: 'animation', filename: 'walk.fbx', metadata: { format: 'fbx' } },
    { type: 'url', url: native.motion_json.url, mediaType: 'application/json', role: 'motion-data', metadata: { format: 'json', fileSize: 256 } },
  ]);
  assert.deepEqual(result.result.providerMetadata.fal, { seed: 42, requestId: REQUEST_ID, output: native });
  assert.equal(wire.calls.length, 3);
});

test('fal animation accepts either FBX or JSON file output and rejects no-file or inline-only results', async () => {
  const outputs = [
    { fbx_file: { url: 'https://files.example/walk.fbx', content_type: 'application/x-fbx' }, motion_json: null, seed: 1 },
    { fbx_file: null, motion_json: { url: 'https://files.example/walk.json' }, seed: 1 },
    { fbx_file: null, motion_json: null, seed: 1 },
    { motion_json: { frames: [1, 2, 3] }, seed: 1 },
    { motion_json: { url: 'data:application/json,{}' }, seed: 1 },
    { fbx_file: { url: 'https://files.example/walk.fbx' }, seed: 0.5 },
  ];
  const wire = scripted(...outputs.flatMap(output => [json({ status: 'COMPLETED' }), json(output)]));
  const model = createFalAssetProvider({ apiKey: 'test:key', fetch: wire.fetch }).animation3D();
  const first = await model.doStatus(operationOptions(FAL_ANIMATION_3D_MODEL));
  assert.equal(first.result.assets[0].mediaType, 'application/x-fbx');
  const second = await model.doStatus(operationOptions(FAL_ANIMATION_3D_MODEL));
  assert.equal(second.result.assets[0].mediaType, 'application/json');
  for (let i = 0; i < 4; i++) {
    await assert.rejects(model.doStatus(operationOptions(FAL_ANIMATION_3D_MODEL)), error => APICallError.isInstance(error) && !error.isRetryable);
  }
  assert.equal(wire.calls.length, 12);
});

test('fal new presets validate schema fields and reject cross-model assumptions before a request', async () => {
  const wire = scripted();
  const fal = createFalAssetProvider({ apiKey: 'test:key', fetch: wire.fetch });
  for (const input of [
    { prompt: 'short' }, { prompt: 'a'.repeat(2001) }, { prompt: 'Instrumental music', instrumental: 'yes' },
    { prompt: 'Instrumental music', lyrics: 'x'.repeat(3501) }, { prompt: 'Instrumental music', lyrics: null },
    { prompt: 'Instrumental music', durationSeconds: 30 }, { prompt: 'A song without any lyrics' },
    { prompt: 'A song without any lyrics', instrumental: false, lyrics: '  ' },
  ]) await assert.rejects(fal.music().doStart(options(input)), TypeError);
  for (const extra of [
    { lyrics_optimizer: 1 }, { audio_setting: { format: 'flac' } }, { audio_setting: { sample_rate: 48000 } },
    { audio_setting: { bitrate: 192000 } }, { audio_setting: { sample_rate: '44100' } },
    { audio_setting: { unsupported: true } }, { is_instrumental: false }, { lyrics: 'override' },
  ]) await assert.rejects(fal.music().doStart(options({ prompt: 'Instrumental music' }, { fal: extra })), TypeError);
  for (const input of [
    { prompt: '' }, { prompt: 'walking', durationSeconds: 0.49 }, { prompt: 'walking', durationSeconds: 12.1 },
    { prompt: 'walking', durationSeconds: NaN }, { prompt: 'walking', seed: 1.5 },
    { prompt: 'walking', seed: Infinity }, { prompt: 'walking', format: 'dict' }, { prompt: 'walking', frames: 120 },
  ]) await assert.rejects(fal.animation3D().doStart(options(input)), TypeError);
  for (const extra of [{ seed: 4 }, { output_format: 'dict' }, { duration: 3 }, { guidance_scale: Infinity }, { guidance_scale: '3' }]) {
    await assert.rejects(fal.animation3D().doStart(options({ prompt: 'walking' }, { fal: extra })), TypeError);
  }
  assert.throws(() => fal.music('fal-ai/minimax-music/v1'), /fal\.asset/);
  assert.throws(() => fal.animation3D('fal-ai/other-motion'), /fal\.asset/);
  assert.equal(wire.calls.length, 0);
});

test('fal media presets reject input accessors without invoking caller code', async () => {
  let getterCalls = 0;
  const input = Object.defineProperty({ instrumental: true }, 'prompt', {
    enumerable: true, get() { getterCalls++; return 'An instrumental acoustic piece'; },
  });
  const wire = scripted();
  const fal = createFalAssetProvider({ apiKey: 'test:key', fetch: wire.fetch });
  await assert.rejects(fal.music().doStart(options(input)), TypeError);
  await assert.rejects(fal.animation3D().doStart(options(input)), TypeError);
  await assert.rejects(fal.threeD().doStart(options(input)), TypeError);
  await assert.rejects(fal.soundEffect().doStart(options(input)), TypeError);
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

test('fal rejects missing mapping functions at construction and snapshots valid definitions', async () => {
  const id = 'my-org/document';
  const native = { url: 'https://files.example/report.pdf' };
  const wire = scripted(json(receipt(id)), json({ status: 'COMPLETED' }), json(native));
  const fal = createFalAssetProvider({ apiKey: 'test:key', fetch: wire.fetch });
  for (const definition of [
    { kind: 'document', mapInput: input => input },
    { kind: 'document', mapResult: () => ({ assets: [] }) },
    { kind: 'document', mapInput: 'not a function', mapResult: () => ({ assets: [] }) },
    { kind: 'document', mapInput: input => input, mapResult: null },
  ]) assert.throws(() => fal.asset(id, definition), /mapInput and mapResult functions/);
  assert.equal(wire.calls.length, 0);

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
  const handle = Object.defineProperty(operation(FAL_MUSIC_MODEL), 'requestId', {
    enumerable: true, get() { getterCalls++; return REQUEST_ID; },
  });
  const wire = scripted();
  const model = createFalAssetProvider({ apiKey: 'test:key', fetch: wire.fetch }).music();
  const input = { ...operationOptions(FAL_MUSIC_MODEL), operation: handle };
  await assert.rejects(model.doStatus(input), TypeError);
  await assert.rejects(model.doCancel(input), TypeError);
  assert.equal(getterCalls, 0);
  assert.equal(wire.calls.length, 0);
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
  const model = createFalAssetProvider({ apiKey: 'test:key', fetch: wire.fetch }).animation3D();
  assert.equal((await model.doCancel(operationOptions(FAL_ANIMATION_3D_MODEL))).status, 'requested');
  assert.equal(wire.calls[0].method, 'PUT');
  assert.equal(wire.calls[0].url, receipt(FAL_ANIMATION_3D_MODEL).cancel_url);
  const reason = new Error('Stop waiting for this request');
  await assert.rejects(model.doStatus({ ...operationOptions(FAL_ANIMATION_3D_MODEL), abortSignal: AbortSignal.abort(reason) }), error => error === reason);
  assert.equal(wire.calls.length, 1);
});
