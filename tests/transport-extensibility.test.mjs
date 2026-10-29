import assert from 'node:assert/strict';
import test from 'node:test';
import { APICallError } from '@ai-sdk/provider';
import { AssetProviderTransport } from '@sinestack/ai-provider-utils';

const callOptions = () => ({ headers: {}, abortSignal: new AbortController().signal });
const transportWith = fetch => new AssetProviderTransport({
  provider: 'fixture', apiKey: 'fixture-key', environmentVariableName: 'TRANSPORT_FIXTURE_KEY',
  baseURL: 'https://api.example.test/proxy/v1', fetch,
});

test('a per-request decoder receives the original response without default JSON parsing', async () => {
  const body = '{"seed":9223372036854775807}';
  let calls = 0;
  const transport = transportWith(async (_url, init) => {
    calls++;
    assert.equal(new Headers(init.headers).get('authorization'), 'Bearer fixture-key');
    assert.equal(init.redirect, 'manual');
    return new Response(body, { headers: { 'x-request-id': 'precise-value' } });
  });
  const result = await transport.request(`${transport.baseURL}/jobs`, 'POST', {
    ...callOptions(), headers: { Authorization: 'Bearer injected' },
  }, { prompt: 'fixture' }, false, {
    successfulResponseHandler: async ({ response }) => ({ value: { raw: await response.text() } }),
  });
  assert.deepEqual(result.value, { raw: body });
  assert.deepEqual(result.response.body, { raw: body });
  assert.equal(result.response.headers['x-request-id'], 'precise-value');
  assert.equal(result.statusCode, 200);
  assert.equal(calls, 1);
});

test('custom HTTP errors preserve provider classification and never retry in transport', async () => {
  let calls = 0;
  const transport = transportWith(async () => {
    calls++;
    return Response.json({ error: { message: 'resolve the input', retryable: false, remediation: 'change input' } }, {
      status: 503, headers: { 'x-request-id': 'failure-id' },
    });
  });
  const failedResponseHandler = async ({ response, url, requestBodyValues }) => {
    const responseBody = await response.text();
    const error = JSON.parse(responseBody).error;
    return { value: new APICallError({
      message: error.message, url, requestBodyValues, statusCode: response.status,
      responseHeaders: Object.fromEntries(response.headers), responseBody, isRetryable: error.retryable,
    }) };
  };
  for (const request of [
    () => transport.request(`${transport.baseURL}/jobs`, 'POST', callOptions(), {}, false, { failedResponseHandler }),
    () => transport.requestRaw(`${transport.baseURL}/events`, 'GET', callOptions(), { failedResponseHandler }),
  ]) {
    await assert.rejects(request(), error => {
      assert.ok(APICallError.isInstance(error));
      assert.equal(error.statusCode, 503);
      assert.equal(error.isRetryable, false);
      assert.equal(error.responseHeaders['x-request-id'], 'failure-id');
      assert.equal(JSON.parse(error.responseBody).error.remediation, 'change input');
      return true;
    });
  }
  assert.equal(calls, 2);
});

test('default malformed and empty success rules remain strict after custom requests', async () => {
  for (const body of ['{', '', '  ']) {
    const transport = transportWith(async () => new Response(body));
    await assert.rejects(transport.request(`${transport.baseURL}/jobs`, 'GET', callOptions()), error => {
      assert.ok(APICallError.isInstance(error));
      assert.equal(error.isRetryable, false);
      return true;
    });
  }
  for (const status of [200, 204]) {
    const transport = transportWith(async () => new Response(null, { status }));
    await assert.rejects(transport.request(`${transport.baseURL}/jobs/one`, 'DELETE', callOptions()));
    const result = await transport.request(`${transport.baseURL}/jobs/one`, 'DELETE', callOptions(), undefined, true);
    assert.equal(result.value, undefined);
    assert.equal(result.statusCode, status);
  }
  const transport = transportWith(async () => new Response('non-json'));
  await transport.request(`${transport.baseURL}/jobs`, 'GET', callOptions(), undefined, false, {
    successfulResponseHandler: async ({ response }) => ({ value: await response.text() }),
  });
  await assert.rejects(transport.request(`${transport.baseURL}/jobs`, 'GET', callOptions()), error => APICallError.isInstance(error));
});

test('raw streams retain locked authentication and the original signal without consuming the body', async () => {
  const controller = new AbortController();
  const stream = new Response('data: {"status":"running"}\n\n', { headers: { 'content-type': 'text/event-stream' } });
  const transport = transportWith(async (url, init) => {
    assert.equal(url, 'https://api.example.test/proxy/v1/events');
    const headers = new Headers(init.headers);
    assert.equal(headers.get('accept'), 'text/event-stream');
    assert.equal(headers.get('authorization'), 'Bearer fixture-key');
    assert.equal(init.signal, controller.signal);
    assert.equal(init.redirect, 'manual');
    return stream;
  });
  const response = await transport.requestRaw(`${transport.baseURL}/events`, 'GET', {
    headers: { Authorization: 'Bearer injected', Accept: 'text/plain' }, abortSignal: controller.signal,
  }, { accept: 'text/event-stream' });
  assert.equal(response, stream);
  assert.equal(response.bodyUsed, false);
  assert.equal(await response.text(), 'data: {"status":"running"}\n\n');
});

test('manual redirect delivery is explicit, never follows Location, and cannot weaken destination validation', async () => {
  let calls = 0;
  const modes = [];
  const location = 'https://cdn.example.test/signed-output';
  const transport = transportWith(async (_url, init) => {
    calls++;
    assert.equal(_url, 'https://api.example.test/proxy/v1/download');
    modes.push(init.redirect);
    return new Response(null, { status: 302, headers: { location } });
  });
  for (const method of ['GET', 'POST', 'PUT', 'DELETE']) {
    await assert.rejects(transport.request(`${transport.baseURL}/download`, method, callOptions()), error =>
      APICallError.isInstance(error) && error.statusCode === 302 && error.isRetryable === false);
  }
  await assert.rejects(transport.requestRaw(`${transport.baseURL}/download`, 'GET', callOptions()), error => APICallError.isInstance(error));
  const response = await transport.requestRaw(`${transport.baseURL}/download`, 'GET', callOptions(), { redirect: 'manual' });
  assert.equal(response.status, 302);
  assert.equal(response.headers.get('location'), location);
  assert.deepEqual(modes, Array(6).fill('manual'));
  assert.equal(calls, 6, 'the CDN is never fetched by the authenticated transport');
  for (const url of [location, 'https://api.example.test/proxy/v10/download']) {
    await assert.rejects(transport.requestRaw(url, 'GET', callOptions(), { redirect: 'manual' }), TypeError);
  }
  await assert.rejects(transport.requestRaw(`${transport.baseURL}/download`, 'GET', callOptions(), { redirect: 'follow' }), /cannot follow/);
  assert.equal(calls, 6);
});

test('raw requests reject a fetch implementation that already followed a redirect', async () => {
  for (const override of [{ redirected: true }, { url: 'https://cdn.example.test/output' }]) {
    const transport = transportWith(async () => {
      const response = new Response('unexpected content');
      for (const [key, value] of Object.entries(override)) Object.defineProperty(response, key, { value });
      return response;
    });
    await assert.rejects(transport.requestRaw(`${transport.baseURL}/download`, 'GET', callOptions(), { redirect: 'manual' }), /redirected/);
  }
});

test('raw responses still honor pre-dispatch abort and default SDK error handling', async () => {
  let calls = 0;
  const transport = transportWith(async () => { calls++; return new Response('Unavailable', { status: 503 }); });
  const reason = new Error('caller stopped');
  await assert.rejects(transport.requestRaw(`${transport.baseURL}/events`, 'GET', {
    headers: {}, abortSignal: AbortSignal.abort(reason),
  }), error => error === reason);
  assert.equal(calls, 0);
  await assert.rejects(transport.requestRaw(`${transport.baseURL}/events`, 'GET', callOptions()), error => {
    assert.ok(APICallError.isInstance(error));
    assert.equal(error.statusCode, 503);
    assert.equal(error.isRetryable, true);
    return true;
  });
  assert.equal(calls, 1);
});
