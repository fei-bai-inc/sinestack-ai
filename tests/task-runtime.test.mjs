import assert from 'node:assert/strict';
import test from 'node:test';
import { APICallError } from '@ai-sdk/provider';
import { checkRigging, processModel3D, rigModel, animateModel, startTask, getTaskStatus, waitForTask, cancelTask, deleteTask, TaskExecutionError, TaskAbortError, generateAsset } from '@sinestack/ai-core';
const poll = { intervalMs: 0, delay: async () => {} };
function fixture(domain = 'model3d.rig.check', overrides = {}) {
  const calls = { start: 0, status: 0, cancel: 0, delete: 0 };
  const model = { specificationVersion: 'v1', provider: 'fixture', driverId: 'check', domain,
    async doStart() { calls.start++; return { handle: { id: 'one' }, response: { body: 'start' } }; },
    async doStatus() { calls.status++; return { status: 'completed', result: { riggable: false }, response: { body: 'final' } }; },
    ...overrides };
  return { model, calls };
}

test('rig checks return a typed business conclusion without artificial assets', async () => {
  const { model, calls } = fixture();
  const result = await checkRigging({ checker: model, input: {}, poll });
  assert.equal(result.riggable, false);
  assert.equal('assets' in result, false);
  assert.equal('output' in result, false);
  assert.equal(result.execution.task.type, 'sine-ai-task');
  assert.deepEqual(result.execution.responses.map(r => r.body), ['start', 'final']);
  assert.deepEqual(calls, { start: 1, status: 1, cancel: 0, delete: 0 });
});
test('domain onFinish observes the public result and malformed results call onError instead', async () => {
  const { model } = fixture(); let seen;
  const result = await checkRigging({ checker: model, input: {}, hooks: { onFinish(event) { seen = event.result; } } });
  assert.equal(seen, result);
  const bad = fixture('model3d.rig', { async doStatus() { return { status: 'completed', result: null }; } });
  const events = [];
  await assert.rejects(rigModel({ rigger: bad.model, input: {}, hooks: { onFinish() { events.push('finish'); }, onError() { events.push('error'); } } }));
  assert.deepEqual(events, ['error']);
});
test('resume uses the saved task and preserves exact domain result types', async () => {
  const first = fixture(); const started = await startTask({ model: first.model, input: {} });
  assert.equal(first.calls.status, 0);
  const restored = fixture(); const task = JSON.parse(JSON.stringify(started.task));
  const result = await waitForTask({ model: restored.model, task, poll });
  assert.equal(result.result.riggable, false); assert.equal(restored.calls.start, 0); assert.equal(restored.calls.status, 1);
  assert.deepEqual(result.execution.task, task);
});
test('wrong domain capability is rejected before submitting', async () => {
  const { model, calls } = fixture();
  await assert.rejects(rigModel({ rigger: model, input: {} }), /requires/);
  await assert.rejects(processModel3D({ processor: model, input: {} }), /requires/);
  await assert.rejects(animateModel({ animator: model, input: {} }), /requires/);
  assert.equal(calls.start, 0);
});
for (const key of ['type', 'provider', 'driverId', 'domain', 'modelId', 'connectionId', 'specificationVersion']) {
  test(`task identity: ${key} mismatch fails before hooks or I/O`, async () => {
    const { model, calls } = fixture(); const { task } = await startTask({ model, input: {} });
    let hooks = 0;
    await assert.rejects(getTaskStatus({ model, task: { ...task, [key]: 'wrong' }, hooks: { onStart() { hooks++; } } }));
    assert.equal(hooks, 0); assert.equal(calls.status, 0);
  });
}
test('task envelopes cannot be retargeted by a hook or an executable accessor', async () => {
  const { model } = fixture(); const { task } = await startTask({ model, input: {} });
  const mutable = JSON.parse(JSON.stringify(task)); let captured; let fetched;
  const resumed = { ...model, async doStatus({ handle }) { fetched = handle; return { status: 'completed', result: { riggable: true } }; } };
  await getTaskStatus({ model: resumed, task: mutable, hooks: { onStart(event) { captured = event.task; mutable.handle.id = 'changed'; } } });
  assert.equal(fetched.id, 'one'); assert.ok(Object.isFrozen(captured.handle));
  let getters = 0;
  const invalid = { ...task, get provider() { getters++; return task.provider; } };
  await assert.rejects(getTaskStatus({ model, task: invalid })); assert.equal(getters, 0);
});
test('status retries reuse the task and never repeat submission', async () => {
  let reads = 0;
  const { model, calls } = fixture('model3d.rig.check', { async doStatus() {
    if (++reads === 1) throw new APICallError({ message: 'retry read', url: 'https://example.test', requestBodyValues: undefined, statusCode: 503, responseHeaders: { 'retry-after-ms': '0' } });
    return { status: 'completed', result: { riggable: false } };
  } });
  await checkRigging({ checker: model, input: {}, poll }); assert.equal(reads, 2); assert.equal(calls.start, 1);
});
test('nonidempotent submission retry configuration is rejected without starting', async () => {
  const { model, calls } = fixture();
  await assert.rejects(startTask({ model, input: {}, retry: { start: 1 } }), /idempotent/); assert.equal(calls.start, 0);
});
test('remote failure is returned by status but is terminal for waiting', async () => {
  const { model, calls } = fixture('model3d.rig.check', { async doStatus() { calls.status++; return { status: 'failed', error: { message: 'no credits', code: 'LOW_BALANCE' } }; } });
  const { task } = await startTask({ model, input: {} });
  assert.equal((await getTaskStatus({ model, task })).status, 'failed');
  await assert.rejects(waitForTask({ model, task, retry: { status: 4 } }), error => error instanceof TaskExecutionError && error.code === 'TASK_JOB_FAILED' && error.task.handle.id === 'one');
  assert.equal(calls.status, 2); assert.equal(calls.start, 1);
});
test('local abort, remote cancel and resource deletion are separate', async () => {
  const { model, calls } = fixture('model3d.rig.check', {
    async doCancel() { calls.cancel++; return { status: 'requested' }; },
    async doDelete() { calls.delete++; return { status: 'deleted' }; },
  });
  const { task } = await startTask({ model, input: {} });
  await assert.rejects(waitForTask({ model, task, abortSignal: AbortSignal.abort() }), error => error instanceof TaskAbortError && error.task.handle.id === 'one');
  assert.equal(calls.cancel, 0); assert.equal(calls.delete, 0);
  assert.equal((await cancelTask({ model, task })).status, 'requested'); assert.equal(calls.delete, 0);
  assert.equal((await deleteTask({ model, task })).status, 'deleted'); assert.equal(calls.cancel, 1);
});
test('early nonterminal notification continues polling the same task', async () => {
  let reads = 0;
  const { model, calls } = fixture('model3d.rig.check', { async doStatus() {
    return ++reads === 1 ? { status: 'running' } : { status: 'completed', result: { riggable: false } };
  } });
  const { task } = await startTask({ model, input: {} });
  await waitForTask({ model, task, notification: Promise.resolve({ forgedResult: true }), poll });
  assert.equal(reads, 2); assert.equal(calls.start, 1);
});
test('direct domain calls need no fabricated task and observer failures do not change results', async () => {
  const model = { specificationVersion: 'v1', provider: 'local', driverId: 'check', domain: 'model3d.rig.check',
    async doExecute() { return { result: { riggable: true } }; } };
  const report = await checkRigging({ checker: model, input: {}, hooks: { onFinish() { throw new Error('observer'); } } });
  assert.equal(report.riggable, true); assert.equal(report.execution.task, undefined);
});
test('legacy Asset results keep nonempty files and never duplicate the final response', async () => {
  const model = { specificationVersion: 'v1', provider: 'legacy', modelId: 'asset', kind: 'model-3d',
    async doStart() { return { operation: { id: 'one' }, response: { body: 'start' } }; },
    async doStatus() { return { status: 'completed', result: { assets: [{ type: 'url', url: 'https://example.test/a.glb', mediaType: 'model/gltf-binary' }], response: { body: 'final' } } }; },
  };
  const result = await generateAsset({ model, input: {}, poll });
  assert.deepEqual(result.responses.map(r => r.body), ['start', 'final']);
  assert.equal(result.operation.type, undefined); assert.equal(result.operation.kind, 'model-3d');
});

test('restored controls validate the provider handle before hooks or remote I/O', async () => {
  const { model, calls } = fixture('model3d.rig.check', {
    connectionId: 'original-account',
    validateHandle(handle) {
      if (handle.id !== 'one') throw new TypeError('Unknown task route');
    },
    async doCancel() { calls.cancel++; return { status: 'requested' }; },
    async doDelete() { calls.delete++; return { status: 'deleted' }; },
  });
  const { task } = await startTask({ model, input: {} });
  for (const invoke of [getTaskStatus, waitForTask, cancelTask, deleteTask]) {
    let hooks = 0;
    for (const invalid of [
      { ...task, connectionId: 'different-account' },
      { ...task, handle: { id: 'different-job' } },
    ]) {
      await assert.rejects(invoke({ model, task: invalid, hooks: { onStart() { hooks++; } } }), TypeError);
    }
    assert.equal(hooks, 0);
  }
  assert.deepEqual(calls, { start: 1, status: 0, cancel: 0, delete: 0 });
});

test('abort after acceptance retains the saved task despite failing observers and permits resumption', async () => {
  const controller = new AbortController();
  const reason = new Error('Stop locally after persisting acceptance');
  const { model, calls } = fixture('model3d.rig.check', {
    async doCancel() { calls.cancel++; return { status: 'cancelled' }; },
    async doDelete() { calls.delete++; return { status: 'deleted' }; },
  });
  let saved;
  let observedError;
  let finishes = 0;
  let failure;
  await assert.rejects(checkRigging({
    checker: model, input: {}, abortSignal: controller.signal, poll,
    hooks: {
      async onOperation(event) {
        saved = JSON.stringify(event.task);
        controller.abort(reason);
        throw new Error('Persistence observer rejected after saving');
      },
      onFinish() { finishes++; },
      async onError(event) { observedError = event.error; throw new Error('Error observer rejected'); },
    },
  }), error => {
    failure = error;
    return error instanceof TaskAbortError && error.cause === reason;
  });
  assert.equal(observedError, failure);
  assert.deepEqual(failure.task, JSON.parse(saved));
  assert.equal(finishes, 0);
  assert.deepEqual(calls, { start: 1, status: 0, cancel: 0, delete: 0 });
  const resumed = await waitForTask({ model, task: JSON.parse(saved), poll });
  assert.equal(resumed.result.riggable, false);
  assert.deepEqual(calls, { start: 1, status: 1, cancel: 0, delete: 0 });
});

test('a cancellation request leaves the saved task queryable until remote cancellation is observed', async () => {
  let cancelled = false;
  const { model, calls } = fixture('model3d.rig.check', {
    async doCancel() { calls.cancel++; return { status: 'requested' }; },
    async doDelete() { calls.delete++; return { status: 'deleted' }; },
    async doStatus() {
      calls.status++;
      return cancelled ? { status: 'cancelled', message: 'Stopped remotely' } : { status: 'running' };
    },
  });
  const { task } = await startTask({ model, input: {} });
  const acknowledgement = await cancelTask({ model, task });
  assert.equal(acknowledgement.status, 'requested');
  assert.deepEqual(acknowledgement.task, task);
  assert.equal((await getTaskStatus({ model, task })).status, 'running');
  cancelled = true;
  await assert.rejects(waitForTask({ model, task, retry: { status: 3 }, poll }), error => {
    assert.ok(error instanceof TaskAbortError);
    assert.deepEqual(error.task, task);
    assert.equal(error.message, 'Stopped remotely');
    return true;
  });
  assert.deepEqual(calls, { start: 1, status: 2, cancel: 1, delete: 0 });
});

test('invalid completion is not retried and observer failure cannot hide its accepted task', async () => {
  const { model, calls } = fixture('model3d.rig.check', {
    async doStatus() { calls.status++; return { status: 'completed' }; },
  });
  let accepted;
  let observed;
  let finishes = 0;
  await assert.rejects(checkRigging({
    checker: model, input: {}, poll, retry: { status: 4 },
    hooks: {
      onOperation(event) { accepted = event.task; },
      onFinish() { finishes++; },
      onError(event) { observed = event; throw new Error('Observer failure'); },
    },
  }), error => {
    assert.ok(error instanceof TaskExecutionError);
    assert.ok(error.cause instanceof TypeError);
    assert.equal(error.phase, 'status');
    assert.equal(error.task, accepted);
    assert.equal(observed.error, error);
    assert.equal(observed.task, accepted);
    return true;
  });
  assert.equal(finishes, 0);
  assert.deepEqual(calls, { start: 1, status: 1, cancel: 0, delete: 0 });
});

test('retrying an idempotent start restores headers and cannot fall back to direct execution', async () => {
  const submissions = [];
  let directCalls = 0;
  const headers = { 'Idempotency-Key': 'caller-submission', 'x-account': 'original' };
  const { model, calls } = fixture('model3d.rig.check', {
    capabilities: { idempotentStart: true },
    async doExecute() { directCalls++; return { result: { riggable: true } }; },
    async doStart(options) {
      calls.start++;
      submissions.push({ key: options.idempotencyKey, headers: { ...options.headers } });
      options.headers['idempotency-key'] = 'mutated-by-adapter';
      options.headers['x-account'] = 'different-account';
      if (calls.start === 1) throw new APICallError({
        message: 'Retry accepted route', url: 'https://example.test', requestBodyValues: undefined,
        statusCode: 503, responseHeaders: { 'retry-after-ms': '0' },
      });
      return { handle: { id: 'one' } };
    },
  });
  const result = await checkRigging({ checker: model, input: {}, execution: 'async', poll, headers, retry: { start: 1 } });
  assert.equal(result.riggable, false);
  assert.equal(submissions.length, 2);
  for (const submission of submissions) {
    assert.equal(submission.key, 'caller-submission');
    assert.equal(new Headers(submission.headers).get('idempotency-key'), 'caller-submission');
    assert.equal(new Headers(submission.headers).get('x-account'), 'original');
  }
  assert.deepEqual(headers, { 'Idempotency-Key': 'caller-submission', 'x-account': 'original' });
  assert.equal(directCalls, 0);
  assert.deepEqual(calls, { start: 2, status: 1, cancel: 0, delete: 0 });
});
