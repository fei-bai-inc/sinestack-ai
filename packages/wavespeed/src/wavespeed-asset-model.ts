import type {
  AssetModelMapping, AssetModelV1, AssetModelV1CallOptions, AssetModelV1OperationOptions,
  AssetModelV1StartResult, AssetModelV1Status, JSONObject,
} from '@sine-ai/provider';
import {
  AssetProviderTransport, errorMessage, httpURL, invalidResponse, jsonObject, jsonValue, mapAssetResult, record, snapshotAssetMapping,
} from '@sine-ai/provider-utils';

export interface WaveSpeedAssetProviderSettings {
  readonly apiKey?: string;
  /** API root, including /api/v3. Defaults to https://api.wavespeed.ai/api/v3. */
  readonly baseURL?: string;
  readonly fetch?: typeof globalThis.fetch;
  readonly headers?: Record<string, string>;
  readonly name?: string;
}

export interface WaveSpeedAssetDefinition<INPUT = JSONObject, KIND extends string = string> extends AssetModelMapping<INPUT> {
  readonly kind: KIND;
}

interface PredictionOperation extends JSONObject {
  type: 'wavespeed-prediction';
  version: 1;
  modelId: string;
  baseURL: string;
  predictionId: string;
}

/** One submit or result HTTP operation. Polling, abort composition, and retries belong to the core. */
export class WaveSpeedAssetModel<INPUT, KIND extends string> implements AssetModelV1<INPUT, KIND> {
  readonly specificationVersion = 'v1' as const;
  readonly capabilities = { idempotentStart: false, webhooks: true } as const;
  readonly provider: string;
  readonly kind: KIND;
  private readonly transport: AssetProviderTransport;
  private readonly definition: WaveSpeedAssetDefinition<INPUT, KIND>;

  constructor(
    readonly modelId: string,
    settings: WaveSpeedAssetProviderSettings,
    definition: WaveSpeedAssetDefinition<INPUT, KIND>,
  ) {
    const parts = typeof modelId === 'string' ? modelId.split('/') : [];
    if (parts.length < 2 || parts.some(part => !/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(part))) {
      throw new TypeError('WaveSpeed modelId must contain safe owner/model path segments.');
    }
    if (!definition || typeof definition.kind !== 'string' || !definition.kind.trim()) {
      throw new TypeError('WaveSpeed asset kind must be a nonempty string.');
    }
    this.provider = settings.name ?? 'wavespeed';
    this.kind = definition.kind;
    this.definition = { ...snapshotAssetMapping(definition), kind: definition.kind };
    this.transport = new AssetProviderTransport({
      ...settings, provider: 'WaveSpeed',
      baseURL: settings.baseURL ?? 'https://api.wavespeed.ai/api/v3',
      environmentVariableName: 'WAVESPEED_API_KEY',
    });
  }

  async doStart(options: AssetModelV1CallOptions<INPUT>): Promise<AssetModelV1StartResult> {
    const mapped = jsonObject(this.definition.mapInput === undefined
      ? options.input : await this.definition.mapInput(options.input), 'WaveSpeed input');
    const extra = jsonObject(options.providerOptions.wavespeed ?? {}, 'providerOptions.wavespeed');
    for (const key of Object.keys(extra)) {
      if (Object.hasOwn(mapped, key)) {
        throw new TypeError(`providerOptions.wavespeed.${key} cannot override a mapped input field; pass it through input.`);
      }
    }
    const body = { ...extra, ...mapped };
    for (const key of ['enable_sync_mode', 'enable_base64_output']) {
      if (body[key] !== undefined && typeof body[key] !== 'boolean') {
        throw new TypeError(`WaveSpeed ${key} must be a boolean.`);
      }
    }
    const url = new URL(`${this.transport.baseURL}/${this.modelId}`);
    if (options.webhookUrl !== undefined) {
      if (body.enable_sync_mode === true) {
        throw new TypeError('WaveSpeed enable_sync_mode cannot be combined with a webhook.');
      }
      if (body.enable_base64_output === true) {
        throw new TypeError('WaveSpeed enable_base64_output cannot be combined with a webhook.');
      }
      const webhook = httpURL(options.webhookUrl, 'WaveSpeed webhookUrl');
      if (webhook.protocol !== 'https:') throw new TypeError('WaveSpeed webhookUrl must use HTTPS.');
      url.searchParams.set('standard_webhook', webhook.href);
    }
    if (body.enable_base64_output === true && this.definition.mapResult === undefined) {
      throw new TypeError('WaveSpeed enable_base64_output requires an explicit mapResult to identify the file format.');
    }
    const response = await this.transport.request(url, 'POST', options, body);
    try {
      const prediction = this.prediction(response.value);
      // A sync wait timeout (data.code=5004) can still carry a successfully created ID.
      // Persist this ID even if data.error is present; only result status decides termination.
      const operation = this.operation({
        type: 'wavespeed-prediction', version: 1, modelId: this.modelId,
        baseURL: this.transport.baseURL, predictionId: prediction.id,
      });
      this.checkModel(prediction);
      return {
        operation,
        providerMetadata: { wavespeed: { predictionId: operation.predictionId } },
        response: response.response,
      };
    } catch (cause) {
      throw invalidResponse(response, cause, 'WaveSpeed');
    }
  }

  async doStatus(options: AssetModelV1OperationOptions): Promise<AssetModelV1Status> {
    // Validate the persisted receipt before loading credentials or performing any request.
    const operation = this.operation(options.operation);
    const response = await this.transport.request(
      `${this.transport.baseURL}/predictions/${operation.predictionId}/result`, 'GET', options,
    );
    try {
      const prediction = this.prediction(response.value);
      if (prediction.id !== operation.predictionId) {
        throw new TypeError('WaveSpeed result id does not match the submitted prediction.');
      }
      this.checkModel(prediction);
      const status = prediction.status;
      if (typeof status !== 'string' || !status.trim()) {
        throw new TypeError('WaveSpeed prediction status must be a nonempty string.');
      }
      if (status === 'cancelled') return { status: 'cancelled' };
      if (status === 'failed' || status === 'timeout' || status === 'deleted') {
        return {
          status: 'failed',
          error: {
            message: errorMessage(prediction.error) ?? `WaveSpeed prediction ${status}.`,
            code: typeof prediction.code === 'string' || typeof prediction.code === 'number'
              ? String(prediction.code) : status,
          },
        };
      }
      if (status !== 'completed') {
        return {
          status: status === 'created' || status === 'queued' ? 'pending' : 'running',
          providerMetadata: { wavespeed: { predictionId: operation.predictionId, status } },
        };
      }
      if (!Array.isArray(prediction.outputs)) {
        throw new TypeError('WaveSpeed completed prediction must contain an outputs array.');
      }
      // Copy native output before invoking a user mapper, which may mutate its argument.
      const output = jsonValue(prediction.outputs, 'WaveSpeed prediction outputs');
      const result = await (this.definition.mapResult ?? mapAssetResult)(jsonValue(output, 'WaveSpeed mapper output'));
      if (!result || !Array.isArray(result.assets) || result.assets.length === 0) {
        throw new TypeError('WaveSpeed mapResult must return at least one asset.');
      }
      return {
        status: 'completed',
        result: {
          ...result,
          providerMetadata: {
            ...result.providerMetadata,
            wavespeed: { ...result.providerMetadata?.wavespeed, predictionId: operation.predictionId, output },
          },
          response: response.response,
        },
      };
    } catch (cause) {
      throw invalidResponse(response, cause, 'WaveSpeed');
    }
  }

  // WaveSpeed's delete endpoint removes completed history. It does not cancel running inference.
  // No doCancel is exposed until the provider offers a verified cancellation protocol.

  private prediction(value: unknown): Record<string, unknown> {
    const envelope = record(value, 'WaveSpeed response');
    if (!Object.hasOwn(envelope, 'data')) return envelope;
    if (envelope.code !== undefined && (typeof envelope.code !== 'number' || envelope.code < 200 || envelope.code >= 300)) {
      throw new TypeError(errorMessage(envelope) ?? 'WaveSpeed response contains an unsuccessful API code.');
    }
    return record(envelope.data, 'WaveSpeed prediction');
  }

  private checkModel(value: Record<string, unknown>): void {
    if (value.model !== undefined && value.model !== this.modelId) {
      throw new TypeError('WaveSpeed prediction model does not match this model.');
    }
  }

  private operation(value: unknown): PredictionOperation {
    const operation = jsonObject(value, 'WaveSpeed operation');
    if (operation.type !== 'wavespeed-prediction' || operation.version !== 1 || operation.modelId !== this.modelId) {
      throw new TypeError('WaveSpeed operation type, version, or modelId does not match this model.');
    }
    if (operation.baseURL !== this.transport.baseURL) {
      throw new TypeError('WaveSpeed operation baseURL does not match this provider connection.');
    }
    if (typeof operation.predictionId !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,255}$/.test(operation.predictionId)) {
      throw new TypeError('WaveSpeed operation predictionId must be a nonempty prediction token.');
    }
    return {
      type: 'wavespeed-prediction', version: 1, modelId: this.modelId,
      baseURL: this.transport.baseURL, predictionId: operation.predictionId,
    };
  }
}
