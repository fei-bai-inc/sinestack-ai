import type { AssetModelMapping, AssetModelV1, AssetModelV1CallOptions, AssetModelV1OperationOptions, AssetModelV1Result, AssetModelV1Status, JSONObject, JSONValue, TaskCallOptions, TaskDeleteResult, TaskDriver, TaskOperationOptions, TaskStatus } from '@sinestack/ai-provider';
import { jsonObject, snapshotAssetMapping } from '@sinestack/ai-provider-utils';
import { MeshyClient, decodeResponse, meshyTaskId } from './client.js';
import { meshyAssetResult } from './results.js';
import { validateRoute } from './routes.js';
import { nonempty, validateMeshyInput } from './validation.js';
import type { MeshyInputMapping, MeshyTaskRecord } from './types.js';

export interface MeshyTaskDefinition<R> {
  readonly route: string;
  readonly variant?: 'preview' | 'refine';
  readonly modelId?: string;
  readonly modelField?: 'ai_model' | 'mode';
  /** Only opt in for a route whose DELETE semantics were verified as resource deletion. */
  readonly supportsDelete?: boolean;
  readonly decode: (task: MeshyTaskRecord) => R | PromiseLike<R>;
}
interface MeshyHandle extends JSONObject {
  type: 'meshy-task'; version: 1; taskId: string; baseURL: string; route: string;
  domain: string; variant?: string; modelId?: string; modelField: string; connectionId?: string;
}

/** One request per protocol method. No hidden preview/refine, waits or retry policy. */
export class MeshyTaskDriver<I, R, D extends string> implements TaskDriver<I, R, D> {
  readonly specificationVersion = 'v1' as const;
  readonly capabilities = Object.freeze({ idempotentStart: false, webhooks: false });
  readonly provider: string;
  readonly driverId: string;
  readonly modelId?: string;
  readonly connectionId?: string;
  readonly doDelete?: (options: TaskOperationOptions) => Promise<TaskDeleteResult>;
  private readonly definition: MeshyTaskDefinition<R>;
  private readonly mapInput?: (input: I) => JSONObject | PromiseLike<JSONObject>;
  constructor(private readonly client: MeshyClient, definition: MeshyTaskDefinition<R>, readonly domain: D, mapping?: MeshyInputMapping<I>) {
    validateRoute(definition.route); nonempty(domain, 'domain');
    if (definition.modelId !== undefined) nonempty(definition.modelId, 'modelId');
    if (definition.variant !== undefined && !['preview', 'refine'].includes(definition.variant)) throw new TypeError('Invalid Meshy text stage');
    if (definition.variant !== undefined && definition.route !== 'v2/text-to-3d') throw new TypeError('A text stage requires the text-to-3d route');
    if (definition.modelField !== undefined && definition.modelField !== 'ai_model' && definition.modelField !== 'mode') throw new TypeError('Invalid model field');
    if (typeof definition.decode !== 'function' || (mapping?.mapInput !== undefined && typeof mapping.mapInput !== 'function')) throw new TypeError('Invalid Meshy mapping');
    this.definition = Object.freeze({ ...definition, decode: definition.decode.bind(definition) });
    this.mapInput = mapping?.mapInput?.bind(mapping);
    this.provider = client.provider; this.connectionId = client.connectionId; this.modelId = definition.modelId;
    this.driverId = `${definition.route}${definition.variant ? `#${definition.variant}` : ''}`;
    if (definition.supportsDelete === true) this.doDelete = async options => {
      const handle = this.handle(options.handle);
      return client.deleteTask(handle.route, handle.taskId, options);
    };
  }
  readonly validateHandle = (value: JSONValue): void => { this.handle(value); };
  private handle(value: JSONValue): MeshyHandle {
    const handle = jsonObject(value, 'Meshy handle');
    if (handle.type !== 'meshy-task' || handle.version !== 1 || handle.baseURL !== this.client.transport.baseURL ||
      handle.route !== this.definition.route || handle.variant !== this.definition.variant || handle.domain !== this.domain ||
      handle.modelId !== this.modelId || handle.modelField !== (this.definition.modelField ?? 'ai_model') || handle.connectionId !== this.connectionId) {
      throw new TypeError('Meshy handle does not match its original connection, route, stage, domain or model');
    }
    meshyTaskId(handle.taskId);
    return handle as MeshyHandle;
  }
  async doStart(options: TaskCallOptions<I>) {
    if (options.webhookUrl !== undefined) throw new TypeError('Meshy webhooks are configured at account level, not on submissions');
    const input = jsonObject(this.mapInput ? await this.mapInput(options.input) : options.input, 'Meshy input');
    const extra = jsonObject(options.providerOptions.meshy ?? {}, 'providerOptions.meshy');
    for (const key of Object.keys(extra)) if (Object.hasOwn(input, key)) throw new TypeError(`providerOptions.meshy.${key} cannot override input`);
    const body: JSONObject = { ...extra, ...input };
    if (this.definition.variant !== undefined) {
      if (body.mode !== undefined && body.mode !== this.definition.variant) throw new TypeError('Meshy mode conflicts with the selected text stage');
      body.mode = this.definition.variant;
    }
    const modelField = this.definition.modelField ?? 'ai_model';
    if (this.modelId !== undefined) {
      if (body[modelField] !== undefined && body[modelField] !== this.modelId) throw new TypeError('Native model conflicts with factory modelId');
      body[modelField] = this.modelId;
    }
    validateMeshyInput(this.definition.route, body);
    const response = await this.client.request(this.definition.route, 'POST', options, body);
    const taskId = decodeResponse(response, value => meshyTaskId(jsonObject(value, 'Meshy submission').result));
    const handle: MeshyHandle = { type: 'meshy-task', version: 1, taskId, baseURL: this.client.transport.baseURL,
      route: this.definition.route, domain: this.domain, modelField,
      ...(this.definition.variant === undefined ? {} : { variant: this.definition.variant }),
      ...(this.modelId === undefined ? {} : { modelId: this.modelId }),
      ...(this.connectionId === undefined ? {} : { connectionId: this.connectionId }) };
    return { handle, response: response.response, providerMetadata: { meshy: { taskId } } };
  }
  async doStatus(options: TaskOperationOptions): Promise<TaskStatus<R>> {
    const handle = this.handle(options.handle);
    const { data, response } = await this.client.getTask(handle.route, handle.taskId, options);
    if (this.definition.variant !== undefined && data.mode !== undefined && data.mode !== this.definition.variant) throw new TypeError('Meshy returned a different text stage');
    const metadata = { response, providerMetadata: { meshy: { taskId: data.id, output: jsonObject(data, 'Meshy retained output') } } };
    switch (data.status) {
      case 'PENDING': case 'IN_PROGRESS':
        return { ...metadata, status: data.status === 'PENDING' ? 'pending' : 'running', ...(data.progress === undefined ? {} : { progress: data.progress / 100 }) };
      case 'CANCELED': return { ...metadata, status: 'cancelled' };
      case 'FAILED': return { ...metadata, status: 'failed', error: {
        message: typeof data.task_error?.message === 'string' ? data.task_error.message : 'Meshy task failed',
        code: String(data.task_error?.code ?? data.task_error?.type ?? 'MESHY_TASK_FAILED') } };
      case 'SUCCEEDED':
        return { ...metadata, status: 'completed', result: await this.definition.decode(jsonObject(data, 'Meshy mapper task') as MeshyTaskRecord) };
    }
  }
}

/** Bridges file generation to the same protocol driver, not a second executor. */
export class MeshyAssetModel<I, K extends string> implements AssetModelV1<I, K> {
  readonly specificationVersion = 'v1' as const;
  readonly capabilities = Object.freeze({ idempotentStart: false, webhooks: false });
  readonly provider: string;
  readonly modelId: string;
  private readonly driver: MeshyTaskDriver<I, AssetModelV1Result, K>;
  constructor(client: MeshyClient, route: string, readonly kind: K, version?: string, mapping?: AssetModelMapping<I>, variant?: 'preview' | 'refine', modelField: 'ai_model' | 'mode' = 'ai_model') {
    const saved = snapshotAssetMapping(mapping);
    this.provider = client.provider;
    this.modelId = `${route}${variant ? `#${variant}` : ''}${version === undefined ? '' : `@${version}`}`;
    this.driver = new MeshyTaskDriver(client, { route, variant, modelId: version, modelField,
      async decode(task) {
        const result = saved.mapResult ? await saved.mapResult(jsonObject(task, 'Meshy asset mapper task')) : meshyAssetResult(task, kind);
        if (!result || !Array.isArray(result.assets) || !result.assets.length) throw new TypeError('Meshy asset mappings must return real files');
        return result;
      } }, kind, { mapInput: saved.mapInput });
  }
  async doStart(options: AssetModelV1CallOptions<I>) {
    const { handle, ...metadata } = await this.driver.doStart(options);
    return { ...metadata, operation: handle };
  }
  async doStatus(options: AssetModelV1OperationOptions): Promise<AssetModelV1Status> {
    const status = await this.driver.doStatus({ handle: options.operation, headers: options.headers, abortSignal: options.abortSignal });
    if (status.status !== 'completed') return status;
    const native = status.providerMetadata?.meshy?.output as JSONObject | undefined;
    return { status: 'completed', result: { ...status.result,
      ...(typeof native?.consumed_credits === 'number' ? { usage: { ...status.result.usage, credits: native.consumed_credits } } : {}),
      providerMetadata: { ...status.result.providerMetadata, meshy: { ...status.result.providerMetadata?.meshy, ...status.providerMetadata?.meshy } },
      response: status.response } };
  }
}
