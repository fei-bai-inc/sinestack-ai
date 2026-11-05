import type { AssetModelMapping, AssetModelV1, AssetModelV1CallOptions, AssetModelV1OperationOptions, AssetModelV1Result, AssetModelV1Status, JSONObject, JSONValue } from '@sinestack/ai-provider';
import { jsonObject, jsonValue, record, snapshotAssetMapping } from '@sinestack/ai-provider-utils';
import { operationRecord, worldRecord, WorldLabsClient } from './client.js';
import { exportAssets, panoramaAssets, worldAssets } from './results.js';
import { resourceId, text, validateDepthInput, validateExportInput, validateWorldInput } from './validation.js';
import type { WorldLabsOperation } from './types.js';

type Route = 'worlds:generate' | 'pano:depth_to_rgb' | 'export-splat' | 'export-mesh';
interface NativeHandle extends JSONObject {
  type: 'worldlabs-operation'; version: 1; operationId: string; route: Route;
  baseURL: string; modelId: string; connectionId?: string; worldId?: string;
  completedOperation?: WorldLabsOperation;
}
/** Each method performs one native operation. Core owns polling and retries. */
export class WorldLabsAssetModel<I, K extends string> implements AssetModelV1<I, K> {
  readonly specificationVersion = 'v1' as const;
  readonly capabilities = { idempotentStart: false, webhooks: false } as const;
  readonly provider: string;
  readonly modelId: string;
  private readonly mapping: AssetModelMapping<I>;
  constructor(private readonly client: WorldLabsClient, private readonly route: Route, readonly kind: K,
    private readonly nativeModel?: string, mapping?: AssetModelMapping<I>) {
    if (!['worlds:generate', 'pano:depth_to_rgb', 'export-splat', 'export-mesh'].includes(route)) throw new TypeError('Invalid World Labs route');
    if (route === 'worlds:generate') text(nativeModel, 'Explicit modelId');
    this.provider = client.provider;
    this.modelId = nativeModel ?? route;
    this.mapping = snapshotAssetMapping(mapping);
  }
  private handle(value: JSONValue): NativeHandle {
    const handle = jsonObject(value, 'World Labs operation handle');
    if (handle.type !== 'worldlabs-operation' || handle.version !== 1 || handle.route !== this.route ||
      handle.baseURL !== this.client.transport.baseURL || handle.modelId !== this.modelId || handle.connectionId !== this.client.connectionId) {
      throw new TypeError('World Labs handle does not match its original route, model, or connection');
    }
    resourceId(handle.operationId);
    if (handle.worldId !== undefined) resourceId(handle.worldId);
    if (this.route.startsWith('export-') && handle.worldId === undefined) throw new TypeError('World Labs export handle requires worldId');
    if (handle.completedOperation !== undefined && !operationRecord(handle.completedOperation, handle.operationId as string).done) throw new TypeError('Stored World Labs operation must be completed');
    return handle as NativeHandle;
  }
  async doStart(options: AssetModelV1CallOptions<I>) {
    if (options.webhookUrl !== undefined) throw new TypeError('World Labs does not support submission webhooks');
    const input = jsonObject(this.mapping.mapInput ? await this.mapping.mapInput(options.input) : options.input, 'World Labs input');
    const extra = jsonObject(options.providerOptions.worldlabs ?? {}, 'providerOptions.worldlabs');
    for (const key of Object.keys(extra)) if (Object.hasOwn(input, key)) throw new TypeError(`providerOptions.worldlabs.${key} cannot override input`);
    const body = { ...extra, ...input };
    let path: string = this.route;
    let worldId: string | undefined;
    if (this.route === 'worlds:generate') {
      if (body.model !== undefined && body.model !== this.nativeModel) throw new TypeError('Native model conflicts with factory modelId');
      body.model = this.nativeModel;
      validateWorldInput(body);
    } else if (this.route === 'pano:depth_to_rgb') {
      validateDepthInput(body);
    } else {
      const splat = this.route === 'export-splat';
      validateExportInput(body, splat ? 'splat' : 'mesh');
      worldId = resourceId(body.world_id);
      path = `worlds/${worldId}:export`;
      delete body.world_id;
      for (const [key, value] of Object.entries({ asset_type: splat ? 'splats' : 'mesh', format: splat ? 'ply' : 'glb' })) {
        if (body[key] !== undefined && body[key] !== value) throw new TypeError(`Export ${key} conflicts with factory`);
        body[key] = value;
      }
    }
    const { data, response } = await this.client.request(path, 'POST', options, body);
    const operation = operationRecord(data);
    const metadataWorldId = operation.metadata?.world_id;
    if (metadataWorldId != null) {
      resourceId(metadataWorldId);
      if (worldId !== undefined && worldId !== metadataWorldId) throw new TypeError('World Labs world ID mismatch');
      worldId = metadataWorldId as string;
    }
    const handle: NativeHandle = { type: 'worldlabs-operation', version: 1, operationId: operation.operation_id,
      route: this.route, baseURL: this.client.transport.baseURL, modelId: this.modelId,
      ...(this.client.connectionId === undefined ? {} : { connectionId: this.client.connectionId }),
      ...(worldId === undefined ? {} : { worldId }),
      ...(operation.done ? { completedOperation: operation } : {}) };
    return { operation: handle, response, providerMetadata: { worldlabs: { operationId: operation.operation_id, operation } } };
  }
  async doStatus(options: AssetModelV1OperationOptions): Promise<AssetModelV1Status> {
    const handle = this.handle(options.operation);
    options.abortSignal.throwIfAborted();
    const { data: operation, response } = handle.completedOperation
      ? { data: operationRecord(handle.completedOperation, handle.operationId), response: { body: handle.completedOperation } }
      : await this.client.getOperation(handle.operationId, options);
    const worldId = operation.metadata?.world_id ?? handle.worldId;
    if (worldId != null) {
      resourceId(worldId);
      if (handle.worldId !== undefined && worldId !== handle.worldId) throw new TypeError('World Labs world ID mismatch');
    }
    const metadata: JSONObject = { operationId: operation.operation_id, operation,
      ...(worldId == null ? {} : { worldId }) };
    if (!operation.done) {
      const progress = operation.metadata?.progress;
      const description = progress != null && typeof progress === 'object' && !Array.isArray(progress) ? record(progress, 'World Labs progress').description : undefined;
      return { status: 'running', ...(typeof description === 'string' ? { message: description } : {}), providerMetadata: { worldlabs: metadata } };
    }
    if (operation.error != null) return { status: 'failed', error: {
      message: operation.error.message || 'World Labs operation failed',
      ...(operation.error.code == null ? {} : { code: String(operation.error.code) }),
    }, response, providerMetadata: { worldlabs: metadata } };
    const output = jsonObject(operation.response, 'World Labs completed response');
    if (this.route === 'worlds:generate') {
      const world = worldRecord(output, typeof worldId === 'string' ? worldId : undefined);
      metadata.worldId = world.world_id ?? world.id;
    }
    const result: AssetModelV1Result = this.mapping.mapResult
      ? await this.mapping.mapResult(jsonValue(output, 'World Labs mapper output'))
      : this.route === 'worlds:generate' ? worldAssets(output)
      : this.route === 'pano:depth_to_rgb' ? panoramaAssets(output)
      : exportAssets(output, this.route === 'export-splat' ? 'splat' : 'mesh');
    if (!result || !Array.isArray(result.assets) || !result.assets.length) throw new TypeError('World Labs asset mapper must return real files');
    // Native output is independent of any application mapper mutation.
    return { status: 'completed', result: { ...result,
      ...(operation.cost == null ? {} : { usage: { ...result.usage, credits: operation.cost.total_credits } }),
      providerMetadata: { ...result.providerMetadata, worldlabs: { ...result.providerMetadata?.worldlabs, ...metadata, output } }, response } };
  }
}
