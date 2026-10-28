import assert from 'node:assert/strict';
import test from 'node:test';
import { APICallError } from '@ai-sdk/provider';
import { createFalAssetProvider, FAL_THREE_D_MODEL, FAL_SOUND_EFFECT_MODEL } from '@sine-ai/fal';

const BASE = 'https://queue.fal.run';
const REQUEST_ID = '764cabcf-b745-4b3e-ae38-1200304cf45b';

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}

function submitBody(modelId = FAL_THREE_D_MODEL, baseURL = BASE) {
  const app = modelId.split('/').slice(0, 2).join('/');
  const response_url = `${baseURL}/${app}/requests/${REQUEST_ID}`;
  return {
    request_id: REQUEST_ID, response_url,
    status_url: `${response_url}/status`, cancel_url: `${response_url}/cancel`, queue_position: 0,
  };
}

function operation(modelId = FAL_THREE_D_MODEL, baseURL = BASE) {
  const body = submitBody(modelId, baseURL);
  return {
    type: 'fal-queue', version: 1, modelId, requestId: body.request_id,
    statusUrl: body.status_url, responseUrl: body.response_url, cancelUrl: body.cancel_url,
  };
}

function startOptions(input = { prompt: 'A low poly treasure chest' }, extra = {}) {
  return {
    input, providerOptions: {}, headers: {}, abortSignal: new AbortController().signal,
    idempotencyKey: 'logical-submit-1', ...extra,
  };
}

function operationOptions(value = operation(), extra = {}) {
  return { operation: value, headers: {}, abortSignal: new AbortController().signal, ...extra };
}

function scripted(...steps) {
  const calls = [];
  const fetch = async (url, init) => {
    const call = { url: String(url), ...init, headers: new Headers(init.headers) };
    calls.push(call);
    const step = steps.shift();
    assert.ok(step, `Unexpected extra provider request: ${call.method} ${call.url}`);
    return typeof step === 'function' ? await step(call) : step;
  };
  return { calls, fetch };
}

test('fal submission uses the real queue protocol once, with webhook, headers, and safe capabilities', async () => {
  const payload = submitBody();
  payload.status_url += '?logs=1';
  const wire = scripted(json(payload, 202, { 'x-fal-request-id': REQUEST_ID }));
  const fal = createFalAssetProvider({ apiKey: 'test:key', fetch: wire.fetch, headers: { 'x-app': 'sine' }, name: 'fal-test' });
  const model = fal.threeD();
  const options = startOptions(undefined, {
    webhookUrl: 'https://sine.example/callback?tenant=a&task=b',
    headers: { 'x-call': 'submit', Authorization: 'must-not-replace-configured-key' },
    providerOptions: { fal: { face_count: 500_000, enable_pbr: true, generate_type: 'Normal' } },
  });
  const result = await model.doStart(options);
  assert.equal(model.specificationVersion, 'v1');
  assert.equal(model.provider, 'fal-test');
  assert.equal(model.kind, 'model-3d');
  assert.equal(model.modelId, FAL_THREE_D_MODEL);
  assert.deepEqual(model.capabilities, { idempotentStart: false, webhooks: true });
  assert.equal(wire.calls.length, 1);
  const [call] = wire.calls;
  const url = new URL(call.url);
  assert.equal(url.origin + url.pathname, `${BASE}/${FAL_THREE_D_MODEL}`);
  assert.equal(url.searchParams.get('fal_webhook'), options.webhookUrl);
  assert.equal(call.method, 'POST');
  assert.equal(call.signal, options.abortSignal);
  assert.equal(call.redirect, 'error');
  assert.equal(call.headers.get('authorization'), 'Key test:key');
  assert.equal(call.headers.get('content-type'), 'application/json');
  assert.equal(call.headers.get('x-app'), 'sine');
  assert.equal(call.headers.get('x-call'), 'submit');
  assert.equal(call.headers.has('idempotency-key'), false);
  assert.deepEqual(JSON.parse(call.body), {
    prompt: 'A low poly treasure chest', face_count: 500_000, enable_pbr: true, generate_type: 'Normal',
  });
  assert.deepEqual(result.operation, { ...operation(), statusUrl: payload.status_url });
  assert.equal(result.providerMetadata.fal.requestId, REQUEST_ID);
  assert.equal(result.response.headers['x-fal-request-id'], REQUEST_ID);
  assert.equal(JSON.stringify(result).includes('test:key'), false);
});

test('fal status is a single read for queued/running work, without inventing a progress percentage', async () => {
  const wire = scripted(
    json({ status: 'IN_QUEUE', request_id: REQUEST_ID, queue_position: 2 }),
    json({ status: 'IN_PROGRESS', request_id: REQUEST_ID, logs: [{ message: 'Loading' }, { message: 'Generating' }] }),
  );
  const model = createFalAssetProvider({ apiKey: 'test:key', fetch: wire.fetch }).threeD();
  const queued = await model.doStatus(operationOptions());
  assert.equal(queued.status, 'pending');
  assert.equal(queued.providerMetadata.fal.queuePosition, 2);
  assert.equal('progress' in queued, false);
  assert.equal(wire.calls.length, 1);
  const running = await model.doStatus(operationOptions());
  assert.equal(running.status, 'running');
  assert.equal(running.message, 'Generating');
  assert.equal(wire.calls.length, 2);
  for (const call of wire.calls) {
    assert.equal(call.method, 'GET');
    assert.equal(call.url, submitBody().status_url);
    assert.equal(call.redirect, 'error');
  }
});

test('fal completion reads the returned result URL and maps GLB, alternate formats, and thumbnail without downloading bytes', async () => {
  const modelFile = { url: 'https://v3.fal.media/model.glb', content_type: 'model/gltf-binary', file_name: 'chest.glb', file_size: 1024 };
  const output = {
    model_glb: modelFile,
    model_urls: { glb: modelFile, obj: { url: 'https://v3.fal.media/model.obj' }, fbx: null },
    thumbnail: { url: 'https://v3.fal.media/preview.png' }, seed: 42,
  };
  const resultURL = `${submitBody().response_url}?response=latest`;
  const wire = scripted(json({ status: 'COMPLETED', response_url: resultURL }), json(output));
  const model = createFalAssetProvider({ apiKey: 'test:key', fetch: wire.fetch }).threeD();
  const status = await model.doStatus(operationOptions());
  assert.equal(status.status, 'completed');
  assert.equal(wire.calls.length, 2);
  assert.equal(wire.calls[1].url, resultURL);
  assert.equal(wire.calls[1].method, 'GET');
  assert.equal(status.result.assets.length, 3);
  assert.deepEqual(status.result.assets[0], {
    type: 'url', url: modelFile.url, mediaType: 'model/gltf-binary', role: 'model', filename: 'chest.glb',
    metadata: { format: 'glb', fileSize: 1024 },
  });
  assert.equal(status.result.assets[1].mediaType, 'model/obj');
  assert.equal(status.result.assets[2].role, 'thumbnail');
  assert.deepEqual(status.result.providerMetadata.fal, { seed: 42, requestId: REQUEST_ID });
  assert.deepEqual(status.result.response.body, output);
});

test('fal COMPLETED plus error is a failed generation and does not fetch a result', async () => {
  const wire = scripted(json({ status: 'COMPLETED', error: 'Content rejected', error_type: 'content_policy_violation' }));
  const model = createFalAssetProvider({ apiKey: 'test:key', fetch: wire.fetch }).threeD();
  assert.deepEqual(await model.doStatus(operationOptions()), {
    status: 'failed', error: { message: 'Content rejected', code: 'content_policy_violation' },
  });
  assert.equal(wire.calls.length, 1);
});

test('fal sound effect maps supported input fields and raw audio output', async () => {
  const wire = scripted(
    json(submitBody(FAL_SOUND_EFFECT_MODEL)),
    json({ status: 'COMPLETED' }),
    json({ audio: { url: 'https://v3.fal.media/effect.mp3', file_name: 'effect.mp3' } }),
  );
  const model = createFalAssetProvider({ apiKey: 'test:key', fetch: wire.fetch }).soundEffect();
  assert.equal(model.kind, 'sound-effect');
  const started = await model.doStart(startOptions({ prompt: 'A brass door slams', durationSeconds: 2.5, promptInfluence: 0.7, loop: false }, {
    providerOptions: { fal: { output_format: 'mp3_44100_128' } },
  }));
  assert.equal(wire.calls[0].url, `${BASE}/${FAL_SOUND_EFFECT_MODEL}`);
  assert.deepEqual(JSON.parse(wire.calls[0].body), {
    text: 'A brass door slams', duration_seconds: 2.5, prompt_influence: 0.7, loop: false, output_format: 'mp3_44100_128',
  });
  const status = await model.doStatus(operationOptions(started.operation));
  assert.equal(status.status, 'completed');
  assert.deepEqual(status.result.assets, [{ type: 'url', url: 'https://v3.fal.media/effect.mp3', mediaType: 'audio/mpeg', role: 'audio', filename: 'effect.mp3' }]);
});

test('fal audio preserves provider media type and does not label unknown raw output as MP3', async () => {
  const wire = scripted(
    json({ status: 'COMPLETED' }), json({ audio: { url: 'https://v3.fal.media/output.raw', content_type: 'audio/L16;rate=48000' } }),
    json({ status: 'COMPLETED' }), json({ audio: { url: 'https://v3.fal.media/output.raw' } }),
  );
  const model = createFalAssetProvider({ apiKey: 'test:key', fetch: wire.fetch }).soundEffect();
  const options = operationOptions(operation(FAL_SOUND_EFFECT_MODEL));
  assert.equal((await model.doStatus(options)).result.assets[0].mediaType, 'audio/L16;rate=48000');
  assert.equal((await model.doStatus(options)).result.assets[0].mediaType, 'application/octet-stream');
});

test('new asset mappings share queue execution and preserve custom result data', async () => {
  const id = 'my-org/motion/generate';
  const wire = scripted(json(submitBody(id)), json({ status: 'COMPLETED' }), json({ animation: 'https://files.example/walk.fbx' }));
  const model = createFalAssetProvider({ apiKey: 'test:key', fetch: wire.fetch }).asset(id, {
    kind: 'animation-3d',
    mapInput: async input => ({ action: input.action, frames: input.frames }),
    mapResult: async result => ({
      assets: [{ type: 'url', url: result.animation, mediaType: 'application/octet-stream', role: 'animation' }],
      usage: { frames: 120 }, providerMetadata: { custom: { format: 'fbx' } },
    }),
  });
  const started = await model.doStart(startOptions({ action: 'walk', frames: 120 }, { providerOptions: { fal: { style: 'cartoon', nested: { seed: 4 } } } }));
  assert.deepEqual(JSON.parse(wire.calls[0].body), { action: 'walk', frames: 120, style: 'cartoon', nested: { seed: 4 } });
  const result = await model.doStatus(operationOptions(started.operation));
  assert.equal(result.result.assets[0].role, 'animation');
  assert.deepEqual(result.result.usage, { frames: 120 });
  assert.deepEqual(result.result.providerMetadata.custom, { format: 'fbx' });
  assert.equal(wire.calls.length, 3);
});

test('fal validates model-specific ranges and unsupported parameters before making a request', async () => {
  const wire = scripted();
  const fal = createFalAssetProvider({ apiKey: 'test:key', fetch: wire.fetch });
  const inputs = [
    { prompt: 'x', durationSeconds: 0.4 }, { prompt: 'x', durationSeconds: 22.1 },
    { prompt: 'x', durationSeconds: NaN }, { prompt: 'x', promptInfluence: 1.01 },
    { prompt: 'x', loop: 'yes' }, { prompt: 'x', seed: 3 }, { prompt: '  ' },
  ];
  for (const input of inputs) await assert.rejects(fal.soundEffect().doStart(startOptions(input)), TypeError);
  await assert.rejects(fal.threeD().doStart(startOptions({ prompt: 'a'.repeat(1025) })), /1024/);
  for (const options of [{ face_count: 39_999 }, { face_count: 40_000.1 }, { enable_pbr: 'true' }, { generate_type: 'unknown' }, { seed: 42 }]) {
    await assert.rejects(fal.threeD().doStart(startOptions(undefined, { providerOptions: { fal: options } })), TypeError);
  }
  await assert.rejects(fal.soundEffect().doStart(startOptions(undefined, { providerOptions: { fal: { output_format: 'wav' } } })), /unsupported/);
  assert.equal(wire.calls.length, 0);
});

test('providerOptions cannot silently override canonical or custom mapped input fields', async () => {
  const wire = scripted();
  const fal = createFalAssetProvider({ apiKey: 'test:key', fetch: wire.fetch });
  for (const key of ['prompt', 'text', 'duration', 'duration_seconds', 'durationSeconds', 'prompt_influence', 'promptInfluence', 'loop']) {
    await assert.rejects(fal.soundEffect().doStart(startOptions({ prompt: 'original' }, { providerOptions: { fal: { [key]: 'override' } } })), /cannot override/);
  }
  const custom = fal.asset('my-org/model', { kind: 'custom', mapInput: input => ({ frames: input.frames }), mapResult: () => ({ assets: [] }) });
  await assert.rejects(custom.doStart(startOptions({ frames: 10 }, { providerOptions: { fal: { frames: 20 } } })), /cannot override/);
  await assert.rejects(custom.doStart(startOptions({ frames: 10 }, { providerOptions: { fal: ['invalid'] } })), /must be an object/);
  const circular = {};
  circular.self = circular;
  await assert.rejects(custom.doStart(startOptions({ frames: 10 }, { providerOptions: { fal: circular } })), /acyclic JSON/);
  assert.equal(wire.calls.length, 0);
});

test('fal JSON input cloning rejects executable or lossy properties without invoking them', async () => {
  let getterCalls = 0;
  let toJSONCalls = 0;
  const getter = Object.defineProperty({}, 'value', {
    enumerable: true, get() { getterCalls++; return 'rewritten'; },
  });
  const hiddenToJSON = Object.defineProperty({ original: true }, 'toJSON', {
    value() { toJSONCalls++; return { original: false }; },
  });
  const hiddenValue = Object.defineProperty({ visible: true }, 'hidden', { value: 'would be lost' });
  const arrayWithExtraProperty = Object.assign([1], { extra: 2 });
  const arrayWithGetter = Object.defineProperty([1], '0', {
    enumerable: true, get() { getterCalls++; return 2; },
  });
  const sparseArray = new Array(1);
  const withSymbol = { visible: true, [Symbol('hidden')]: 'would be lost' };
  const malformed = [getter, hiddenToJSON, hiddenValue, arrayWithExtraProperty, arrayWithGetter, sparseArray, withSymbol];
  const wire = scripted(json(submitBody('my-org/model')));
  const fal = createFalAssetProvider({ apiKey: 'test:key', fetch: wire.fetch });
  const mappedModel = fal.asset('my-org/model', {
    kind: 'custom', mapInput: input => ({ payload: input }), mapResult: () => ({ assets: [] }),
  });
  const optionsModel = fal.asset('my-org/model', {
    kind: 'custom', mapInput: () => ({ action: 'render' }), mapResult: () => ({ assets: [] }),
  });
  for (const value of malformed) {
    await assert.rejects(mappedModel.doStart(startOptions(value)), TypeError);
    await assert.rejects(optionsModel.doStart(startOptions({}, { providerOptions: { fal: { payload: value } } })), TypeError);
  }
  assert.equal(getterCalls, 0);
  assert.equal(toJSONCalls, 0);
  assert.equal(wire.calls.length, 0);

  await mappedModel.doStart(startOptions({
    optional: undefined, nested: { absent: undefined, present: 'kept' }, values: [null, 0, false],
  }, { providerOptions: { fal: { additional: undefined } } }));
  assert.deepEqual(JSON.parse(wire.calls[0].body), {
    payload: { nested: { present: 'kept' }, values: [null, 0, false] },
  });
});

test('fal 429/5xx errors preserve response details and retry eligibility without retrying inside the adapter', async () => {
  const wire = scripted(
    json({ detail: 'Rate limited' }, 429, { 'retry-after': '3' }),
    json({ error: 'Temporarily unavailable' }, 503),
    json({ detail: 'Bad input' }, 422),
  );
  const model = createFalAssetProvider({ apiKey: 'test:key', fetch: wire.fetch }).threeD();
  await assert.rejects(model.doStatus(operationOptions()), error => {
    assert.ok(APICallError.isInstance(error));
    assert.equal(error.statusCode, 429);
    assert.equal(error.responseHeaders['retry-after'], '3');
    assert.equal(error.isRetryable, true);
    assert.match(error.responseBody, /Rate limited/);
    return true;
  });
  await assert.rejects(model.doStart(startOptions()), error => APICallError.isInstance(error) && error.statusCode === 503 && error.isRetryable);
  assert.equal(model.capabilities.idempotentStart, false);
  await assert.rejects(model.doStart(startOptions()), error => APICallError.isInstance(error) && error.statusCode === 422 && !error.isRetryable);
  assert.equal(wire.calls.length, 3);
});

test('fal does not hide a non-2xx result download behind a failed or completed status', async () => {
  const wire = scripted(json({ status: 'COMPLETED' }), json({ detail: 'Result is unavailable' }, 500));
  const model = createFalAssetProvider({ apiKey: 'test:key', fetch: wire.fetch }).threeD();
  await assert.rejects(model.doStatus(operationOptions()), error => APICallError.isInstance(error) && error.statusCode === 500 && error.isRetryable);
  assert.equal(wire.calls.length, 2);
});

test('network failures are retryable APICallErrors and caller abort reasons retain their identity', async () => {
  const wire = scripted(() => { throw new TypeError('Network down'); });
  const model = createFalAssetProvider({ apiKey: 'test:key', fetch: wire.fetch }).threeD();
  await assert.rejects(model.doStatus(operationOptions()), error => APICallError.isInstance(error) && error.isRetryable && error.cause.message === 'Network down');
  const controller = new AbortController();
  const reason = new Error('Stop requested');
  controller.abort(reason);
  await assert.rejects(model.doStatus(operationOptions(undefined, { abortSignal: controller.signal })), error => error === reason);
  assert.equal(wire.calls.length, 1);
});

test('fal cancellation distinguishes a removed queued request from an in-progress cancellation request', async () => {
  const wire = scripted(json({ status: 'OK' }), json({ status: 'CANCELLATION_REQUESTED' }, 202), new Response(null, { status: 204 }));
  const model = createFalAssetProvider({ apiKey: 'test:key', fetch: wire.fetch }).threeD();
  assert.equal((await model.doCancel(operationOptions())).status, 'cancelled');
  assert.equal((await model.doCancel(operationOptions())).status, 'requested');
  assert.equal((await model.doCancel(operationOptions())).status, 'requested');
  for (const call of wire.calls) {
    assert.equal(call.method, 'PUT');
    assert.equal(call.url, submitBody().cancel_url);
    assert.equal(call.body, undefined);
    assert.equal(call.redirect, 'error');
  }
});

test('fal cancellation errors and unknown acknowledgements are never reported as cancellation', async () => {
  const wire = scripted(json({ status: 'ALREADY_COMPLETED' }, 400), json({ status: 'NOT_FOUND' }, 404), json({ status: 'MAYBE' }));
  const model = createFalAssetProvider({ apiKey: 'test:key', fetch: wire.fetch }).threeD();
  for (const statusCode of [400, 404, 200]) {
    await assert.rejects(model.doCancel(operationOptions()), error => APICallError.isInstance(error) && error.statusCode === statusCode && !error.isRetryable);
  }
});

test('persisted operation handles are validated before credentials or requests are sent', async () => {
  const wire = scripted();
  const model = createFalAssetProvider({ apiKey: 'test:key', fetch: wire.fetch }).threeD();
  const invalid = [
    { ...operation(), statusUrl: 'https://attacker.example/steal' },
    { ...operation(), responseUrl: submitBody().response_url.replace(BASE, 'https://queue.fal.run.attacker.example') },
    { ...operation(), cancelUrl: submitBody().cancel_url.replace(BASE, 'https://user:pass@queue.fal.run') },
    { ...operation(), requestId: '../other' },
    { ...operation(), requestId: 'different-request' },
    { ...operation(), modelId: FAL_SOUND_EFFECT_MODEL },
    { ...operation(), version: 2 },
    { ...operation(), statusUrl: `${BASE}/${FAL_THREE_D_MODEL}/requests/${REQUEST_ID}/status` },
    { ...operation(), statusUrl: `${submitBody().status_url}#fragment` },
    { ...operation(), responseUrl: submitBody().response_url.replace(REQUEST_ID, '%2e%2e') },
  ];
  for (const handle of invalid) {
    await assert.rejects(model.doStatus(operationOptions(handle)), TypeError);
    await assert.rejects(model.doCancel(operationOptions(handle)), TypeError);
  }
  assert.equal(wire.calls.length, 0);
});

test('untrusted submit/status response URLs cannot move authenticated result reads to another origin', async () => {
  const wire = scripted(
    json({ ...submitBody(), response_url: 'https://attacker.example/result' }),
    json({ status: 'COMPLETED', response_url: 'https://attacker.example/result' }),
  );
  const model = createFalAssetProvider({ apiKey: 'test:key', fetch: wire.fetch }).threeD();
  await assert.rejects(model.doStart(startOptions()), error => APICallError.isInstance(error) && !error.isRetryable && /baseURL origin/.test(error.message));
  await assert.rejects(model.doStatus(operationOptions()), error => APICallError.isInstance(error) && !error.isRetryable && /baseURL origin/.test(error.message));
  assert.equal(wire.calls.length, 2);
  assert.ok(wire.calls.every(call => new URL(call.url).origin === BASE));
});

test('fal rejects redirect responses as well as requesting redirect:error', async () => {
  const redirected = json({ status: 'COMPLETED' });
  Object.defineProperty(redirected, 'url', { value: 'https://attacker.example/status' });
  Object.defineProperty(redirected, 'redirected', { value: true });
  const wire = scripted(redirected, new Response('', { status: 302, headers: { location: 'https://attacker.example/result' } }));
  const model = createFalAssetProvider({ apiKey: 'test:key', fetch: wire.fetch }).threeD();
  await assert.rejects(model.doStatus(operationOptions()), error => APICallError.isInstance(error) && !error.isRetryable && /redirect/.test(error.message));
  await assert.rejects(model.doStatus(operationOptions()), error => APICallError.isInstance(error) && error.statusCode === 302 && !error.isRetryable);
  assert.equal(wire.calls.length, 2);
  assert.ok(wire.calls.every(call => call.redirect === 'error'));
});

test('invalid provider JSON, unknown states, request mismatches, and malformed assets are explicit nonretryable API errors', async () => {
  const wire = scripted(
    new Response('{invalid', { status: 200 }),
    json({ status: 'SOMETHING_NEW' }),
    json({ status: 'IN_PROGRESS', request_id: 'wrong' }),
    json({ status: 'COMPLETED' }), json({ model_glb: { url: 'file:///etc/passwd' } }),
    json({ status: 'COMPLETED' }), json({}),
    json({ ...submitBody(), request_id: '' }),
  );
  const model = createFalAssetProvider({ apiKey: 'test:key', fetch: wire.fetch }).threeD();
  for (let index = 0; index < 5; index++) {
    await assert.rejects(model.doStatus(operationOptions()), error => APICallError.isInstance(error) && !error.isRetryable);
  }
  await assert.rejects(model.doStart(startOptions()), error => APICallError.isInstance(error) && !error.isRetryable);
  assert.equal(wire.calls.length, 8);
});

test('custom proxy base paths are used consistently for submit and returned queue URLs', async () => {
  const baseURL = 'https://proxy.example/api/queue';
  const wire = scripted(json(submitBody(FAL_THREE_D_MODEL, baseURL)), json({ status: 'IN_PROGRESS' }));
  const settings = { apiKey: 'test:key', baseURL: `${baseURL}/`, fetch: wire.fetch, headers: { 'x-app': 'first' } };
  const fal = createFalAssetProvider(settings);
  settings.baseURL = 'https://attacker.example';
  settings.headers['x-app'] = 'second';
  const model = fal.threeD();
  const started = await model.doStart(startOptions());
  await model.doStatus(operationOptions(started.operation));
  assert.equal(wire.calls[0].url, `${baseURL}/${FAL_THREE_D_MODEL}`);
  assert.equal(wire.calls[1].url, submitBody(FAL_THREE_D_MODEL, baseURL).status_url);
  assert.equal(wire.calls[0].headers.get('x-app'), 'first');
});

test('invalid model paths, base URLs, and webhook URLs fail locally', async () => {
  const wire = scripted();
  const fal = createFalAssetProvider({ apiKey: 'test:key', fetch: wire.fetch });
  for (const modelId of ['https://attacker.example/model', 'fal-ai/../model', '/fal-ai/model', 'fal-ai/model?steal=1', 'fal-ai/model/%2e%2e', 'model']) {
    assert.throws(() => fal.threeD(modelId), TypeError);
  }
  for (const baseURL of ['file:///tmp', 'https://user:pass@queue.fal.run', `${BASE}?token=secret`]) {
    assert.throws(() => createFalAssetProvider({ baseURL }).threeD(), TypeError);
  }
  for (const webhookUrl of ['javascript:alert(1)', 'https://user:pass@sine.example/callback', 'relative/path']) {
    await assert.rejects(fal.threeD().doStart(startOptions(undefined, { webhookUrl })), TypeError);
  }
  assert.equal(wire.calls.length, 0);
});
