import { APICallError } from '@ai-sdk/provider';
import {
  createJsonErrorResponseHandler,
  createJsonResponseHandler,
  getFromApi,
  jsonSchema,
  loadApiKey,
  postJsonToApi,
  postFormDataToApi,
  type ResponseHandler,
} from '@ai-sdk/provider-utils';
import type { AssetModelV1OperationOptions, AssetResponse, JSONObject } from '@sinestack/ai-provider';
import { errorMessage, httpURL, jsonObject } from './json.js';

export interface AssetProviderTransportOptions {
  readonly provider: string;
  readonly baseURL: string;
  readonly apiKey?: string;
  readonly environmentVariableName: string;
  readonly authorizationScheme?: 'Key' | 'Bearer';
  readonly fetch?: typeof globalThis.fetch;
  readonly headers?: Record<string, string>;
}
export interface AssetProviderResponse {
  readonly url: string;
  readonly statusCode: number;
  readonly value: unknown;
  readonly response: AssetResponse & { readonly headers: Record<string, string> };
}
/** A malformed protocol response is not a reason to repeat a paid submission. */
export function invalidResponse(response: AssetProviderResponse, cause: unknown, provider: string): APICallError {
  return new APICallError({
    message: `Invalid ${provider} response: ${cause instanceof Error ? cause.message : String(cause)}`,
    url: response.url, requestBodyValues: undefined, statusCode: response.statusCode,
    responseHeaders: response.response.headers, responseBody: JSON.stringify(response.value), cause, isRetryable: false,
  });
}
const responseSchema = jsonSchema<unknown>({});
const jsonResponse = createJsonResponseHandler(responseSchema);

/** Single request only. Retries, polling, lifecycle and timeout policy belong to core. */
export class AssetProviderTransport {
  readonly baseURL: string;
  private readonly base: URL;
  private readonly settings: AssetProviderTransportOptions;
  private readonly fetcher: typeof globalThis.fetch;
  constructor(settings: AssetProviderTransportOptions) {
    this.base = httpURL(settings.baseURL, `${settings.provider} baseURL`);
    if (this.base.search) throw new TypeError(`${settings.provider} baseURL must not include a query.`);
    this.base.pathname = this.base.pathname.replace(/\/+$/, '');
    this.baseURL = this.base.href.replace(/\/$/, '');
    this.settings = { ...settings, headers: { ...settings.headers } };
    this.fetcher = settings.fetch ?? globalThis.fetch;
  }
  async request(
    value: string | URL,
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    options: Pick<AssetModelV1OperationOptions, 'headers' | 'abortSignal'>,
    body?: JSONObject | FormData,
    allowEmpty = false,
  ): Promise<AssetProviderResponse> {
    // Validate the destination before loading or attaching credentials.
    const url = httpURL(typeof value === 'string' ? value : value.href, `${this.settings.provider} request URL`);
    this.validateDestination(url);
    options.abortSignal.throwIfAborted();
    const formData = body instanceof FormData ? body : undefined;
    if (formData !== undefined && method !== 'POST') throw new TypeError('Multipart transport requires POST');
    if (method === 'DELETE' && body !== undefined) throw new TypeError('DELETE transport does not accept a body');
    const requestBody = body === undefined || formData !== undefined ? undefined : jsonObject(body, `${this.settings.provider} request body`);
    const headers = new Headers(this.settings.headers);
    new Headers(options.headers).forEach((header, key) => headers.set(key, header));
    headers.set('Authorization', `${this.settings.authorizationScheme ?? 'Bearer'} ${loadApiKey({
      apiKey: this.settings.apiKey, environmentVariableName: this.settings.environmentVariableName, description: this.settings.provider,
    })}`);
    headers.set('Accept', 'application/json');
    if (requestBody !== undefined) headers.set('Content-Type', 'application/json');
    if (formData !== undefined) headers.delete('Content-Type');
    const guardedFetch: typeof globalThis.fetch = async (input, init) => {
      const response = await this.fetcher(input, { ...init, redirect: 'error' });
      if (response.redirected || (response.url && response.url !== url.href)) {
        throw new APICallError({
          message: `${this.settings.provider} request redirected outside the allowed request flow.`,
          url: url.href, requestBodyValues: requestBody, statusCode: response.status, isRetryable: false,
        });
      }
      return response;
    };
    const failedResponseHandler = createJsonErrorResponseHandler({
      errorSchema: responseSchema,
      errorToMessage: error => errorMessage(error) ?? `${this.settings.provider} request failed.`,
    });
    const successfulResponseHandler: ResponseHandler<AssetProviderResponse> = async context => {
      // Meshy DELETE returns an empty 200, not necessarily 204. This exception is
      // explicit per call; malformed or empty JSON generation responses still fail.
      const empty = allowEmpty && (context.response.status === 204 ||
        (context.response.status === 200 && (await context.response.clone().text()).trim() === ''));
      const parsed = empty
        ? { value: undefined, responseHeaders: Object.fromEntries(context.response.headers.entries()) }
        : await jsonResponse(context);
      const responseHeaders = parsed.responseHeaders ?? {};
      return { value: { url: url.href, statusCode: context.response.status, value: parsed.value,
        response: { headers: responseHeaders, body: parsed.value } }, responseHeaders };
    };
    const common = { url: url.href, headers: Object.fromEntries(headers.entries()), abortSignal: options.abortSignal,
      fetch: guardedFetch, successfulResponseHandler, failedResponseHandler };
    try {
      if (method === 'GET') return (await getFromApi({ ...common, validateUrl: false, credentialedOrigin: this.base.origin })).value;
      if (method === 'POST' && formData !== undefined) return (await postFormDataToApi({ ...common, formData })).value;
      if (method === 'POST') return (await postJsonToApi({ ...common, body: requestBody })).value;
      // Reuse the existing guarded single-fetch path and official response handlers.
      const response = await guardedFetch(url.href, { method, headers, signal: options.abortSignal,
        ...(requestBody === undefined ? {} : { body: JSON.stringify(requestBody) }) });
      const context = { response, url: url.href, requestBodyValues: requestBody };
      if (!response.ok) throw (await failedResponseHandler(context)).value;
      return (await successfulResponseHandler(context)).value;
    } catch (error) {
      if (options.abortSignal.aborted) throw options.abortSignal.reason;
      throw error;
    }
  }
  private validateDestination(url: URL): void {
    const prefix = this.base.pathname.replace(/\/$/, '');
    if (url.origin !== this.base.origin || (prefix && url.pathname !== prefix && !url.pathname.startsWith(`${prefix}/`))) {
      throw new TypeError(`${this.settings.provider} requests must use the configured baseURL origin and path prefix.`);
    }
  }
}
