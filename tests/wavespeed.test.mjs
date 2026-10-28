import assert from 'node:assert/strict';
import test from 'node:test';
import { APICallError } from '@ai-sdk/provider';
import { cancelAsset, getAssetStatus, startAsset, waitForAsset } from '@sine-ai/core';
import { createWaveSpeedAssetProvider, WAVESPEED_MUSIC_MODEL, WAVESPEED_THREE_D_MODEL, WaveSpeedAssetModel } from '@sine-ai/wavespeed';

const BASE = 'https://api.wavespeed.ai/api/v3';
const ID = 'pred_abc123';
const URL_FILE = 'https://cdn.example/asset.glb';

function json(value, status = 200, headers = {}) {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json', ...headers } });
}

function prediction(status = 'created', extra = {}, model = WAVESPEED_THREE_D_MODEL) {
  return { code: 200, message: 'success', data: { id: ID, model, status, outputs: [], ...extra } };
}

function operation(modelId = WAVESPEED_THREE_D_MODEL, baseURL = BASE) {
  return { type: 'wavespeed-prediction', version: 1, modelId, baseURL, predictionId: ID };
}

function startOptions(input = { prompt: 'A blue sculpture' }, extra = {}) {
  return { input, providerOptions: {}, headers: {}, abortSignal: new AbortController().signal, idempotencyKey: 'logical-1', ...extra };
}

function statusOptions(value = operation(), extra = {}) {
  return { operation: value, headers: {}, abortSignal: new AbortController().signal, ...extra };
}

function scripted(...steps) {
  const calls = [];
  return {
    calls,
    fetch: async (url, init) => {
      const call = { url: String(url), ...init, headers: new Headers(init.headers) };
      calls.push(call);
      const step = steps.shift();
      assert.ok(step, `Unexpected HTTP call ${call.method} ${call.url}`);
      return typeof step === 'function' ? await step(call) : step;
    },
  };
}

test('WaveSpeed submits once, retaining the full model path and configured credentials', async () => {
  const wire = scripted(json(prediction(), 200, { 'x-request-id': ID }));
  const provider = createWaveSpeedAssetProvider({ apiKey: 'private-token', fetch: wire.fetch, headers: { 'x-client': 'sine' }, name: 'tenant-wave' });
  const model = provider.threeD();
  const options = startOptions(undefined, {
    providerOptions: { wavespeed: { texture: true, geometry_quality: 'detailed', face_limit: 50_000, model_seed: 7 } },
    headers: { Authorization: 'untrusted', 'x-call': 'start' },
  });
  const result = await model.doStart(options);
  assert.equal(model.provider, 'tenant-wave');
  assert.equal(model.kind, 'model-3d');
  assert.deepEqual(model.capabilities, { idempotentStart: false, webhooks: true });
  assert.equal(model.doCancel, undefined);
  assert.equal(wire.calls.length, 1);
  const [call] = wire.calls;
  assert.equal(call.url, `${BASE}/tripo3d/h3.1/text-to-3d`);
  assert.equal(call.method, 'POST');
  assert.equal(call.signal, options.abortSignal);
  assert.equal(call.redirect, 'error');
  assert.equal(call.headers.get('authorization'), 'Bearer private-token');
  assert.equal(call.headers.get('x-client'), 'sine');
  assert.equal(call.headers.get('x-call'), 'start');
  assert.equal(call.headers.get('idempotency-key'), null);
  assert.deepEqual(JSON.parse(call.body), { prompt: 'A blue sculpture', texture: true, geometry_quality: 'detailed', face_limit: 50_000, model_seed: 7 });
  assert.deepEqual(result.operation, operation());
  assert.equal(result.providerMetadata.wavespeed.predictionId, ID);
  assert.equal(result.response.headers['x-request-id'], ID);
  assert.equal(JSON.stringify(result.operation).includes('private-token'), false);
});

test('WaveSpeed music maps unified lyrics and instrumental to native inputs', async () => {
  const wire = scripted(json(prediction('created', {}, WAVESPEED_MUSIC_MODEL)));
  const model = createWaveSpeedAssetProvider({ apiKey: 'token', fetch: wire.fetch }).music();
  await model.doStart(startOptions({ prompt: 'Quiet ambient piano', lyrics: '', instrumental: true }, {
    providerOptions: { wavespeed: { bitrate: 128000, sample_rate: 24000 } },
  }));
  assert.deepEqual(JSON.parse(wire.calls[0].body), {
    prompt: 'Quiet ambient piano', lyrics: '', is_instrumental: true, bitrate: 128000, sample_rate: 24000,
  });
});

test('WaveSpeed returns URL references with accurate MIME fallbacks and native output preservation', async () => {
  const output = [URL_FILE, 'https://cdn.example/texture.png', { url: 'https://cdn.example/opaque', content_type: 'application/zip', file_name: 'model.zip', file_size: 42 }];
  const wire = scripted(json(prediction('completed', { outputs: output })));
  const model = createWaveSpeedAssetProvider({ apiKey: 'token', fetch: wire.fetch }).threeD();
  const result = await model.doStatus(statusOptions());
  assert.equal(result.status, 'completed');
  assert.equal(wire.calls.length, 1);
  assert.equal(wire.calls[0].url, `${BASE}/predictions/${ID}/result`);
  assert.deepEqual(result.result.assets.map(asset => asset.mediaType), ['model/gltf-binary', 'image/png', 'application/zip']);
  assert.equal(result.result.assets[2].filename, 'model.zip');
  assert.deepEqual(result.result.providerMetadata.wavespeed.output, output);
});

test('WaveSpeed music does not assume an unknown output is MP3', async () => {
  const wire = scripted(json(prediction('completed', { outputs: ['https://cdn.example/song.flac', 'https://cdn.example/opaque'] }, WAVESPEED_MUSIC_MODEL)));
  const result = await createWaveSpeedAssetProvider({ apiKey: 'token', fetch: wire.fetch }).music().doStatus(statusOptions(operation(WAVESPEED_MUSIC_MODEL)));
  assert.equal(result.result.assets[0].mediaType, 'audio/flac');
  assert.equal(result.result.assets[1].mediaType, 'application/octet-stream');
});

test('WaveSpeed generic mapping preserves native output before custom mapper mutation', async () => {
  const modelId = 'vendor/custom/motion';
  const output = [{ model: URL_FILE, statistics: { score: 9 } }];
  const wire = scripted(
    json(prediction('created', {}, modelId)),
    json(prediction('completed', { outputs: output, input: { private: 'prompt' }, logs: 'sensitive debug' }, modelId)),
  );
  const model = createWaveSpeedAssetProvider({ apiKey: 'token', fetch: wire.fetch }).asset(modelId, {
    kind: 'animation-3d', mapInput: input => input,
    async mapResult(value) {
      const url = value[0].model;
      value[0].statistics.score = 0;
      return { assets: [{ type: 'url', url, mediaType: 'model/gltf-binary' }], providerMetadata: { wavespeed: { output: 'wrong', custom: true } } };
    },
  });
  const started = await model.doStart(startOptions({ prompt: 'Spin', frames: 120, extras: { loop: true } }));
  assert.deepEqual(JSON.parse(wire.calls[0].body), { prompt: 'Spin', frames: 120, extras: { loop: true } });
  const status = await model.doStatus(statusOptions(started.operation));
  assert.deepEqual(status.result.providerMetadata.wavespeed.output, output);
  assert.deepEqual(status.result.response.body.data.outputs, output);
  assert.equal(status.result.providerMetadata.wavespeed.custom, true);
  assert.equal('input' in status.result.providerMetadata.wavespeed, false);
  assert.equal('logs' in status.result.providerMetadata.wavespeed, false);
});

test('WaveSpeed status handles documented terminal states and future nonterminal states', async () => {
  const statuses = ['created', 'queued', 'processing', 'new-stage', 'cancelled', 'failed', 'timeout', 'deleted'];
  const wire = scripted(...statuses.map(status => json(prediction(status, { error: 'provider detail', code: 5004 }))));
  const model = createWaveSpeedAssetProvider({ apiKey: 'token', fetch: wire.fetch }).threeD();
  for (const [index, expected] of ['pending', 'pending', 'running', 'running', 'cancelled', 'failed', 'failed', 'failed'].entries()) {
    const result = await model.doStatus(statusOptions());
    assert.equal(result.status, expected, statuses[index]);
    if (result.status === 'failed') {
      assert.equal(result.error.message, 'provider detail');
      assert.equal(result.error.code, '5004');
    }
  }
  assert.equal(wire.calls.length, statuses.length);
});

test('WaveSpeed sync timeout with an accepted prediction ID remains resumable', async () => {
  const wire = scripted(
    json(prediction('processing', { code: 5004, error: 'Sync mode timed out', urls: { get: 'https://attacker.example/' } })),
    json(prediction('processing', { code: 5004, error: 'Still running' })),
    json(prediction('completed', { outputs: [URL_FILE] })),
  );
  const model = createWaveSpeedAssetProvider({ apiKey: 'token', fetch: wire.fetch }).threeD();
  const started = await startAsset({ model, input: { prompt: 'A sculpture' }, providerOptions: { wavespeed: { enable_sync_mode: true } } });
  const persisted = JSON.parse(JSON.stringify(started.operation));
  assert.equal((await getAssetStatus({ model, operation: persisted })).status, 'running');
  assert.equal((await getAssetStatus({ model, operation: persisted })).status, 'completed');
  assert.deepEqual(wire.calls.map(call => call.method), ['POST', 'GET', 'GET']);
  assert.ok(wire.calls.every(call => call.url.startsWith(BASE)));
});

test('WaveSpeed standard webhooks are encoded and use the same result query', async () => {
  const wire = scripted(json(prediction()));
  const model = createWaveSpeedAssetProvider({ apiKey: 'token', fetch: wire.fetch }).threeD();
  const webhookUrl = 'https://app.example/webhooks?tenant=a&job=b';
  await model.doStart(startOptions(undefined, { webhookUrl }));
  assert.equal(new URL(wire.calls[0].url).searchParams.get('standard_webhook'), webhookUrl);
  assert.equal(new URL(wire.calls[0].url).searchParams.has('webhook'), false);
});

test('WaveSpeed rejects unsupported sync/webhook and base64 combinations before any paid submission', async () => {
  const wire = scripted();
  const model = createWaveSpeedAssetProvider({ apiKey: 'token', fetch: wire.fetch }).threeD();
  await assert.rejects(model.doStart(startOptions(undefined, { webhookUrl: 'http://app.example/hook' })), /HTTPS/);
  await assert.rejects(model.doStart(startOptions(undefined, { webhookUrl: 'https://app.example/hook', providerOptions: { wavespeed: { enable_sync_mode: true } } })), /cannot be combined/);
  await assert.rejects(model.doStart(startOptions(undefined, { providerOptions: { wavespeed: { enable_base64_output: true } } })), /not supported/);
  await assert.rejects(model.doStart(startOptions(undefined, { providerOptions: { wavespeed: { enable_sync_mode: 'true' } } })), /boolean/);
  const generic = createWaveSpeedAssetProvider({ apiKey: 'token', fetch: wire.fetch }).asset('vendor/model', { kind: 'music', mapInput: input => input, mapResult: () => ({ assets: [] }) });
  await assert.rejects(generic.doStart(startOptions({ enable_base64_output: true })), /not supported/);
  assert.equal(wire.calls.length, 0);
});

test('WaveSpeed checks model, prediction, and baseURL identities before network and credentials', async () => {
  const wire = scripted();
  const model = createWaveSpeedAssetProvider({ fetch: wire.fetch }).threeD();
  for (const changed of [
    { type: 'other' }, { version: 2 }, { modelId: WAVESPEED_MUSIC_MODEL },
    { baseURL: 'https://attacker.example/api/v3' }, { baseURL: `${BASE}/other` },
    { predictionId: '../steal' }, { predictionId: 'id?token' }, { predictionId: '' },
  ]) await assert.rejects(model.doStatus(statusOptions({ ...operation(), ...changed })), TypeError);
  let getterCalls = 0;
  await assert.rejects(model.doStatus(statusOptions({ ...operation(), get predictionId() { getterCalls += 1; return ID; } })), /JSON/);
  assert.equal(getterCalls, 0);
  assert.equal(wire.calls.length, 0);
});

test('WaveSpeed custom baseURL, path prefix, and headers are snapshotted', async () => {
  const custom = 'https://proxy.example/tenant/wavespeed/api/v3';
  const wire = scripted(json(prediction()), json(prediction('processing')));
  const settings = { apiKey: 'original', baseURL: `${custom}///`, fetch: wire.fetch, headers: { 'x-tenant': 'a' } };
  const provider = createWaveSpeedAssetProvider(settings);
  settings.baseURL = 'https://attacker.example';
  settings.apiKey = 'changed';
  settings.headers['x-tenant'] = 'b';
  const model = provider.threeD();
  const started = await model.doStart(startOptions());
  assert.equal(started.operation.baseURL, custom);
  await model.doStatus(statusOptions(JSON.parse(JSON.stringify(started.operation))));
  assert.equal(wire.calls[0].url, `${custom}/${WAVESPEED_THREE_D_MODEL}`);
  assert.equal(wire.calls[1].url, `${custom}/predictions/${ID}/result`);
  assert.ok(wire.calls.every(call => call.headers.get('authorization') === 'Bearer original' && call.headers.get('x-tenant') === 'a'));
  const directSettings = { apiKey: 'original', baseURL: custom, fetch: scripted(json(prediction())).fetch };
  const direct = new WaveSpeedAssetModel(WAVESPEED_THREE_D_MODEL, directSettings, { kind: 'model-3d', mapInput: input => input, mapResult: () => ({ assets: [] }) });
  directSettings.baseURL = 'https://attacker.example';
  assert.equal((await direct.doStart(startOptions())).operation.baseURL, custom);
});

test('WaveSpeed rejects malformed, mismatched, and non-file completed responses without retrying', async () => {
  for (const body of [
    prediction('processing', { id: 'different' }), prediction('processing', { model: 'vendor/other' }),
    prediction(undefined, { status: null }), prediction(''), prediction('completed', { outputs: null }),
    prediction('completed', { outputs: [] }), prediction('completed', { outputs: ['plain text'] }),
    prediction('completed', { outputs: ['https://user:password@cdn.example/file.glb'] }),
    prediction('completed', { outputs: [{ status: 'done' }] }), { code: 403, message: 'Denied', data: {} },
  ]) {
    const wire = scripted(json(body));
    const model = createWaveSpeedAssetProvider({ apiKey: 'token', fetch: wire.fetch }).threeD();
    await assert.rejects(model.doStatus(statusOptions()), error => APICallError.isInstance(error) && error.isRetryable === false);
    assert.equal(wire.calls.length, 1);
  }
});

test('WaveSpeed ignores untrusted provider-supplied request URLs and rejects redirects', async () => {
  const wire = scripted(json(prediction('created', { urls: { get: 'https://attacker.example/result' } })), json(prediction('processing')));
  const model = createWaveSpeedAssetProvider({ apiKey: 'token', fetch: wire.fetch }).threeD();
  const started = await model.doStart(startOptions());
  await model.doStatus(statusOptions(started.operation));
  assert.equal(wire.calls[1].url, `${BASE}/predictions/${ID}/result`);
  assert.equal('urls' in started.operation, false);
  const redirected = json(prediction());
  Object.defineProperty(redirected, 'redirected', { value: true });
  const redirectedModel = createWaveSpeedAssetProvider({ apiKey: 'token', fetch: scripted(redirected).fetch }).threeD();
  await assert.rejects(redirectedModel.doStart(startOptions()), error => APICallError.isInstance(error) && error.isRetryable === false);
});

test('WaveSpeed submission errors are never retried and a status retry is delegated to the shared core', async () => {
  const failedWire = scripted(json({ message: 'busy' }, 503));
  const failedModel = createWaveSpeedAssetProvider({ apiKey: 'token', fetch: failedWire.fetch }).threeD();
  await assert.rejects(startAsset({ model: failedModel, input: { prompt: 'A sculpture' } }));
  assert.equal(failedWire.calls.length, 1);
  await assert.rejects(startAsset({ model: failedModel, input: { prompt: 'A sculpture' }, retry: { start: 1 } }), /idempotent/);
  assert.equal(failedWire.calls.length, 1);
  const wire = scripted(json(prediction()), json({ message: 'slow down' }, 429, { 'retry-after': '0.001' }), json(prediction('completed', { outputs: [URL_FILE] })));
  const model = createWaveSpeedAssetProvider({ apiKey: 'token', fetch: wire.fetch }).threeD();
  const started = await startAsset({ model, input: { prompt: 'A sculpture' } });
  const result = await getAssetStatus({ model, operation: started.operation, retry: { status: 1 } });
  assert.equal(result.status, 'completed');
  assert.deepEqual(wire.calls.map(call => call.method), ['POST', 'GET', 'GET']);
});

test('WaveSpeed HTTP errors retain AI SDK retryability including 409', async () => {
  for (const [status, retryable] of [[400, false], [401, false], [408, true], [409, true], [429, true], [503, true]]) {
    const wire = scripted(json({ message: 'upstream error' }, status, { 'retry-after': '4' }));
    const model = createWaveSpeedAssetProvider({ apiKey: 'token', fetch: wire.fetch }).threeD();
    await assert.rejects(model.doStatus(statusOptions()), error => APICallError.isInstance(error) && error.statusCode === status && error.isRetryable === retryable && error.responseHeaders['retry-after'] === '4');
    assert.equal(wire.calls.length, 1);
  }
});

test('WaveSpeed passes cancellation signals through and does not submit an aborted request', async () => {
  const aborted = new AbortController();
  const reason = new Error('Stopped');
  aborted.abort(reason);
  const wire = scripted();
  const model = createWaveSpeedAssetProvider({ apiKey: 'token', fetch: wire.fetch }).threeD();
  await assert.rejects(model.doStart(startOptions(undefined, { abortSignal: aborted.signal })), error => error === reason);
  assert.equal(wire.calls.length, 0);
  const active = new AbortController();
  const activeWire = scripted(call => new Promise((resolve, reject) => {
    assert.equal(call.signal, active.signal);
    call.signal.addEventListener('abort', () => reject(call.signal.reason), { once: true });
    active.abort(reason);
  }));
  await assert.rejects(createWaveSpeedAssetProvider({ apiKey: 'token', fetch: activeWire.fetch }).threeD().doStatus(statusOptions(undefined, { abortSignal: active.signal })), error => error === reason);
  assert.equal(activeWire.calls.length, 1);
});

test('WaveSpeed runs through existing wait/resume flow and unsupported cancel sends no delete request', async () => {
  const wire = scripted(json(prediction()), json(prediction('processing')), json(prediction('completed', { outputs: [URL_FILE] })));
  const model = createWaveSpeedAssetProvider({ apiKey: 'token', fetch: wire.fetch }).threeD();
  const started = await startAsset({ model, input: { prompt: 'A sculpture' } });
  const result = await waitForAsset({ model, operation: JSON.parse(JSON.stringify(started.operation)), poll: { intervalMs: 1, delay: async () => {} } });
  assert.equal(result.asset.url, URL_FILE);
  assert.deepEqual(result.providerMetadata.wavespeed.output, [URL_FILE]);
  await assert.rejects(cancelAsset({ model, operation: started.operation }), /cancel/i);
  assert.deepEqual(wire.calls.map(call => call.method), ['POST', 'GET', 'GET']);
});

test('WaveSpeed presets validate inputs and model IDs before dispatch', async () => {
  const wire = scripted();
  const provider = createWaveSpeedAssetProvider({ apiKey: 'token', fetch: wire.fetch });
  for (const bad of [{ prompt: '' }, { prompt: 'x'.repeat(1025) }, { prompt: 'x', seed: 1 }]) await assert.rejects(provider.threeD().doStart(startOptions(bad)), TypeError);
  for (const bad of [{ prompt: '' }, { prompt: 'x', lyrics: 'short' }, { prompt: 'x', instrumental: 'yes' }]) await assert.rejects(provider.music().doStart(startOptions(bad)), TypeError);
  for (const extra of [{ prompt: 'override' }, { face_limit: 999 }, { texture: 'true' }, { geometry_quality: 'ultra' }, { model_seed: 1.5 }]) await assert.rejects(provider.threeD().doStart(startOptions(undefined, { providerOptions: { wavespeed: extra } })), TypeError);
  await assert.rejects(provider.music().doStart(startOptions({ prompt: 'Music' }, { providerOptions: { wavespeed: { is_instrumental: true } } })), TypeError);
  for (const id of ['bad', '../escape', 'vendor/../model', 'vendor/model?key=value', 'https://attacker.example/model']) {
    assert.throws(() => provider.asset(id, { kind: 'music', mapInput: input => input, mapResult: () => ({ assets: [] }) }), TypeError);
  }
  assert.throws(() => provider.music('vendor/other'), /Unsupported/);
  assert.throws(() => provider.threeD('vendor/other'), /Unsupported/);
  assert.throws(() => provider.asset('vendor/model', { kind: 'music', mapInput: input => input }), /mapInput and mapResult/);
  assert.throws(() => provider.asset('vendor/model', { kind: 'music', mapResult: () => ({ assets: [] }) }), /mapInput and mapResult/);
  assert.equal(wire.calls.length, 0);
});

test('WaveSpeed validates native JSON and prevents provider options overriding native mapped fields', async () => {
  const wire = scripted();
  const model = createWaveSpeedAssetProvider({ apiKey: 'token', fetch: wire.fetch }).asset('vendor/model', { kind: 'music', mapInput: input => input, mapResult: () => ({ assets: [] }) });
  await assert.rejects(model.doStart(startOptions({ prompt: 'x', frames: 20 }, { providerOptions: { wavespeed: { frames: 30 } } })), /override/);
  const cyclic = {}; cyclic.self = cyclic;
  await assert.rejects(model.doStart(startOptions(cyclic)), /JSON/);
  await assert.rejects(model.doStart(startOptions({ count: Infinity })), /JSON/);
  let getterCalls = 0;
  const getterInput = { get prompt() { getterCalls += 1; return 'unsafe'; } };
  await assert.rejects(model.doStart(startOptions(getterInput)), /JSON/);
  const provider = createWaveSpeedAssetProvider({ apiKey: 'token', fetch: wire.fetch });
  await assert.rejects(provider.music().doStart(startOptions(getterInput)), /JSON/);
  await assert.rejects(provider.threeD().doStart(startOptions(getterInput)), /JSON/);
  assert.equal(getterCalls, 0);
  assert.equal(wire.calls.length, 0);
});

test('WaveSpeed rejects malformed submission receipts without a second POST', async () => {
  for (const response of [
    json({ code: 200, data: { status: 'created' } }),
    json(prediction('created', { id: '../unsafe' })),
    json(prediction('created', { model: 'vendor/different' })),
    new Response('not json', { status: 200 }),
  ]) {
    const wire = scripted(response);
    const model = createWaveSpeedAssetProvider({ apiKey: 'token', fetch: wire.fetch }).threeD();
    await assert.rejects(startAsset({ model, input: { prompt: 'A sculpture' } }));
    assert.equal(wire.calls.length, 1);
  }
});

test('WaveSpeed accepts an unwrapped prediction and rejects custom results without files', async () => {
  const modelId = 'vendor/native-model';
  const wire = scripted(
    json({ id: ID, status: 'created', model: modelId }),
    json({ id: ID, status: 'completed', model: modelId, outputs: [{ caption: 'No file generated' }] }),
  );
  const model = createWaveSpeedAssetProvider({ apiKey: 'token', fetch: wire.fetch }).asset(modelId, {
    kind: 'music', mapInput: input => input, mapResult: () => ({ assets: [] }),
  });
  const started = await model.doStart(startOptions());
  assert.equal(started.operation.predictionId, ID);
  await assert.rejects(model.doStatus(statusOptions(started.operation)), error => APICallError.isInstance(error) && !error.isRetryable && /at least one asset/.test(error.message));
  assert.deepEqual(wire.calls.map(call => call.method), ['POST', 'GET']);
});
