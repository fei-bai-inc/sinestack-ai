import assert from 'node:assert/strict';
import test from 'node:test';
import { APICallError } from '@ai-sdk/provider';
import {
  AssetAbortError,
  AssetExecutionError,
  AssetHookError,
  AssetTimeoutError,
  cancelAsset,
  generateAsset,
  generate3D,
  generateSoundEffect,
  getAssetStatus,
  materializeAsset,
  startAsset,
  waitForAsset,
} from '@sine-ai/core';

const TEST_TIMEOUT = 3_000;
const fastRetry = { initialDelayMs: 0, maxDelayMs: 0 };
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
    onAbort: () => events.push('abort'),
  };
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
    const attempts = [];
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
      retry: fastRetry,
      hooks: {
        async onStart() {
          events.push('start');
          await Promise.resolve();
          startHookFinished = true;
        },
        onAttempt(event) { attempts.push(event.phase); },
        onOperation(event) {
          events.push('operation');
          assert.equal(event.operation.kind, kind);
        },
        onProgress(event) { events.push(event.status); },
        onFinish() { events.push('finish'); },
        onError() { events.push('error'); },
        onAbort() { events.push('abort'); },
      },
    };
    const result = kind === 'model-3d'
      ? await generate3D(options)
      : await generateSoundEffect({ ...options, durationSeconds: 3, promptInfluence: 0.4, loop: true });

    assert.equal(submitCount, 1);
    assert.deepEqual(events, ['start', 'operation', 'pending', 'running', 'finish']);
    assert.deepEqual(attempts, ['start', 'status', 'status', 'status']);
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
  const retries = [];
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
    retry: fastRetry,
    poll: fastPoll,
    hooks: { ...terminalRecorder(terminals), onRetry: event => retries.push(event) },
  });
  assert.equal(calls.start.length, 1);
  assert.equal(statusCalls, 3);
  assert.deepEqual(retries.map(event => event.phase), ['status', 'status']);
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
      retry: { ...fastRetry, status: 5 },
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
    retry: { ...fastRetry, start: 2 },
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
  await generateAsset({ model, input: { title: 'Report' }, retry: { ...fastRetry, generate: 1 } });
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
    await assert.rejects(invoke({ model, input: {}, retry: { ...fastRetry, [mode]: 1 } }));
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
    await assert.rejects(invoke({ model, input: {}, retry: fastRetry }));
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
    const controls = { model, poll: fastPoll, retry: { ...fastRetry, status: 5 }, hooks: terminalRecorder(terminals) };
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

test('abort interrupts an in-flight status promise that ignores the signal and retains its operation', { timeout: TEST_TIMEOUT }, async () => {
  const controller = new AbortController();
  const terminals = [];
  let statusSignal;
  const { model, calls } = jobModel('model-3d', {
    doStatus(options) {
      statusSignal = options.abortSignal;
      queueMicrotask(() => controller.abort(new Error('Stop waiting')));
      return new Promise(() => {});
    },
  });
  const operation = operationFor(model);
  await assert.rejects(waitForAsset({ model, operation, abortSignal: controller.signal, hooks: terminalRecorder(terminals) }), error => {
    assert.ok(error instanceof AssetAbortError);
    assert.deepEqual(error.operation, operation);
    return true;
  });
  assert.equal(statusSignal.aborted, true);
  assert.equal(calls.start.length, 0);
  assert.deepEqual(terminals, ['abort']);
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

test('poll timeout includes an in-flight query that never resolves', { timeout: TEST_TIMEOUT }, async () => {
  let statusSignal;
  const terminals = [];
  const { model } = jobModel('model-3d', {
    doStatus(options) { statusSignal = options.abortSignal; return new Promise(() => {}); },
  });
  const operation = operationFor(model);
  await assert.rejects(waitForAsset({
    model, operation, timeoutMs: 1_000, poll: { intervalMs: 0, timeoutMs: 30 }, hooks: terminalRecorder(terminals),
  }), error => {
    assert.ok(error instanceof AssetTimeoutError);
    assert.equal(error.code, 'ASSET_TIMEOUT');
    assert.deepEqual(error.operation, operation);
    return true;
  });
  assert.equal(statusSignal.aborted, true);
  assert.equal(terminals.length, 1);
  assert.notEqual(terminals[0], 'finish');
});

test('whole-call timeout includes submission instead of starting only after the job is accepted', { timeout: TEST_TIMEOUT }, async () => {
  let submitSignal;
  const { model, calls } = jobModel('model-3d', {
    doStart(options) { submitSignal = options.abortSignal; return new Promise(() => {}); },
  });
  await assert.rejects(generateAsset({ model, input: {}, timeoutMs: 30, poll: { timeoutMs: 1_000 } }), error => {
    assert.ok(error instanceof AssetTimeoutError);
    assert.equal(error.code, 'ASSET_TIMEOUT');
    return true;
  });
  assert.equal(submitSignal.aborted, true);
  assert.equal(calls.status.length, 0);
});

test('whole-call timeout also bounds an onStart hook that never resolves', { timeout: TEST_TIMEOUT }, async () => {
  const { model, calls } = jobModel();
  await assert.rejects(generateAsset({
    model, input: {}, timeoutMs: 30,
    hooks: { onStart() { return new Promise(() => {}); } },
  }), error => {
    assert.equal(error.code, 'ASSET_TIMEOUT');
    return true;
  });
  assert.equal(calls.start.length, 0);
  assert.equal(calls.status.length, 0);
});

test('onStart failure is propagated before any submission', { timeout: TEST_TIMEOUT }, async () => {
  const cause = new Error('Start observer rejected');
  const { model, calls } = jobModel();
  await assert.rejects(generateAsset({ model, input: {}, hooks: { async onStart() { throw cause; } } }), error => {
    assert.ok(error instanceof AssetHookError);
    assert.equal(error.hook, 'onStart');
    assert.equal(error.cause, cause);
    return true;
  });
  assert.equal(calls.start.length, 0);
});

test('onOperation failure retains the accepted job and never polls or resubmits', { timeout: TEST_TIMEOUT }, async () => {
  const cause = new Error('Could not persist operation');
  const { model, calls } = jobModel();
  await assert.rejects(generateAsset({
    model, input: {}, poll: fastPoll,
    hooks: { async onOperation() { throw cause; } },
  }), error => {
    assert.ok(error instanceof AssetHookError);
    assert.equal(error.hook, 'onOperation');
    assert.equal(error.cause, cause);
    assert.deepEqual(error.operation, operationFor(model));
    return true;
  });
  assert.equal(calls.start.length, 1);
  assert.equal(calls.status.length, 0);
});

test('onFinish failure exposes the completed result, without onError or another provider attempt', { timeout: TEST_TIMEOUT }, async () => {
  const terminals = [];
  let calls = 0;
  const cause = new Error('Finish observer rejected');
  const model = {
    specificationVersion: 'v1', provider: 'finish-test', modelId: 'direct', kind: 'model-3d',
    capabilities: { idempotentGenerate: true },
    async doGenerate() { calls++; return output(); },
  };
  await assert.rejects(generateAsset({
    model, input: {}, retry: { ...fastRetry, generate: 2 },
    hooks: {
      ...terminalRecorder(terminals),
      async onFinish() { terminals.push('finish'); throw cause; },
    },
  }), error => {
    assert.ok(error instanceof AssetHookError);
    assert.equal(error.hook, 'onFinish');
    assert.equal(error.cause, cause);
    assert.deepEqual(error.result.asset, output().assets[0]);
    return true;
  });
  assert.equal(calls, 1);
  assert.deepEqual(terminals, ['finish']);
});

test('an error-hook failure preserves the original execution error and operation', { timeout: TEST_TIMEOUT }, async () => {
  const observerError = new Error('Error observer rejected');
  let onErrorCalls = 0;
  const { model, calls } = jobModel('model-3d', {
    async doStatus() { return { status: 'failed', error: { message: 'Remote job failed' } }; },
  });
  await assert.rejects(generateAsset({
    model, input: {}, poll: fastPoll,
    hooks: { async onError() { onErrorCalls++; throw observerError; } },
  }), error => {
    assert.ok(error instanceof AssetHookError);
    assert.equal(error.hook, 'onError');
    assert.equal(error.cause, observerError);
    assert.equal(error.executionError.code, 'ASSET_JOB_FAILED');
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

test('webhook finalization is bounded by the poll deadline even when its query ignores abort', { timeout: TEST_TIMEOUT }, async () => {
  let statusCalls = 0;
  let statusSignal;
  const { model, calls } = jobModel('model-3d', {
    capabilities: { webhooks: true },
    doStatus(options) {
      statusCalls++;
      statusSignal = options.abortSignal;
      return new Promise(() => {});
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
  let progressEvents = 0;
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
      onProgress(event) {
        progressEvents++;
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
      },
    },
  });
  assert.equal(progressEvents, 1);
  assert.equal(queries, 2);
  assert.deepEqual(result.operation, operationFor(model));
});

test('a non-boolean idempotency capability is rejected before submission', { timeout: TEST_TIMEOUT }, async () => {
  const { model, calls } = jobModel('model-3d', {
    capabilities: { idempotentStart: 'false' },
  });
  await assert.rejects(startAsset({
    model, input: {}, retry: { ...fastRetry, start: 1 },
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
    let started = false;
    const options = {
      model, operation: original, ...(api === 'waitForAsset' ? { poll: fastPoll } : {}),
      hooks: {
        onStart(event) {
          started = true;
          assert.deepEqual(event.operation, expected);
          assert.notEqual(event.operation, original);
          assert.notEqual(event.operation.operation, original.operation);
          assert.ok(Object.isFrozen(event.operation));
          assert.ok(Object.isFrozen(event.operation.operation));
          assert.ok(Object.isFrozen(event.operation.operation.route));
          assert.ok(Object.isFrozen(event.operation.operation.parts));
          assert.ok(Object.isFrozen(event.operation.operation.parts[0]));
          assert.equal(Reflect.set(event.operation, 'provider', 'other-provider'), false);
          assert.equal(Reflect.set(event.operation.operation, 'requestId', 'hook-target'), false);
          assert.equal(Reflect.set(event.operation.operation.route, 'region', 'hook-region'), false);
          assert.equal(Reflect.set(event.operation.operation.parts[0], 'id', 'hook-part'), false);

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
    assert.equal(started, true);
    assert.deepEqual(requests, [expected.operation]);
    assert.deepEqual(result.operation, expected);
    assert.equal(calls.start.length, 0);
  });

  test(api + ': an onStart failure retains the existing operation without contacting the provider', { timeout: TEST_TIMEOUT }, async () => {
    let cancelCalls = 0;
    const { model, calls } = jobModel('model-3d', {
      async doCancel() { cancelCalls++; return { status: 'requested' }; },
    });
    const operation = operationFor(model);
    const cause = new Error('Start hook failed while restoring the job');
    let errors = 0;
    await assert.rejects(invoke({
      model, operation,
      hooks: {
        onStart(event) {
          assert.deepEqual(event.operation, operation);
          throw cause;
        },
        onError(event) {
          errors++;
          assert.deepEqual(event.operation, operation);
        },
      },
    }), error => {
      assert.ok(error instanceof AssetHookError);
      assert.equal(error.hook, 'onStart');
      assert.equal(error.cause, cause);
      assert.deepEqual(error.operation, operation);
      return true;
    });
    assert.equal(errors, 1);
    assert.equal(calls.start.length, 0);
    assert.equal(calls.status.length, 0);
    assert.equal(cancelCalls, 0);
  });

  test(api + ': pre-aborted restoration preserves the operation in the error and abort event', { timeout: TEST_TIMEOUT }, async () => {
    let cancelCalls = 0;
    const { model, calls } = jobModel('model-3d', {
      async doCancel() { cancelCalls++; return { status: 'requested' }; },
    });
    const operation = operationFor(model);
    const controller = new AbortController();
    controller.abort(new Error('Already stopped'));
    const terminals = [];
    await assert.rejects(invoke({
      model, operation, abortSignal: controller.signal,
      hooks: {
        ...terminalRecorder(terminals),
        onStart() { assert.fail('onStart must not run for a pre-aborted call'); },
        onAbort(event) {
          terminals.push('abort');
          assert.deepEqual(event.operation, operation);
          assert.deepEqual(event.error.operation, operation);
        },
      },
    }), error => {
      assert.ok(error instanceof AssetAbortError);
      assert.deepEqual(error.operation, operation);
      return true;
    });
    assert.deepEqual(terminals, ['abort']);
    assert.equal(calls.start.length, 0);
    assert.equal(calls.status.length, 0);
    assert.equal(cancelCalls, 0);
  });
}

test('a newly submitted operation is detached and deeply frozen before persistence hooks or polling', { timeout: TEST_TIMEOUT }, async () => {
  const providerOperation = {
    requestId: 'accepted-job', route: { region: 'accepted-region' }, parts: [{ id: 'accepted-part' }],
  };
  const expectedPayload = JSON.parse(JSON.stringify(providerOperation));
  let submits = 0;
  let persists = 0;
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
        persists++;
        assert.deepEqual(event.operation.operation, expectedPayload);
        assert.notEqual(event.operation.operation, providerOperation);
        assert.ok(Object.isFrozen(event.operation));
        assert.ok(Object.isFrozen(event.operation.operation));
        assert.ok(Object.isFrozen(event.operation.operation.route));
        assert.ok(Object.isFrozen(event.operation.operation.parts));
        assert.ok(Object.isFrozen(event.operation.operation.parts[0]));
        assert.equal(Reflect.set(event.operation.operation, 'requestId', 'hook-target'), false);
        assert.equal(Reflect.set(event.operation.operation.parts[0], 'id', 'hook-part'), false);
        providerOperation.requestId = 'provider-target';
        providerOperation.route.region = 'provider-region';
        providerOperation.parts[0].id = 'provider-part';
      },
    },
  });
  assert.equal(submits, 1);
  assert.equal(persists, 1);
  assert.equal(queries, 1);
  assert.deepEqual(result.operation, operationFor(model, expectedPayload));
});

for (const descriptor of ['non-enumerable toJSON', 'accessor']) {
  for (const path of ['submission', 'restoration']) {
    test(path + ': operation with ' + descriptor + ' is rejected without executing or persisting it', { timeout: TEST_TIMEOUT }, async () => {
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
      let persists = 0;
      const { model, calls } = jobModel('model-3d', {
        async doStart() { submits++; return { operation }; },
      });
      const hooks = { onOperation() { persists++; } };
      const promise = path === 'submission'
        ? generateAsset({ model, input: {}, poll: fastPoll, hooks })
        : getAssetStatus({ model, operation: operationFor(model, operation), hooks });
      await assert.rejects(promise);
      assert.equal(executed, 0, 'JSON validation must inspect descriptors without invoking user code');
      assert.equal(persists, 0, 'a lossy operation must not reach the persistence hook');
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

test('onAttempt failure during a retry remains an AssetHookError and does not cause another provider request', { timeout: TEST_TIMEOUT }, async () => {
  const cause = new Error('Observer rejected the second attempt');
  let queries = 0;
  const attempts = [];
  const terminals = [];
  const { model } = jobModel('model-3d', {
    async doStatus() { queries++; throw transientError(); },
  });
  const operation = operationFor(model);
  await assert.rejects(getAssetStatus({
    model, operation, retry: { ...fastRetry, status: 3 },
    hooks: {
      ...terminalRecorder(terminals),
      onAttempt(event) {
        attempts.push(event.attemptNumber);
        if (event.attemptNumber === 2) throw cause;
      },
    },
  }), error => {
    assert.ok(error instanceof AssetHookError);
    assert.equal(error.hook, 'onAttempt');
    assert.equal(error.cause, cause);
    assert.deepEqual(error.operation, operation);
    return true;
  });
  assert.deepEqual(attempts, [1, 2]);
  assert.equal(queries, 1);
  assert.deepEqual(terminals, ['error']);
});
