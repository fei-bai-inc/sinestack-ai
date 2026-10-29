import type { AssetModelV1, AssetModelV1CallOptions, AssetModelV1OperationOptions, AssetModelV1Result, AssetModelV1Status, JSONObject, JSONValue, TaskCallOptions, TaskDeleteResult, TaskDriver, TaskOperationOptions, TaskStatus } from '@sinestack/ai-provider';
import { invalidResponse, jsonObject } from '@sinestack/ai-provider-utils';
import type { AssetProviderResponse } from '@sinestack/ai-provider-utils';
import type { ViggleClient } from './client.js';
import { decodeResponse, parseJob } from './client.js';
import type { ViggleJob, ViggleResourceResponse } from './types.js';
import { mergeInput, nonempty, opaqueId } from './validation.js';

export interface ViggleHandle extends JSONObject {
  type: 'viggle-task'; version: 1; taskId: string; driverId: string; domain: string; baseURL: string; connectionId?: string; sessionId?: string;
}
export interface ViggleTaskDefinition<I, R, D extends string> {
  readonly id: string;
  readonly domain: D;
  readonly prefixes: readonly string[];
  readonly idempotentStart?: boolean;
  readonly start: (input: I, options: TaskCallOptions<I>) => PromiseLike<ViggleResourceResponse>;
  readonly get: (id: string, options: TaskOperationOptions, handle: ViggleHandle) => PromiseLike<ViggleResourceResponse>;
  readonly decode: (data: ViggleJob, options: TaskOperationOptions) => R | PromiseLike<R>;
  readonly delete?: (id: string, options: TaskOperationOptions) => PromiseLike<TaskDeleteResult>;
}
/** Single protocol calls only; all retries and waiting belong to the existing core. */
export class ViggleTaskDriver<I, R, D extends string = string> implements TaskDriver<I, R, D> {
  readonly specificationVersion = 'v1' as const;
  readonly provider: string;
  readonly driverId: string;
  readonly domain: D;
  readonly connectionId?: string;
  readonly capabilities: { readonly idempotentStart: boolean; readonly webhooks: false };
  readonly doDelete?: (options: TaskOperationOptions) => PromiseLike<TaskDeleteResult>;
  private readonly definition: ViggleTaskDefinition<I, R, D>;
  constructor(private readonly client: ViggleClient, definition: ViggleTaskDefinition<I, R, D>) {
    nonempty(definition.id, 'Viggle driver ID'); nonempty(definition.domain, 'Viggle domain');
    this.definition = Object.freeze({ ...definition, prefixes: Object.freeze([...definition.prefixes]) });
    this.provider = client.provider; this.driverId = definition.id; this.domain = definition.domain; this.connectionId = client.connectionId;
    this.capabilities = Object.freeze({ idempotentStart: definition.idempotentStart === true, webhooks: false });
    if (definition.delete) this.doDelete = options => this.definition.delete!(this.handle(options.handle).taskId, options);
  }
  readonly validateHandle = (value: JSONValue): void => { this.handle(value); };
  private protocol(result: ViggleResourceResponse): AssetProviderResponse {
    return { url: result.url ?? this.client.transport.baseURL, statusCode: result.statusCode ?? 200,
      value: result.data, response: { ...result.response, headers: result.response.headers ?? {} } };
  }
  private handle(value: JSONValue): ViggleHandle {
    const handle = jsonObject(value, 'Viggle handle');
    if (handle.type !== 'viggle-task' || handle.version !== 1 || handle.driverId !== this.driverId || handle.domain !== this.domain || handle.baseURL !== this.client.transport.baseURL || handle.connectionId !== this.connectionId) throw new TypeError('Viggle handle does not match the original connection, driver or domain');
    opaqueId(handle.taskId, this.definition.prefixes);
    if (handle.sessionId !== undefined) nonempty(handle.sessionId, 'sessionId');
    return handle as ViggleHandle;
  }
  async doStart(options: TaskCallOptions<I>) {
    if (options.webhookUrl !== undefined) throw new TypeError('Viggle has no published submission webhook capability');
    const input = mergeInput(options.input, jsonObject(options.providerOptions.viggle ?? {}, 'providerOptions.viggle')) as I;
    const result = await this.definition.start(input, options);
    const { response } = result;
    const data = decodeResponse(this.protocol(result), value => {
      const data = parseJob(value); opaqueId(data.id, this.definition.prefixes); return data;
    });
    const handle: ViggleHandle = { type: 'viggle-task', version: 1, taskId: data.id, driverId: this.driverId, domain: this.domain, baseURL: this.client.transport.baseURL,
      ...(this.connectionId === undefined ? {} : { connectionId: this.connectionId }), ...(data.sessionId === undefined ? {} : { sessionId: data.sessionId }) };
    return { handle, response, providerMetadata: { viggle: { taskId: data.id, output: data } } };
  }
  async doStatus(options: TaskOperationOptions): Promise<TaskStatus<R>> {
    const handle = this.handle(options.handle);
    const result = await this.definition.get(handle.taskId, options, handle);
    const { response } = result; const protocol = this.protocol(result);
    const data = decodeResponse(protocol, value => {
      const data = parseJob(value, handle.taskId);
      if (handle.sessionId !== undefined && data.sessionId !== handle.sessionId) throw new TypeError('Viggle returned a different scene session');
      return data;
    });
    const metadata = { response, providerMetadata: { viggle: { taskId: data.id, output: data } } };
    switch (data.status) {
      case 'queued': case 'processing': return { ...metadata, status: data.status === 'queued' ? 'pending' : 'running', ...(data.progress == null ? {} : { progress: data.progress / 100 }) };
      case 'failed': {
        const nested = data.vsplat ?? data.glb;
        const error = data.error ?? (nested && typeof nested === 'object' && !Array.isArray(nested) ? (nested as JSONObject).error : undefined);
        const details: JSONObject = error && typeof error === 'object' && !Array.isArray(error) ? error as JSONObject : {};
        return { ...metadata, status: 'failed', error: { message: typeof details.message === 'string' ? details.message : 'Viggle task failed', code: typeof details.code === 'string' ? details.code : 'VIGGLE_TASK_FAILED' } };
      }
      case 'cancelled': return { ...metadata, status: 'cancelled', message: 'Viggle stopped the remote task' };
      case 'ready': {
        try { return { ...metadata, status: 'completed', result: await this.definition.decode(data, options) }; }
        catch (cause) {
          if (options.abortSignal.aborted) throw options.abortSignal.reason;
          throw invalidResponse(protocol, cause, 'Viggle');
        }
      }
    }
  }
}
/** Asset compatibility view of the same driver, without another execution loop. */
export class ViggleAssetModel<I, K extends string> implements AssetModelV1<I, K> {
  readonly specificationVersion = 'v1' as const;
  readonly provider: string;
  readonly modelId: string;
  readonly capabilities;
  constructor(private readonly driver: ViggleTaskDriver<I, AssetModelV1Result>, readonly kind: K) {
    this.provider = driver.provider; this.modelId = driver.driverId; this.capabilities = driver.capabilities;
  }
  async doStart(options: AssetModelV1CallOptions<I>) {
    const { handle, ...metadata } = await this.driver.doStart(options);
    return { ...metadata, operation: handle };
  }
  async doStatus(options: AssetModelV1OperationOptions): Promise<AssetModelV1Status> {
    const status = await this.driver.doStatus({ handle: options.operation, headers: options.headers, abortSignal: options.abortSignal });
    if (status.status !== 'completed') return status;
    return { status: 'completed', result: { ...status.result, response: status.response,
      providerMetadata: { ...status.result.providerMetadata, viggle: { ...status.result.providerMetadata?.viggle, ...status.providerMetadata?.viggle } } } };
  }
}
