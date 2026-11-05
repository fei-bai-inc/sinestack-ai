import type { AssetResponse, JSONObject } from '@sinestack/ai-provider';
import { AssetProviderTransport, invalidResponse, jsonObject, record } from '@sinestack/ai-provider-utils';
import type { WorldLabsOperation, WorldLabsProviderSettings, WorldLabsRequestOptions, WorldLabsWorld } from './types.js';
import { resourceId, text } from './validation.js';

export function operationRecord(value: unknown, expectedId?: string): WorldLabsOperation {
  const operation = jsonObject(value, 'World Labs operation');
  resourceId(operation.operation_id);
  if (expectedId !== undefined && operation.operation_id !== expectedId) throw new TypeError('World Labs operation ID mismatch');
  if (typeof operation.done !== 'boolean') throw new TypeError('World Labs operation requires boolean done');
  if (operation.error != null) {
    const error = record(operation.error, 'World Labs operation error');
    if (error.message != null && typeof error.message !== 'string') throw new TypeError('Invalid operation error message');
    if (error.code != null && (typeof error.code !== 'number' || !Number.isInteger(error.code))) throw new TypeError('Invalid operation error code');
    if (!operation.done) throw new TypeError('Nonterminal World Labs operation contains an error');
  }
  if (operation.response != null) record(operation.response, 'World Labs operation response');
  if (operation.metadata != null) record(operation.metadata, 'World Labs operation metadata');
  if (operation.cost != null) {
    const cost = record(operation.cost, 'World Labs operation cost');
    if (typeof cost.total_credits !== 'number' || !Number.isInteger(cost.total_credits) || cost.total_credits < 0) throw new TypeError('Invalid operation total_credits');
  }
  return operation as WorldLabsOperation;
}
export function worldRecord(value: unknown, expectedId?: string): WorldLabsWorld {
  const envelope = jsonObject(value, 'World Labs world');
  const world = envelope.world === undefined ? envelope : jsonObject(envelope.world, 'World Labs world');
  const id = resourceId(world.world_id ?? world.id);
  if ((world.world_id !== undefined && world.id !== undefined && world.world_id !== world.id) || (expectedId !== undefined && id !== expectedId)) throw new TypeError('World Labs world ID mismatch');
  return world as WorldLabsWorld;
}
export class WorldLabsClient {
  readonly transport: AssetProviderTransport;
  readonly provider: string;
  readonly connectionId?: string;
  readonly fetcher: typeof globalThis.fetch;
  constructor(settings: WorldLabsProviderSettings) {
    this.provider = settings.name ?? 'worldlabs';
    text(this.provider, 'provider name');
    this.connectionId = settings.connectionId;
    if (this.connectionId !== undefined) text(this.connectionId, 'connectionId');
    this.fetcher = settings.fetch ?? globalThis.fetch;
    this.transport = new AssetProviderTransport({ ...settings, provider: 'World Labs',
      baseURL: settings.baseURL ?? 'https://api.worldlabs.ai/marble/v1',
      environmentVariableName: 'WORLDLABS_API_KEY', apiKeyHeader: 'WLT-Api-Key' });
  }
  async request(path: string, method: 'GET' | 'POST' | 'DELETE', options: WorldLabsRequestOptions = {}, body?: JSONObject): Promise<{ data: JSONObject; response: AssetResponse }> {
    const response = await this.transport.request(`${this.transport.baseURL}/${path}`, method,
      { headers: { ...options.headers }, abortSignal: options.abortSignal ?? new AbortController().signal }, body);
    try { return { data: jsonObject(response.value, 'World Labs response'), response: response.response }; }
    catch (cause) { throw invalidResponse(response, cause, 'World Labs'); }
  }
  async getOperation(id: string, options?: WorldLabsRequestOptions): Promise<{ data: WorldLabsOperation; response: AssetResponse }> {
    const result = await this.request(`operations/${resourceId(id)}`, 'GET', options);
    return { ...result, data: operationRecord(result.data, id) };
  }
}
