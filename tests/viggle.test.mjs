import assert from 'node:assert/strict';
import test from 'node:test';
import { APICallError } from '@ai-sdk/provider';
import {
  generateAsset, startAsset, getAssetStatus, waitForAsset, cancelAsset,
  startTask, getTaskStatus, waitForTask, cancelTask,
} from '@sinestack/ai-core';
import { createViggleProvider } from '@sinestack/ai-viggle';

const BASE = 'https://apis.viggle.ai/v1';
const IMAGE = 'https://assets.example/character.png';
const IMAGE_2 = 'https://assets.example/second.png';
const VIDEO = 'https://assets.example/result.mp4';
const SOURCE = 'https://assets.example/source.mp4';
const ALPHA = 'https://assets.example/alpha.mp4';
const CREATED = '2026-10-29T04:00:00Z';
const poll = { intervalMs: 0, delay: async () => {} };
const json = (body, status = 200, headers) => Response.json(body, { status, headers });
const accepted = (id, status = 200) => json({ id, status: 'queued', progress: null, created_at: CREATED }, status);
const video = (id, overrides = {}) => ({
  id, status: 'ready', stage: null, progress: 100, video_url: VIDEO,
  alpha_url: null, created_at: CREATED, completed_at: CREATED, error: null, ...overrides,
});
const image = (id, overrides = {}) => ({
  id, status: 'ready', progress: 100, created_at: CREATED, completed_at: CREATED, error: null,
  images: [
    { url: IMAGE, width: 2048, height: 1152, seed: 0 },
    { url: IMAGE_2, width: 2048, height: 1152, seed: 1 },
  ], ...overrides,
});
function wire(...steps) {
  const calls = [];
  return { calls, fetch: async (url, init) => {
    const call = { url: String(url), ...init, method: init?.method ?? 'GET', headers: new Headers(init?.headers) };
    calls.push(call);
    assert.ok(steps.length, `Unexpected ${call.method} ${call.url}`);
    const next = steps.shift();
    return typeof next === 'function' ? next(call) : next;
  } };
}
const provider = (fetch, extra = {}) => createViggleProvider({ apiKey: 'fixture-secret', fetch, ...extra });
function assertMultipart(call, input, repeated = []) {
  assert.ok(call.body instanceof FormData, 'The native endpoint requires multipart/form-data');
  assert.equal(call.headers.has('content-type'), false, 'fetch must supply the multipart boundary');
  assert.deepEqual([...new Set(call.body.keys())].sort(), Object.keys(input).sort());
  for (const [key, value] of Object.entries(input)) {
    const expected = repeated.includes(key) ? value : [value];
    assert.deepEqual(call.body.getAll(key), expected.map(item =>
      typeof item === 'object' && item !== null ? JSON.stringify(item) : String(item)), key);
  }
}

const generations = [
  ['textToVideo', 'vid_text', 'videos', {
    prompt: '一架纸飞机穿过阳光下的办公室', quality: 'high', duration_s: 7.5, resolution: '2k',
    aspect_ratio: '21:9', seed: 0, watermark: false, enhance: false, priority: 0,
  }, []],
  ['firstFrameToVideo', 'vid_first', 'videos', {
    prompt: 'The character waves', quality: 'low', first_frame_image_url: IMAGE,
    duration_s: 5, resolution: '480p', aspect_ratio: '9:16', seed: 42, watermark: true,
  }, []],
  ['firstLastFrameToVideo', 'vid_frames', 'videos', {
    prompt: 'Move between these poses', quality: 'high', first_frame_image_url: IMAGE,
    last_frame_image_url: IMAGE_2, duration_s: 15, resolution: '4k', enhance: false,
  }, []],
  ['referenceToVideo', 'vid_reference', 'videos', {
    prompt: 'Follow this visual style', quality: 'low', reference_video_url: SOURCE,
    reference_image_url: [IMAGE, IMAGE_2], duration_s: 8, resolution: '1080p',
  }, ['reference_image_url']],
  ['characterAnimation', 'anim_people', 'videos', {
    driving_video_url: SOURCE, character_image_urls: [IMAGE, IMAGE_2],
    prompt: '<Character1>the person on the left<Character2>the person on the right',
    enhance_mode: 'planner', watermark: false, priority: 1000,
  }, []],
  ['renderVideo', 'render_mix', 'renders', {
    image_url: IMAGE, motion_video_url: SOURCE, background_mode: 'solid', bg_color: '0,177,64',
    model: 'future-render-v9', mode: 'full_pipeline', character_mapping: { segment1: 'char_saved' },
  }, []],
  ['image', 'img_batch', 'images', {
    prompt: 'A warm hand-painted character', n: 2, resolution: '2K', aspect_ratio: '16:9',
    seed: 0, reference_image_url: [IMAGE, IMAGE_2],
  }, ['reference_image_url']],
];
for (const [factory, id, route, native, repeated] of generations) {
  test(`Viggle ${factory}: native parameters, exact endpoint and complete output through generateAsset`, async () => {
    const output = factory === 'image' ? image(id) : video(id);
    const script = wire(accepted(id), json(output));
    const input = { ...native, future_option: { strength: 0, enabled: false, hint: null } };
    const model = provider(script.fetch)[factory]();
    const result = await generateAsset({ model, input, poll });
    assert.equal(model.kind, factory === 'image' ? 'image' : 'video');
    assert.deepEqual(script.calls.map(call => [call.method, call.url]), [
      ['POST', `${BASE}/${route}`], ['GET', `${BASE}/${factory === 'image' ? 'images' : 'videos'}/${id}`],
    ]);
    assertMultipart(script.calls[0], input, repeated);
    assert.deepEqual(result.providerMetadata.viggle.output, output);
    assert.deepEqual(result.assets.map(asset => asset.url), factory === 'image' ? [IMAGE, IMAGE_2] : [VIDEO]);
    if (factory === 'image') {
      assert.deepEqual(result.assets.map(asset => asset.metadata), output.images.map(({ width, height, seed }) => ({ width, height, seed })));
    }
    assert.ok(script.calls.every(call => call.headers.get('authorization') === 'Bearer fixture-secret'));
  });
}

test('Viggle uploads keep Blob bytes and repeated fields without JSON-encoding media', async () => {
  const png = new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' });
  const mp4 = new Blob([new Uint8Array([0, 0, 0, 24])], { type: 'video/mp4' });
  const script = wire(accepted('vid_upload'));
  await startAsset({ model: provider(script.fetch).referenceToVideo(), input: {
    prompt: 'Animate this scene', quality: 'high', reference_video: mp4,
    reference_image: [png, png], reference_image_url: [IMAGE],
  } });
  const form = script.calls[0].body;
  assert.ok(form instanceof FormData);
  assert.equal(form.getAll('reference_image').length, 2);
  for (const file of form.getAll('reference_image')) {
    assert.equal(file.type, 'image/png');
    assert.deepEqual(new Uint8Array(await file.arrayBuffer()), new Uint8Array(await png.arrayBuffer()));
  }
  assert.equal(form.get('reference_video').type, 'video/mp4');
  assert.deepEqual(form.getAll('reference_image_url'), [IMAGE]);
  assert.equal(script.calls[0].headers.has('content-type'), false);
});

test('Viggle explicit video modes reject conflicting or missing sources before a paid request', async () => {
  const script = wire(); const viggle = provider(script.fetch);
  const invalid = [
    ['textToVideo', { quality: 'low' }],
    ['textToVideo', { prompt: 'x' }],
    ['textToVideo', { prompt: 'x', quality: 'low', first_frame_image_url: IMAGE }],
    ['firstFrameToVideo', { prompt: 'x', quality: 'low' }],
    ['firstFrameToVideo', { prompt: 'x', quality: 'low', first_frame_image_url: IMAGE, last_frame_image_url: IMAGE_2 }],
    ['firstLastFrameToVideo', { prompt: 'x', quality: 'low', last_frame_image_url: IMAGE }],
    ['firstLastFrameToVideo', { prompt: 'x', quality: 'low', first_frame_image_url: IMAGE }],
    ['referenceToVideo', { prompt: 'x', quality: 'low' }],
    ['referenceToVideo', { prompt: 'x', quality: 'low', reference_image_url: [] }],
    ['referenceToVideo', { prompt: 'x', quality: 'low', reference_image_url: [IMAGE], first_frame_image_url: IMAGE }],
    ['referenceToVideo', { prompt: 'x', quality: 'low', reference_image_url: Array(5).fill(IMAGE) }],
    ['characterAnimation', { character_image_urls: [IMAGE] }],
    ['characterAnimation', { driving_video_url: SOURCE, character_image_urls: [IMAGE], quality: 'high' }],
    ['characterAnimation', { driving_video_url: SOURCE, character_image_urls: [IMAGE], first_frame_image_url: IMAGE }],
    ['characterAnimation', { driving_video_url: SOURCE, character_image_urls: [IMAGE], character_image_url: IMAGE }],
    ['characterAnimation', { driving_video_url: SOURCE, character_image_urls: Array(11).fill(IMAGE), enhance_mode: 'agent' }],
    ['renderVideo', {}],
    ['renderVideo', { image_url: IMAGE }],
    ['renderVideo', { image_url: IMAGE, character_id: 'char_saved', motion_video_url: SOURCE }],
    ['renderVideo', { image_url: IMAGE, motion_video_url: SOURCE, motion_id: 'mot_saved' }],
  ];
  for (const [factory, input] of invalid) {
    await assert.rejects(startAsset({ model: viggle[factory](), input }), undefined, factory);
  }
  assert.equal(script.calls.length, 0);
});

test('Viggle known numeric limits and image counts fail locally without blocking future native fields', async () => {
  const script = wire(); const viggle = provider(script.fetch);
  for (const patch of [{ duration_s: 4.9 }, { duration_s: 15.1 }, { seed: -1 }, { seed: Infinity }]) {
    await assert.rejects(startAsset({ model: viggle.textToVideo(), input: { prompt: 'x', quality: 'low', ...patch } }));
  }
  for (const patch of [{ n: 0 }, { n: 7 }, { n: 1.5 }, { seed: -1 }, { seed: 2147483648 }, { reference_image_url: Array(9).fill(IMAGE) }]) {
    await assert.rejects(startAsset({ model: viggle.image(), input: { prompt: 'x', ...patch } }));
  }
  assert.equal(script.calls.length, 0);
});

test('Viggle image requests without references still use multipart and preserve a zero seed', async () => {
  const script = wire(accepted('img_text'));
  await startAsset({ model: provider(script.fetch).image(), input: { prompt: '测试', seed: 0, n: 1 } });
  assertMultipart(script.calls[0], { prompt: '测试', seed: 0, n: 1 });
});

test('Viggle render exposes foreground and alpha as separate files and resumes only through videos', async () => {
  const id = 'render_alpha'; const native = video(id, { alpha_url: ALPHA });
  const script = wire(accepted(id), json(video(id, { status: 'processing', progress: 35, video_url: null })), json(native));
  const settings = { apiKey: 'fixture-secret', fetch: script.fetch, connectionId: 'tenant-one' };
  const started = await startAsset({ model: createViggleProvider(settings).renderVideo(), input: {
    character_id: 'char_saved', motion_id: 'mot_saved', background_mode: 'transparent',
  } });
  const saved = JSON.parse(JSON.stringify(started.operation));
  assert.equal(JSON.stringify(saved).includes('fixture-secret'), false);
  const restored = createViggleProvider(settings).renderVideo();
  assert.equal((await getAssetStatus({ model: restored, operation: saved })).status, 'running');
  const result = await waitForAsset({ model: restored, operation: saved, poll });
  assert.deepEqual(result.assets.map(asset => asset.url), [VIDEO, ALPHA]);
  assert.deepEqual(result.assets.map(asset => asset.role), ['video', 'alpha']);
  assert.deepEqual(result.providerMetadata.viggle.output, native);
  assert.equal(script.calls.filter(call => call.method === 'POST').length, 1);
  assert.ok(script.calls.slice(1).every(call => call.url === `${BASE}/videos/${id}`));
});

test('Viggle draft preparation and submission retain upload handles, quoted ETags and idempotency', async () => {
  const preparation = {
    character: { kind: 'upload', filename: 'character.png', content_type: 'image/png', bytes: 4 },
    motion: { kind: 'official_motion', motion_id: 'official-dance' },
    output: { background_mode: 'transparent', aspect_ratio: 'source' },
  };
  const draft = { draft_id: 'draft_one', state: 'awaiting_uploads', uploads: [{
    slot: 'character', upload_handle: 'upload_one', method: 'PUT',
    url: 'https://uploads.example/object?signature=1', required_headers: { 'Content-Type': 'image/png' }, expires_at: CREATED,
  }] };
  const input = { draft_id: draft.draft_id, upload_completions: [{ upload_handle: 'upload_one', etag: '"object-etag"' }] };
  const script = wire(json(draft), accepted('render_draft', 202));
  const viggle = provider(script.fetch);
  assert.deepEqual(await viggle.renders.prepare(preparation), draft);
  await startAsset({ model: viggle.renderDraft(), input, headers: { 'Idempotency-Key': 'stable-user-key' } });
  assert.deepEqual(JSON.parse(script.calls[0].body), preparation);
  assert.deepEqual(JSON.parse(script.calls[1].body), input);
  assert.equal(script.calls[1].headers.get('idempotency-key'), 'stable-user-key');
  assert.equal(script.calls[0].headers.get('content-type'), 'application/json');
  assert.deepEqual(script.calls.map(call => call.url), [`${BASE}/renders/prepare`, `${BASE}/renders`]);
});

test('Viggle draft retries use one unchanged draft and key without hidden upload or prepare operations', async () => {
  const input = { draft_id: 'draft_retry', upload_completions: [] };
  const busy = { error: { code: 'SERVICE_BUSY', message: 'Busy', retryable: true, request_id: 'req_busy', remediation: { action: 'retry', retry_after_ms: 0 } } };
  const script = wire(json(busy, 503, { 'retry-after-ms': '0' }), accepted('render_retry', 202));
  await startAsset({ model: provider(script.fetch).renderDraft(), input, retry: { start: 1 } });
  assert.equal(script.calls.length, 2);
  assert.ok(script.calls.every(call => call.url === `${BASE}/renders`));
  assert.equal(script.calls[0].body, script.calls[1].body);
  assert.ok(script.calls[0].headers.get('idempotency-key'));
  assert.equal(script.calls[0].headers.get('idempotency-key'), script.calls[1].headers.get('idempotency-key'));
});

test('Viggle uncertain non-idempotent submissions never duplicate paid work', async () => {
  for (const response of [
    json({ error: { code: 'SERVICE_BUSY', message: 'busy', retryable: true } }, 503),
    json({ status: 'queued' }), json({ id: 'vid_wrong-kind', status: 'queued' }), new Response('{', { status: 200 }),
  ]) {
    const script = wire(response);
    await assert.rejects(startAsset({ model: provider(script.fetch).image(), input: { prompt: 'a robot' } }));
    assert.equal(script.calls.length, 1);
  }
  const script = wire();
  await assert.rejects(startAsset({ model: provider(script.fetch).textToVideo(), input: { prompt: 'x', quality: 'low' }, retry: { start: 1 } }), /idempotent/);
  assert.equal(script.calls.length, 0);
});

test('Viggle status retries query only the accepted operation and honor native retryability', async () => {
  const id = 'vid_retry';
  const script = wire(accepted(id), json({ error: {
    code: 'RATE_LIMITED', message: 'Try later', retryable: true, request_id: 'req_poll',
    remediation: { action: 'retry', retry_after_ms: 0 },
  } }, 429, { 'retry-after-ms': '0' }), json(video(id)));
  const result = await generateAsset({ model: provider(script.fetch).textToVideo(), input: { prompt: 'x', quality: 'low' }, poll });
  assert.equal(result.asset.url, VIDEO);
  assert.deepEqual(script.calls.map(call => call.method), ['POST', 'GET', 'GET']);

  const refused = wire(json({ error: { code: 'PROCESSING_FAILED', message: 'Do not retry', retryable: false, request_id: 'req_final' } }, 500));
  await assert.rejects(provider(refused.fetch).videos.get(id), error => APICallError.isInstance(error) && !error.isRetryable);
  assert.equal(refused.calls.length, 1);
});

test('Viggle terminal failures, cancelled renders and unfamiliar progress stages do not resubmit', async () => {
  const id = 'render_states';
  const script = wire(accepted(id),
    json(video(id, { status: 'processing', stage: 'future-stage', progress: null, video_url: null })),
    json(video(id, { status: 'failed', video_url: null, error: { code: 'TASK_FAILED', message: 'No usable person', retryable: false, request_id: 'req_failed' } })),
    json(video(id, { status: 'cancelled', video_url: null })),
  );
  const model = provider(script.fetch).renderVideo();
  const { operation } = await startAsset({ model, input: { image_url: IMAGE, motion_video_url: SOURCE } });
  assert.equal((await getAssetStatus({ model, operation })).status, 'running');
  const failed = await getAssetStatus({ model, operation });
  assert.equal(failed.status, 'failed'); assert.equal(failed.error.code, 'TASK_FAILED');
  assert.equal((await getAssetStatus({ model, operation })).status, 'cancelled');
  assert.deepEqual(script.calls.map(call => call.method), ['POST', 'GET', 'GET', 'GET']);
});

test('Viggle ready records require usable promised files; expired image history remains queryable', async () => {
  for (const [factory, id, native] of [
    ['textToVideo', 'vid_no_output', video('vid_no_output', { video_url: null })],
    ['image', 'img_expired', image('img_expired', { images: [{ url: null, width: 1024, height: 1024, seed: 0 }] })],
    ['image', 'img_partial', image('img_partial', { images: [{ url: IMAGE, width: 1024, height: 1024, seed: 0 }, { url: null, width: 1024, height: 1024, seed: 1 }] })],
    ['image', 'img_empty', image('img_empty', { images: [] })],
  ]) {
    const script = wire(accepted(id), json(native), json(native));
    const viggle = provider(script.fetch); const model = viggle[factory]();
    const { operation } = await startAsset({ model, input: factory === 'image' ? { prompt: 'x' } : { prompt: 'x', quality: 'low' } });
    await assert.rejects(waitForAsset({ model, operation, poll }));
    const raw = factory === 'image' ? await viggle.images.get(id) : await viggle.videos.get(id);
    assert.deepEqual(raw, native);
    assert.equal(script.calls.filter(call => call.method === 'POST').length, 1);
  }
});

test('Viggle H3 preserves server-generated 63-bit seeds exactly rather than rounding JSON integers', async () => {
  const raw = '{"id":"vid_seed","status":"ready","progress":100,"stage":null,"video_url":"https://assets.example/result.mp4","alpha_url":null,"seed":4271960385017522688}';
  const script = wire(accepted('vid_seed'), new Response(raw, { headers: { 'content-type': 'application/json' } }));
  const result = await generateAsset({ model: provider(script.fetch).textToVideo(), input: { prompt: 'x', quality: 'low' }, poll });
  assert.equal(String(result.providerMetadata.viggle.output.seed), '4271960385017522688');
  assert.doesNotThrow(() => JSON.stringify(result.providerMetadata));
});

test('Viggle H3 accepts an exact returned seed as decimal text and rejects already unsafe numeric seeds', async () => {
  const script = wire(accepted('vid_exact_seed'));
  const model = provider(script.fetch).textToVideo();
  const seed = '9223372036854775807';
  await startAsset({ model, input: { prompt: 'x', quality: 'low', seed } });
  assert.equal(script.calls[0].body.get('seed'), seed);
  for (const value of ['9223372036854775808', '1e6', -1, Number.MAX_SAFE_INTEGER + 1]) {
    await assert.rejects(startAsset({ model, input: { prompt: 'x', quality: 'low', seed: value } }));
  }
  assert.equal(script.calls.length, 1);
});

test('Viggle status identity, lifecycle and progress are verified before accepting generated output', async () => {
  for (const patch of [{ id: 'vid_other' }, { status: 'unknown-new-state' }, { status: 'processing', progress: 101 }]) {
    const script = wire(accepted('vid_validate'), json(video('vid_validate', patch)));
    await assert.rejects(generateAsset({ model: provider(script.fetch).textToVideo(), input: { prompt: 'x', quality: 'low' }, poll }));
    assert.deepEqual(script.calls.map(call => call.method), ['POST', 'GET']);
  }
});

test('Viggle upscale is a resumable processing task with a fixed native 2x request', async () => {
  const id = 'vsr_scale'; const native = video(id);
  const script = wire(accepted(id), json(native));
  const settings = { apiKey: 'fixture-secret', fetch: script.fetch };
  const { task } = await startTask({ model: createViggleProvider(settings).upscaleVideo(), input: { video_url: SOURCE, watermark: false } });
  const result = await waitForTask({ model: createViggleProvider(settings).upscaleVideo(), task: JSON.parse(JSON.stringify(task)), poll });
  assert.equal(result.result.video.url, VIDEO);
  assert.deepEqual(result.result.files.map(file => file.url), [VIDEO]);
  assert.deepEqual(result.result.raw, native); assert.equal(result.result.taskId, id);
  assertMultipart(script.calls[0], { video_url: SOURCE, watermark: false });
  assert.deepEqual(script.calls.map(call => [call.method, call.url]), [
    ['POST', `${BASE}/videos/super-resolution`], ['GET', `${BASE}/videos/${id}`],
  ]);
});

test('Viggle cancellation and local abort cannot send unpublished remote cancellation requests', async () => {
  const script = wire(accepted('vid_abort'), accepted('vsr_abort'));
  const viggle = provider(script.fetch); const model = viggle.textToVideo();
  const { operation } = await startAsset({ model, input: { prompt: 'x', quality: 'low' } });
  await assert.rejects(cancelAsset({ model, operation }), /cancel/i);
  await assert.rejects(waitForAsset({ model, operation, abortSignal: AbortSignal.abort() }));
  await assert.rejects(startAsset({ model, input: { prompt: 'x', quality: 'low' }, webhookUrl: 'https://app.example/callback' }), /webhook/i);
  const processor = viggle.upscaleVideo(); const { task } = await startTask({ model: processor, input: { video_url: SOURCE } });
  await assert.rejects(cancelTask({ model: processor, task }), /cancel/i);
  await assert.rejects(waitForTask({ model: processor, task, abortSignal: AbortSignal.abort() }));
  assert.deepEqual(script.calls.map(call => call.method), ['POST', 'POST']);
});

test('Viggle resource queries preserve native pagination, zero or fractional balance, and explicit headers', async () => {
  const page = { items: [{ id: 'vid_list', status: 'queued', progress: null }], next_cursor: 'opaque+next/=', has_more: true };
  const script = wire(json(video('vid_detail')), json(page), json(image('img_detail')), json({ balance: 0 }), json({ balance: 12.5 }));
  const viggle = provider(script.fetch);
  assert.deepEqual(await viggle.videos.get('vid_detail'), video('vid_detail'));
  assert.deepEqual(await viggle.videos.list({ status: 'queued', cursor: 'opaque+before/=', limit: 100 }), page);
  assert.deepEqual(await viggle.images.get('img_detail'), image('img_detail'));
  assert.equal((await viggle.credits.get({ headers: { 'X-Request-Id': 'req_credit', 'X-Viggle-Source': 'test-sdk' } })).balance, 0);
  assert.equal((await viggle.credits.get()).balance, 12.5);
  const query = new URL(script.calls[1].url).searchParams;
  assert.equal(query.get('cursor'), 'opaque+before/='); assert.equal(query.get('limit'), '100'); assert.equal(query.get('status'), 'queued');
  assert.equal(script.calls[3].headers.get('x-request-id'), 'req_credit');
  assert.equal(script.calls[3].headers.get('x-viggle-source'), 'test-sdk');
  assert.ok(script.calls.every(call => call.method === 'GET'));
});

test('Viggle resources reject wrong ID families and path injection without credentialed I/O', async () => {
  const script = wire(); const viggle = provider(script.fetch);
  for (const id of ['', '../credits', 'vid_x/../../credits', 'vid_x?secret=1', 'https://evil.example/x', 'img_wrong-family']) {
    await assert.rejects(viggle.videos.get(id));
  }
  for (const id of ['vid_wrong-family', 'img_x/../../credits']) await assert.rejects(viggle.images.get(id));
  for (const limit of [0, 101, 1.5]) await assert.rejects(viggle.videos.list({ limit }));
  assert.equal(script.calls.length, 0);
});

test('Viggle resumed operations stay bound to the original capability, connection and base URL', async () => {
  const script = wire(accepted('vid_bound'));
  const config = { apiKey: 'private', fetch: script.fetch, connectionId: 'tenant-a', baseURL: 'https://proxy.example/viggle/v1' };
  const { operation } = await startAsset({ model: createViggleProvider(config).textToVideo(), input: { prompt: 'x', quality: 'low' } });
  for (const model of [
    createViggleProvider(config).firstFrameToVideo(),
    createViggleProvider({ ...config, connectionId: 'tenant-b' }).textToVideo(),
    createViggleProvider({ ...config, baseURL: BASE }).textToVideo(),
  ]) await assert.rejects(getAssetStatus({ model, operation }));
  assert.equal(script.calls.length, 1);
  assert.equal(JSON.stringify(operation).includes('private'), false);
});

test('Viggle overrides caller Authorization, keeps proxy paths and does not follow API redirects', async () => {
  const script = wire(accepted('vid_proxy'));
  const model = provider(script.fetch, { baseURL: 'https://proxy.example/custom/v1', headers: { 'x-project': 'demo' } }).textToVideo();
  await startAsset({ model, input: { prompt: 'x', quality: 'low' }, headers: { Authorization: 'Bearer unrelated' } });
  assert.equal(script.calls[0].url, 'https://proxy.example/custom/v1/videos');
  assert.equal(script.calls[0].headers.get('authorization'), 'Bearer fixture-secret');
  assert.equal(script.calls[0].headers.get('x-project'), 'demo');
  assert.ok(['error', 'manual'].includes(script.calls[0].redirect));
  const redirected = wire(new Response(null, { status: 302, headers: { location: 'https://evil.example/videos' } }));
  await assert.rejects(startAsset({ model: provider(redirected.fetch).textToVideo(), input: { prompt: 'x', quality: 'low' } }));
  assert.equal(redirected.calls.length, 1);
});

test('Viggle render events parse split SSE frames without reconnecting or resubmitting', async () => {
  const snapshot = { event_id: 'event_1', sequence: 1, id: 'render_events', status: 'processing', stage: 'rendering', progress: 40 };
  const ready = { event_id: 'event_2', sequence: 2, id: 'render_events', status: 'ready', video_url: VIDEO, alpha_url: ALPHA };
  const text = `id: event_1\nevent: snapshot\ndata: ${JSON.stringify(snapshot)}\n\n: keep-alive\n\nevent: heartbeat\n\nid: event_2\nevent: ready\ndata: ${JSON.stringify(ready)}\n\n`;
  const encoded = new TextEncoder().encode(text);
  const stream = new ReadableStream({ start(controller) {
    for (let index = 0; index < encoded.length; index += 13) controller.enqueue(encoded.slice(index, index + 13));
    controller.close();
  } });
  const script = wire(new Response(stream, { headers: { 'content-type': 'text/event-stream' } }));
  const events = [];
  for await (const event of await provider(script.fetch).renders.events('render_events', { lastEventId: 'event_previous' })) events.push(event);
  assert.deepEqual(events.filter(event => event.data).map(event => event.data), [snapshot, ready]);
  assert.deepEqual(events.filter(event => event.data).map(event => event.event), ['snapshot', 'ready']);
  assert.equal(script.calls[0].headers.get('last-event-id'), 'event_previous');
  assert.equal(script.calls[0].headers.get('accept'), 'text/event-stream');
  assert.equal(script.calls[0].url, `${BASE}/renders/render_events/events`);
  assert.equal(script.calls.length, 1);
});

test('Viggle draft upload sends only signed storage headers and preserves the quoted ETag', async () => {
  const plan = {
    upload_handle: 'upload_character', method: 'PUT', url: 'https://uploads.example/character.png?signature=signed',
    required_headers: { 'content-type': 'image/png', 'x-upload-token': 'signed-token' },
  };
  const file = new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' });
  const script = wire(new Response(null, { status: 200, headers: { etag: '"opaque-etag"' } }));
  const signal = new AbortController().signal;
  const result = await provider(script.fetch, { headers: { 'x-project': 'private-project' } }).renders.upload(plan, file, { abortSignal: signal });
  assert.deepEqual(result, { upload_handle: plan.upload_handle, etag: '"opaque-etag"' });
  assert.equal(script.calls.length, 1);
  const call = script.calls[0];
  assert.equal(call.url, plan.url); assert.equal(call.method, 'PUT'); assert.equal(call.redirect, 'manual');
  assert.equal(call.body, file); assert.equal(call.signal, signal);
  assert.deepEqual(Object.fromEntries(call.headers), plan.required_headers);
  assert.equal(call.headers.has('authorization'), false); assert.equal(call.headers.has('x-project'), false);
});

test('Viggle draft upload rejects redirects without a second request and honors pre-abort locally', async () => {
  const plan = { upload_handle: 'upload_character', method: 'PUT', url: 'https://uploads.example/character.png?signature=signed' };
  const file = new Blob(['image'], { type: 'image/png' });
  const redirected = new Response(null, { status: 200 });
  Object.defineProperty(redirected, 'redirected', { value: true });
  Object.defineProperty(redirected, 'url', { value: 'https://other-storage.example/character.png' });
  for (const response of [new Response(null, { status: 302, headers: { location: 'https://other-storage.example/character.png' } }), redirected]) {
    const script = wire(response);
    await assert.rejects(provider(script.fetch).renders.upload(plan, file), error => APICallError.isInstance(error) && error.isRetryable === false);
    assert.equal(script.calls.length, 1); assert.equal(script.calls[0].redirect, 'manual');
  }
  const script = wire(); const viggle = provider(script.fetch);
  await assert.rejects(viggle.renders.upload(plan, file, { abortSignal: AbortSignal.abort() }));
  await assert.rejects(viggle.renders.upload({ ...plan, url: 'http://uploads.example/plaintext' }, file));
  assert.equal(script.calls.length, 0);
});

test('Viggle render download returns the signed redirect without sending API credentials to storage', async () => {
  const url = 'https://storage.example/result.mp4?signature=signed';
  const script = wire(new Response(null, { status: 302, headers: { location: url, 'x-request-id': 'req_download' } }));
  const result = await provider(script.fetch).renders.download('render_download');
  assert.equal(result.url, url); assert.equal(result.response.headers['x-request-id'], 'req_download');
  assert.equal(script.calls[0].url, `${BASE}/renders/render_download/download`);
  assert.equal(script.calls[0].redirect, 'manual');
  assert.equal(script.calls.length, 1);
});

test('Viggle native provider options supplement inputs but cannot silently replace a declared field', async () => {
  const script = wire(accepted('vid_options'));
  const model = provider(script.fetch).textToVideo();
  await startAsset({ model, input: { prompt: 'x', quality: 'low' }, providerOptions: { viggle: { future_native: { enabled: true } } } });
  assert.equal(script.calls[0].body.get('future_native'), '{"enabled":true}');
  await assert.rejects(startAsset({ model, input: { prompt: 'x', quality: 'low' }, providerOptions: { viggle: { prompt: 'changed' } } }));
  assert.equal(script.calls.length, 1);
});

test('Viggle input getters and unsupported nested values fail without running caller accessors', async () => {
  const script = wire(); const model = provider(script.fetch).image(); let accesses = 0;
  const input = Object.defineProperty({}, 'prompt', { enumerable: true, get() { accesses++; return 'a robot'; } });
  await assert.rejects(startAsset({ model, input }));
  await assert.rejects(startAsset({ model, input: { prompt: 'a robot', future_option: { amount: Infinity } } }));
  assert.equal(accesses, 0); assert.equal(script.calls.length, 0);
});
