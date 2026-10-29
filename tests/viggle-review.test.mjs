import assert from 'node:assert/strict';
import test from 'node:test';
import { APICallError } from '@ai-sdk/provider';
import { generateAsset } from '@sinestack/ai-core';
import { createViggleProvider } from '@sinestack/ai-viggle';

const plan = {
  upload_handle: 'upload_review', method: 'PUT',
  url: 'https://uploads.example/object?signature=fixture',
  required_headers: { 'Content-Type': 'image/png', 'x-upload-checksum': 'fixture' },
};
const file = new Blob(['image'], { type: 'image/png' });
const provider = fetch => createViggleProvider({ apiKey: 'fixture-secret', fetch });
const body = onCancel => new ReadableStream({ cancel: onCancel });

test('Viggle signed upload cancels a failed response and sends only signed request credentials', async () => {
  for (const status of [403, 302]) {
    let cancelled = false;
    let calls = 0;
    const viggle = provider(async (url, init) => {
      calls++;
      assert.equal(url, plan.url);
      assert.equal(init.method, 'PUT');
      assert.equal(init.credentials, 'omit');
      assert.equal(init.redirect, 'manual');
      assert.equal(init.body, file);
      assert.deepEqual(Object.fromEntries(new Headers(init.headers)), {
        'content-type': 'image/png', 'x-upload-checksum': 'fixture',
      });
      return new Response(body(() => { cancelled = true; }), {
        status, headers: { location: 'https://unexpected.example/upload' },
      });
    });
    await assert.rejects(viggle.renders.upload(plan, file), error =>
      APICallError.isInstance(error) && error.statusCode === status && error.isRetryable === false);
    assert.equal(cancelled, true);
    assert.equal(calls, 1, 'the signed upload must never follow a redirect or retry itself');
  }
});

test('Viggle signed upload preserves an accepted upload and quoted ETag when cleanup rejects', async () => {
  let cancelled = false;
  const viggle = provider(async () => new Response(body(() => {
    cancelled = true; throw new Error('cleanup failed');
  }), { status: 200, headers: { etag: '"accepted-etag"' } }));
  assert.deepEqual(await viggle.renders.upload(plan, file), {
    upload_handle: plan.upload_handle, etag: '"accepted-etag"',
  });
  assert.equal(cancelled, true);
});

test('Viggle download cleanup cannot replace the signed URL or original protocol failure', async () => {
  for (const status of [302, 200]) {
    let cancelled = false;
    const viggle = provider(async (url, init) => {
      assert.equal(url, 'https://apis.viggle.ai/v1/renders/render_review/download');
      assert.equal(init.redirect, 'manual');
      return new Response(body(() => { cancelled = true; throw new Error('cleanup failed'); }), {
        status, headers: { location: 'https://assets.example/output.mp4?signature=fixture' },
      });
    });
    if (status === 302) {
      assert.equal((await viggle.renders.download('render_review')).url,
        'https://assets.example/output.mp4?signature=fixture');
    } else {
      await assert.rejects(viggle.renders.download('render_review'), /must return HTTP 302/);
    }
    assert.equal(cancelled, true);
  }
});

test('Viggle signed upload honors abort after fetch resolves and still cleans the response', async () => {
  const controller = new AbortController();
  const reason = new Error('caller stopped');
  let cancelled = false;
  const viggle = provider(async () => {
    controller.abort(reason);
    return new Response(body(() => { cancelled = true; }));
  });
  await assert.rejects(viggle.renders.upload(plan, file, { abortSignal: controller.signal }),
    error => error === reason);
  assert.equal(cancelled, true);
});

test('Viggle invalid ready output keeps the native response and never resubmits accepted work', async () => {
  const output = {
    id: 'img_review', status: 'ready', progress: 100,
    images: [{ url: null, width: 1024, height: 1024, seed: 0 }],
    error: null, native_detail: { retention: 'expired' },
  };
  const calls = [];
  const viggle = provider(async (url, init) => {
    calls.push({ url, method: init.method });
    return Response.json(init.method === 'POST' ? { id: output.id, status: 'queued' } : output, {
      headers: { 'x-request-id': 'ready-response' },
    });
  });
  await assert.rejects(generateAsset({
    model: viggle.image(), input: { prompt: 'character' },
    poll: { intervalMs: 0, delay: async () => {} },
  }), error => {
    let diagnostic = error;
    while (diagnostic && !APICallError.isInstance(diagnostic)) diagnostic = diagnostic.cause;
    assert.ok(diagnostic, 'The error chain must retain a native response diagnostic');
    assert.equal(diagnostic.isRetryable, false);
    assert.deepEqual(JSON.parse(diagnostic.responseBody), output);
    assert.equal(diagnostic.responseHeaders['x-request-id'], 'ready-response');
    return true;
  });
  assert.deepEqual(calls.map(call => call.method), ['POST', 'GET']);
});
