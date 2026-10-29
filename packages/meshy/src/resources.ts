import { jsonObject } from '@sinestack/ai-provider-utils';
import { MeshyClient, decodeResponse, meshyTaskId, parseMeshyTask } from './client.js';
import type { MeshyDeleteResult } from './client.js';
import { familyRoute } from './routes.js';
import type { MeshyTaskFamily } from './routes.js';
import type { MeshyAnimationFilters, MeshyAnimationPreset, MeshyBalance, MeshyListOptions, MeshyRequestOptions, MeshyTaskRecord, MeshyUsageQuery, MeshyUsageRecord } from './types.js';
import { boundedNumber, nonempty } from './validation.js';

export interface MeshyTaskDeletion extends MeshyDeleteResult { taskId: string }
export interface MeshyResources {
  tasks: {
    get(family: MeshyTaskFamily, id: string, options?: MeshyRequestOptions): Promise<MeshyTaskRecord>;
    list(family: MeshyTaskFamily, query?: MeshyListOptions, options?: MeshyRequestOptions): Promise<MeshyTaskRecord[]>;
    delete(family: MeshyTaskFamily, id: string, options?: MeshyRequestOptions): Promise<MeshyTaskDeletion>;
  };
  animations: {
    list(query?: MeshyAnimationFilters, options?: MeshyRequestOptions): Promise<readonly MeshyAnimationPreset[]>;
  };
  account: {
    balance(options?: MeshyRequestOptions): Promise<MeshyBalance>;
    usage(query?: MeshyUsageQuery, options?: MeshyRequestOptions): Promise<readonly MeshyUsageRecord[]>;
  };
}

function queryString(query: object): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined) continue;
    if (typeof value !== 'string' && typeof value !== 'number' && !Array.isArray(value)) throw new TypeError(`Invalid query parameter: ${key}`);
    if (typeof value === 'number' && !Number.isFinite(value)) throw new TypeError(`Invalid query parameter: ${key}`);
    if (Array.isArray(value) && !value.every(item => typeof item === 'string' || (typeof item === 'number' && Number.isFinite(item)))) throw new TypeError(`Invalid query array: ${key}`);
    params.set(key, Array.isArray(value) ? value.join(',') : String(value));
  }
  return params.size ? `?${params}` : '';
}
function page(query: MeshyListOptions): void {
  if (query.page_num !== undefined) boundedNumber(query.page_num, 'page_num', 1, 255, true);
  if (query.page_size !== undefined) boundedNumber(query.page_size, 'page_size', 1, 255, true);
}
function array(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new TypeError('Expected a Meshy response array');
  return value;
}
/** Resource queries never create artificial jobs or automatically drain every page. */
export function meshyResources(client: MeshyClient): MeshyResources {
  return {
    tasks: {
      async get(family: MeshyTaskFamily, id: string, options?: MeshyRequestOptions) {
        return (await client.getTask(familyRoute(family), id, options)).data;
      },
      async list(family: MeshyTaskFamily, query: MeshyListOptions = {}, options?: MeshyRequestOptions) {
        page(query);
        const response = await client.request(`${familyRoute(family)}${queryString(query)}`, 'GET', options);
        return decodeResponse(response, value => array(value).map(item => parseMeshyTask(item)));
      },
      async delete(family: MeshyTaskFamily, id: string, options?: MeshyRequestOptions) {
        return { ...await client.deleteTask(familyRoute(family), id, options), taskId: id };
      },
    },
    animations: {
      async list(query: MeshyAnimationFilters = {}, options?: MeshyRequestOptions): Promise<readonly MeshyAnimationPreset[]> {
        if (Array.isArray(query.action_ids)) {
          if (query.action_ids.length > 200) throw new TypeError('Animation lookup accepts at most 200 IDs');
          query.action_ids.forEach(id => boundedNumber(id, 'action_id', 0, 32767, true));
        }
        const response = await client.request(`v1/animations/library${queryString(query)}`, 'GET', options);
        return decodeResponse(response, value => array(value).map(item => {
          const preset = jsonObject(item, 'Meshy animation preset');
          boundedNumber(preset.action_id, 'action_id', 0, Infinity, true);
          nonempty(preset.name, 'animation name'); nonempty(preset.key, 'animation key');
          return preset as MeshyAnimationPreset;
        }));
      },
    },
    account: {
      async balance(options?: MeshyRequestOptions): Promise<MeshyBalance> {
        const response = await client.request('v1/balance', 'GET', options);
        return decodeResponse(response, value => {
          const balance = jsonObject(value, 'Meshy balance'); boundedNumber(balance.balance, 'balance', 0);
          for (const field of ['monthly_credits', 'permanent_credits', 'monthly_resets_at']) if (balance[field] != null) boundedNumber(balance[field], field, 0);
          return balance as MeshyBalance;
        });
      },
      async usage(query: MeshyUsageQuery = {}, options?: MeshyRequestOptions): Promise<readonly MeshyUsageRecord[]> {
        page(query);
        const response = await client.request(`v1/usage/tasks${queryString(query)}`, 'GET', options);
        return decodeResponse(response, value => array(value).map(item => {
          const row = jsonObject(item, 'Meshy usage'); meshyTaskId(row.task_id); nonempty(row.endpoint, 'endpoint');
          if (row.status !== 'SUCCEEDED' && row.status !== 'FAILED') throw new TypeError('Invalid usage status');
          boundedNumber(row.consumed_credits, 'consumed_credits', 0);
          return row as MeshyUsageRecord;
        }));
      },
    },
  };
}
