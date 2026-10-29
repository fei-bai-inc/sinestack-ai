import { parseMeshyTask } from './client.js';

/**
 * Parsing is NOT authentication. The reviewed public Meshy webhook reference
 * does not specify a signature-verification protocol; do not reuse Tripo HMAC.
 * Use only to wake a registered, authorized task and re-read its GET endpoint.
 * Never derive an authenticated request route/connection from this payload.
 */
export function parseMeshyWebhook(body: string | Uint8Array | unknown) {
  const value = typeof body === 'string' ? JSON.parse(body)
    : body instanceof Uint8Array ? JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body)) : body;
  const task = parseMeshyTask(value);
  return { authenticated: false as const, taskId: task.id, status: task.status,
    eventKey: `${task.id}:${task.status}`, task };
}
