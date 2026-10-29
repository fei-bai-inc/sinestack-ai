import type { JSONObject } from '@sinestack/ai-provider';
import { jsonObject } from '@sinestack/ai-provider-utils';
import { taskId } from './client.js';

export interface TripoWebhookOptions {
  readonly body: string | Uint8Array;
  readonly headers: HeadersInit;
  readonly secret: string;
  readonly expectedEndpointId?: string;
  readonly now?: number;
  readonly toleranceSeconds?: number;
}
/** Verify original bytes using Web Crypto, usable on Node and Workers. No Node crypto dependency. */
export async function verifyTripoWebhook(options: TripoWebhookOptions) {
  if (!options.secret) throw new TypeError('Webhook signing secret is required');
  const headers = new Headers(options.headers);
  const signature = headers.get('tripo-webhook-signature') ?? '';
  const fields = signature.split(',').map(part => part.trim());
  const timestamps = fields.filter(part => part.startsWith('t='));
  const signatures = fields.filter(part => part.startsWith('v1='));
  if (timestamps.length !== 1 || signatures.length !== 1) throw new Error('Malformed Tripo webhook signature');
  const timestamp = timestamps[0]!.slice(2); const expected = signatures[0]!.slice(3);
  if (!/^\d+$/.test(timestamp) || !/^[a-f0-9]{64}$/i.test(expected)) throw new Error('Malformed Tripo webhook signature');
  const tolerance = options.toleranceSeconds ?? 300;
  const now = options.now ?? Date.now();
  if (!Number.isFinite(tolerance) || tolerance < 0 || !Number.isFinite(now)) throw new TypeError('Invalid webhook time configuration');
  if (!Number.isSafeInteger(Number(timestamp)) || Math.abs(now / 1000 - Number(timestamp)) > tolerance) throw new Error('Expired Tripo webhook signature');
  const encoder = new TextEncoder();
  const body = typeof options.body === 'string' ? encoder.encode(options.body) : options.body;
  const prefix = encoder.encode(`${timestamp}.`);
  const signed = new Uint8Array(prefix.length + body.length); signed.set(prefix); signed.set(body, prefix.length);
  const key = await crypto.subtle.importKey('raw', encoder.encode(options.secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  const bytes = Uint8Array.from(expected.match(/../g)!, hex => parseInt(hex, 16));
  if (!await crypto.subtle.verify('HMAC', key, bytes, signed)) throw new Error('Invalid Tripo webhook signature');
  const endpointId = headers.get('tripo-webhook-id'); const deliveryId = headers.get('tripo-webhook-delivery');
  if (!endpointId || !deliveryId || (options.expectedEndpointId !== undefined && endpointId !== options.expectedEndpointId)) throw new Error('Invalid Tripo webhook endpoint or delivery');
  const event = jsonObject(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body)), 'Tripo webhook');
  if (typeof event.id !== 'string' || !event.id || typeof event.created_at !== 'string' || !Number.isFinite(Date.parse(event.created_at)) ||
    !['task.completed', 'task.failed', 'balance.low'].includes(String(event.type)) || headers.get('tripo-webhook-event') !== event.type) throw new Error('Invalid Tripo webhook event');
  const data = jsonObject(event.data, 'Tripo webhook data');
  return { event: { ...event, data } as JSONObject, endpointId, deliveryId,
    // event.id is signed; delivery headers are not covered by the signature. Scope
    // this key to the trusted connection and persist atomically with the host outbox.
    deduplicationKey: String(event.id), deliveryKey: `${endpointId}:${deliveryId}`,
    ...(event.type === 'balance.low' ? {} : { taskId: taskId(data.task_id) }) };
}
