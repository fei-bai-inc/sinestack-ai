import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate as nextTurn, setTimeout as sleep } from 'node:timers/promises';
import { APICallError } from '@ai-sdk/provider';
import { RetryError } from 'ai';
import { mergeAbortSignals, mergeCallbacks, prepareRetries } from 'ai/internal';
import {
  AssetAbortError,
  AssetExecutionError,
  AssetTimeoutError,
  cancelAsset,
  generateAsset,
  generate3D,
  generateSoundEffect,
  getAssetStatus,
  materializeAsset,
  startAsset,
  waitForAsset,
} from '@sinestack/ai-core';

const TEST_TIMEOUT = 3_000;
const fastPoll = { intervalMs: 0 };

function output(kind = 'model-3d') {
  return {
    assets: [{
      type: 'url',
      url: `https://assets.example.invalid/${kind === 'sound-effect' ? 'effect.mp3' : 'model.glb'}`,
      mediaType: kind === 'sound-effect' ? 'audio/mpeg' : 'model/gltf-binary',
    }],
    usage: { generatedAssets: 1 },
  };
}

function transientError(message = 'Temporary provider error') {
  return new APICallError({
    message,
    url: 'https://provider.example.invalid/request',
    requestBodyValues: undefined,
    statusCode: 503,
    responseHeaders: { 'retry-after-ms': '0' },
    isRetryable: true,
  });
}

function jobModel(kind = 'model-3d', overrides = {}) {
  const calls = { start: [], status: [] };
  const model = {
    specificationVersion: 'v1',
    provider: 'contract-test',
    modelId: `test-${kind}`,
    kind,
    async doStart(options) {
      calls.start.push(options);
      return { operation: { requestId: 'job-1' } };
    },
    async doStatus(options) {
      calls.status.push(options);
      return { status: 'completed', result: output(kind) };
    },
    ...overrides,
  };
  return { model, calls };
}

function operationFor(model, operation = { requestId: 'job-1' }) {
  return {
    specificationVersion: 'v1',
    provider: model.provider,
    modelId: model.modelId,
    kind: model.kind,
    operation,
  };
}

function terminalRecorder(events) {
  return {
    onFinish: () => events.push('finish'),
    onError: () => events.push('error'),
  };
}

async function rejectWhenAborted(signal) {
  signal.throwIfAborted();
  // Model in-flight I/O with a referenced timer: AbortSignal.timeout alone
  // does not keep Node's event loop alive. Cancellation clears this timer.
  await sleep(TEST_TIMEOUT, undefined, { signal });
  assert.fail('The cooperative provider did not receive cancellation');
}

function assertSingleIdempotencyHeader(options, expected) {
  const keys = Object.keys(options.headers).filter(key => key.toLowerCase() === 'idempotency-key');
  assert.equal(keys.length, 1, 'case variants must not produce duplicate idempotency headers');
  assert.equal(options.headers[keys[0]], expected);
  assert.equal(options.idempotencyKey, expected);
}

for (const kind of ['model-3d', 'sound-effect']) {
  test(`${kind}: facade shares one submit/poll lifecycle and preserves typed inputs`, { timeout: TEST_TIMEOUT }, async () => {
    const events = [];
    const operations = [];
    const requests = [];
    const statuses = [
      { status: 'pending', progress: 0 },
      { status: 'running', progress: 0.5, message: 'Rendering' },
      { status: 'completed', result: output(kind) },
    ];
    let startHookFinished = false;
    let submitCount = 0;
    const { model } = jobModel(kind, {
      async doStart(options) {
        assert.equal(startHookFinished, true, 'onStart must be awaited before submission');
        requests.push(options);
        submitCount++;
        return { operation: { requestId: 'shared-job' } };
      },
      async doStatus(options) {
        assert.deepEqual(options.operation, { requestId: 'shared-job' });
        assert.equal(options.headers['x-test-context'], 'tenant-1');
        return statuses.shift();
      },
    });
    const options = {
      model,
      prompt: 'A useful generated asset',
      headers: { 'x-test-context': 'tenant-1' },
      providerOptions: { 'contract-test': { quality: 'high' } },
      poll: fastPoll,
      hooks: {
        async onStart() {
          events.push('start');
          await Promise.resolve();
          startHookFinished = true;
        },
        onOperation(event) {
          events.push('operation');
          operations.push(event.operation);
        },
        onProgress(event) { events.push(event.status); },
        onFinish() { events.push('finish'); },
        onError() { events.push('error'); },
      },
    };
    const result = kind === 'model-3d'
      ? await generate3D(options)
      : await generateSoundEffect({ ...options, durationSeconds: 3, promptInfluence: 0.4, loop: true });

    assert.equal(submitCount, 1);
    assert.deepEqual(events, ['start', 'operation', 'pending', 'running', 'finish']);
    assert.equal(operations.length, 1);
    assert.equal(operations[0].kind, kind);
    assert.deepEqual(requests[0].input, kind === 'model-3d'
      ? { prompt: options.prompt }
      : { prompt: options.prompt, durationSeconds: 3, promptInfluence: 0.4, loop: true });
    assert.deepEqual(requests[0].providerOptions, options.providerOptions);
    assert.deepEqual(result.asset, output(kind).assets[0]);
    assert.deepEqual(result.assets, output(kind).assets);
    assert.deepEqual(result.operation.operation, { requestId: 'shared-job' });
  });
}

test('startAsset returns a JSON-resumable handle without querying the job', { timeout: TEST_TIMEOUT }, async () => {
  const { model, calls } = jobModel();
  const result = await startAsset({ model, input: { prompt: 'Chair' } });
  assert.equal(calls.start.length, 1);
  assert.equal(calls.status.length, 0);
  assert.deepEqual(JSON.parse(JSON.stringify(result.operation)), operationFor(model));
});

test('waitForAsset resumes a saved operation with a new model instance and never submits', { timeout: TEST_TIMEOUT }, async () => {
  const first = jobModel();
  const { operation } = await startAsset({ model: first.model, input: { prompt: 'Chair' } });
  const persisted = JSON.parse(JSON.stringify(operation));
  const resumed = jobModel();
  const result = await waitForAsset({ model: resumed.model, operation: persisted, poll: fastPoll });
  assert.equal(resumed.calls.start.length, 0);
  assert.equal(resumed.calls.status.length, 1);
  assert.deepEqual(resumed.calls.status[0].operation, persisted.operation);
  assert.deepEqual(result.operation, persisted);
});

test('transient status failures retry the existing job only, with two retries by default', { timeout: TEST_TIMEOUT }, async () => {
  let statusCalls = 0;
  const terminals = [];
  const { model, calls } = jobModel('sound-effect', {
    async doStatus(options) {
      statusCalls++;
      assert.deepEqual(options.operation, { requestId: 'job-1' });
      if (statusCalls < 3) throw transientError();
      return { status: 'completed', result: output('sound-effect') };
    },
  });
  await generateAsset({
    model,
    input: { prompt: 'Rain' },
    poll: fastPoll,
    hooks: terminalRecorder(terminals),
  });
  assert.equal(calls.start.length, 1);
  assert.equal(statusCalls, 3);
  assert.deepEqual(terminals, ['finish']);
});

for (const [label, error] of [
  ['plain Error', new Error('Invalid provider response')],
  ['non-retryable APICallError', new APICallError({
    message: 'Forbidden',
    url: 'https://provider.example.invalid/request',
    requestBodyValues: undefined,
    statusCode: 403,
    isRetryable: false,
  })],
]) {
  test(`status does not retry a ${label}`, { timeout: TEST_TIMEOUT }, async () => {
    let attempts = 0;
    const { model } = jobModel('model-3d', {
      async doStatus() { attempts++; throw error; },
    });
    await assert.rejects(getAssetStatus({
      model,
      operation: operationFor(model),
      retry: { status: 5 },
    }));
    assert.equal(attempts, 1);
  });
}

test('safe submission retries preserve a caller-provided case-insensitive idempotency key', { timeout: TEST_TIMEOUT }, async () => {
  const submissions = [];
  const { model } = jobModel('model-3d', {
    capabilities: { idempotentStart: true },
    async doStart(options) {
      submissions.push(options);
      if (submissions.length < 3) throw transientError();
      return { operation: { requestId: 'idempotent-job' } };
    },
  });
  const result = await startAsset({
    model,
    input: { prompt: 'Chair' },
    headers: { 'IDEMPOTENCY-KEY': 'caller-request-123' },
    retry: { start: 2 },
  });
  assert.equal(submissions.length, 3);
  for (const submission of submissions) assertSingleIdempotencyHeader(submission, 'caller-request-123');
  assert.deepEqual(result.operation.operation, { requestId: 'idempotent-job' });
});

test('safe direct retries reuse an automatically generated idempotency key', { timeout: TEST_TIMEOUT }, async () => {
  const attempts = [];
  const model = {
    specificationVersion: 'v1', provider: 'direct-test', modelId: 'direct', kind: 'document',
    capabilities: { idempotentGenerate: true },
    async doGenerate(options) {
      attempts.push(options);
      if (attempts.length === 1) throw transientError();
      return output();
    },
  };
  await generateAsset({ model, input: { title: 'Report' }, retry: { generate: 1 } });
  assert.equal(attempts.length, 2);
  assert.equal(typeof attempts[0].idempotencyKey, 'string');
  assert.ok(attempts[0].idempotencyKey.length > 0);
  for (const attempt of attempts) assertSingleIdempotencyHeader(attempt, attempts[0].idempotencyKey);
});

for (const mode of ['start', 'generate']) {
  test(`${mode} refuses unsafe positive retry configuration before a provider request`, { timeout: TEST_TIMEOUT }, async () => {
    let calls = 0;
    const base = { specificationVersion: 'v1', provider: 'unsafe-test', modelId: mode, kind: 'document' };
    const model = mode === 'start'
      ? { ...base, async doStart() { calls++; return { operation: 'id' }; }, async doStatus() { return { status: 'completed', result: output() }; } }
      : { ...base, async doGenerate() { calls++; return output(); } };
    const invoke = mode === 'start' ? startAsset : generateAsset;
    await assert.rejects(invoke({ model, input: {}, retry: { [mode]: 1 } }));
    assert.equal(calls, 0);
  });

  test(`${mode} does not retry by default even when the provider supports idempotency`, { timeout: TEST_TIMEOUT }, async () => {
    let calls = 0;
    const base = {
      specificationVersion: 'v1', provider: 'default-retry-test', modelId: mode, kind: 'document',
      capabilities: mode === 'start' ? { idempotentStart: true } : { idempotentGenerate: true },
    };
    const model = mode === 'start'
      ? { ...base, async doStart() { calls++; throw transientError(); }, async doStatus() { return { status: 'pending' }; } }
      : { ...base, async doGenerate() { calls++; throw transientError(); } };
    const invoke = mode === 'start' ? startAsset : generateAsset;
    await assert.rejects(invoke({ model, input: {} }));
    assert.equal(calls, 1);
  });
}

test('querying a remote failed state succeeds as a query and invokes onFinish', { timeout: TEST_TIMEOUT }, async () => {
  const terminals = [];
  const { model } = jobModel('model-3d', {
    async doStatus() { return { status: 'failed', error: { message: 'Unsupported input', code: 'BAD_INPUT' } }; },
  });
  const status = await getAssetStatus({ model, operation: operationFor(model), hooks: terminalRecorder(terminals) });
  assert.equal(status.status, 'failed');
  assert.equal(status.error.code, 'BAD_INPUT');
  assert.deepEqual(terminals, ['finish']);
});

for (const api of ['generate', 'wait']) {
  test(`${api} treats a remote failed state as terminal, never as a retryable query error`, { timeout: TEST_TIMEOUT }, async () => {
    let statusCalls = 0;
    const terminals = [];
    const { model, calls } = jobModel('model-3d', {
      async doStatus() {
        statusCalls++;
        return { status: 'failed', error: { message: 'Generation failed', code: 'REMOTE_FAILURE' } };
      },
    });
    const controls = { model, poll: fastPoll, retry: { status: 5 }, hooks: terminalRecorder(terminals) };
    const promise = api === 'generate'
      ? generateAsset({ ...controls, input: { prompt: 'Chair' } })
      : waitForAsset({ ...controls, operation: operationFor(model) });
    await assert.rejects(promise, error => {
      assert.ok(error instanceof AssetExecutionError);
      assert.equal(error.code, 'ASSET_JOB_FAILED');
      assert.deepEqual(error.operation.operation, { requestId: 'job-1' });
      return true;
    });
    assert.equal(statusCalls, 1);
    assert.equal(calls.start.length, api === 'generate' ? 1 : 0);
    assert.deepEqual(terminals, ['error']);
  });
}

const invalidOperationCases = [
  ['version', handle => ({ ...handle, specificationVersion: 'v99' })],
  ['provider', handle => ({ ...handle, provider: 'different-provider' })],
  ['model', handle => ({ ...handle, modelId: 'different-model' })],
  ['kind', handle => ({ ...handle, kind: 'sound-effect' })],
  ['undefined payload', handle => ({ ...handle, operation: undefined })],
  ['nested non-finite number', handle => ({ ...handle, operation: { value: Number.NaN } })],
  ['function payload', handle => ({ ...handle, operation: { value: () => 1 } })],
  ['cyclic payload', handle => {
    const cyclic = {};
    cyclic.self = cyclic;
    return { ...handle, operation: cyclic };
  }],
];

for (const [label, invalidate] of invalidOperationCases) {
  test(`invalid operation ${label} is rejected before contacting the provider`, { timeout: TEST_TIMEOUT }, async () => {
    const { model, calls } = jobModel();
    await assert.rejects(getAssetStatus({ model, operation: invalidate(operationFor(model)) }));
    assert.equal(calls.status.length, 0);
    assert.equal(calls.start.length, 0);
  });
}

test('an invalid operation returned by submission is rejected before polling', { timeout: TEST_TIMEOUT }, async () => {
  const { model, calls } = jobModel('model-3d', {
    async doStart() { return { operation: { invalid: Number.POSITIVE_INFINITY } }; },
  });
  await assert.rejects(generateAsset({ model, input: {}, poll: fastPoll }));
  assert.equal(calls.status.length, 0);
});

test('direct generation accepts custom input and leaves URL assets as references', { timeout: TEST_TIMEOUT }, async () => {
  let observedInput;
  const terminals = [];
  const model = {
    specificationVersion: 'v1', provider: 'direct-test', modelId: 'pdf', kind: 'document',
    async doGenerate(options) {
      observedInput = options.input;
      return {
        assets: [{ type: 'url', url: 'https://must-not-be-fetched.example.invalid/report.pdf', mediaType: 'application/pdf' }],
        response: { headers: { 'x-provider-request': 'request-1' } },
      };
    },
  };
  const result = await generateAsset({ model, input: { title: 'Report', pages: 4 }, hooks: terminalRecorder(terminals) });
  assert.deepEqual(observedInput, { title: 'Report', pages: 4 });
  assert.equal(result.asset.type, 'url');
  assert.equal(result.asset.url, 'https://must-not-be-fetched.example.invalid/report.pdf');
  assert.equal(result.operation, undefined);
  assert.ok(result.responses.some(response => response.headers?.['x-provider-request'] === 'request-1'));
  assert.deepEqual(terminals, ['finish']);
});

test('execution mode selects one path and never falls back after a failed submission', { timeout: TEST_TIMEOUT }, async () => {
  let directCalls = 0;
  let startCalls = 0;
  const { model } = jobModel('model-3d', {
    async doGenerate() { directCalls++; return output(); },
    async doStart() { startCalls++; throw new Error('Submission rejected'); },
  });
  await generateAsset({ model, input: {}, execution: 'direct' });
  assert.equal(directCalls, 1);
  assert.equal(startCalls, 0);
  await assert.rejects(generateAsset({ model, input: {}, execution: 'async', poll: fastPoll }));
  assert.equal(startCalls, 1);
  assert.equal(directCalls, 1, 'failed async execution must not switch to doGenerate');
});

test('pre-aborted execution makes no provider request', { timeout: TEST_TIMEOUT }, async () => {
  const controller = new AbortController();
  controller.abort(new Error('Caller stopped before invocation'));
  const { model, calls } = jobModel();
  await assert.rejects(generateAsset({ model, input: {}, abortSignal: controller.signal }), error => {
    assert.ok(error instanceof AssetAbortError);
    assert.equal(error.code, 'ASSET_ABORTED');
    return true;
  });
  assert.equal(calls.start.length, 0);
  assert.equal(calls.status.length, 0);
});

test('a cooperative status adapter observes caller cancellation and retains its operation', { timeout: TEST_TIMEOUT }, async () => {
  const controller = new AbortController();
  const cause = new Error('Stop waiting');
  const terminals = [];
  let statusSignal;
  const { model, calls } = jobModel('model-3d', {
    doStatus(options) {
      statusSignal = options.abortSignal;
      queueMicrotask(() => controller.abort(cause));
      return rejectWhenAborted(statusSignal);
    },
  });
  const operation = operationFor(model);
  await assert.rejects(waitForAsset({ model, operation, abortSignal: controller.signal, hooks: terminalRecorder(terminals) }), error => {
    assert.ok(error instanceof AssetAbortError);
    assert.deepEqual(error.operation, operation);
    assert.equal(error.cause, cause);
    return true;
  });
  assert.equal(statusSignal.aborted, true);
  assert.equal(calls.start.length, 0);
  assert.deepEqual(terminals, ['error']);
});

test('cancellation does not force an uncooperative provider promise to settle', { timeout: TEST_TIMEOUT }, async t => {
  const controller = new AbortController();
  const entered = Promise.withResolvers();
  const provider = Promise.withResolvers();
  t.after(() => provider.resolve({ status: 'completed', result: output() }));
  let statusSignal;
  const { model } = jobModel('model-3d', {
    doStatus(options) {
      statusSignal = options.abortSignal;
      entered.resolve();
      return provider.promise;
    },
  });
  const operation = operationFor(model);
  let settled = false;
  const outcome = waitForAsset({ model, operation, abortSignal: controller.signal }).then(
    value => { settled = true; return { value }; },
    error => { settled = true; return { error }; },
  );
  await entered.promise;
  controller.abort(new Error('Stop observing the provider'));
  await nextTurn();
  assert.equal(statusSignal.aborted, true);
  assert.equal(settled, false, 'the SDK forwards cancellation without racing arbitrary provider promises');
  provider.resolve({ status: 'completed', result: output() });
  const result = await outcome;
  assert.ok(result.error instanceof AssetAbortError);
  assert.deepEqual(result.error.operation, operation);
});

test('cancellation after progress does not issue another query or resubmit', { timeout: TEST_TIMEOUT }, async () => {
  const controller = new AbortController();
  let statusCalls = 0;
  const { model, calls } = jobModel('model-3d', {
    async doStatus() { statusCalls++; return { status: 'running' }; },
  });
  await assert.rejects(generateAsset({
    model, input: {}, abortSignal: controller.signal,
    poll: { intervalMs: 1_000 },
    hooks: { onProgress() { controller.abort(); } },
  }), error => error.code === 'ASSET_ABORTED');
  assert.equal(calls.start.length, 1);
  assert.equal(statusCalls, 1);
});

test('poll timeout is forwarded to a cooperative in-flight status adapter', { timeout: TEST_TIMEOUT }, async () => {
  let statusSignal;
  const terminals = [];
  const { model } = jobModel('model-3d', {
    doStatus(options) { statusSignal = options.abortSignal; return rejectWhenAborted(statusSignal); },
  });
  const operation = operationFor(model);
  await assert.rejects(waitForAsset({
    model, operation, timeoutMs: 1_000, poll: { intervalMs: 0, timeoutMs: 30 }, hooks: terminalRecorder(terminals),
  }), error => {
    assert.ok(error instanceof AssetTimeoutError);
    assert.equal(error.code, 'ASSET_TIMEOUT');
    assert.equal(error.cause, statusSignal.reason);
    assert.ok(error.cause instanceof DOMException);
    assert.deepEqual(error.operation, operation);
    return true;
  });
  assert.equal(statusSignal.aborted, true);
  assert.deepEqual(terminals, ['error']);
});

test('the call timeout signal reaches a cooperative submission adapter', { timeout: TEST_TIMEOUT }, async () => {
  let submitSignal;
  const { model, calls } = jobModel('model-3d', {
    doStart(options) { submitSignal = options.abortSignal; return rejectWhenAborted(submitSignal); },
  });
  await assert.rejects(generateAsset({ model, input: {}, timeoutMs: 30, poll: { timeoutMs: 1_000 } }), error => {
    assert.ok(error instanceof AssetTimeoutError);
    assert.equal(error.code, 'ASSET_TIMEOUT');
    return true;
  });
  assert.equal(submitSignal.aborted, true);
  assert.equal(calls.status.length, 0);
});

test('timeout does not force an observation hook to settle, and no I/O begins after it settles', { timeout: TEST_TIMEOUT }, async t => {
  const entered = Promise.withResolvers();
  const observer = Promise.withResolvers();
  t.after(() => observer.resolve());
  const { model, calls } = jobModel();
  let settled = false;
  const outcome = generateAsset({
    model, input: {}, timeoutMs: 5,
    hooks: { onStart() { entered.resolve(); return observer.promise; } },
  }).then(
    value => { settled = true; return { value }; },
    error => { settled = true; return { error }; },
  );
  await entered.promise;
  await sleep(15);
  assert.equal(settled, false, 'observation hooks follow mergeCallbacks awaiting semantics');
  assert.equal(calls.start.length, 0);
  observer.resolve();
  const result = await outcome;
  assert.ok(result.error instanceof AssetTimeoutError);
  assert.equal(calls.start.length, 0);
  assert.equal(calls.status.length, 0);
});

test('observation hooks await completion and ignore failure exactly like SDK mergeCallbacks', { timeout: TEST_TIMEOUT }, async () => {
  const hookNames = ['onStart', 'onOperation', 'onProgress', 'onFinish'];
  const sdkEvents = [];
  const actualEvents = [];
  const sequence = [];
  const observer = (events, name) => async () => {
    events.push(name + ':start');
    await Promise.resolve();
    events.push(name + ':settled');
    throw new Error(name + ' observer failed');
  };
  for (const name of hookNames) await mergeCallbacks(observer(sdkEvents, name))({});
  const hooks = Object.fromEntries(hookNames.map(name => [name, async event => {
    sequence.push(name + ':start');
    try { await observer(actualEvents, name)(event); }
    finally { sequence.push(name + ':settled'); }
  }]));
  let errorEvents = 0;
  hooks.onError = () => { errorEvents++; };
  let queries = 0;
  const { model } = jobModel('model-3d', {
    async doStart() { sequence.push('submit'); return { operation: { requestId: 'observed-job' } }; },
    async doStatus() {
      sequence.push('query');
      return ++queries === 1 ? { status: 'running' } : { status: 'completed', result: output() };
    },
  });
  const result = await generateAsset({ model, input: {}, poll: fastPoll, hooks });
  assert.deepEqual(actualEvents, sdkEvents);
  assert.deepEqual(sequence, [
    'onStart:start', 'onStart:settled', 'submit',
    'onOperation:start', 'onOperation:settled', 'query',
    'onProgress:start', 'onProgress:settled', 'query',
    'onFinish:start', 'onFinish:settled',
  ]);
  assert.deepEqual(result.operation.operation, { requestId: 'observed-job' });
  assert.deepEqual(result.asset, output().assets[0]);
  assert.equal(errorEvents, 0);
});

test('an onError observer failure does not replace the execution error or operation', { timeout: TEST_TIMEOUT }, async () => {
  const observerError = new Error('Error observer rejected');
  let onErrorCalls = 0;
  let observedError;
  const { model, calls } = jobModel('model-3d', {
    async doStatus() { return { status: 'failed', error: { message: 'Remote job failed' } }; },
  });
  await assert.rejects(generateAsset({
    model, input: {}, poll: fastPoll,
    hooks: { async onError(event) { onErrorCalls++; observedError = event.error; throw observerError; } },
  }), error => {
    assert.ok(error instanceof AssetExecutionError);
    assert.equal(error, observedError);
    assert.equal(error.code, 'ASSET_JOB_FAILED');
    assert.notEqual(error.cause, observerError);
    assert.deepEqual(error.operation, operationFor(model));
    return true;
  });
  assert.equal(onErrorCalls, 1);
  assert.equal(calls.start.length, 1);
});

test('unsupported webhooks fall back to polling with a warning and never invoke the factory', { timeout: TEST_TIMEOUT }, async () => {
  const { model, calls } = jobModel();
  let factories = 0;
  const result = await generateAsset({
    model, input: {}, poll: fastPoll,
    webhook() { factories++; throw new Error('Unsupported webhook factory must not run'); },
  });
  assert.equal(factories, 0);
  assert.equal(calls.start.length, 1);
  assert.equal(calls.status.length, 1);
  assert.equal(calls.start[0].webhookUrl, undefined);
  assert.match(JSON.stringify(result.warnings), /webhook/i);
});

test('supported webhooks wait for the receiver then perform one final status query', { timeout: TEST_TIMEOUT }, async () => {
  const events = [];
  let resolveReceived;
  const received = new Promise(resolve => { resolveReceived = resolve; });
  const { model } = jobModel('model-3d', {
    capabilities: { webhooks: true },
    async doStart(options) {
      assert.equal(options.webhookUrl, 'https://app.example.invalid/webhooks/assets');
      events.push('submit');
      queueMicrotask(() => { events.push('webhook'); resolveReceived({ untrustedPayload: 'not a final result' }); });
      return { operation: { requestId: 'webhook-job' } };
    },
    async doStatus(options) {
      assert.ok(events.includes('webhook'));
      assert.deepEqual(options.operation, { requestId: 'webhook-job' });
      events.push('query');
      return { status: 'completed', result: output() };
    },
  });
  const result = await generateAsset({
    model, input: {},
    webhook: () => ({ url: 'https://app.example.invalid/webhooks/assets', received }),
    poll: { intervalMs: 0, delay() { assert.fail('webhook path must not enter a polling sleep'); } },
  });
  assert.deepEqual(events, ['submit', 'webhook', 'query']);
  assert.deepEqual(result.asset, output().assets[0]);
});

test('webhook finalization forwards the poll timeout signal to a cooperative final query', { timeout: TEST_TIMEOUT }, async () => {
  let statusCalls = 0;
  let statusSignal;
  const { model, calls } = jobModel('model-3d', {
    capabilities: { webhooks: true },
    doStatus(options) {
      statusCalls++;
      statusSignal = options.abortSignal;
      return rejectWhenAborted(statusSignal);
    },
  });
  await assert.rejects(generateAsset({
    model, input: {}, timeoutMs: 1_000,
    webhook: () => ({ url: 'https://app.example.invalid/webhook', received: Promise.resolve() }),
    poll: { timeoutMs: 30 },
  }), error => {
    assert.ok(error instanceof AssetTimeoutError);
    assert.deepEqual(error.operation, operationFor(model));
    return true;
  });
  assert.equal(calls.start.length, 1);
  assert.equal(statusCalls, 1);
  assert.equal(statusSignal.aborted, true);
});

test('waiting for a webhook notification times out before issuing a final query', { timeout: TEST_TIMEOUT }, async () => {
  const { model, calls } = jobModel('model-3d', { capabilities: { webhooks: true } });
  await assert.rejects(generateAsset({
    model, input: {}, poll: { timeoutMs: 15 },
    webhook: () => ({
      url: 'https://app.example.invalid/webhook',
      received: new Promise(() => {}),
    }),
  }), error => {
    assert.ok(error instanceof AssetTimeoutError);
    assert.deepEqual(error.operation, operationFor(model));
    return true;
  });
  assert.equal(calls.start.length, 1);
  assert.equal(calls.status.length, 0);
});

test('cancelAsset preserves a requested cancellation without claiming the remote job stopped', { timeout: TEST_TIMEOUT }, async () => {
  const cancellations = [];
  const terminals = [];
  const { model, calls } = jobModel('model-3d', {
    async doCancel(options) {
      cancellations.push(options);
      return { status: 'requested', response: { headers: { 'x-cancel': 'accepted' } } };
    },
  });
  const operation = operationFor(model);
  const result = await cancelAsset({ model, operation, hooks: terminalRecorder(terminals) });
  assert.equal(result.status, 'requested');
  assert.deepEqual(result.operation, operation);
  assert.deepEqual(cancellations[0].operation, operation.operation);
  assert.equal(cancellations.length, 1);
  assert.equal(calls.start.length, 0);
  assert.equal(calls.status.length, 0);
  assert.deepEqual(terminals, ['finish']);
});

test('cancelAsset rejects unsupported providers and mismatched handles without a cancellation request', { timeout: TEST_TIMEOUT }, async () => {
  const unsupported = jobModel();
  await assert.rejects(cancelAsset({ model: unsupported.model, operation: operationFor(unsupported.model) }));
  let cancelCalls = 0;
  const { model } = jobModel('model-3d', {
    async doCancel() { cancelCalls++; return { status: 'cancelled' }; },
  });
  await assert.rejects(cancelAsset({ model, operation: { ...operationFor(model), provider: 'wrong-provider' } }));
  assert.equal(cancelCalls, 0);
});

test('materializeAsset explicitly downloads a URL and exposes AI SDK GeneratedFile accessors', { timeout: TEST_TIMEOUT }, async () => {
  const controller = new AbortController();
  const downloads = [];
  const asset = { type: 'url', url: 'https://assets.example.invalid/effect.mp3', mediaType: 'audio/mpeg' };
  const file = await materializeAsset(asset, {
    abortSignal: controller.signal,
    maxBytes: 3,
    async download(options) {
      downloads.push(options);
      return { data: new Uint8Array([1, 2, 3]), mediaType: 'audio/mpeg' };
    },
  });
  assert.equal(downloads.length, 1);
  assert.ok(downloads[0].url instanceof URL);
  assert.equal(downloads[0].url.href, asset.url);
  assert.equal(downloads[0].abortSignal, controller.signal);
  assert.deepEqual(file.uint8Array, new Uint8Array([1, 2, 3]));
  assert.equal(file.base64, 'AQID');
  assert.equal(file.mediaType, 'audio/mpeg');
});

for (const asset of [
  { type: 'binary', data: new Uint8Array([1, 2, 3]), mediaType: 'application/octet-stream' },
  { type: 'base64', data: 'AQID', mediaType: 'application/octet-stream' },
]) {
  test(`materializeAsset decodes ${asset.type} locally and enforces the byte limit`, { timeout: TEST_TIMEOUT }, async () => {
    const download = () => assert.fail('local assets must not call the downloader');
    const file = await materializeAsset(asset, { maxBytes: 3, download });
    assert.deepEqual(file.uint8Array, new Uint8Array([1, 2, 3]));
    assert.equal(file.base64, 'AQID');
    await assert.rejects(materializeAsset(asset, { maxBytes: 2, download }));
  });
}

test('materializeAsset applies the byte limit to an injected downloader too', { timeout: TEST_TIMEOUT }, async () => {
  const asset = { type: 'url', url: 'https://assets.example.invalid/large.glb', mediaType: 'model/gltf-binary' };
  await assert.rejects(materializeAsset(asset, {
    maxBytes: 2,
    download: async () => ({ data: new Uint8Array([1, 2, 3]) }),
  }));
});

test('provider status fields cannot overwrite the core progress event identity or operation', { timeout: TEST_TIMEOUT }, async () => {
  const startedAt = Date.now();
  let started;
  let acceptedOperation;
  const progressEvents = [];
  let queries = 0;
  const { model } = jobModel('model-3d', {
    async doStatus(options) {
      assert.deepEqual(options.operation, { requestId: 'job-1' });
      if (++queries > 1) return { status: 'completed', result: output() };
      return {
        status: 'running', progress: 0.25, message: 'Building geometry',
        callId: 'provider-spoofed-call', api: 'startAsset', timestamp: -1,
        provider: 'different-provider', modelId: 'different-model', kind: 'sound-effect',
        operation: { requestId: 'different-job' },
      };
    },
  });
  const result = await generateAsset({
    model, input: {}, poll: fastPoll,
    hooks: {
      onStart(event) { started = event; },
      onOperation(event) { acceptedOperation = event.operation; },
      onProgress(event) { progressEvents.push(event); },
    },
  });
  assert.equal(progressEvents.length, 1);
  const event = progressEvents[0];
  assert.equal(event.callId, started.callId);
  assert.equal(event.api, 'generateAsset');
  assert.equal(event.provider, model.provider);
  assert.equal(event.modelId, model.modelId);
  assert.equal(event.kind, model.kind);
  assert.ok(event.timestamp >= startedAt);
  assert.deepEqual(event.operation, acceptedOperation);
  assert.equal(event.status, 'running');
  assert.equal(event.progress, 0.25);
  assert.equal(event.message, 'Building geometry');
  assert.equal(queries, 2);
  assert.deepEqual(result.operation, operationFor(model));
});

test('a non-boolean idempotency capability is rejected before submission', { timeout: TEST_TIMEOUT }, async () => {
  const { model, calls } = jobModel('model-3d', {
    capabilities: { idempotentStart: 'false' },
  });
  await assert.rejects(startAsset({
    model, input: {}, retry: { start: 1 },
  }), error => {
    assert.ok(error instanceof TypeError);
    assert.match(error.message, /idempotentStart.*boolean/);
    return true;
  });
  assert.equal(calls.start.length, 0);
  assert.equal(calls.status.length, 0);
});

for (const method of ['doGenerate', 'doStart', 'doStatus', 'doCancel']) {
  test('a non-function ' + method + ' is rejected even when another execution path is selected', { timeout: TEST_TIMEOUT }, async () => {
    let directCalls = 0;
    const { model, calls } = jobModel('model-3d', {
      async doGenerate() { directCalls++; return output(); },
      [method]: 'not callable',
    });
    // Selecting an otherwise valid path proves validation is proactive: a
    // TypeError from accidentally calling the malformed method is insufficient.
    const promise = method === 'doStart' || method === 'doStatus'
      ? generateAsset({ model, input: {}, execution: 'direct' })
      : startAsset({ model, input: {} });
    await assert.rejects(promise, error => {
      assert.ok(error instanceof TypeError);
      assert.match(error.message, new RegExp(method + '.*function'));
      return true;
    });
    assert.equal(directCalls, 0);
    assert.equal(calls.start.length, 0);
    assert.equal(calls.status.length, 0);
  });
}

const restoredAPIs = [
  ['getAssetStatus', getAssetStatus],
  ['waitForAsset', waitForAsset],
  ['cancelAsset', cancelAsset],
];

for (const [api, invoke] of restoredAPIs) {
  test(api + ': onStart receives a detached, deeply frozen operation that cannot be retargeted', { timeout: TEST_TIMEOUT }, async () => {
    const requests = [];
    const { model, calls } = jobModel('model-3d', {
      async doStatus(options) {
        requests.push(options.operation);
        return { status: 'completed', result: output() };
      },
      async doCancel(options) {
        requests.push(options.operation);
        return { status: 'requested' };
      },
    });
    const original = operationFor(model, {
      requestId: 'original-job', route: { region: 'original-region' }, parts: [{ id: 'original-part' }],
    });
    const expected = JSON.parse(JSON.stringify(original));
    let observedOperation;
    const mutationResults = [];
    const options = {
      model, operation: original, ...(api === 'waitForAsset' ? { poll: fastPoll } : {}),
      hooks: {
        onStart(event) {
          observedOperation = event.operation;
          mutationResults.push(
            Reflect.set(event.operation, 'provider', 'other-provider'),
            Reflect.set(event.operation.operation, 'requestId', 'hook-target'),
            Reflect.set(event.operation.operation.route, 'region', 'hook-region'),
            Reflect.set(event.operation.operation.parts[0], 'id', 'hook-part'),
          );

          // The caller retains ownership of the original mutable object. Both
          // changing it and replacing options.operation must leave work fixed.
          original.operation.requestId = 'caller-target';
          original.operation.route.region = 'caller-region';
          original.operation.parts[0].id = 'caller-part';
          options.operation = operationFor(model, { requestId: 'replacement-target' });
        },
      },
    };
    const result = await invoke(options);
    assert.deepEqual(observedOperation, expected);
    assert.notEqual(observedOperation, original);
    assert.notEqual(observedOperation.operation, original.operation);
    assert.ok(Object.isFrozen(observedOperation));
    assert.ok(Object.isFrozen(observedOperation.operation));
    assert.ok(Object.isFrozen(observedOperation.operation.route));
    assert.ok(Object.isFrozen(observedOperation.operation.parts));
    assert.ok(Object.isFrozen(observedOperation.operation.parts[0]));
    assert.deepEqual(mutationResults, [false, false, false, false]);
    assert.equal(original.operation.requestId, 'caller-target');
    assert.equal(options.operation.operation.requestId, 'replacement-target');
    assert.deepEqual(requests, [expected.operation]);
    assert.deepEqual(result.operation, expected);
    assert.equal(calls.start.length, 0);
  });

  test(api + ': an onStart observer failure does not prevent resuming the existing operation', { timeout: TEST_TIMEOUT }, async () => {
    let cancelCalls = 0;
    const { model, calls } = jobModel('model-3d', {
      async doCancel() { cancelCalls++; return { status: 'requested' }; },
    });
    const operation = operationFor(model);
    const cause = new Error('Start hook failed while restoring the job');
    let errors = 0;
    let observedOperation;
    const result = await invoke({
      model, operation,
      hooks: {
        onStart(event) {
          observedOperation = event.operation;
          throw cause;
        },
        onError() { errors++; },
      },
    });
    assert.deepEqual(observedOperation, operation);
    assert.deepEqual(result.operation, operation);
    assert.equal(errors, 0);
    assert.equal(calls.start.length, 0);
    assert.equal(calls.status.length, api === 'cancelAsset' ? 0 : 1);
    assert.equal(cancelCalls, api === 'cancelAsset' ? 1 : 0);
  });

  test(api + ': pre-aborted restoration preserves the operation in the error and onError event', { timeout: TEST_TIMEOUT }, async () => {
    let cancelCalls = 0;
    const { model, calls } = jobModel('model-3d', {
      async doCancel() { cancelCalls++; return { status: 'requested' }; },
    });
    const operation = operationFor(model);
    const controller = new AbortController();
    controller.abort(new Error('Already stopped'));
    const terminals = [];
    let starts = 0;
    let observedErrorEvent;
    await assert.rejects(invoke({
      model, operation, abortSignal: controller.signal,
      hooks: {
        ...terminalRecorder(terminals),
        onStart() { starts++; },
        onError(event) {
          terminals.push('error');
          observedErrorEvent = event;
        },
      },
    }), error => {
      assert.ok(error instanceof AssetAbortError);
      assert.deepEqual(error.operation, operation);
      return true;
    });
    assert.deepEqual(terminals, ['error']);
    assert.equal(starts, 0);
    assert.deepEqual(observedErrorEvent.operation, operation);
    assert.deepEqual(observedErrorEvent.error.operation, operation);
    assert.equal(calls.start.length, 0);
    assert.equal(calls.status.length, 0);
    assert.equal(cancelCalls, 0);
  });
}

test('a newly submitted operation is detached and deeply frozen before observation hooks or polling', { timeout: TEST_TIMEOUT }, async () => {
  const providerOperation = {
    requestId: 'accepted-job', route: { region: 'accepted-region' }, parts: [{ id: 'accepted-part' }],
  };
  const expectedPayload = JSON.parse(JSON.stringify(providerOperation));
  let submits = 0;
  let observations = 0;
  let observedOperation;
  const mutationResults = [];
  let queries = 0;
  const { model } = jobModel('model-3d', {
    async doStart() { submits++; return { operation: providerOperation }; },
    async doStatus(options) {
      queries++;
      assert.deepEqual(options.operation, expectedPayload);
      return { status: 'completed', result: output() };
    },
  });
  const result = await generateAsset({
    model, input: {}, poll: fastPoll,
    hooks: {
      onOperation(event) {
        observations++;
        observedOperation = event.operation;
        mutationResults.push(
          Reflect.set(event.operation.operation, 'requestId', 'hook-target'),
          Reflect.set(event.operation.operation.parts[0], 'id', 'hook-part'),
        );
        providerOperation.requestId = 'provider-target';
        providerOperation.route.region = 'provider-region';
        providerOperation.parts[0].id = 'provider-part';
      },
    },
  });
  assert.equal(submits, 1);
  assert.equal(observations, 1);
  assert.deepEqual(observedOperation.operation, expectedPayload);
  assert.notEqual(observedOperation.operation, providerOperation);
  assert.ok(Object.isFrozen(observedOperation));
  assert.ok(Object.isFrozen(observedOperation.operation));
  assert.ok(Object.isFrozen(observedOperation.operation.route));
  assert.ok(Object.isFrozen(observedOperation.operation.parts));
  assert.ok(Object.isFrozen(observedOperation.operation.parts[0]));
  assert.deepEqual(mutationResults, [false, false]);
  assert.equal(providerOperation.requestId, 'provider-target');
  assert.equal(queries, 1);
  assert.deepEqual(result.operation, operationFor(model, expectedPayload));
});

for (const descriptor of ['non-enumerable toJSON', 'accessor']) {
  for (const path of ['submission', 'restoration']) {
    test(path + ': operation with ' + descriptor + ' is rejected without executing or exposing it', { timeout: TEST_TIMEOUT }, async () => {
      let executed = 0;
      const operation = { requestId: 'unsafe-job' };
      if (descriptor === 'non-enumerable toJSON') {
        Object.defineProperty(operation, 'toJSON', {
          enumerable: false,
          value() { executed++; return { requestId: 'rewritten-job' }; },
        });
      } else {
        Object.defineProperty(operation, 'requestId', {
          enumerable: true,
          get() { executed++; return 'rewritten-job'; },
        });
      }
      let submits = 0;
      let observations = 0;
      const { model, calls } = jobModel('model-3d', {
        async doStart() { submits++; return { operation }; },
      });
      const hooks = { onOperation() { observations++; } };
      const promise = path === 'submission'
        ? generateAsset({ model, input: {}, poll: fastPoll, hooks })
        : getAssetStatus({ model, operation: operationFor(model, operation), hooks });
      await assert.rejects(promise);
      assert.equal(executed, 0, 'JSON validation must inspect descriptors without invoking user code');
      assert.equal(observations, 0, 'a lossy operation must not reach the observation hook');
      assert.equal(submits, path === 'submission' ? 1 : 0);
      assert.equal(calls.status.length, 0);
    });
  }
}

for (const data of ['==', 'AA=']) {
  test('invalid base64 padding ' + JSON.stringify(data) + ' is rejected by generation and materialization', { timeout: TEST_TIMEOUT }, async () => {
    const asset = { type: 'base64', data, mediaType: 'application/octet-stream' };
    const terminals = [];
    const model = {
      specificationVersion: 'v1', provider: 'base64-test', modelId: 'binary', kind: 'document',
      async doGenerate() { return { assets: [asset] }; },
    };
    await assert.rejects(generateAsset({ model, input: {}, hooks: terminalRecorder(terminals) }));
    assert.deepEqual(terminals, ['error']);
    await assert.rejects(materializeAsset(asset, {
      download() { assert.fail('invalid base64 must not invoke a downloader'); },
    }));
  });
}

for (const [label, errors] of [
  ['retry exhaustion', [transientError('First'), transientError('Second'), transientError('Third')]],
  ['a non-retryable error after a retry', [transientError('First'), new Error('Invalid provider response')]],
]) {
  test('status preserves SDK prepareRetries behavior for ' + label, { timeout: TEST_TIMEOUT }, async () => {
    let sdkCalls = 0;
    let sdkError;
    const { retry } = prepareRetries({ maxRetries: 2, abortSignal: undefined });
    await assert.rejects(retry(async () => { throw errors[sdkCalls++]; }), error => {
      sdkError = error;
      return true;
    });
    assert.ok(RetryError.isInstance(sdkError));

    let statusCalls = 0;
    const { model, calls } = jobModel('model-3d', {
      async doStatus() { throw errors[statusCalls++]; },
    });
    const operation = operationFor(model);
    await assert.rejects(getAssetStatus({ model, operation, retry: { status: 2 } }), error => {
      assert.ok(error instanceof AssetExecutionError);
      assert.ok(RetryError.isInstance(error.cause));
      assert.equal(error.cause.reason, sdkError.reason);
      assert.equal(error.cause.message, sdkError.message);
      assert.deepEqual(error.cause.errors, sdkError.errors);
      assert.equal(error.cause.lastError, sdkError.lastError);
      assert.deepEqual(error.operation, operation);
      return true;
    });
    assert.equal(statusCalls, sdkCalls);
    assert.equal(calls.start.length, 0);
  });
}

test('a single caller signal is passed through with SDK mergeAbortSignals semantics', { timeout: TEST_TIMEOUT }, async () => {
  const controller = new AbortController();
  const sdkSignal = mergeAbortSignals(controller.signal);
  let observedSignal;
  const { model } = jobModel('model-3d', {
    async doStatus(options) {
      observedSignal = options.abortSignal;
      return { status: 'completed', result: output() };
    },
  });
  await getAssetStatus({ model, operation: operationFor(model), abortSignal: controller.signal });
  assert.equal(observedSignal, sdkSignal);
  assert.equal(observedSignal, controller.signal);
});
