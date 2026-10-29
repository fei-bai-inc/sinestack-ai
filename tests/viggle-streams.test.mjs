import assert from 'node:assert/strict';
import test from 'node:test';
import { APICallError } from '@ai-sdk/provider';
import { ViggleClient } from '../packages/viggle/dist/client.js';
import { renderEvents } from '../packages/viggle/dist/streams.js';

const encoder = new TextEncoder();
function clientWith(body, headers = { 'content-type': 'text/event-stream' }) {
  const calls = [];
  const client = new ViggleClient({ apiKey: 'fixture-key', fetch: async (url, init) => {
    calls.push({ url, init }); return new Response(body, { headers });
  } });
  return { client, calls };
}

test('Render SSE handles split UTF-8, multiline JSON and unknown fields without reconnecting', async () => {
  const frame = 'id: event-one\nevent: snapshot\nfuture-field: ignored\nretry: invalid\nretry: 750\ndata: {"id":"render_one",\ndata: "status":"processing","label":"跳舞","seed":9223372036854775807}\n\n';
  const bytes = encoder.encode(frame);
  const body = new ReadableStream({ start(controller) {
    for (let index = 0; index < bytes.length; index += 2) controller.enqueue(bytes.slice(index, index + 2));
    controller.close();
  } });
  const { client, calls } = clientWith(body);
  const events = [];
  for await (const event of await renderEvents(client, 'render_one', { lastEventId: 'before' })) events.push(event);
  assert.deepEqual(events, [{ event: 'snapshot', id: 'event-one', retry: 750,
    data: { id: 'render_one', status: 'processing', label: '跳舞', seed: '9223372036854775807' } }]);
  assert.equal(calls.length, 1);
  assert.equal(new Headers(calls[0].init.headers).get('last-event-id'), 'before');
});

test('breaking a Render SSE iterator cancels its upstream response body', async () => {
  let cancelled = 0;
  const { client, calls } = clientWith(new ReadableStream({
    start(controller) { controller.enqueue(encoder.encode('data: {"id":"render_one","status":"processing"}\n\n')); },
    cancel() { cancelled++; },
  }));
  for await (const event of await renderEvents(client, 'render_one')) {
    assert.equal(event.data.status, 'processing');
    break;
  }
  assert.equal(cancelled, 1);
  assert.equal(calls.length, 1);
});

test('aborting a pending Render SSE read rejects with the caller reason and cleans up', async () => {
  let cancelled = 0;
  const { client, calls } = clientWith(new ReadableStream({ cancel() { cancelled++; } }));
  const controller = new AbortController();
  const reason = new Error('stop observing');
  const iterable = await renderEvents(client, 'render_one', { abortSignal: controller.signal });
  const next = iterable[Symbol.asyncIterator]().next();
  controller.abort(reason);
  await assert.rejects(next, error => error === reason);
  assert.equal(cancelled, 1);
  assert.equal(calls.length, 1);
});

test('Render SSE task mismatches and non-SSE responses fail while releasing the body', async () => {
  let cancelled = 0;
  const { client } = clientWith(new ReadableStream({
    start(controller) { controller.enqueue(encoder.encode('data: {"id":"render_other","status":"ready"}\n\n')); },
    cancel() { cancelled++; },
  }));
  const events = await renderEvents(client, 'render_one');
  await assert.rejects(events[Symbol.asyncIterator]().next(), error => APICallError.isInstance(error) && !error.isRetryable);
  assert.equal(cancelled, 1);
  const wrongType = clientWith(new ReadableStream({ cancel() { cancelled++; } }), { 'content-type': 'application/json' });
  await assert.rejects(renderEvents(wrongType.client, 'render_one'), /text\/event-stream/);
  assert.equal(cancelled, 2);
});
