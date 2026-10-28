import { APICallError } from '@ai-sdk/provider';
import { loadApiKey } from '@ai-sdk/provider-utils';
import type {
  AssetModelV1,
  AssetModelV1CallOptions,
  AssetModelV1CancelResult,
  AssetModelV1OperationOptions,
  AssetModelV1Result,
  AssetModelV1StartResult,
  AssetModelV1Status,
  AssetResponse,
  JSONObject,
  JSONValue,
} from '@sine-ai/provider';

export interface FalAssetProviderSettings {
  readonly apiKey?: string;
  /** Queue origin, optionally with a proxy path prefix. Defaults to https://queue.fal.run. */
  readonly baseURL?: string;
  readonly fetch?: typeof globalThis.fetch;
  readonly headers?: Record<string, string>;
  readonly name?: string;
}

export interface FalAssetDefinition<INPUT, KIND extends string> {
  readonly kind: KIND;
  /** Produce the model's JSON request. Mapped keys cannot be overridden by providerOptions.fal. */
  readonly mapInput: (input: INPUT) => JSONObject | PromiseLike<JSONObject>;
  /** Map the raw REST result, not the { data } wrapper returned by the fal JavaScript SDK. */
  readonly mapResult: (result: unknown) => AssetModelV1Result | PromiseLike<AssetModelV1Result>;
}

interface QueueOperation extends JSONObject {
  type: 'fal-queue';
  version: 1;
  modelId: string;
  requestId: string;
  statusUrl: string;
  responseUrl: string;
  cancelUrl: string;
}

interface FalResponse {
  url: string;
  statusCode: number;
  value: unknown;
  rawBody: string;
  response: AssetResponse & { headers: Record<string, string> };
}

const CORE_INPUT_KEYS = new Set([
  'prompt', 'text', 'duration', 'duration_seconds', 'durationSeconds',
  'prompt_influence', 'promptInfluence', 'loop',
]);

export function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${label} must be a plain object.`);
  }
  return value as Record<string, unknown>;
}

function jsonObject(value: unknown, label: string): JSONObject {
  const seen = new Set<object>();
  function clone(item: unknown, depth = 0): JSONValue {
    if (depth > 64) throw new TypeError(`${label} exceeds the maximum JSON nesting depth.`);
    if (item === null || typeof item === 'string' || typeof item === 'boolean') return item;
    if (typeof item === 'number' && Number.isFinite(item)) return item;
    if (typeof item !== 'object' || item === null || seen.has(item)) {
      throw new TypeError(`${label} must contain finite, acyclic JSON values.`);
    }
    const array = Array.isArray(item);
    const prototype = Object.getPrototypeOf(item);
    if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) {
      throw new TypeError(`${label} must contain only plain JSON objects and arrays.`);
    }
    if (Object.getOwnPropertySymbols(item).length) {
      throw new TypeError(`${label} must not contain symbol keys.`);
    }
    const descriptors = Object.getOwnPropertyDescriptors(item);
    const length = array ? descriptors.length!.value as number : 0;
    if (array && Object.keys(descriptors).length !== length + 1) {
      throw new TypeError(`${label} arrays must not contain holes or extra properties.`);
    }
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (array && key === 'length') continue;
      if (!('value' in descriptor) || !descriptor.enumerable) {
        throw new TypeError(`${label} must contain only enumerable JSON data properties.`);
      }
      if (array && (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= length)) {
        throw new TypeError(`${label} arrays must not contain extra properties.`);
      }
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
        throw new TypeError(`${label} contains an unsupported key: ${key}.`);
      }
    }
    seen.add(item);
    let result: JSONValue;
    if (array) {
      result = Array.from({ length }, (_, index) => clone(descriptors[String(index)]!.value, depth + 1));
    } else {
      result = Object.fromEntries(Object.entries(descriptors).map(([key, descriptor]) => [
        key,
        // JSONObject permits undefined object values; final request serialization omits them.
        descriptor.value === undefined ? undefined : clone(descriptor.value, depth + 1),
      ]));
    }
    seen.delete(item);
    return result;
  }
  record(value, label);
  // Do not invoke user-supplied getters, iterators, or toJSON while validating or copying.
  return clone(value) as JSONObject;
}

function httpURL(value: unknown, label: string): URL {
  if (typeof value !== 'string') throw new TypeError(`${label} must be an absolute HTTP(S) URL.`);
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new TypeError(`${label} must be an absolute HTTP(S) URL.`);
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash) {
    throw new TypeError(`${label} must be an HTTP(S) URL without credentials or a fragment.`);
  }
  return url;
}

function errorMessage(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (value !== null && typeof value === 'object') {
    const body = value as Record<string, unknown>;
    for (const candidate of [body.error, body.message, body.detail]) {
      if (typeof candidate === 'string' && candidate) return candidate;
    }
    if (body.error !== null && typeof body.error === 'object') {
      return errorMessage(body.error);
    }
  }
  return undefined;
}

/** One queue protocol implementation shared by all fal asset kinds. No polling or retries. */
export class FalAssetModel<INPUT, KIND extends string> implements AssetModelV1<INPUT, KIND> {
  readonly specificationVersion = 'v1' as const;
  readonly capabilities = { idempotentStart: false, webhooks: true } as const;
  readonly provider: string;
  readonly kind: KIND;
  private readonly base: URL;
  private readonly appPath: string;
  private readonly fetcher: typeof globalThis.fetch;

  constructor(
    readonly modelId: string,
    private readonly settings: FalAssetProviderSettings,
    private readonly definition: FalAssetDefinition<INPUT, KIND>,
    private readonly validateProviderOptions?: (options: JSONObject) => void,
  ) {
    const parts = modelId.split('/');
    if (parts.length < 2 || parts.some(part => !/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(part))) {
      throw new TypeError('fal modelId must contain safe owner/app path segments.');
    }
    if (typeof definition.kind !== 'string' || !definition.kind.trim()) {
      throw new TypeError('fal asset kind must be a nonempty string.');
    }
    this.base = httpURL(settings.baseURL ?? 'https://queue.fal.run', 'fal baseURL');
    if (this.base.search) throw new TypeError('fal baseURL must not include a query.');
    this.base.pathname = this.base.pathname.replace(/\/+$/, '');
    const prefix = this.base.pathname.replace(/\/$/, '');
    this.appPath = `${prefix}/${parts[0]}/${parts[1]}`;
    this.fetcher = settings.fetch ?? globalThis.fetch;
    this.provider = settings.name ?? 'fal';
    this.kind = definition.kind;
  }

  async doStart(options: AssetModelV1CallOptions<INPUT>): Promise<AssetModelV1StartResult> {
    const mapped = jsonObject(await this.definition.mapInput(options.input), 'fal mapped input');
    const extra = jsonObject(options.providerOptions.fal ?? {}, 'providerOptions.fal');
    for (const key of Object.keys(extra)) {
      if (CORE_INPUT_KEYS.has(key) || Object.hasOwn(mapped, key)) {
        throw new TypeError(`providerOptions.fal.${key} cannot override a mapped input field; pass it through input.`);
      }
    }
    this.validateProviderOptions?.(extra);
    const body = { ...extra, ...mapped };
    const url = new URL(`${this.base.href.replace(/\/$/, '')}/${this.modelId}`);
    if (options.webhookUrl !== undefined) {
      url.searchParams.set('fal_webhook', httpURL(options.webhookUrl, 'webhookUrl').href);
    }
    const response = await this.request(url, 'POST', options, body);
    let operation: QueueOperation;
    try {
      const value = record(response.value, 'fal submit response');
      operation = this.operation({
        type: 'fal-queue', version: 1, modelId: this.modelId,
        requestId: value.request_id, statusUrl: value.status_url,
        responseUrl: value.response_url, cancelUrl: value.cancel_url,
      });
    } catch (cause) {
      throw this.invalidResponse(response, cause);
    }
    return {
      operation,
      providerMetadata: { fal: { requestId: operation.requestId } },
      response: response.response,
    };
  }

  async doStatus(options: AssetModelV1OperationOptions): Promise<AssetModelV1Status> {
    const operation = this.operation(options.operation);
    const response = await this.request(new URL(operation.statusUrl), 'GET', options);
    let value: Record<string, unknown>;
    try {
      value = record(response.value, 'fal status response');
      this.checkRequestId(value, operation.requestId);
    } catch (cause) {
      throw this.invalidResponse(response, cause);
    }
    const status = value.status;
    if (status === 'IN_QUEUE' || status === 'IN_PROGRESS') {
      const metadata: JSONObject = { requestId: operation.requestId };
      if (typeof value.queue_position === 'number' && Number.isFinite(value.queue_position)) {
        metadata.queuePosition = value.queue_position;
      }
      const lastLog = Array.isArray(value.logs) ? value.logs.at(-1) as unknown : undefined;
      const message = lastLog !== null && typeof lastLog === 'object'
        ? (lastLog as Record<string, unknown>).message : undefined;
      return {
        status: status === 'IN_QUEUE' ? 'pending' : 'running',
        ...(typeof message === 'string' ? { message } : {}),
        providerMetadata: { fal: metadata },
      };
    }
    if (status === 'CANCELLED' || status === 'CANCELED') return { status: 'cancelled' };
    if (status === 'FAILED' || status === 'ERROR' || (status === 'COMPLETED' && value.error != null)) {
      return {
        status: 'failed',
        error: {
          message: errorMessage(value) ?? 'fal generation failed.',
          ...(typeof value.error_type === 'string' ? { code: value.error_type } : {}),
        },
      };
    }
    if (status !== 'COMPLETED') {
      throw this.invalidResponse(response, new TypeError(`Unknown fal queue status: ${String(status)}.`));
    }
    let resultUrl: URL;
    try {
      resultUrl = this.operationURL(value.response_url ?? operation.responseUrl, operation.requestId, '');
    } catch (cause) {
      throw this.invalidResponse(response, cause);
    }
    const resultResponse = await this.request(resultUrl, 'GET', options);
    try {
      const result = await this.definition.mapResult(resultResponse.value);
      if (!result || !Array.isArray(result.assets)) {
        throw new TypeError('fal mapResult must return an asset result with an assets array.');
      }
      return {
        status: 'completed',
        result: {
          ...result,
          providerMetadata: {
            ...result.providerMetadata,
            fal: { ...result.providerMetadata?.fal, requestId: operation.requestId },
          },
          response: resultResponse.response,
        },
      };
    } catch (cause) {
      throw this.invalidResponse(resultResponse, cause);
    }
  }

  async doCancel(options: AssetModelV1OperationOptions): Promise<AssetModelV1CancelResult> {
    const operation = this.operation(options.operation);
    const response = await this.request(new URL(operation.cancelUrl), 'PUT', options, undefined, true);
    if (response.statusCode === 204 && response.value === undefined) {
      return { status: 'requested', response: response.response };
    }
    try {
      const value = record(response.value, 'fal cancel response');
      this.checkRequestId(value, operation.requestId);
      if (response.statusCode === 200 && ['OK', 'CANCELLED', 'CANCELED'].includes(String(value.status))) {
        return { status: 'cancelled', response: response.response };
      }
      if (response.statusCode === 202 && value.status === 'CANCELLATION_REQUESTED') {
        return { status: 'requested', response: response.response };
      }
      throw new TypeError(`Unknown fal cancellation acknowledgement: ${String(value.status)}.`);
    } catch (cause) {
      throw this.invalidResponse(response, cause);
    }
  }

  private checkRequestId(value: Record<string, unknown>, expected: string): void {
    if (value.request_id !== undefined && value.request_id !== expected) {
      throw new TypeError('fal response request_id does not match the submitted request.');
    }
  }

  private operation(value: unknown): QueueOperation {
    const op = record(value, 'fal operation');
    if (op.type !== 'fal-queue' || op.version !== 1 || op.modelId !== this.modelId) {
      throw new TypeError('fal operation type, version, or modelId does not match this model.');
    }
    if (typeof op.requestId !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,255}$/.test(op.requestId)) {
      throw new TypeError('fal operation requestId must be a nonempty request token.');
    }
    return {
      type: 'fal-queue', version: 1, modelId: this.modelId, requestId: op.requestId,
      statusUrl: this.operationURL(op.statusUrl, op.requestId, '/status').href,
      responseUrl: this.operationURL(op.responseUrl, op.requestId, '').href,
      cancelUrl: this.operationURL(op.cancelUrl, op.requestId, '/cancel').href,
    };
  }

  private operationURL(value: unknown, requestId: string, suffix: string): URL {
    const url = httpURL(value, 'fal operation URL');
    if (url.origin !== this.base.origin) throw new TypeError('fal operation URL must use the configured baseURL origin.');
    if (url.pathname !== `${this.appPath}/requests/${requestId}${suffix}`) {
      throw new TypeError('fal operation URL does not match the owner/app, requestId, or operation path.');
    }
    return url;
  }

  private invalidResponse(response: FalResponse, cause: unknown): APICallError {
    return new APICallError({
      message: `Invalid fal response: ${cause instanceof Error ? cause.message : String(cause)}`,
      url: response.url, requestBodyValues: undefined,
      statusCode: response.statusCode, responseHeaders: response.response.headers,
      responseBody: response.rawBody, cause, isRetryable: false,
    });
  }

  private async request(
    url: URL,
    method: 'POST' | 'GET' | 'PUT',
    options: Pick<AssetModelV1OperationOptions, 'headers' | 'abortSignal'>,
    body?: JSONObject,
    allowEmpty = false,
  ): Promise<FalResponse> {
    // Validate before attaching credentials, including when resuming an untrusted persisted handle.
    if (url.origin !== this.base.origin) throw new TypeError('fal requests must use the configured baseURL origin.');
    options.abortSignal.throwIfAborted();
    const headers = new Headers(this.settings.headers);
    new Headers(options.headers).forEach((value, key) => headers.set(key, value));
    headers.set('Authorization', `Key ${loadApiKey({ apiKey: this.settings.apiKey, environmentVariableName: 'FAL_KEY', description: 'fal' })}`);
    headers.set('Accept', 'application/json');
    if (body !== undefined) headers.set('Content-Type', 'application/json');
    let response: Response;
    let rawBody: string;
    try {
      response = await this.fetcher(url.href, {
        method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: options.abortSignal, redirect: 'error',
      });
      // Native fetch enforces redirect:error. Also reject a redirect returned by a custom fetch.
      if (response.redirected || (response.url && new URL(response.url).origin !== this.base.origin)) {
        throw new APICallError({
          message: 'fal request redirected outside the allowed request flow.',
          url: url.href, requestBodyValues: body, statusCode: response.status, isRetryable: false,
        });
      }
      rawBody = await response.text();
    } catch (cause) {
      if (options.abortSignal.aborted) throw options.abortSignal.reason;
      if (APICallError.isInstance(cause) || (cause instanceof Error && cause.name === 'AbortError')) throw cause;
      throw new APICallError({ message: 'fal network request failed.', url: url.href, requestBodyValues: body, cause, isRetryable: true });
    }
    const responseHeaders = Object.fromEntries(response.headers.entries());
    let value: unknown;
    let parseError: unknown;
    try {
      value = rawBody === '' && allowEmpty ? undefined : JSON.parse(rawBody);
    } catch (cause) {
      parseError = cause;
    }
    if (!response.ok) {
      throw new APICallError({
        message: errorMessage(value) ?? `fal request failed with HTTP ${response.status}.`,
        url: url.href, requestBodyValues: body, statusCode: response.status,
        responseHeaders, responseBody: rawBody,
        isRetryable: response.status === 408 || response.status === 429 || response.status >= 500,
      });
    }
    const result: FalResponse = {
      url: url.href, statusCode: response.status, value, rawBody,
      response: { headers: responseHeaders, body: value },
    };
    if (parseError !== undefined) throw this.invalidResponse(result, parseError);
    return result;
  }
}
