import assert from 'node:assert/strict';
import test from 'node:test';
import { APICallError } from '@ai-sdk/provider';
import {
  generate3D, generateSoundEffect, startAsset, waitForAsset,
} from '@sine-ai/core';
import {
  createFalAssetProvider, FAL_THREE_D_MODEL, FAL_SOUND_EFFECT_MODEL,
} from '@sine-ai/fal';

const BASE = 'https://queue.fal.run';
const API_KEY = 'fake-integration-key';
const retry = { status: 2 };

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}

function accepted(modelId, requestId) {
  const app = modelId.split('/').slice(0, 2).join('/');
  const response_url = `${BASE}/${app}/requests/${requestId}`;
  return {
    request_id: requestId, response_url,
    status_url: `${response_url}/status`, cancel_url: `${response_url}/cancel`,
  };
}

const cases = [
  {
    name: '3D', kind: 'model-3d', modelId: FAL_THREE_D_MODEL,
    model: fal => fal.threeD(), generate: generate3D,
    input: { prompt: 'A stylized wooden treasure chest' },
    wireInput: { prompt: 'A stylized wooden treasure chest' },
    output: {
      model_glb: { url: 'https://v3.fal.media/chest.glb', content_type: 'model/gltf-binary', file_name: 'chest.glb' },
      thumbnail: { url: 'https://v3.fal.media/chest.png', content_type: 'image/png' },
    },
    assetURL: 'https://v3.fal.media/chest.glb', mediaType: 'model/gltf-binary', assetCount: 2,
  },
  {
    name: 'sound effect', kind: 'sound-effect', modelId: FAL_SOUND_EFFECT_MODEL,
    model: fal => fal.soundEffect(), generate: generateSoundEffect,
    input: { prompt: 'A creaking wooden chest opens', durationSeconds: 3, promptInfluence: 0.6, loop: false },
    wireInput: { text: 'A creaking wooden chest opens', duration_seconds: 3, prompt_influence: 0.6, loop: false },
    output: { audio: { url: 'https://v3.fal.media/chest-open.mp3' } },
    assetURL: 'https://v3.fal.media/chest-open.mp3', mediaType: 'audio/mpeg', assetCount: 1,
  },
];

for (const scenario of cases) {
  test(`core ${scenario.name} facade and fal adapter share submission, polling, retry, and lifecycle semantics`, { timeout: 5_000 }, async t => {
    const network = t.mock.method(globalThis, 'fetch', () => assert.fail('Integration tests must never access the network.'));
    const requestId = `integration-${scenario.kind}`;
    const submitted = accepted(scenario.modelId, requestId);
    const calls = [];
    const lifecycle = [];
    const hookEvents = [];
    let statusReads = 0;
    let pollDelays = 0;
    let startHookSettled = false;
    let observedOperation;
    let finishResult;

    const fakeFetch = async (url, init) => {
      const headers = new Headers(init.headers);
      const call = { url: String(url), method: init.method, headers, body: init.body };
      calls.push(call);
      assert.equal(init.redirect, 'error');
      assert.ok(init.signal instanceof AbortSignal);
      assert.equal(headers.get('authorization'), `Key ${API_KEY}`);
      assert.match(headers.get('user-agent'), /sine-ai\/0\.1\.0/);
      if (call.method === 'POST') {
        assert.equal(startHookSettled, true, 'The shared onStart hook must finish before submitting.');
        assert.equal(call.url, `${BASE}/${scenario.modelId}`);
        assert.deepEqual(JSON.parse(call.body), scenario.wireInput);
        return json(submitted, 202);
      }
      assert.ok(observedOperation, 'The shared onOperation observation must finish before polling.');
      if (call.url === submitted.status_url) {
        statusReads++;
        switch (statusReads) {
          case 1: return json({ detail: 'Rate limit: retry this status read' }, 429, { 'retry-after-ms': '0' });
          case 2: return json({ status: 'IN_QUEUE', request_id: requestId, queue_position: 1 });
          case 3: return json({ status: 'IN_PROGRESS', request_id: requestId, logs: [{ message: 'Generating asset' }] });
          case 4: return json({ status: 'COMPLETED', request_id: requestId, response_url: submitted.response_url });
          default: assert.fail('The executor must stop querying after completion.');
        }
      }
      assert.equal(call.url, submitted.response_url);
      return json(scenario.output);
    };
    const fal = createFalAssetProvider({ apiKey: API_KEY, fetch: fakeFetch });
    const remember = (name, event) => { lifecycle.push(name); hookEvents.push(event); };
    const hooks = {
      async onStart(event) {
        remember('start', event);
        await Promise.resolve();
        startHookSettled = true;
      },
      async onOperation(event) {
        remember('operation', event);
        await Promise.resolve();
        observedOperation = event.operation;
      },
      onProgress(event) { remember(`progress:${event.status}`, event); },
      onFinish(event) { remember('finish', event); finishResult = event.result; },
      onError(event) { remember('error', event); },
    };

    const result = await scenario.generate({
      model: scenario.model(fal), ...scenario.input,
      timeoutMs: 2_000, retry, hooks,
      poll: {
        intervalMs: 0, timeoutMs: 1_500,
        async delay(_milliseconds, { abortSignal }) {
          assert.equal(abortSignal.aborted, false);
          pollDelays++;
        },
      },
    });

    assert.equal(calls.filter(call => call.method === 'POST').length, 1, 'A failed status query must not resubmit billable work.');
    assert.equal(statusReads, 4, 'The query is retried once and then polling follows the existing job.');
    assert.equal(calls.filter(call => call.url === submitted.response_url).length, 1);
    assert.equal(pollDelays, 2);
    assert.deepEqual(lifecycle, ['start', 'operation', 'progress:pending', 'progress:running', 'finish']);
    // Observation callbacks swallow their own errors. Keep contract assertions outside them.
    assert.ok(hookEvents.every(event => typeof event.callId === 'string' && event.callId.length > 0));
    assert.equal(new Set(hookEvents.map(event => event.callId)).size, 1);
    assert.ok(hookEvents.every(event => event.kind === scenario.kind && event.provider === 'fal' && event.modelId === scenario.modelId && event.api === 'generateAsset'));
    assert.equal(result.assets.length, scenario.assetCount);
    assert.equal(result.asset.type, 'url');
    assert.equal(result.asset.url, scenario.assetURL);
    assert.equal(result.asset.mediaType, scenario.mediaType);
    assert.equal(finishResult, result);
    assert.equal(result.operation, observedOperation);
    assert.equal(Object.isFrozen(observedOperation), true);
    assert.equal(Object.isFrozen(observedOperation.operation), true);
    assert.ok(hookEvents.filter(event => event.operation !== undefined).every(event => event.operation === observedOperation));
    assert.equal(result.operation.kind, scenario.kind);
    assert.equal(result.operation.operation.requestId, requestId);
    assert.equal(result.responses.length, 2, 'Submission and final result response metadata remain available.');
    assert.equal(JSON.stringify(observedOperation).includes(API_KEY), false);
    assert.ok(calls.every(call => new URL(call.url).origin === BASE), 'URL assets must not be implicitly downloaded.');
    assert.equal(network.mock.callCount(), 0);
  });
}

test('a fal job resumes through the real core from persisted JSON and a fresh provider without another POST', { timeout: 5_000 }, async t => {
  const network = t.mock.method(globalThis, 'fetch', () => assert.fail('No network is allowed.'));
  const submitted = accepted(FAL_THREE_D_MODEL, 'persisted-job');
  let submissions = 0;
  const submissionProvider = createFalAssetProvider({
    apiKey: API_KEY,
    async fetch(url, init) {
      assert.equal(String(url), `${BASE}/${FAL_THREE_D_MODEL}`);
      assert.equal(init.method, 'POST');
      submissions++;
      return json(submitted, 202);
    },
  });
  const started = await startAsset({
    model: submissionProvider.threeD(), input: { prompt: 'A bronze lantern' },
  });
  // Critical persistence is explicit application work, outside best-effort observation callbacks.
  const savedJSON = JSON.stringify(started.operation);
  const reads = [];
  let statusReads = 0;
  const resumedProvider = createFalAssetProvider({
    apiKey: API_KEY,
    async fetch(url, init) {
      assert.equal(init.method, 'GET', 'A resumed call cannot submit a new job.');
      reads.push(String(url));
      if (String(url) === submitted.status_url) {
        statusReads++;
        return json({ status: statusReads === 1 ? 'IN_PROGRESS' : 'COMPLETED' });
      }
      assert.equal(String(url), submitted.response_url);
      return json({ model_glb: { url: 'https://v3.fal.media/lantern.glb' } });
    },
  });
  const result = await waitForAsset({
    model: resumedProvider.threeD(), operation: JSON.parse(savedJSON),
    poll: { intervalMs: 0, delay: async () => {} }, retry,
  });
  assert.equal(submissions, 1);
  assert.deepEqual(reads, [submitted.status_url, submitted.status_url, submitted.response_url]);
  assert.equal(result.asset.url, 'https://v3.fal.media/lantern.glb');
  assert.deepEqual(result.operation, JSON.parse(savedJSON));
  assert.equal(network.mock.callCount(), 0);
});

test('a transient fal submission failure is not retried by the real core status retry policy', { timeout: 5_000 }, async t => {
  const network = t.mock.method(globalThis, 'fetch', () => assert.fail('No network is allowed.'));
  let submissions = 0;
  const terminals = [];
  const errors = [];
  const fal = createFalAssetProvider({
    apiKey: API_KEY,
    async fetch(_url, init) {
      assert.equal(init.method, 'POST');
      submissions++;
      return json({ detail: 'Temporary submit failure; acceptance is unknown' }, 503);
    },
  });
  await assert.rejects(generateSoundEffect({
    model: fal.soundEffect(), prompt: 'A short bell',
    retry: { status: 5 },
    hooks: {
      onFinish() { terminals.push('finish'); },
      onError(event) { terminals.push('error'); errors.push(event); },
    },
  }), error => {
    assert.equal(error.phase, 'start');
    assert.ok(APICallError.isInstance(error.cause));
    assert.equal(error.cause.statusCode, 503);
    return true;
  });
  assert.equal(submissions, 1);
  assert.deepEqual(terminals, ['error']);
  assert.equal(errors[0].phase, 'start');
  assert.equal(network.mock.callCount(), 0);
});
