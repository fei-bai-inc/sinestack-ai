import assert from 'node:assert/strict';
import test from 'node:test';
import {
  startTask, getTaskStatus, waitForTask, generateAsset, startAsset, getAssetStatus,
  TaskExecutionError, TaskAbortError, AssetExecutionError, AssetAbortError,
} from '@sinestack/ai-core';

const nativeError = { message: 'resource cannot be processed', code: 'INVALID_RESOURCE' };
const diagnostics = {
  response: {
    headers: { 'x-request-id': 'request-one' },
    body: { status: 'FAILED', error: nativeError, resources: [{ id: 'resource-one', status: 'invalid' }] },
  },
  providerMetadata: { fixture: {
    request_id: 'request-one', retryable: false, details: { resource: 'resource-one' },
    remediation: 'replace the resource', resourceStatus: 'invalid',
  } },
};

function taskFixture(status) {
  const calls = { start: 0, status: 0 };
  const model = {
    specificationVersion: 'v1', provider: 'fixture', driverId: 'inspect', domain: 'fixture.inspect',
    async doStart() { calls.start++; return { handle: { id: 'one' } }; },
    async doStatus() { calls.status++; return status; },
  };
  return { model, calls };
}
function assetFixture(status) {
  const calls = { start: 0, status: 0 };
  const model = {
    specificationVersion: 'v1', provider: 'fixture', modelId: 'create', kind: 'fixture-asset',
    async doStart() { calls.start++; return { operation: { id: 'one' } }; },
    async doStatus() { calls.status++; return status; },
  };
  return { model, calls };
}
function assertDiagnostics(error) {
  assert.deepEqual(error.response, diagnostics.response);
  assert.deepEqual(error.providerMetadata, diagnostics.providerMetadata);
}

test('HTTP-successful failed tasks retain native diagnostics in status, thrown error, and onError', async () => {
  const { model, calls } = taskFixture({ status: 'failed', error: nativeError, ...diagnostics });
  const { task } = await startTask({ model, input: {} });
  const status = await getTaskStatus({ model, task });
  assert.equal(status.status, 'failed');
  assertDiagnostics(status);
  let observed;
  let thrown;
  await assert.rejects(waitForTask({ model, task, retry: { status: 4 }, hooks: { onError(event) { observed = event.error; } } }), error => {
    thrown = error;
    assert.ok(error instanceof TaskExecutionError);
    assert.equal(error.code, 'TASK_JOB_FAILED');
    assert.equal(error.phase, 'status');
    assert.equal(error.task.handle.id, 'one');
    assert.equal(error.cause.cause, nativeError);
    assertDiagnostics(error);
    return true;
  });
  assert.equal(observed, thrown);
  assert.deepEqual(calls, { start: 1, status: 2 }, 'remote failure neither retries the observation nor resubmits');
});

test('Asset compatibility retains failed task diagnostics and the same public onError object', async () => {
  const { model, calls } = assetFixture({ status: 'failed', error: nativeError, ...diagnostics });
  const { operation } = await startAsset({ model, input: {} });
  assertDiagnostics(await getAssetStatus({ model, operation }));
  let observed;
  let thrown;
  await assert.rejects(generateAsset({ model, input: {}, retry: { status: 4 }, hooks: { onError(event) { observed = event.error; } } }), error => {
    thrown = error;
    assert.ok(error instanceof AssetExecutionError);
    assert.equal(error.code, 'ASSET_JOB_FAILED');
    assert.equal(error.phase, 'status');
    assert.equal(error.operation.operation.id, 'one');
    assert.equal(error.cause.cause, nativeError);
    assertDiagnostics(error);
    return true;
  });
  assert.equal(observed, thrown);
  assert.deepEqual(calls, { start: 2, status: 2 });
});

test('remote task cancellation retains response and provider metadata through error wrapping', async () => {
  const { model, calls } = taskFixture({ status: 'cancelled', message: 'cancelled remotely', ...diagnostics });
  const { task } = await startTask({ model, input: {} });
  let observed;
  await assert.rejects(waitForTask({ model, task, hooks: { onError(event) { observed = event.error; } } }), error => {
    assert.ok(error instanceof TaskAbortError);
    assert.equal(error.code, 'TASK_ABORTED');
    assert.equal(error.task.handle.id, 'one');
    assert.equal(observed, error);
    assertDiagnostics(error);
    return true;
  });
  assert.deepEqual(calls, { start: 1, status: 1 });
});

test('remote Asset cancellation retains diagnostics in its legacy error type', async () => {
  const { model, calls } = assetFixture({ status: 'cancelled', message: 'cancelled remotely', ...diagnostics });
  let observed;
  await assert.rejects(generateAsset({ model, input: {}, hooks: { onError(event) { observed = event.error; } } }), error => {
    assert.ok(error instanceof AssetAbortError);
    assert.equal(error.code, 'ASSET_ABORTED');
    assert.equal(error.operation.operation.id, 'one');
    assert.equal(observed, error);
    assertDiagnostics(error);
    return true;
  });
  assert.deepEqual(calls, { start: 1, status: 1 });
});

test('explicit driver errors preserve diagnostics and their original cause', async () => {
  const underlying = new Error('native decoder rejected the resource');
  const original = new TaskExecutionError('native error', { code: 'NATIVE_ERROR', cause: underlying, ...diagnostics });
  const { model } = taskFixture({ status: 'running' });
  model.doStatus = async () => { throw original; };
  const { task } = await startTask({ model, input: {} });
  await assert.rejects(getTaskStatus({ model, task }), error => {
    assert.equal(error.code, 'NATIVE_ERROR');
    assert.equal(error.cause, original);
    assert.equal(error.cause.cause, underlying);
    assertDiagnostics(error);
    return true;
  });
});

test('an Asset provider error keeps its own code and diagnostics across the shared runtime', async () => {
  const original = new AssetExecutionError('native asset error', { code: 'ASSET_NATIVE', ...diagnostics });
  const model = {
    specificationVersion: 'v1', provider: 'fixture', modelId: 'direct', kind: 'fixture-asset',
    async doGenerate() { throw original; },
  };
  await assert.rejects(generateAsset({ model, input: {} }), error => {
    assert.equal(error.code, 'ASSET_NATIVE');
    assert.equal(error.cause, original);
    assertDiagnostics(error);
    return true;
  });
});
