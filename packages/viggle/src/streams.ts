import { APICallError } from '@ai-sdk/provider';
import { jsonObject } from '@sinestack/ai-provider-utils';
import { EventSourceParserStream } from 'eventsource-parser/stream';
import { parseJSON, type ViggleClient } from './client.js';
import type { ViggleRenderEvent, ViggleRenderEventsOptions } from './types.js';
import { nonempty, opaqueId } from './validation.js';

/** Observe a single Render stream. Reconnection and task recovery remain explicit caller actions. */
export async function renderEvents(client: ViggleClient, id: string, options: ViggleRenderEventsOptions = {}): Promise<AsyncIterable<ViggleRenderEvent>> {
  opaqueId(id, ['render_']);
  if (id === 'render_') throw new TypeError('A complete Render ID is required');
  const headers = new Headers(options.headers);
  if (options.lastEventId !== undefined) {
    nonempty(options.lastEventId, 'lastEventId');
    headers.set('Last-Event-ID', options.lastEventId);
  }
  const path = `renders/${encodeURIComponent(id)}/events`;
  const response = await client.raw(path, { ...options, headers: Object.fromEntries(headers) }, { accept: 'text/event-stream' });
  const url = `${client.transport.baseURL}/${path}`;
  const responseHeaders = Object.fromEntries(response.headers);
  const invalid = (message: string, cause?: unknown, responseBody?: string) => new APICallError({
    message, cause, responseBody, url, requestBodyValues: undefined,
    statusCode: response.status, responseHeaders, isRetryable: false,
  });
  if (!response.body || response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() !== 'text/event-stream') {
    try { await response.body?.cancel(); } catch { /* Preserve the protocol error. */ }
    throw invalid('Viggle Render events require a nonempty text/event-stream response');
  }
  const signal = options.abortSignal;
  let retry: number | undefined;
  const events = response.body
    .pipeThrough(new TextDecoderStream(), { signal })
    // Unknown SSE fields and invalid retry hints are ignored by the parser;
    // its buffer limit remains fatal without changing SSE forward compatibility.
    .pipeThrough(new EventSourceParserStream({ maxBufferSize: 16 * 1024 * 1024,
      onRetry: value => { retry = value; } }), { signal });
  return (async function* (): AsyncGenerator<ViggleRenderEvent> {
    const reader = events.getReader();
    try {
      for (;;) {
        signal?.throwIfAborted();
        const next = await reader.read();
        signal?.throwIfAborted();
        if (next.done) break;
        const message = next.value;
        let data;
        try {
          data = jsonObject(parseJSON(message.data), 'Viggle Render event');
          if (data.id !== undefined && data.id !== id) throw new TypeError('Render event belongs to a different task');
        } catch (cause) { throw invalid('Invalid Viggle Render event', cause, message.data); }
        yield { event: message.event ?? 'message', ...(message.id === undefined ? {} : { id: message.id }),
          data, ...(retry === undefined ? {} : { retry }) };
      }
    } finally {
      try { await reader.cancel(); } catch { /* Keep the original read, abort or parsing error. */ }
      finally { reader.releaseLock(); }
    }
  })();
}
