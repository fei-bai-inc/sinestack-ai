import type { AssetResponse, JSONObject, JSONValue } from '@sinestack/ai-provider';
import { AssetProviderTransport, errorMessage, invalidResponse, jsonObject, jsonValue, record } from '@sinestack/ai-provider-utils';
import type { AssetProviderResponse } from '@sinestack/ai-provider-utils';
import type { TripoProviderSettings, TripoTaskRecord } from './types.js';

export interface TripoRequestOptions { readonly abortSignal?: AbortSignal; readonly headers?: Record<string, string> }
export class TripoAPIError extends Error {
  readonly code: number | string;
  readonly response: AssetResponse;
  constructor(message: string, code: number | string, response: AssetResponse) {
    super(message); this.name = 'TripoAPIError'; this.code = code; this.response = response;
  }
}
export function taskId(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,255}$/.test(value)) throw new TypeError('Invalid Tripo task ID');
  return value;
}
export class TripoClient {
  readonly transport: AssetProviderTransport;
  readonly provider: string;
  readonly connectionId?: string;
  readonly fetcher: typeof globalThis.fetch;
  constructor(settings: TripoProviderSettings) {
    this.provider = settings.name ?? 'tripo';
    this.connectionId = settings.connectionId;
    if (this.connectionId !== undefined && (typeof this.connectionId !== 'string' || !this.connectionId.trim())) throw new TypeError('connectionId must not be empty');
    this.fetcher = settings.fetch ?? globalThis.fetch;
    this.transport = new AssetProviderTransport({ ...settings, provider: 'Tripo',
      baseURL: settings.baseURL ?? 'https://openapi.tripo3d.ai/v3', environmentVariableName: 'TRIPO_API_KEY' });
  }
  options(options: TripoRequestOptions = {}) { return { headers: { ...options.headers }, abortSignal: options.abortSignal ?? new AbortController().signal }; }
  unwrap(response: AssetProviderResponse): JSONValue {
    const envelope = record(response.value, 'Tripo response');
    if (typeof envelope.code !== 'number') throw invalidResponse(response, new TypeError('Missing numeric API code'), 'Tripo');
    if (envelope.code !== 0) throw new TripoAPIError(errorMessage(envelope) ?? `Tripo API error ${envelope.code}`, envelope.code, response.response);
    try { return jsonValue(envelope.data, 'Tripo response data'); }
    catch (cause) { throw invalidResponse(response, cause, 'Tripo'); }
  }
  async request(path: string, method: 'GET' | 'POST', options: TripoRequestOptions = {}, body?: JSONObject | FormData) {
    const response = await this.transport.request(`${this.transport.baseURL}/${path}`, method, this.options(options), body);
    return { data: this.unwrap(response), response: response.response };
  }
  async getTask(id: string, options: TripoRequestOptions = {}): Promise<{ data: TripoTaskRecord; response: AssetResponse }> {
    const result = await this.request(`tasks/${taskId(id)}`, 'GET', options);
    const data = jsonObject(result.data, 'Tripo task');
    if (data.task_id !== id || typeof data.status !== 'string' || !data.status) throw new TypeError('Tripo task identity or status mismatch');
    if (data.progress !== undefined && (typeof data.progress !== 'number' || !Number.isFinite(data.progress) || data.progress < 0 || data.progress > 100)) throw new TypeError('Invalid Tripo progress');
    if (data.credits_consumed !== undefined && (typeof data.credits_consumed !== 'number' || !Number.isFinite(data.credits_consumed))) throw new TypeError('Invalid Tripo credits_consumed');
    return { ...result, data: data as TripoTaskRecord };
  }
}
