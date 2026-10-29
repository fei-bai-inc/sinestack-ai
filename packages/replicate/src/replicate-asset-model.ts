import type {
  AssetModelMapping, AssetModelV1, AssetModelV1CallOptions, AssetModelV1CancelResult,
  AssetModelV1OperationOptions, AssetModelV1StartResult,
  AssetModelV1Status, JSONObject,
} from '@sinestack/ai-provider';
import {
  AssetProviderTransport, errorMessage, httpURL, invalidResponse,
  jsonObject, jsonValue, mapAssetResult, record, snapshotAssetMapping,
} from '@sinestack/ai-provider-utils';

export interface ReplicateAssetProviderSettings {
  readonly apiKey?: string;
  /** API root, including its version path. Defaults to https://api.replicate.com/v1. */
  readonly baseURL?: string;
  readonly fetch?: typeof globalThis.fetch;
  readonly headers?: Record<string, string>;
  readonly name?: string;
}

export interface ReplicateAssetMapping<INPUT = JSONObject> extends AssetModelMapping<INPUT> {
  /** Optional fixed 64-character model version; alternatively append :version to modelId. */
  readonly version?: string;
}

/** Native JSON is forwarded by default; an optional result mapper receives prediction.output. */
export interface ReplicateAssetDefinition<INPUT = JSONObject, KIND extends string = string> extends ReplicateAssetMapping<INPUT> {
  readonly kind: KIND;
}

interface PredictionOperation extends JSONObject {
  type: 'replicate-prediction';
  version: 1;
  modelId: string;
  baseURL: string;
  predictionId: string;
  modelVersion?: string;
}

const MODEL_ID = /^([A-Za-z0-9][A-Za-z0-9_.-]*)\/([A-Za-z0-9][A-Za-z0-9_.-]*)(?::([a-f0-9]{64}))?$/;
const VERSION = /^[a-f0-9]{64}$/;
const PREDICTION_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,255}$/;
const STATUSES = new Set(['starting', 'processing', 'succeeded', 'failed', 'canceled']);

/** One prediction operation per method. Retries and waiting belong to the shared core. */
export class ReplicateAssetModel<INPUT, KIND extends string> implements AssetModelV1<INPUT, KIND> {
  readonly specificationVersion = 'v1' as const;
  readonly capabilities = { idempotentStart: false, webhooks: true } as const;
  readonly provider: string;
  readonly kind: KIND;
  private readonly transport: AssetProviderTransport;
  private readonly model: string;
  private readonly versionId?: string;
  private readonly definition: ReplicateAssetDefinition<INPUT, KIND>;

  constructor(
    readonly modelId: string,
    settings: ReplicateAssetProviderSettings,
    definition: ReplicateAssetDefinition<INPUT, KIND>,
  ) {
    const parsed = typeof modelId === 'string' ? MODEL_ID.exec(modelId) : null;
    if (!parsed) throw new TypeError('Replicate modelId must be owner/model, optionally followed by a full :version.');
    this.model = `${parsed[1]}/${parsed[2]}`;
    const version = definition.version;
    const kind = definition.kind;
    if (version !== undefined && !VERSION.test(version)) {
      throw new TypeError('Replicate version must be a full 64-character lowercase hexadecimal version ID.');
    }
    if (parsed[3] !== undefined && version !== undefined && parsed[3] !== version) {
      throw new TypeError('Replicate modelId version conflicts with definition.version.');
    }
    this.versionId = parsed[3] ?? version;
    if (typeof kind !== 'string' || !kind.trim()) {
      throw new TypeError('Replicate asset kind must be a nonempty string.');
    }
    this.definition = { ...snapshotAssetMapping(definition), kind, ...(version === undefined ? {} : { version }) };
    this.kind = kind;
    this.provider = settings.name ?? 'replicate';
    this.transport = new AssetProviderTransport({
      ...settings,
      provider: 'Replicate',
      baseURL: settings.baseURL ?? 'https://api.replicate.com/v1',
      environmentVariableName: 'REPLICATE_API_TOKEN',
      authorizationScheme: 'Bearer',
    });
  }

  async doStart(options: AssetModelV1CallOptions<INPUT>): Promise<AssetModelV1StartResult> {
    const input = jsonObject(this.definition.mapInput === undefined
      ? options.input : await this.definition.mapInput(options.input), 'Replicate input');
    const extra = jsonObject(options.providerOptions.replicate ?? {}, 'providerOptions.replicate');
    for (const key of Object.keys(extra)) {
      if (Object.hasOwn(input, key)) {
        throw new TypeError(`providerOptions.replicate.${key} cannot override a mapped input field; pass it through input.`);
      }
    }
    const body: JSONObject = { input: { ...extra, ...input } };
    if (this.versionId !== undefined) body.version = this.versionId;
    if (options.webhookUrl !== undefined) {
      const webhook = httpURL(options.webhookUrl, 'Replicate webhookUrl');
      if (webhook.protocol !== 'https:') throw new TypeError('Replicate webhookUrl must use HTTPS.');
      body.webhook = webhook.href;
      body.webhook_events_filter = ['completed'];
    }
    const path = this.versionId === undefined ? `/models/${this.model}/predictions` : '/predictions';
    const response = await this.transport.request(`${this.transport.baseURL}${path}`, 'POST', options, body);
    try {
      const prediction = this.prediction(response.value, undefined, this.versionId);
      const operation: PredictionOperation = {
        type: 'replicate-prediction', version: 1, modelId: this.modelId,
        baseURL: this.transport.baseURL, predictionId: prediction.id as string,
      };
      const modelVersion = prediction.version ?? this.versionId;
      if (typeof modelVersion === 'string') operation.modelVersion = modelVersion;
      return {
        operation,
        providerMetadata: { replicate: { predictionId: operation.predictionId } },
        response: response.response,
      };
    } catch (cause) {
      throw invalidResponse(response, cause, 'Replicate');
    }
  }

  async doStatus(options: AssetModelV1OperationOptions): Promise<AssetModelV1Status> {
    const operation = this.operation(options.operation);
    const response = await this.transport.request(this.predictionURL(operation), 'GET', options);
    try {
      const prediction = this.prediction(response.value, operation.predictionId, operation.modelVersion);
      switch (prediction.status) {
        case 'starting': case 'processing':
          return {
            status: prediction.status === 'starting' ? 'pending' : 'running',
            providerMetadata: { replicate: { predictionId: operation.predictionId } },
          };
        case 'canceled': return { status: 'cancelled' };
        case 'failed': return {
          status: 'failed', error: { message: errorMessage(prediction.error) ?? 'Replicate prediction failed.' },
        };
        case 'succeeded': {
          // Snapshot before calling application code. A mapper must not change the retained native output.
          const output = jsonValue(prediction.output, 'Replicate prediction output');
          const result = await (this.definition.mapResult ?? mapAssetResult)(jsonValue(output, 'Replicate mapper output'));
          if (!result || !Array.isArray(result.assets) || result.assets.length === 0) {
            throw new TypeError('Replicate mapResult must return at least one real asset.');
          }
          return {
            status: 'completed',
            result: {
              ...result,
              providerMetadata: {
                ...result.providerMetadata,
                replicate: { ...result.providerMetadata?.replicate, predictionId: operation.predictionId, output },
              },
              response: response.response,
            },
          };
        }
        default: throw new TypeError('Unsupported Replicate prediction status.');
      }
    } catch (cause) {
      throw invalidResponse(response, cause, 'Replicate');
    }
  }

  async doCancel(options: AssetModelV1OperationOptions): Promise<AssetModelV1CancelResult> {
    const operation = this.operation(options.operation);
    const response = await this.transport.request(`${this.predictionURL(operation)}/cancel`, 'POST', options);
    try {
      const prediction = this.prediction(response.value, operation.predictionId, operation.modelVersion);
      if (prediction.status === 'canceled') return { status: 'cancelled', response: response.response };
      if (prediction.status === 'starting' || prediction.status === 'processing') {
        return { status: 'requested', response: response.response };
      }
      throw new TypeError(`Replicate prediction is already ${prediction.status}; query the original operation for its result.`);
    } catch (cause) {
      throw invalidResponse(response, cause, 'Replicate');
    }
  }

  private prediction(value: unknown, predictionId?: string, modelVersion?: string): Record<string, unknown> {
    const prediction = record(value, 'Replicate prediction');
    if (typeof prediction.id !== 'string' || !PREDICTION_ID.test(prediction.id)) {
      throw new TypeError('Replicate prediction must have a valid id.');
    }
    if (predictionId !== undefined && prediction.id !== predictionId) {
      throw new TypeError('Replicate prediction id does not match the original operation.');
    }
    if (prediction.model !== undefined && prediction.model !== this.model) {
      throw new TypeError('Replicate prediction model does not match the original model.');
    }
    if (prediction.version !== undefined && (
      typeof prediction.version !== 'string' || !prediction.version.trim() ||
      (modelVersion !== undefined && prediction.version !== modelVersion)
    )) {
      throw new TypeError('Replicate prediction version does not match the original model version.');
    }
    if (typeof prediction.status !== 'string' || !STATUSES.has(prediction.status)) {
      throw new TypeError(`Unknown Replicate prediction status: ${String(prediction.status)}.`);
    }
    return prediction;
  }

  private operation(value: unknown): PredictionOperation {
    const operation = jsonObject(value, 'Replicate operation');
    if (operation.type !== 'replicate-prediction' || operation.version !== 1 ||
      operation.modelId !== this.modelId || operation.baseURL !== this.transport.baseURL) {
      throw new TypeError('Replicate operation type, version, modelId, or baseURL does not match this connection.');
    }
    if (typeof operation.predictionId !== 'string' || !PREDICTION_ID.test(operation.predictionId)) {
      throw new TypeError('Replicate operation predictionId must be a valid token.');
    }
    if (operation.modelVersion !== undefined && (
      typeof operation.modelVersion !== 'string' || !operation.modelVersion.trim()
    )) {
      throw new TypeError('Replicate operation modelVersion must be a nonempty string.');
    }
    if (this.versionId !== undefined && operation.modelVersion !== this.versionId) {
      throw new TypeError('Replicate operation modelVersion does not match the configured model version.');
    }
    return {
      type: 'replicate-prediction', version: 1, modelId: this.modelId,
      baseURL: this.transport.baseURL, predictionId: operation.predictionId,
      ...(operation.modelVersion === undefined ? {} : { modelVersion: operation.modelVersion }),
    };
  }

  private predictionURL(operation: PredictionOperation): string {
    return `${this.transport.baseURL}/predictions/${operation.predictionId}`;
  }
}
