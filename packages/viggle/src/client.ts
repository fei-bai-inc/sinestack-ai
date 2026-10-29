import { APICallError } from '@ai-sdk/provider';
import { readResponseWithSizeLimit, type ResponseHandler } from '@ai-sdk/provider-utils';
import type { AssetResponse, JSONObject } from '@sinestack/ai-provider';
import { AssetProviderTransport, errorMessage, invalidResponse, jsonObject, jsonValue } from '@sinestack/ai-provider-utils';
import type { AssetProviderResponse } from '@sinestack/ai-provider-utils';
import { parse as parseLosslessJSON } from 'lossless-json';
import type { ViggleJob, ViggleProviderSettings, ViggleRequestOptions } from './types.js';
import { bounded, inputObject, nonempty, opaqueId } from './validation.js';

const MAX_JSON_BYTES = 16 * 1024 * 1024;
const statuses = new Set(['queued', 'processing', 'ready', 'failed', 'cancelled']);
const decoder = new TextDecoder();

/** Preserve unsafe integer tokens as JSON-safe strings, without a BigInt value escaping. */
export function parseJSON(text: string): unknown {
  return parseLosslessJSON(text, undefined, { parseNumber: token => {
    const value = Number(token);
    if (/^-?\d+$/u.test(token) && !Number.isSafeInteger(value)) return token;
    if (!Number.isFinite(value)) throw new TypeError('Viggle JSON contains an unrepresentable number');
    return value;
  } });
}

async function responseText(response: Response, url: string): Promise<string> {
  return decoder.decode(await readResponseWithSizeLimit({ response, url, maxBytes: MAX_JSON_BYTES }));
}

const successfulResponseHandler: ResponseHandler<unknown> = async ({ response, url, requestBodyValues }) => {
  const responseHeaders = Object.fromEntries(response.headers);
  let responseBody: string | undefined;
  try {
    responseBody = await responseText(response, url);
    const value = jsonValue(parseJSON(responseBody), 'Viggle response');
    return { value, rawValue: responseBody, responseHeaders };
  } catch (cause) {
    throw new APICallError({ message: 'Invalid Viggle JSON response', url, requestBodyValues,
      statusCode: response.status, responseHeaders, responseBody, cause, isRetryable: false });
  }
};

const failedResponseHandler: ResponseHandler<APICallError> = async ({ response, url, requestBodyValues }) => {
  const responseHeaders = Object.fromEntries(response.headers);
  let responseBody: string;
  try { responseBody = await responseText(response, url); }
  catch (cause) {
    return { responseHeaders, value: new APICallError({ message: 'Unable to read Viggle error response', url,
      requestBodyValues, statusCode: response.status, responseHeaders, cause, isRetryable: false }) };
  }
  let data: unknown;
  try { data = jsonValue(parseJSON(responseBody), 'Viggle error response'); } catch { /* Preserve a non-JSON HTTP error verbatim. */ }
  const root = data && typeof data === 'object' && !Array.isArray(data) ? data as JSONObject : undefined;
  const native = root?.error && typeof root.error === 'object' && !Array.isArray(root.error) ? root.error as JSONObject : root;
  const isRetryable = typeof native?.retryable === 'boolean' ? native.retryable : undefined;
  const remediation = native?.remediation && typeof native.remediation === 'object' && !Array.isArray(native.remediation)
    ? native.remediation as JSONObject : undefined;
  const delay = remediation?.retry_after_ms;
  if (typeof delay === 'number' && Number.isSafeInteger(delay) && delay >= 0 &&
    responseHeaders['retry-after-ms'] === undefined && responseHeaders['retry-after'] === undefined) {
    responseHeaders['retry-after-ms'] = String(delay);
  }
  return { responseHeaders, value: new APICallError({
    message: errorMessage(data) ?? (response.statusText || `Viggle request failed (HTTP ${response.status})`),
    url, requestBodyValues, statusCode: response.status, responseHeaders, responseBody, data, isRetryable,
  }) };
};

/** Convert response-shape errors into non-retryable protocol failures after a single request. */
export function decodeResponse<T>(response: AssetProviderResponse, decode: (value: unknown) => T): T {
  try { return decode(response.value); }
  catch (cause) { throw invalidResponse(response, cause, 'Viggle'); }
}

export function parseJob(value: unknown, expectedId?: string): ViggleJob {
  const record = jsonObject(value, 'Viggle job');
  opaqueId(record.id);
  if (expectedId !== undefined && record.id !== expectedId) throw new TypeError('Viggle job identity mismatch');
  if (typeof record.status !== 'string' || !statuses.has(record.status)) throw new TypeError('Unknown Viggle job status');
  if (record.progress != null) bounded(record.progress, 'Viggle job progress', 0, 100);
  if (record.error != null) jsonObject(record.error, 'Viggle job error');
  if (record.sessionId !== undefined) nonempty(record.sessionId, 'Viggle scene sessionId');
  return record as ViggleJob;
}

/** Viggle protocol encoding and decoding only; execution and retry policy belong to core. */
export class ViggleClient {
  readonly provider: string;
  readonly connectionId?: string;
  readonly transport: AssetProviderTransport;
  constructor(settings: ViggleProviderSettings = {}) {
    this.provider = settings.name ?? 'viggle';
    nonempty(this.provider, 'Viggle provider name');
    if (settings.connectionId !== undefined) nonempty(settings.connectionId, 'Viggle connectionId');
    this.connectionId = settings.connectionId;
    this.transport = new AssetProviderTransport({
      provider: this.provider, apiKey: settings.apiKey, baseURL: settings.baseURL ?? 'https://apis.viggle.ai/v1',
      environmentVariableName: 'VIGGLE_API_KEY', authorizationScheme: 'Bearer',
      fetch: settings.fetch, headers: settings.headers,
    });
  }
  private url(path: string): string {
    nonempty(path, 'Viggle API path');
    if (/^(?:[\/\\]|[a-z][a-z\d+.-]*:)/iu.test(path) || /[\\#]/u.test(path)) throw new TypeError('Viggle API paths must be relative');
    return `${this.transport.baseURL}/${path}`;
  }
  request(path: string, method: 'GET' | 'POST' | 'DELETE', options: ViggleRequestOptions = {}, body?: JSONObject | FormData): Promise<AssetProviderResponse> {
    return this.transport.request(this.url(path), method, {
      headers: options.headers ?? {}, abortSignal: options.abortSignal ?? new AbortController().signal,
    }, body, method === 'DELETE', { successfulResponseHandler, failedResponseHandler });
  }
  async get<T extends object>(path: string, options?: ViggleRequestOptions): Promise<{ data: T; response: AssetResponse }> {
    const response = await this.request(path, 'GET', options);
    return { data: decodeResponse(response, value => jsonObject(value, 'Viggle resource') as T), response: response.response };
  }
  raw(path: string, options: ViggleRequestOptions = {}, responseOptions: { accept?: string; redirect?: 'error' | 'manual' } = {}): Promise<Response> {
    return this.transport.requestRaw(this.url(path), 'GET', {
      headers: options.headers ?? {}, abortSignal: options.abortSignal ?? new AbortController().signal,
    }, { ...responseOptions, failedResponseHandler });
  }
  form(input: object): FormData {
    const values = inputObject(input);
    const form = new FormData();
    const append = (key: string, value: unknown): void => {
      if (value === undefined) return;
      if (value instanceof Blob) form.append(key, value);
      else form.append(key, value !== null && typeof value === 'object' ? JSON.stringify(value) : String(value));
    };
    for (const [key, value] of Object.entries(values)) {
      if (Array.isArray(value) && key !== 'character_image_urls') value.forEach(item => append(key, item));
      else append(key, value);
    }
    return form;
  }
}
