import {
  AssetProviderTransport, errorMessage, httpURL, invalidResponse, jsonObject, jsonValue, mapAssetResult, record, snapshotAssetMapping,
} from '@sinestack/ai-provider-utils';
import type { AssetProviderResponse } from '@sinestack/ai-provider-utils';
import type {
  AssetModelV1,
  AssetModelMapping,
  AssetModelV1CallOptions,
  AssetModelV1CancelResult,
  AssetModelV1OperationOptions,
  AssetModelV1StartResult,
  AssetModelV1Status,
  JSONObject,
} from '@sinestack/ai-provider';

export { record } from '@sinestack/ai-provider-utils';

export interface FalAssetProviderSettings {
  readonly apiKey?: string;
  /** Queue origin, optionally with a proxy path prefix. Defaults to https://queue.fal.run. */
  readonly baseURL?: string;
  readonly fetch?: typeof globalThis.fetch;
  readonly headers?: Record<string, string>;
  readonly name?: string;
}

export interface FalAssetDefinition<INPUT = JSONObject, KIND extends string = string> extends AssetModelMapping<INPUT> {
  readonly kind: KIND;
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

/** One queue protocol implementation shared by all fal asset kinds. No polling or retries. */
export class FalAssetModel<INPUT, KIND extends string> implements AssetModelV1<INPUT, KIND> {
  readonly specificationVersion = 'v1' as const;
  readonly capabilities = { idempotentStart: false, webhooks: true } as const;
  readonly provider: string;
  readonly kind: KIND;
  private readonly base: URL;
  private readonly appPath: string;
  private readonly transport: AssetProviderTransport;
  private readonly definition: FalAssetDefinition<INPUT, KIND>;

  constructor(
    readonly modelId: string,
    settings: FalAssetProviderSettings,
    definition: FalAssetDefinition<INPUT, KIND>,
  ) {
    if (typeof modelId !== 'string') throw new TypeError('fal modelId must be an explicit owner/app path.');
    const parts = modelId.split('/');
    // fal's workflow and Comfy endpoints include a namespace before owner/app.
    const appPartCount = parts[0] === 'workflows' || parts[0] === 'comfy' ? 3 : 2;
    if (parts.length < appPartCount || parts.some(part => !/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(part))) {
      throw new TypeError('fal modelId must contain safe owner/app path segments, including namespace/owner/app for workflows or comfy.');
    }
    if (!definition || typeof definition.kind !== 'string' || !definition.kind.trim()) {
      throw new TypeError('fal asset kind must be a nonempty string.');
    }
    this.definition = { ...snapshotAssetMapping(definition), kind: definition.kind };
    this.transport = new AssetProviderTransport({
      ...settings, provider: 'fal', baseURL: settings.baseURL ?? 'https://queue.fal.run',
      environmentVariableName: 'FAL_KEY', authorizationScheme: 'Key',
    });
    this.base = new URL(this.transport.baseURL);
    const prefix = this.base.pathname.replace(/\/$/, '');
    this.appPath = `${prefix}/${parts.slice(0, appPartCount).join('/')}`;
    this.provider = settings.name ?? 'fal';
    this.kind = definition.kind;
  }

  async doStart(options: AssetModelV1CallOptions<INPUT>): Promise<AssetModelV1StartResult> {
    const mapped = jsonObject(
      this.definition.mapInput ? await this.definition.mapInput(options.input) : options.input,
      'fal input',
    );
    const extra = jsonObject(options.providerOptions.fal ?? {}, 'providerOptions.fal');
    for (const key of Object.keys(extra)) {
      if (Object.hasOwn(mapped, key)) {
        throw new TypeError(`providerOptions.fal.${key} cannot override a mapped input field; pass it through input.`);
      }
    }
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
      // Snapshot before calling user mapping code so mutation cannot rewrite the native result.
      const output = jsonValue(resultResponse.value, 'fal output');
      const result = await (this.definition.mapResult ?? mapAssetResult)(jsonValue(output, 'fal mapper output'));
      if (!result || !Array.isArray(result.assets) || result.assets.length === 0) {
        throw new TypeError('fal mapResult must return an asset result with a nonempty assets array.');
      }
      return {
        status: 'completed',
        result: {
          ...result,
          providerMetadata: {
            ...result.providerMetadata,
            fal: { ...result.providerMetadata?.fal, requestId: operation.requestId, output },
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
    const op = jsonObject(value, 'fal operation');
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

  private invalidResponse(response: AssetProviderResponse, cause: unknown) {
    return invalidResponse(response, cause, 'fal');
  }

  private request(
    url: URL,
    method: 'POST' | 'GET' | 'PUT',
    options: Pick<AssetModelV1OperationOptions, 'headers' | 'abortSignal'>,
    body?: JSONObject,
    allowEmpty = false,
  ): Promise<AssetProviderResponse> {
    return this.transport.request(url, method, options, body, allowEmpty);
  }
}
