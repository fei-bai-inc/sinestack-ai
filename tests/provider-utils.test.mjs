import assert from 'node:assert/strict';
import test from 'node:test';
import { APICallError } from '@ai-sdk/provider';
import { AssetProviderTransport, jsonObject, jsonValue } from '@sine-ai/provider-utils';

const options = () => ({ headers: {}, abortSignal: new AbortController().signal });
const settings = fetch => ({
  provider: 'fixture', apiKey: 'fixture-key', environmentVariableName: 'SINE_FIXTURE_KEY',
  baseURL: 'https://api.example.test/proxy/v1', fetch,
});

test('HTTP retry classification and response headers come from the SDK', async () => {
  for (const statusCode of [400, 401, 408, 409, 429, 500, 503]) {
    let calls = 0;
    const transport = new AssetProviderTransport(settings(async () => {
      calls++;
      return Response.json({ error: { message: 'provider failure' } }, {
        status: statusCode, headers: { 'retry-after': '3', 'x-request-id': 'fixture-id' },
      });
    }));
    await assert.rejects(transport.request(`${transport.baseURL}/jobs`, 'POST', options(), { prompt: 'fixture' }), error => {
      assert.ok(APICallError.isInstance(error));
      const sdkError = new APICallError({ message: 'expected', url: '', requestBodyValues: {}, statusCode });
      assert.equal(error.isRetryable, sdkError.isRetryable);
      assert.equal(error.responseHeaders['retry-after'], '3');
      assert.equal(error.responseHeaders['x-request-id'], 'fixture-id');
      assert.equal(error.message, 'provider failure');
      return true;
    });
    assert.equal(calls, 1, 'transport never retries a failed request');
  }
});

test('SDK network handling distinguishes connection failures from application exceptions', async () => {
  const network = new TypeError('fetch failed', { cause: Object.assign(new Error('socket closed'), { code: 'ECONNRESET' }) });
  const transport = new AssetProviderTransport(settings(async () => { throw network; }));
  await assert.rejects(transport.request(`${transport.baseURL}/jobs/id`, 'GET', options()), error => {
    assert.ok(APICallError.isInstance(error));
    assert.equal(error.isRetryable, true);
    return true;
  });
  const application = new Error('custom fetch configuration is broken');
  const broken = new AssetProviderTransport(settings(async () => { throw application; }));
  await assert.rejects(broken.request(`${broken.baseURL}/jobs/id`, 'GET', options()), error => error === application);
});

test('SDK JSON handling rejects malformed success and accepts plain-text HTTP errors', async () => {
  const malformed = new AssetProviderTransport(settings(async () => new Response('{', { status: 200 })));
  await assert.rejects(malformed.request(`${malformed.baseURL}/jobs/id`, 'GET', options()), error => {
    assert.ok(APICallError.isInstance(error));
    assert.equal(error.isRetryable, false);
    assert.equal(error.responseBody, '{');
    return true;
  });
  const failure = new AssetProviderTransport(settings(async () => new Response('Unavailable', { status: 503 })));
  await assert.rejects(failure.request(`${failure.baseURL}/jobs/id`, 'GET', options()), error => {
    assert.ok(APICallError.isInstance(error));
    assert.equal(error.statusCode, 503);
    assert.equal(error.isRetryable, true);
    return true;
  });
});

test('transport locks credentials and snapshots mutable connection configuration', async () => {
  const signal = new AbortController().signal;
  const configured = settings(async (url, init) => {
    assert.equal(url, 'https://api.example.test/proxy/v1/jobs');
    const headers = new Headers(init.headers);
    assert.equal(headers.get('authorization'), 'Bearer fixture-key');
    assert.equal(headers.get('x-connection'), 'original');
    assert.equal(headers.get('x-request'), 'specific');
    assert.equal(init.signal, signal);
    assert.equal(init.redirect, 'error');
    return Response.json({ ok: true });
  });
  configured.headers = { 'x-connection': 'original' };
  const transport = new AssetProviderTransport(configured);
  configured.apiKey = 'changed';
  configured.headers['x-connection'] = 'changed';
  configured.baseURL = 'https://different.example';
  await transport.request(`${transport.baseURL}/jobs`, 'POST', {
    headers: { Authorization: 'Bearer injected', 'x-request': 'specific' }, abortSignal: signal,
  }, {});
});

test('invalid origin, prefix, and redirects fail without a second request', async () => {
  let calls = 0;
  const transport = new AssetProviderTransport(settings(async () => {
    calls++;
    const response = Response.json({ ok: true });
    Object.defineProperty(response, 'redirected', { value: true });
    return response;
  }));
  for (const destination of ['https://other.example/jobs', 'https://api.example.test/proxy/v10/jobs', 'https://user:pass@api.example.test/proxy/v1/jobs']) {
    await assert.rejects(transport.request(destination, 'GET', options()), TypeError);
  }
  assert.equal(calls, 0);
  await assert.rejects(transport.request(`${transport.baseURL}/jobs`, 'GET', options()), /redirected/);
  assert.equal(calls, 1);
});

test('PUT cancellation shares SDK response parsing and never adds retries', async () => {
  let calls = 0;
  const transport = new AssetProviderTransport(settings(async (_url, init) => {
    calls++;
    assert.equal(init.method, 'PUT');
    assert.equal(init.body, undefined);
    return new Response(null, { status: 204 });
  }));
  const result = await transport.request(`${transport.baseURL}/jobs/id/cancel`, 'PUT', options(), undefined, true);
  assert.equal(result.statusCode, 204);
  assert.equal(result.value, undefined);
  assert.equal(calls, 1);
});

test('abort reason is retained and an already aborted call is never dispatched', async () => {
  const controller = new AbortController();
  const reason = new Error('request cancelled');
  let calls = 0;
  const transport = new AssetProviderTransport(settings(async (_url, init) => {
    calls++;
    controller.abort(reason);
    init.signal.throwIfAborted();
  }));
  await assert.rejects(transport.request(`${transport.baseURL}/jobs`, 'POST', { headers: {}, abortSignal: controller.signal }, {}), error => error === reason);
  await assert.rejects(transport.request(`${transport.baseURL}/jobs`, 'POST', { headers: {}, abortSignal: controller.signal }, {}), error => error === reason);
  assert.equal(calls, 1);
});

test('JSON snapshots detach data and reject lossy or executable request values', () => {
  const original = { nested: { data: [1, 'two', null] }, optional: undefined };
  const snapshot = jsonObject(original, 'input');
  original.nested.data[0] = 9;
  assert.equal(snapshot.nested.data[0], 1);
  assert.equal(jsonValue('native file URL', 'output'), 'native file URL');
  let getterCalled = false;
  const getter = { get prompt() { getterCalled = true; return 'bad'; } };
  for (const value of [getter, { number: Infinity }, { list: [, 1] }, { toJSON() { throw new Error('must not run'); } }]) {
    assert.throws(() => jsonObject(value, 'input'), TypeError);
  }
  assert.equal(getterCalled, false);
});
