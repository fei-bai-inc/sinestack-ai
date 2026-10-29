import type { AssetModelMapping, AssetModelV1, AssetModelV1CallOptions, AssetModelV1OperationOptions, AssetModelV1Result, AssetModelV1Status, JSONObject, JSONValue, TaskCallOptions, TaskDriver, TaskOperationOptions, TaskStatus } from '@sinestack/ai-provider';
import { errorMessage, jsonObject, jsonValue, snapshotAssetMapping } from '@sinestack/ai-provider-utils';
import { TripoClient, taskId } from './client.js';
import { assetResult } from './results.js';
import { validateTripoInput } from './validation.js';
import type { TripoTaskRecord } from './types.js';

interface NativeHandle extends JSONObject {
  type: 'tripo-task'; version: 1; taskId: string; path: string; baseURL: string;
  modelId?: string; connectionId?: string; requestModel?: string;
}
export interface TripoTaskMapping<I, R> {
  readonly mapInput?: (input: I) => JSONObject | PromiseLike<JSONObject>;
  readonly decode: (task: TripoTaskRecord) => R | PromiseLike<R>;
}
/** Single protocol operations only. No polling, retries, timeout controllers or hidden workflows. */
export class TripoTaskDriver<I, R, D extends string> implements TaskDriver<I, R, D> {
  readonly specificationVersion = 'v1' as const;
  readonly capabilities = { idempotentStart: false, webhooks: false } as const;
  readonly provider: string;
  readonly connectionId?: string;
  private readonly mapping: TripoTaskMapping<I, R>;
  constructor(private readonly client: TripoClient, readonly driverId: string, readonly domain: D,
    readonly modelId: string | undefined, mapping: TripoTaskMapping<I, R>) {
    if (!/^[a-z][a-z0-9-]*(?:\/[a-z][a-z0-9-]*)+$/.test(driverId)) throw new TypeError('Invalid Tripo operation path');
    if (modelId !== undefined && (typeof modelId !== 'string' || !modelId.trim())) throw new TypeError('modelId must be a nonempty native version');
    if (typeof mapping.decode !== 'function' || (mapping.mapInput !== undefined && typeof mapping.mapInput !== 'function')) throw new TypeError('Invalid Tripo mapping');
    this.mapping = { decode: mapping.decode.bind(mapping), ...(mapping.mapInput ? { mapInput: mapping.mapInput.bind(mapping) } : {}) };
    this.provider = client.provider; this.connectionId = client.connectionId;
  }
  readonly validateHandle = (value: JSONValue): void => { this.handle(value); };
  private handle(value: JSONValue): NativeHandle {
    const handle = jsonObject(value, 'Tripo handle');
    if (handle.type !== 'tripo-task' || handle.version !== 1 || handle.path !== this.driverId ||
      handle.baseURL !== this.client.transport.baseURL || handle.modelId !== this.modelId || handle.connectionId !== this.connectionId) {
      throw new TypeError('Tripo handle does not match its original route, model, or connection');
    }
    taskId(handle.taskId);
    return handle as NativeHandle;
  }
  async doStart(options: TaskCallOptions<I>) {
    if (options.webhookUrl !== undefined) throw new TypeError('Tripo uses account-level webhook subscriptions, not submission callback URLs');
    const input = jsonObject(this.mapping.mapInput ? await this.mapping.mapInput(options.input) : options.input, 'Tripo input');
    const extra = jsonObject(options.providerOptions.tripo ?? {}, 'providerOptions.tripo');
    for (const key of Object.keys(extra)) if (Object.hasOwn(input, key)) throw new TypeError(`providerOptions.tripo.${key} cannot override input`);
    const body = { ...extra, ...input };
    if (this.modelId !== undefined) {
      if (body.model !== undefined && body.model !== this.modelId) throw new TypeError('Native model conflicts with factory modelId');
      body.model = this.modelId;
    }
    validateTripoInput(this.driverId, body);
    const response = await this.client.request(this.driverId, 'POST', options, body);
    const data = jsonObject(response.data, 'Tripo submission');
    const handle: NativeHandle = { type: 'tripo-task', version: 1, taskId: taskId(data.task_id),
      path: this.driverId, baseURL: this.client.transport.baseURL,
      ...(this.modelId === undefined ? {} : { modelId: this.modelId }),
      ...(this.connectionId === undefined ? {} : { connectionId: this.connectionId }),
      ...(typeof body.model === 'string' ? { requestModel: body.model } : {}),
    };
    return { handle, response: response.response, providerMetadata: { tripo: { taskId: handle.taskId } } };
  }
  async doStatus(options: TaskOperationOptions): Promise<TaskStatus<R>> {
    const handle = this.handle(options.handle);
    const { data, response } = await this.client.getTask(handle.taskId, options);
    const metadata = { tripo: { taskId: handle.taskId, status: data.status } };
    switch (data.status) {
      case 'queued': case 'running':
        return { status: data.status === 'queued' ? 'pending' : 'running',
          ...(typeof data.progress === 'number' ? { progress: data.progress / 100 } : {}), providerMetadata: metadata };
      case 'cancelled': return { status: 'cancelled' };
      case 'failed': case 'banned': case 'expired':
        return { status: 'failed', error: { message: (typeof data.error_message === 'string' ? data.error_message : typeof data.error_msg === 'string' ? data.error_msg : errorMessage(data)) ?? `Tripo task ${data.status}`,
          code: String(data.error_code ?? data.status) } };
      case 'success': {
        const output = jsonObject(data.output, 'Tripo task output');
        // Independent snapshots protect native metadata and response.body from application mappers.
        const result = await this.mapping.decode(jsonObject(data, 'Tripo mapper task') as TripoTaskRecord);
        return { status: 'completed', result, response,
          providerMetadata: { tripo: { taskId: handle.taskId, output: jsonValue(output, 'Tripo retained output'),
            ...(typeof data.credits_consumed === 'number' ? { creditsConsumed: data.credits_consumed } : {}) } } };
      }
      default: throw new TypeError(`Unsupported Tripo status: ${data.status}`);
    }
  }
}

/** Asset contract adapter over the SAME Tripo protocol, not another execution engine. */
export class TripoAssetModel<I, K extends string> implements AssetModelV1<I, K> {
  readonly specificationVersion = 'v1' as const;
  readonly capabilities = { idempotentStart: false, webhooks: false } as const;
  readonly provider: string;
  readonly modelId: string;
  private readonly driver: TripoTaskDriver<I, AssetModelV1Result, K>;
  constructor(client: TripoClient, path: string, readonly kind: K, version?: string, mapping?: AssetModelMapping<I>) {
    this.provider = client.provider;
    this.modelId = version === undefined ? path : `${path}@${version}`;
    const saved = snapshotAssetMapping(mapping);
    this.driver = new TripoTaskDriver(client, path, kind, version, {
      mapInput: saved.mapInput,
      async decode(task) {
        const output = jsonObject(task.output, 'Tripo output');
        const result = saved.mapResult ? await saved.mapResult(jsonValue(output, 'Tripo mapper output')) : assetResult(task, kind);
        if (!result || !Array.isArray(result.assets) || !result.assets.length) throw new TypeError('Tripo asset mapper must return real files');
        return { ...result, providerMetadata: { ...result.providerMetadata,
          tripo: { ...result.providerMetadata?.tripo, taskId: task.task_id, output } } };
      },
    });
  }
  async doStart(options: AssetModelV1CallOptions<I>) {
    const { handle, ...metadata } = await this.driver.doStart(options); return { ...metadata, operation: handle };
  }
  async doStatus(options: AssetModelV1OperationOptions): Promise<AssetModelV1Status> {
    const status = await this.driver.doStatus({ ...options, handle: options.operation });
    if (status.status !== 'completed') return status;
    const credits = status.providerMetadata?.tripo?.creditsConsumed;
    return { status: 'completed', result: { ...status.result,
      ...(typeof credits === 'number' ? { usage: { ...status.result.usage, credits } } : {}),
      providerMetadata: { ...status.result.providerMetadata,
        tripo: { ...status.result.providerMetadata?.tripo, ...status.providerMetadata?.tripo } },
      response: status.response } };
  }
}
