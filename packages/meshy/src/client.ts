import type { JSONObject } from '@sinestack/ai-provider';
import { AssetProviderTransport, invalidResponse, jsonObject } from '@sinestack/ai-provider-utils';
import type { AssetProviderResponse } from '@sinestack/ai-provider-utils';
import type { MeshyProviderSettings, MeshyRequestOptions, MeshyTaskRecord } from './types.js';
import { boundedNumber, nonempty } from './validation.js';
import { validateRoute } from './routes.js';

/** Treat IDs as opaque single path segments, never as provider URLs or UUIDs. */
export function meshyTaskId(value: unknown): string {
  nonempty(value, 'Meshy task ID');
  if (value === '.' || value === '..' || /[\/\\?#%\s\u0000-\u001f]/u.test(value)) throw new TypeError('Unsafe Meshy task ID');
  return value;
}
export function parseMeshyTask(value: unknown, expectedId?: string): MeshyTaskRecord {
  const task = jsonObject(value, 'Meshy task');
  meshyTaskId(task.id);
  if (expectedId !== undefined && task.id !== expectedId) throw new TypeError('Meshy task identity mismatch');
  if (!['PENDING', 'IN_PROGRESS', 'SUCCEEDED', 'FAILED', 'CANCELED'].includes(String(task.status))) throw new TypeError('Unknown Meshy task status');
  if (task.progress !== undefined) boundedNumber(task.progress, 'Meshy progress', 0, 100);
  if (task.consumed_credits != null) boundedNumber(task.consumed_credits, 'consumed_credits', 0);
  for (const field of ['created_at', 'started_at', 'finished_at', 'expires_at']) if (task[field] != null) boundedNumber(task[field], field, 0);
  if (task.task_error != null) jsonObject(task.task_error, 'task_error');
  return task as MeshyTaskRecord;
}
export function decodeResponse<T>(response: AssetProviderResponse, decode: (value: unknown) => T): T {
  try { return decode(response.value); }
  catch (cause) { throw invalidResponse(response, cause, 'Meshy'); }
}
export class MeshyClient {
  readonly transport: AssetProviderTransport;
  readonly provider: string;
  readonly connectionId?: string;
  constructor(settings: MeshyProviderSettings) {
    this.provider = settings.name ?? 'meshy'; nonempty(this.provider, 'Meshy provider name');
    this.connectionId = settings.connectionId;
    if (this.connectionId !== undefined) nonempty(this.connectionId, 'connectionId');
    this.transport = new AssetProviderTransport({ ...settings, provider: 'Meshy',
      baseURL: settings.baseURL ?? 'https://api.meshy.ai/openapi', environmentVariableName: 'MESHY_API_KEY' });
  }
  request(path: string, method: 'GET' | 'POST' | 'DELETE', options: MeshyRequestOptions = {}, body?: JSONObject, allowEmpty = false) {
    return this.transport.request(`${this.transport.baseURL}/${path}`, method,
      { headers: { ...options.headers }, abortSignal: options.abortSignal ?? new AbortController().signal }, body, allowEmpty);
  }
  async getTask(route: string, id: string, options?: MeshyRequestOptions) {
    const path = `${validateRoute(route)}/${encodeURIComponent(meshyTaskId(id))}`;
    const response = await this.request(path, 'GET', options);
    return { data: decodeResponse(response, value => parseMeshyTask(value, id)), response: response.response };
  }
  async deleteTask(route: string, id: string, options?: MeshyRequestOptions) {
    const path = `${validateRoute(route)}/${encodeURIComponent(meshyTaskId(id))}`;
    const response = await this.request(path, 'DELETE', options, undefined, true);
    decodeResponse(response, value => {
      if (value !== undefined && Object.keys(jsonObject(value, 'Meshy delete acknowledgement')).length !== 0) throw new TypeError('Unexpected Meshy deletion acknowledgement');
    });
    return { status: 'deleted' as const, response: response.response };
  }
}
