import assert from 'node:assert/strict';
import test from 'node:test';
import { APICallError } from '@ai-sdk/provider';
import { cancelAsset, getAssetStatus, startAsset, waitForAsset } from '@sinestack/ai-core';
import {
  createReplicateAssetProvider, ReplicateAssetModel,
} from '@sinestack/ai-replicate';

const MUSIC_MODEL = 'future-lab/new-music-model';
const THREE_D_MODEL = 'future-lab/new-3d-model';
const BASE = 'https://api.replicate.com/v1';
const ID = 'gm3qorzdhgbfurvjtvhg6dckhu';
const VERSION = 'a'.repeat(64);
const MUSIC_URL = 'https://replicate.delivery/example/song.wav';
const MODEL_URL = 'https://replicate.delivery/example/model.glb';

function json(value, status = 200, headers = {}) {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json', ...headers } });
}

function prediction(status = 'starting', extra = {}) {
  return { id: ID, model: MUSIC_MODEL, version: 'hidden', status, ...extra };
}

function operation(extra = {}) {
  return {
    type: 'replicate-prediction', version: 1, modelId: MUSIC_MODEL,
    baseURL: BASE, predictionId: ID, modelVersion: 'hidden', ...extra,
  };
}

function startOptions(input = { prompt: 'Gentle ambient piano', is_instrumental: true }, extra = {}) {
  return {
    input, providerOptions: {}, headers: {}, abortSignal: new AbortController().signal,
    idempotencyKey: 'logical-start', ...extra,
  };
}

function operationOptions(value = operation(), extra = {}) {
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
      assert.ok(step, `Unexpected provider call: ${call.method} ${call.url}`);
      return typeof step === 'function' ? await step(call) : step;
    },
  };
}

function genericDefinition(extra = {}) {
  return {
    kind: 'document',
    mapInput: input => input,
    mapResult: output => ({ assets: [{ type: 'url', url: output.file, mediaType: 'application/pdf' }] }),
    ...extra,
  };
}

test('Replicate official submission makes one native POST with protected credentials and completed webhooks', async () => {
  const wire = scripted(json(prediction(), 201));
  const model = createReplicateAssetProvider({ apiKey: 'test-token', fetch: wire.fetch, headers: { 'x-app': 'sinestack' }, name: 'replicate-test' }).music(MUSIC_MODEL);
  const options = startOptions(undefined, {
    providerOptions: { replicate: { audio_format: 'wav', sample_rate: 44100, bitrate: 128000 } },
    headers: { 'x-request': 'one', Authorization: 'must-not-override' },
    webhookUrl: 'https://app.example/webhook?task=1',
  });
  const started = await model.doStart(options);
  assert.equal(model.provider, 'replicate-test');
  assert.equal(model.specificationVersion, 'v1');
  assert.equal(model.kind, 'music');
  assert.deepEqual(model.capabilities, { idempotentStart: false, webhooks: true });
  assert.deepEqual(started.operation, operation());
  assert.equal(started.providerMetadata.replicate.predictionId, ID);
  assert.equal(wire.calls.length, 1);
  const [call] = wire.calls;
  assert.equal(call.url, `${BASE}/models/${MUSIC_MODEL}/predictions`);
  assert.equal(call.method, 'POST');
  assert.equal(call.redirect, 'error');
  assert.equal(call.signal, options.abortSignal);
  assert.equal(call.headers.get('authorization'), 'Bearer test-token');
  assert.equal(call.headers.get('x-app'), 'sinestack');
  assert.equal(call.headers.get('x-request'), 'one');
  assert.equal(call.headers.has('prefer'), false);
  assert.equal(call.headers.has('idempotency-key'), false);
  assert.deepEqual(JSON.parse(call.body), {
    input: { prompt: 'Gentle ambient piano', is_instrumental: true, audio_format: 'wav', sample_rate: 44100, bitrate: 128000 },
    webhook: options.webhookUrl, webhook_events_filter: ['completed'],
  });
  assert.equal(JSON.stringify(started.operation).includes('test-token'), false);
});

test('Replicate fixed versions use /predictions and survive serialized operation recovery', async () => {
  const wire = scripted(
    json(prediction('starting', { model: 'my-org/pdf-model', version: VERSION })),
    json(prediction('succeeded', { model: 'my-org/pdf-model', version: VERSION, output: { file: 'https://cdn.example/report.pdf' } })),
  );
  const provider = createReplicateAssetProvider({ apiKey: 'test-token', fetch: wire.fetch });
  const model = provider.asset(`my-org/pdf-model:${VERSION}`, genericDefinition());
  const started = await model.doStart(startOptions({ text: 'hello', extra: [1, { nested: true }] }));
  assert.equal(wire.calls[0].url, `${BASE}/predictions`);
  assert.deepEqual(JSON.parse(wire.calls[0].body), { version: VERSION, input: { text: 'hello', extra: [1, { nested: true }] } });
  assert.equal(started.operation.modelVersion, VERSION);
  const restored = provider.asset(`my-org/pdf-model:${VERSION}`, genericDefinition());
  const status = await restored.doStatus(operationOptions(JSON.parse(JSON.stringify(started.operation))));
  assert.equal(status.status, 'completed');
  assert.equal(status.result.assets[0].mediaType, 'application/pdf');
  assert.equal(wire.calls[1].url, `${BASE}/predictions/${ID}`);
});

test('Replicate definition.version selects fixed predictions and rejects conflicting versions', async () => {
  const wire = scripted(json(prediction('starting', { model: 'org/model', version: VERSION })));
  const provider = createReplicateAssetProvider({ apiKey: 'test-token', fetch: wire.fetch });
  const model = provider.asset('org/model', genericDefinition({ version: VERSION }));
  const started = await model.doStart(startOptions({ payload: 1 }));
  assert.equal(JSON.parse(wire.calls[0].body).version, VERSION);
  assert.equal(started.operation.modelId, 'org/model');
  assert.throws(() => provider.asset(`org/model:${VERSION}`, genericDefinition({ version: 'b'.repeat(64) })), /conflicts/);
  for (const version of ['short', VERSION.toUpperCase(), '', 123]) {
    assert.throws(() => provider.asset('org/model', genericDefinition({ version })), /version/);
  }
});

test('Replicate requires an explicit safe model ID without a catalog or mandatory mappings', () => {
  const provider = createReplicateAssetProvider({ apiKey: 'test-token' });
  for (const modelId of [undefined, null, 123, '', 'one', '/org/model', 'org/../model', 'org/model/path', 'org/model?x=1', 'org/model#x', 'org/model:short', 'org/%2e%2e']) {
    assert.throws(() => provider.asset(modelId, genericDefinition()), /modelId/);
  }
  for (const [method, kind] of [['music', 'music'], ['threeD', 'model-3d'], ['soundEffect', 'sound-effect'], ['animation3D', 'animation-3d']]) {
    assert.equal(provider[method]('new-org/new-model').kind, kind);
    assert.equal(provider[method]('new-org/new-model').modelId, 'new-org/new-model');
    assert.throws(() => provider[method](), /modelId/);
  }
  assert.throws(() => provider.asset('org/model', genericDefinition({ kind: '' })), /kind/);
  assert.equal(provider.asset('org/model', { kind: 'document' }).modelId, 'org/model');
  for (const mapping of [{ mapInput: null }, { mapInput: 'function' }, { mapResult: false }]) {
    assert.throws(() => provider.asset('org/model', { kind: 'document', ...mapping }), /must be a function when provided/);
  }
});

test('Replicate keeps arbitrary model input native and protects fields produced by mapInput', async () => {
  const wire = scripted(json(prediction('starting', { model: 'org/model' })));
  const model = createReplicateAssetProvider({ apiKey: 'test-token', fetch: wire.fetch }).asset('org/model', genericDefinition());
  await model.doStart(startOptions({ text: 'original', controls: [0, false, null] }, {
    providerOptions: { replicate: { quality: 9, version: 'native-model-field' } },
  }));
  assert.deepEqual(JSON.parse(wire.calls[0].body), { input: { text: 'original', controls: [0, false, null], quality: 9, version: 'native-model-field' } });
  await assert.rejects(model.doStart(startOptions({ text: 'original' }, { providerOptions: { replicate: { text: 'replacement' } } })), /cannot override/);
  assert.equal(wire.calls.length, 1);
});

test('Replicate rejects invalid JSON and field accessors before any network request', async () => {
  const wire = scripted();
  const model = createReplicateAssetProvider({ apiKey: 'test-token', fetch: wire.fetch }).asset('org/model', { kind: 'document' });
  const circular = {}; circular.self = circular;
  let getterCalls = 0;
  const accessor = Object.defineProperty({}, 'field', { enumerable: true, get() { getterCalls++; return 1; } });
  for (const input of [{ invalid: Infinity }, { invalid: BigInt(1) }, { invalid: new Date() }, circular, accessor, { values: [1, , 3] }]) {
    await assert.rejects(model.doStart(startOptions(input)), TypeError);
  }
  assert.equal(getterCalls, 0);
  assert.equal(wire.calls.length, 0);
});

test('Replicate generic asset needs no mappings for native JSON and common file references', async () => {
  const nativeOutput = [
    'https://cdn.example/report.pdf',
    { preview: { url: 'https://cdn.example/preview.png', file_name: 'cover.png', file_size: 42 } },
  ];
  const wire = scripted(
    json(prediction('starting', { model: 'unlisted/report-generator' })),
    json(prediction('succeeded', { model: 'unlisted/report-generator', output: nativeOutput })),
  );
  const provider = createReplicateAssetProvider({ apiKey: 'test-token', fetch: wire.fetch });
  const model = provider.asset('unlisted/report-generator', { kind: 'document' });
  const started = await startAsset({ model, input: { title: 'Report', sections: ['A', 'B'], render: { format: 'pdf' } } });
  const restored = provider.asset('unlisted/report-generator', { kind: 'document' });
  const status = await getAssetStatus({ model: restored, operation: JSON.parse(JSON.stringify(started.operation)) });
  assert.equal(status.status, 'completed');
  assert.deepEqual(status.result.assets.map(file => file.url), ['https://cdn.example/report.pdf', 'https://cdn.example/preview.png']);
  assert.equal(status.result.assets[0].mediaType, 'application/pdf');
  assert.equal(status.result.assets[1].filename, 'cover.png');
  assert.deepEqual(status.result.providerMetadata.replicate.output, nativeOutput);
  assert.deepEqual(JSON.parse(wire.calls[0].body).input, { title: 'Report', sections: ['A', 'B'], render: { format: 'pdf' } });
  assert.deepEqual(wire.calls.map(call => call.method), ['POST', 'GET']);
});

test('Replicate capability helpers forward arbitrary native model input without preset schema gates', async () => {
  const cases = [
    ['music', 'music', { text: '', seconds: 3600, lyrics: 'x'.repeat(4000), instrumental: 'model-owned-enum' }],
    ['threeD', 'model-3d', { image: 'https://cdn.example/input.png', face_count: 12.5, generate_type: 'FutureGeometry' }],
    ['soundEffect', 'sound-effect', { audio: ['https://cdn.example/source.wav'], operation: 'transform', quality: 17 }],
    ['animation3D', 'animation-3d', { skeleton: { joints: [1, 2, 3] }, frames: 2000, controls: [false, null] }],
  ];
  const wire = scripted(...cases.map(([method]) => json(prediction('starting', { model: `future-org/${method}-v99` }))));
  const provider = createReplicateAssetProvider({ apiKey: 'test-token', fetch: wire.fetch });
  for (const [index, [method, kind, input]] of cases.entries()) {
    const model = provider[method](`future-org/${method}-v99`);
    const started = await model.doStart(startOptions(input, { providerOptions: { replicate: { additional_native_flag: true } } }));
    assert.equal(model.kind, kind);
    assert.equal(started.operation.modelId, `future-org/${method}-v99`);
    assert.equal(wire.calls[index].url, `${BASE}/models/future-org/${method}-v99/predictions`);
    assert.deepEqual(JSON.parse(wire.calls[index].body).input, { ...input, additional_native_flag: true });
  }
  assert.equal(wire.calls.length, 4);
});

test('Replicate accepts independent injected input and result mappings on capability helpers', async () => {
  const wire = scripted(
    json(prediction('starting', { model: 'my-org/custom-sound' })),
    json(prediction('succeeded', { model: 'my-org/custom-sound', output: MUSIC_URL })),
    json(prediction('starting', { model: 'my-org/custom-motion' })),
    json(prediction('succeeded', { model: 'my-org/custom-motion', output: { animation_uri: 'https://cdn.example/motion.fbx' } })),
  );
  const provider = createReplicateAssetProvider({ apiKey: 'test-token', fetch: wire.fetch });
  const sound = provider.soundEffect('my-org/custom-sound', {
    mapInput: ({ description, length }) => ({ text: description, duration_seconds: length }),
  });
  const soundStarted = await sound.doStart(startOptions({ description: 'A soft bell', length: 3 }));
  assert.deepEqual(JSON.parse(wire.calls[0].body).input, { text: 'A soft bell', duration_seconds: 3 });
  const soundResult = await sound.doStatus(operationOptions(soundStarted.operation));
  assert.equal(soundResult.result.assets[0].url, MUSIC_URL);

  const motion = provider.animation3D('my-org/custom-motion', {
    mapResult: output => ({ assets: [{ type: 'url', url: output.animation_uri, mediaType: 'application/octet-stream', role: 'motion' }] }),
  });
  const motionStarted = await motion.doStart(startOptions({ skeleton: 'humanoid', frames: 180 }));
  assert.deepEqual(JSON.parse(wire.calls[2].body).input, { skeleton: 'humanoid', frames: 180 });
  const motionResult = await motion.doStatus(operationOptions(motionStarted.operation));
  assert.equal(motionResult.result.assets[0].role, 'motion');
  assert.deepEqual(motionResult.result.providerMetadata.replicate.output, { animation_uri: 'https://cdn.example/motion.fbx' });
});

test('Replicate requires HTTPS callbacks without credentials or fragments', async () => {
  const wire = scripted();
  const model = createReplicateAssetProvider({ apiKey: 'test-token', fetch: wire.fetch }).music(MUSIC_MODEL);
  for (const webhookUrl of ['http://app.example/hook', 'https://user:pass@app.example/hook', 'https://app.example/hook#fragment', 'javascript:alert(1)']) {
    await assert.rejects(model.doStart(startOptions(undefined, { webhookUrl })), TypeError);
  }
  assert.equal(wire.calls.length, 0);
});

test('Replicate preserves a configured proxy path and snapshots caller-owned configuration', async () => {
  const wire = scripted(json(prediction()), json(prediction('processing')));
  const settings = { apiKey: 'original-key', baseURL: 'https://proxy.example/replicate/v1/', headers: { 'x-app': 'original' }, name: 'original', fetch: wire.fetch };
  const provider = createReplicateAssetProvider(settings);
  settings.apiKey = 'mutated'; settings.baseURL = 'https://evil.example'; settings.headers['x-app'] = 'mutated'; settings.name = 'mutated';
  const model = provider.music(MUSIC_MODEL);
  const started = await model.doStart(startOptions());
  await model.doStatus(operationOptions(started.operation));
  assert.equal(model.provider, 'original');
  assert.equal(started.operation.baseURL, 'https://proxy.example/replicate/v1');
  assert.equal(wire.calls[0].url, `https://proxy.example/replicate/v1/models/${MUSIC_MODEL}/predictions`);
  assert.equal(wire.calls[1].url, `https://proxy.example/replicate/v1/predictions/${ID}`);
  for (const call of wire.calls) {
    assert.equal(call.headers.get('authorization'), 'Bearer original-key');
    assert.equal(call.headers.get('x-app'), 'original');
  }
});

test('Replicate class construction snapshots configuration and definition callbacks', async () => {
  const wire = scripted(json(prediction('starting', { model: 'org/model' })));
  const settings = { apiKey: 'original', fetch: wire.fetch, headers: { 'x-original': 'yes' } };
  const definition = genericDefinition();
  const model = new ReplicateAssetModel('org/model', settings, definition);
  settings.apiKey = 'mutated'; settings.headers['x-original'] = 'no';
  definition.mapInput = () => { throw new Error('mutated mapping'); };
  await model.doStart(startOptions({ text: 'original' }));
  assert.equal(wire.calls[0].headers.get('authorization'), 'Bearer original');
  assert.equal(wire.calls[0].headers.get('x-original'), 'yes');
});

test('Replicate accepts class mapping services and snapshots bound methods and fixed versions', async () => {
  for (const [factory, expectedKind] of [
    ['music', 'music'], ['threeD', 'model-3d'], ['soundEffect', 'sound-effect'],
    ['animation3D', 'animation-3d'], ['asset', 'document'], ['constructor', 'document'],
  ]) {
    class MappingService {
      #prefix = 'mapped';
      #mediaType = 'application/pdf';
      #version = VERSION;
      get kind() { return 'document'; }
      get version() { return this.#version; }
      async mapInput(input) { return { description: `${this.#prefix}:${input.text}` }; }
      async mapResult(output) {
        return { assets: [{ type: 'url', url: output.delivery, mediaType: this.#mediaType }] };
      }
    }
    const wire = scripted(
      json(prediction('starting', { model: 'org/service-model', version: VERSION })),
      json(prediction('succeeded', { model: 'org/service-model', version: VERSION, output: { delivery: 'https://cdn.example/report.pdf' } })),
    );
    const settings = { apiKey: 'test-token', fetch: wire.fetch };
    const provider = createReplicateAssetProvider(settings);
    const service = new MappingService();
    const model = factory === 'constructor'
      ? new ReplicateAssetModel('org/service-model', settings, service)
      : provider[factory]('org/service-model', service);

    service.mapInput = () => { throw new Error('Replaced instance method must not run.'); };
    MappingService.prototype.mapResult = () => { throw new Error('Replaced prototype method must not run.'); };
    Object.defineProperty(service, 'version', { value: 'b'.repeat(64) });

    const started = await model.doStart(startOptions({ text: 'hello' }));
    const status = await model.doStatus(operationOptions(started.operation));
    assert.equal(model.kind, expectedKind);
    assert.equal(wire.calls[0].url, `${BASE}/predictions`);
    assert.deepEqual(JSON.parse(wire.calls[0].body), { version: VERSION, input: { description: 'mapped:hello' } });
    assert.equal(started.operation.modelVersion, VERSION);
    assert.equal(status.status, 'completed');
    assert.deepEqual(status.result.assets, [{ type: 'url', url: 'https://cdn.example/report.pdf', mediaType: 'application/pdf' }]);
  }
});

test('Replicate validates resumed operation identity before credentials or network access', async () => {
  const wire = scripted();
  const model = createReplicateAssetProvider({ fetch: wire.fetch }).music(MUSIC_MODEL);
  for (const patch of [
    { type: 'other' }, { version: 2 }, { modelId: 'different/model' },
    { baseURL: 'https://evil.example/v1' }, { baseURL: `${BASE}/nested` },
    { predictionId: '../secret' }, { predictionId: `${ID}?x=1` }, { modelVersion: '' },
  ]) {
    await assert.rejects(model.doStatus(operationOptions(operation(patch))), TypeError);
    await assert.rejects(model.doCancel(operationOptions(operation(patch))), TypeError);
  }
  const fixed = createReplicateAssetProvider({ fetch: wire.fetch }).asset('org/model', genericDefinition({ version: VERSION }));
  await assert.rejects(fixed.doStatus(operationOptions(operation({ modelId: 'org/model' }))), /modelVersion/);
  assert.equal(wire.calls.length, 0);
});

test('Replicate status and cancellation URLs are derived from the original connection, never remote urls', async () => {
  const wire = scripted(
    json(prediction('starting', { urls: { get: 'https://evil.example/secret', cancel: 'https://evil.example/cancel' } })),
    json(prediction('processing', { urls: { get: 'https://evil.example/secret' } })),
    json(prediction('canceled')),
  );
  const model = createReplicateAssetProvider({ apiKey: 'test-token', fetch: wire.fetch }).music(MUSIC_MODEL);
  const started = await model.doStart(startOptions());
  await model.doStatus(operationOptions(started.operation));
  await model.doCancel(operationOptions(started.operation));
  assert.deepEqual(wire.calls.map(call => call.url), [
    `${BASE}/models/${MUSIC_MODEL}/predictions`, `${BASE}/predictions/${ID}`, `${BASE}/predictions/${ID}/cancel`,
  ]);
});

test('Replicate maps only documented statuses and makes a single request for each observation', async () => {
  const wire = scripted(json(prediction('starting')), json(prediction('processing')), json(prediction('failed', { error: 'Generation rejected' })), json(prediction('canceled')));
  const model = createReplicateAssetProvider({ apiKey: 'test-token', fetch: wire.fetch }).music(MUSIC_MODEL);
  assert.equal((await model.doStatus(operationOptions())).status, 'pending');
  assert.equal((await model.doStatus(operationOptions())).status, 'running');
  assert.deepEqual(await model.doStatus(operationOptions()), { status: 'failed', error: { message: 'Generation rejected' } });
  assert.deepEqual(await model.doStatus(operationOptions()), { status: 'cancelled' });
  assert.equal(wire.calls.length, 4);
  assert.ok(wire.calls.every(call => call.method === 'GET'));
});

test('Replicate success preserves output without putting prediction inputs, logs or URLs in metadata', async () => {
  const wire = scripted(json(prediction('succeeded', {
    output: MUSIC_URL, input: { private: 'input' }, logs: 'internal log', urls: { get: 'internal' },
  })));
  const model = createReplicateAssetProvider({ apiKey: 'test-token', fetch: wire.fetch }).music(MUSIC_MODEL);
  const status = await model.doStatus(operationOptions());
  assert.equal(status.status, 'completed');
  assert.deepEqual(status.result.assets, [{ type: 'url', url: MUSIC_URL, mediaType: 'audio/wav' }]);
  assert.deepEqual(status.result.providerMetadata, { replicate: { predictionId: ID, output: MUSIC_URL } });
  assert.equal(wire.calls.length, 1, 'URL output is not downloaded');
});

test('Replicate native output remains intact when a custom async result mapper mutates its input', async () => {
  const native = { file: 'https://cdn.example/report.pdf', nested: { value: 1 }, list: [1, 'caption', null] };
  const wire = scripted(json(prediction('succeeded', { model: 'org/model', output: native })));
  const model = createReplicateAssetProvider({ apiKey: 'test-token', fetch: wire.fetch }).asset('org/model', genericDefinition({
    async mapResult(output) {
      assert.deepEqual(output, native);
      output.nested.value = 2;
      await Promise.resolve();
      return {
        assets: [{ type: 'url', url: output.file, mediaType: 'application/pdf' }],
        providerMetadata: { replicate: { output: 'cannot replace', predictionId: 'cannot replace', custom: true } },
      };
    },
  }));
  const status = await model.doStatus(operationOptions(operation({ modelId: 'org/model' })));
  assert.deepEqual(status.result.providerMetadata.replicate, { custom: true, predictionId: ID, output: native });
  assert.deepEqual(status.result.response.body.output, native);
});

test('Replicate preserves array native output and requires the custom mapper to select actual files', async () => {
  const output = ['https://cdn.example/a.glb', { file: 'https://cdn.example/texture.png', caption: 'Native metadata' }];
  const wire = scripted(json(prediction('succeeded', { model: 'org/model', output })));
  const model = createReplicateAssetProvider({ apiKey: 'test-token', fetch: wire.fetch }).asset('org/model', genericDefinition({
    kind: 'model-3d',
    mapResult: raw => ({ assets: [
      { type: 'url', url: raw[0], mediaType: 'model/gltf-binary', role: 'model' },
      { type: 'url', url: raw[1].file, mediaType: 'image/png', role: 'texture' },
    ] }),
  }));
  const status = await model.doStatus(operationOptions(operation({ modelId: 'org/model' })));
  assert.deepEqual(status.result.providerMetadata.replicate.output, output);
  assert.equal(status.result.assets.length, 2);
});

test('Replicate 3D results retain real file references and unknown formats are not guessed', async () => {
  const wire = scripted(
    json(prediction('succeeded', { model: THREE_D_MODEL, output: MODEL_URL })),
    json(prediction('succeeded', { model: THREE_D_MODEL, output: 'https://cdn.example/download?id=1' })),
    json(prediction('succeeded', { output: 'https://cdn.example/music.pcm' })),
  );
  const provider = createReplicateAssetProvider({ apiKey: 'test-token', fetch: wire.fetch });
  const op = operationOptions(operation({ modelId: THREE_D_MODEL }));
  assert.equal((await provider.threeD(THREE_D_MODEL).doStatus(op)).result.assets[0].mediaType, 'model/gltf-binary');
  assert.equal((await provider.threeD(THREE_D_MODEL).doStatus(op)).result.assets[0].mediaType, 'application/octet-stream');
  const audio = (await provider.music(MUSIC_MODEL).doStatus(operationOptions())).result.assets[0];
  assert.equal(audio.mediaType, 'application/octet-stream');
  assert.equal(audio.metadata, undefined);
});

test('Replicate rejects incomplete or mismatched prediction responses without retryable errors', async () => {
  for (const value of [
    {}, prediction('starting', { id: undefined }), prediction('starting', { id: '../invalid' }),
    prediction('starting', { model: 'different/model' }), prediction('starting', { version: '' }),
    prediction('queued'), prediction(undefined, { status: undefined }),
  ]) {
    const wire = scripted(json(value));
    const model = createReplicateAssetProvider({ apiKey: 'test-token', fetch: wire.fetch }).music(MUSIC_MODEL);
    await assert.rejects(model.doStart(startOptions()), error => APICallError.isInstance(error) && error.isRetryable === false);
    assert.equal(wire.calls.length, 1);
  }
  for (const extra of [{ id: 'different' }, { model: 'different/model' }, { version: 'different' }]) {
    const wire = scripted(json(prediction('processing', extra)));
    const model = createReplicateAssetProvider({ apiKey: 'test-token', fetch: wire.fetch }).music(MUSIC_MODEL);
    await assert.rejects(model.doStatus(operationOptions()), error => APICallError.isInstance(error) && error.isRetryable === false);
  }
});

test('Replicate validates fixed version acknowledgement before accepting a submit receipt', async () => {
  const wire = scripted(json(prediction('starting', { model: 'org/model', version: 'b'.repeat(64) })));
  const model = createReplicateAssetProvider({ apiKey: 'test-token', fetch: wire.fetch }).asset(`org/model:${VERSION}`, genericDefinition());
  await assert.rejects(model.doStart(startOptions({ prompt: 'test' })), /version does not match/);
  assert.equal(wire.calls.length, 1);
});

test('Replicate does not treat removed output, text, malformed URLs or empty mapping as generated files', async () => {
  for (const output of [undefined, null, 'a song with no file', 'file:///private/music.wav', 'https://user:pass@cdn.example/music.wav', {}]) {
    const wire = scripted(json(prediction('succeeded', { output })));
    const model = createReplicateAssetProvider({ apiKey: 'test-token', fetch: wire.fetch }).music(MUSIC_MODEL);
    await assert.rejects(model.doStatus(operationOptions()), error => APICallError.isInstance(error) && error.isRetryable === false);
  }
  const wire = scripted(json(prediction('succeeded', { model: 'org/model', output: { text: 'no files' } })));
  const model = createReplicateAssetProvider({ apiKey: 'test-token', fetch: wire.fetch }).asset('org/model', genericDefinition({ mapResult: () => ({ assets: [] }) }));
  await assert.rejects(model.doStatus(operationOptions(operation({ modelId: 'org/model' }))), /at least one real asset/);
});

test('Replicate cancellation distinguishes a request from observed cancellation and handles terminal races honestly', async () => {
  const wire = scripted(json(prediction('processing')), json(prediction('canceled')), json(prediction('succeeded', { output: MUSIC_URL })), json(prediction('failed', { error: 'failed earlier' })));
  const model = createReplicateAssetProvider({ apiKey: 'test-token', fetch: wire.fetch }).music(MUSIC_MODEL);
  assert.equal((await model.doCancel(operationOptions())).status, 'requested');
  assert.equal((await model.doCancel(operationOptions())).status, 'cancelled');
  await assert.rejects(model.doCancel(operationOptions()), /already succeeded/);
  await assert.rejects(model.doCancel(operationOptions()), /already failed/);
  assert.ok(wire.calls.every(call => call.method === 'POST' && call.url === `${BASE}/predictions/${ID}/cancel`));
  assert.equal(wire.calls.length, 4);
});

test('Replicate cancellation validates prediction identity and does not accept malformed acknowledgements', async () => {
  for (const value of [{}, prediction('canceled', { id: 'other' }), prediction('canceled', { model: 'org/other' })]) {
    const wire = scripted(json(value));
    const model = createReplicateAssetProvider({ apiKey: 'test-token', fetch: wire.fetch }).music(MUSIC_MODEL);
    await assert.rejects(model.doCancel(operationOptions()), error => APICallError.isInstance(error) && !error.isRetryable);
  }
});

test('Replicate rejects redirects and never follows them with its credential', async () => {
  for (const response of [
    new Response(null, { status: 302, headers: { location: 'https://evil.example' } }),
    Object.defineProperty(json(prediction()), 'redirected', { value: true }),
    Object.defineProperty(json(prediction()), 'url', { value: 'https://evil.example' }),
  ]) {
    const wire = scripted(response);
    const model = createReplicateAssetProvider({ apiKey: 'test-token', fetch: wire.fetch }).music(MUSIC_MODEL);
    await assert.rejects(model.doStart(startOptions()));
    assert.equal(wire.calls.length, 1);
    assert.equal(wire.calls[0].redirect, 'error');
  }
});

test('Replicate HTTP status errors use SDK classification and keep Retry-After', async () => {
  for (const [code, retryable] of [[400, false], [401, false], [408, true], [409, true], [429, true], [503, true]]) {
    const wire = scripted(json({ detail: `HTTP ${code}` }, code, { 'retry-after': '1' }));
    const model = createReplicateAssetProvider({ apiKey: 'test-token', fetch: wire.fetch }).music(MUSIC_MODEL);
    await assert.rejects(model.doStatus(operationOptions()), error => {
      assert.ok(APICallError.isInstance(error));
      assert.equal(error.isRetryable, retryable);
      assert.equal(error.responseHeaders['retry-after'], '1');
      return true;
    });
    assert.equal(wire.calls.length, 1);
  }
});

test('Replicate does not retry a rejected or uncertain paid submission through shared core', async () => {
  for (const response of [json({ detail: 'temporarily unavailable' }, 503), new Response('{malformed', { status: 201 })]) {
    const wire = scripted(response);
    const model = createReplicateAssetProvider({ apiKey: 'test-token', fetch: wire.fetch }).music(MUSIC_MODEL);
    await assert.rejects(startAsset({ model, input: { prompt: 'Ambient', is_instrumental: true } }));
    assert.equal(wire.calls.length, 1);
  }
  const wire = scripted();
  const model = createReplicateAssetProvider({ apiKey: 'test-token', fetch: wire.fetch }).music(MUSIC_MODEL);
  await assert.rejects(startAsset({ model, input: { prompt: 'Ambient', is_instrumental: true }, retry: { start: 1 } }), /idempotent/);
  assert.equal(wire.calls.length, 0);
});

test('Replicate resumes status retry through shared core without resubmitting a prediction', async () => {
  const wire = scripted(
    json(prediction(), 201),
    json({ detail: 'rate limited' }, 429, { 'retry-after': '0' }),
    json(prediction('succeeded', { output: MUSIC_URL })),
  );
  const model = createReplicateAssetProvider({ apiKey: 'test-token', fetch: wire.fetch }).music(MUSIC_MODEL);
  const started = await startAsset({ model, input: { prompt: 'Ambient', is_instrumental: true } });
  const status = await getAssetStatus({ model, operation: JSON.parse(JSON.stringify(started.operation)) });
  assert.equal(status.status, 'completed');
  assert.deepEqual(wire.calls.map(call => call.method), ['POST', 'GET', 'GET']);
});

test('Replicate wait and explicit cancel share the existing core operation envelope', async () => {
  const wire = scripted(json(prediction()), json(prediction('processing')), json(prediction('succeeded', { output: MUSIC_URL })), json(prediction('canceled')));
  const model = createReplicateAssetProvider({ apiKey: 'test-token', fetch: wire.fetch }).music(MUSIC_MODEL);
  const started = await startAsset({ model, input: { prompt: 'Ambient', is_instrumental: true } });
  const result = await waitForAsset({ model, operation: started.operation, poll: { delay: async () => {} } });
  assert.equal(result.asset.url, MUSIC_URL);
  assert.equal(result.operation.operation.predictionId, ID);
  const cancelled = await cancelAsset({ model, operation: started.operation });
  assert.equal(cancelled.status, 'cancelled');
  assert.deepEqual(wire.calls.map(call => call.method), ['POST', 'GET', 'GET', 'POST']);
});

test('Replicate propagates pre-abort and fetch cancellation without initiating remote cancellation', async () => {
  const controller = new AbortController();
  const reason = new Error('stop'); controller.abort(reason);
  const wire = scripted();
  const model = createReplicateAssetProvider({ apiKey: 'test-token', fetch: wire.fetch }).music(MUSIC_MODEL);
  await assert.rejects(model.doStart(startOptions(undefined, { abortSignal: controller.signal })), error => error === reason);
  await assert.rejects(model.doStatus(operationOptions(undefined, { abortSignal: controller.signal })), error => error === reason);
  assert.equal(wire.calls.length, 0);

  const during = new AbortController();
  const pending = scripted(call => new Promise((resolve, reject) => {
    call.signal.addEventListener('abort', () => reject(call.signal.reason), { once: true });
    queueMicrotask(() => during.abort(reason));
  }));
  const active = createReplicateAssetProvider({ apiKey: 'test-token', fetch: pending.fetch }).music(MUSIC_MODEL);
  await assert.rejects(active.doStatus(operationOptions(undefined, { abortSignal: during.signal })), error => error === reason);
  assert.equal(pending.calls.length, 1);
  assert.equal(pending.calls[0].method, 'GET');
});
