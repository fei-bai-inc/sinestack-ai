import assert from 'node:assert/strict';
import test from 'node:test';
import { APICallError } from '@ai-sdk/provider';
import { ViggleClient, parseJSON, parseJob } from '../packages/viggle/dist/client.js';

const createClient = fetch => new ViggleClient({ apiKey: 'fixture-key', fetch });

test('Viggle JSON preserves unsafe integer tokens as strings without changing ordinary numbers', () => {
  const value = parseJSON('{"seed":9223372036854775807,"negative":-9223372036854775808,"safe":9007199254740991,"zero":0,"fraction":1.25,"exponent":1e3}');
  assert.deepEqual(value, {
    seed: '9223372036854775807', negative: '-9223372036854775808', safe: Number.MAX_SAFE_INTEGER,
    zero: 0, fraction: 1.25, exponent: 1000,
  });
  assert.doesNotThrow(() => JSON.stringify(value));
  assert.throws(() => parseJSON('{"overflow":1e400}'), /unrepresentable/);
});

test('Viggle job records validate identity, status and optional progress while retaining native fields', () => {
  const original = { id: 'vid_one', status: 'processing', progress: null, custom: { stage: 'new-stage' } };
  const result = parseJob(original, 'vid_one');
  original.custom.stage = 'changed';
  assert.equal(result.custom.stage, 'new-stage');
  for (const patch of [
    { id: 'vid_other' }, { id: '../credits' }, { status: 'unrecognized' },
    { progress: -1 }, { progress: 101 }, { progress: Infinity }, { progress: '40' },
  ]) assert.throws(() => parseJob({ ...original, ...patch }, 'vid_one'));
  assert.equal(parseJob({ id: 'vid_one', status: 'ready', progress: 100 }).progress, 100);
});

test('Viggle forms preserve files, repeated references, JSON-valued character lists and falsy fields', async () => {
  const client = createClient(async () => { throw new Error('form construction must not fetch'); });
  const image = new Blob(['image bytes'], { type: 'image/png' });
  const form = client.form({
    reference_image: [image, image], reference_image_url: ['https://assets.test/a', 'https://assets.test/b'],
    character_image_urls: ['https://assets.test/c', 'https://assets.test/d'],
    seed: '9223372036854775807', count: 0, enabled: false, omitted: undefined, extra: { nested: null },
  });
  assert.equal(form.getAll('reference_image').length, 2);
  assert.equal(await form.get('reference_image').text(), 'image bytes');
  assert.deepEqual(form.getAll('reference_image_url'), ['https://assets.test/a', 'https://assets.test/b']);
  assert.equal(form.get('character_image_urls'), '["https://assets.test/c","https://assets.test/d"]');
  assert.equal(form.get('seed'), '9223372036854775807');
  assert.equal(form.get('count'), '0'); assert.equal(form.get('enabled'), 'false');
  assert.equal(form.has('omitted'), false); assert.equal(form.get('extra'), '{"nested":null}');
  let getterCalls = 0;
  assert.throws(() => client.form({ get prompt() { getterCalls++; return 'must not run'; } }));
  assert.equal(getterCalls, 0);
});

test('Viggle HTTP errors retain raw bodies, diagnostics and explicit retryability', async () => {
  const native = { error: { code: 'NOT_RETRYABLE', message: 'Fix the input', retryable: false,
    request_id: 'native-request', details: { bad_field: 'image' }, remediation: { action: 'update', retry_after_ms: 0 } } };
  const raw = JSON.stringify(native);
  let calls = 0;
  const client = createClient(async () => { calls++; return new Response(raw, { status: 503 }); });
  await assert.rejects(client.get('credits'), error => {
    assert.ok(APICallError.isInstance(error));
    assert.equal(error.isRetryable, false);
    assert.equal(error.message, 'Fix the input');
    assert.equal(error.responseBody, raw);
    assert.deepEqual(error.data, native);
    assert.equal(error.responseHeaders['retry-after-ms'], '0');
    return true;
  });
  assert.equal(calls, 1);
  const headers = createClient(async () => new Response(raw, { status: 429, headers: { 'retry-after': '3' } }));
  await assert.rejects(headers.get('credits'), error => {
    assert.equal(error.responseHeaders['retry-after'], '3');
    assert.equal(error.responseHeaders['retry-after-ms'], undefined);
    return true;
  });
});

test('Viggle rejects malformed and oversized JSON without retrying accepted submissions', async () => {
  let calls = 0;
  const malformed = createClient(async () => { calls++; return new Response('{'); });
  await assert.rejects(malformed.request('videos', 'POST', {}, {}), error => {
    assert.ok(APICallError.isInstance(error));
    assert.equal(error.isRetryable, false); assert.equal(error.responseBody, '{');
    return true;
  });
  let cancelled = false;
  const oversized = createClient(async () => {
    calls++;
    return new Response(new ReadableStream({ cancel() { cancelled = true; } }), {
      headers: { 'content-length': String(16 * 1024 * 1024 + 1) },
    });
  });
  await assert.rejects(oversized.get('credits'), error => APICallError.isInstance(error) && error.isRetryable === false);
  assert.equal(cancelled, true);
  assert.equal(calls, 2);
});

test('Viggle client preserves proxy paths and only accepts empty success for explicit deletion', async () => {
  const calls = [];
  const client = new ViggleClient({ apiKey: 'fixture-key', baseURL: 'https://proxy.test/viggle/v1', fetch: async (url, init) => {
    calls.push({ url, init }); return new Response(null, { status: 204 });
  } });
  const deleted = await client.request('characters/char_one', 'DELETE');
  assert.equal(deleted.value, undefined);
  assert.equal(calls[0].url, 'https://proxy.test/viggle/v1/characters/char_one');
  await assert.rejects(client.request('characters', 'POST', {}, {}), error => APICallError.isInstance(error));
  assert.throws(() => client.request('https://elsewhere.test/videos', 'GET'));
  assert.throws(() => client.raw('/renders/render_one/events'));
  assert.equal(calls.length, 2);
});
