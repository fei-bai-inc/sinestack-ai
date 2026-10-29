import assert from 'node:assert/strict';
import test from 'node:test';
import { APICallError } from '@ai-sdk/provider';
import { AssetProviderTransport, jsonObject, jsonValue, mapAssetResult, snapshotAssetMapping } from '@sinestack/ai-provider-utils';

const options = () => ({ headers: {}, abortSignal: new AbortController().signal });
const settings = fetch => ({
  provider: 'fixture', apiKey: 'fixture-key', environmentVariableName: 'SINESTACK_FIXTURE_KEY',
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
    assert.equal(init.redirect, 'manual');
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

test('default result mapping recognizes native file shapes without any model registration', () => {
  const output = {
    audio: { url: 'https://assets.example/song', content_type: 'audio/wav', file_name: 'song.wav', file_size: 1024 },
    custom_geometry: [{ url: 'https://assets.example/mesh.glb' }, { url: 'https://assets.example/texture.png' }],
    custom_motion: { payload: { url: 'https://assets.example/motion.json' } },
    seed: 42,
    metadata: { documentation: 'https://provider.example/docs', message: 'See https://provider.example/status' },
  };
  const result = mapAssetResult(output);
  assert.deepEqual(result.assets.map(file => file.url), [
    'https://assets.example/song', 'https://assets.example/mesh.glb',
    'https://assets.example/texture.png', 'https://assets.example/motion.json',
  ]);
  assert.deepEqual(result.assets.map(file => file.mediaType), ['audio/wav', 'model/gltf-binary', 'image/png', 'application/json']);
  assert.equal(result.assets[0].filename, 'song.wav');
  assert.deepEqual(result.assets[0].metadata, { fileSize: 1024 });
  assert.equal(mapAssetResult('https://assets.example/unknown-format').assets[0].mediaType, 'application/octet-stream');
  for (const name of ['constructor', '__proto__', 'asset.constructor', 'asset.__proto__']) {
    assert.equal(mapAssetResult(`https://assets.example/${name}`).assets[0].mediaType, 'application/octet-stream');
    assert.equal(mapAssetResult({ url: 'https://assets.example/file', file_name: name }).assets[0].mediaType, 'application/octet-stream');
  }
  assert.equal(mapAssetResult({ files: ['https://assets.example/report.pdf'] }).assets[0].mediaType, 'application/pdf');
});

test('default result mapping deduplicates references while retaining explicit provider file metadata', () => {
  const result = mapAssetResult([
    'https://assets.example/audio',
    { url: 'https://assets.example/audio', content_type: 'audio/flac', file_name: 'recording.flac' },
    'https://assets.example/mesh.glb',
  ]);
  assert.equal(result.assets.length, 2);
  assert.equal(result.assets[0].mediaType, 'audio/flac');
  assert.equal(result.assets[0].filename, 'recording.flac');
  assert.equal(result.assets[1].mediaType, 'model/gltf-binary');
});

test('default result mapping requires real file references and leaves special schemas to injected mappers', () => {
  for (const output of [null, 'Generated text', 'Read https://example.test/file.pdf for details', [], {},
    { metadata: { docs: 'https://example.test/docs' } }, { mesh_url: 'https://example.test/custom.glb' }]) {
    assert.throws(() => mapAssetResult(output), /Provide mapResult/);
  }
  for (const file of [
    { url: 'javascript:alert(1)' }, { url: 'https://user:pass@example.test/file.glb' },
    { url: 'https://example.test/file.glb', content_type: 'not-a-mime' },
    { url: 'https://example.test/file.glb', file_size: -1 },
  ]) assert.throws(() => mapAssetResult(file), TypeError);
});

test('injected mapping methods retain their original receiver and snapshot method identity', async () => {
  class ExternalMapping {
    #prefix = 'external:';
    mapInput(input) { return { text: this.#prefix + input.description }; }
    mapResult(output) { return { assets: [{ type: 'url', url: output, mediaType: 'audio/wav', role: this.#prefix }] }; }
  }
  const implementation = new ExternalMapping();
  const mapping = snapshotAssetMapping(implementation);
  implementation.mapInput = () => { throw new Error('Changed method must not replace captured implementation'); };
  assert.deepEqual(await mapping.mapInput({ description: 'Song' }), { text: 'external:Song' });
  assert.equal((await mapping.mapResult('https://assets.example/song.wav')).assets[0].role, 'external:');
});
