import { createViggleProvider } from '../../packages/viggle/dist/index.js';
import { startAsset, waitForAsset } from '../../packages/core/dist/index.js';

const BASE = 'https://apis.viggle.ai/v1';
const OUTPUT = 'https://assets.example/mock-video.mp4';
const poll = { intervalMs: 0, delay: async () => {} };
function check(value, message) {
  if (!value) throw new Error(message);
}
function queued(id) {
  return Response.json({ id, status: 'queued', progress: null });
}
function ready(id) {
  return Response.json({ id, status: 'ready', progress: 100, video_url: OUTPUT, alpha_url: null });
}

export const textVideoSmoke = {
  async test() {
    const calls = [];
    const mockFetch = async (url, init) => {
      new Request(String(url), init); // The injected mock still validates native Worker RequestInit.
      calls.push({ url: String(url), method: init.method });
      check(new Headers(init.headers).get('authorization') === 'Bearer mock-key', 'API authentication missing');
      if (init.method === 'POST' && String(url) === `${BASE}/videos`) {
        check(init.body instanceof FormData, 'H3 request is not native FormData');
        check(init.body.get('prompt') === 'A paper airplane', 'Prompt was changed');
        check(init.body.get('seed') === '9223372036854775807', 'Exact seed input was changed');
        return queued('vid_worker_text');
      }
      if (init.method === 'GET' && String(url) === `${BASE}/videos/vid_worker_text`) {
        return new Response('{"id":"vid_worker_text","status":"ready","progress":100,"video_url":"https://assets.example/mock-video.mp4","alpha_url":null,"seed":4271960385017522688}', {
          headers: { 'content-type': 'application/json' },
        });
      }
      throw new Error(`Unexpected mock request ${init.method} ${url}`);
    };
    const settings = { apiKey: 'mock-key', connectionId: 'worker-smoke', fetch: mockFetch };
    const started = await startAsset({
      model: createViggleProvider(settings).textToVideo(),
      input: { prompt: 'A paper airplane', quality: 'low', seed: '9223372036854775807' },
    });
    const result = await waitForAsset({
      model: createViggleProvider(settings).textToVideo(),
      operation: JSON.parse(JSON.stringify(started.operation)), poll,
    });
    check(result.asset.type === 'url' && result.asset.url === OUTPUT, 'Video output missing');
    check(result.providerMetadata.viggle.output.seed === '4271960385017522688', 'Unsafe integer lost precision');
    check(calls.length === 2 && calls[0].method === 'POST' && calls[1].method === 'GET', 'Restore resubmitted work');
    console.log(JSON.stringify({ check: 'core text video + restored receipt + lossless seed', requests: calls, seed: result.providerMetadata.viggle.output.seed, nodeProcess: typeof process, nodeBuffer: typeof Buffer }));
  },
};

export const multipartBlobSmoke = {
  async test() {
    const bytes = new Uint8Array([137, 80, 78, 71]);
    const image = new Blob([bytes], { type: 'image/png' });
    let calls = 0;
    const model = createViggleProvider({ apiKey: 'mock-key', fetch: async (url, init) => {
      calls++;
      if (init.method === 'POST' && String(url) === `${BASE}/videos`) {
        check(init.body instanceof FormData, 'Upload is not FormData');
        check(!new Headers(init.headers).has('content-type'), 'Multipart boundary was manually overridden');
        const request = new Request(String(url), init);
        check(request.headers.get('content-type').includes('multipart/form-data; boundary='), 'Native boundary not generated');
        const decoded = await request.formData();
        const file = decoded.get('first_frame_image');
        check(file instanceof Blob && file.type === 'image/png', 'Native file media type was lost');
        check([...new Uint8Array(await file.arrayBuffer())].join(',') === [...bytes].join(','), 'Multipart binary bytes changed');
        check(decoded.get('watermark') === 'false', 'Boolean serialization changed');
        return queued('vid_worker_blob');
      }
      if (init.method === 'GET' && String(url) === `${BASE}/videos/vid_worker_blob`) return ready('vid_worker_blob');
      throw new Error(`Unexpected mock request ${init.method} ${url}`);
    } }).firstFrameToVideo();
    const { operation } = await startAsset({ model, input: { prompt: 'Wave', quality: 'low', first_frame_image: image, watermark: false } });
    const result = await waitForAsset({ model, operation, poll });
    check(result.asset.type === 'url' && result.asset.url === OUTPUT, 'Upload generation output missing');
    check(calls === 2, 'Multipart submission made extra requests');
    console.log(JSON.stringify({ check: 'native Blob / FormData / Request.formData round trip', bytes: image.size, mediaType: image.type, requests: calls }));
  },
};

export const renderEventsSmoke = {
  async test() {
    let calls = 0;
    const event = { id: 'render_worker', status: 'ready', video_url: OUTPUT, alpha_url: null };
    const encoded = new TextEncoder().encode(`id: event_worker\nevent: ready\ndata: ${JSON.stringify(event)}\n\n`);
    const provider = createViggleProvider({ apiKey: 'mock-key', fetch: async (url, init) => {
      new Request(String(url), init);
      calls++;
      check(String(url) === `${BASE}/renders/render_worker/events`, 'SSE endpoint changed');
      check(new Headers(init.headers).get('last-event-id') === 'event_previous', 'SSE resume header missing');
      return new Response(new ReadableStream({ start(controller) {
        for (let index = 0; index < encoded.length; index += 7) controller.enqueue(encoded.slice(index, index + 7));
        controller.close();
      } }), { headers: { 'content-type': 'text/event-stream' } });
    } });
    const events = [];
    for await (const item of await provider.renders.events('render_worker', { lastEventId: 'event_previous' })) events.push(item);
    check(events.length === 1 && events[0].event === 'ready' && events[0].id === 'event_worker', 'Split SSE frames parsed incorrectly');
    check(JSON.stringify(events[0].data) === JSON.stringify(event), 'SSE native data changed');
    check(calls === 1, 'SSE silently reconnected');
    console.log(JSON.stringify({ check: 'eventsource-parser + native TextDecoderStream', event: events[0].event, id: events[0].id, requests: calls }));
  },
};

export const signedUploadSmoke = {
  async test() {
    const bytes = new Blob(['png-bytes'], { type: 'image/png' });
    const plan = {
      upload_handle: 'upload_worker', method: 'PUT', url: 'https://uploads.example/worker.png?signature=mock',
      required_headers: { 'content-type': 'image/png', 'x-upload-token': 'signed-token' },
    };
    let calls = 0;
    const provider = createViggleProvider({ apiKey: 'mock-key', headers: { 'x-private-api': 'must-not-leak' }, fetch: async (url, init) => {
      calls++;
      const request = new Request(String(url), init);
      check(String(url) === plan.url && request.method === 'PUT', 'Signed upload destination changed');
      check(!request.headers.has('authorization') && !request.headers.has('x-private-api'), 'API credentials reached storage');
      check(request.headers.get('x-upload-token') === 'signed-token', 'Signed upload headers missing');
      check(new TextDecoder().decode(await request.arrayBuffer()) === 'png-bytes', 'Signed upload bytes changed');
      check(request.redirect === 'manual', 'Signed upload may follow redirects');
      return new Response(null, { status: 200, headers: { etag: '"worker-etag"' } });
    } });
    const result = await provider.renders.upload(plan, bytes);
    check(result.upload_handle === plan.upload_handle && result.etag === '"worker-etag"', 'Upload receipt changed');
    check(calls === 1, 'Upload made extra requests');
    console.log(JSON.stringify({ check: 'signed PUT + native RequestInit + isolated credentials', requests: calls, etag: result.etag }));
  },
};
