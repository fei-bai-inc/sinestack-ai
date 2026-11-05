import { httpURL, jsonObject, record } from '@sinestack/ai-provider-utils';
import { worldRecord, WorldLabsClient } from './client.js';
import { resourceId, text } from './validation.js';
import type { WorldLabsListWorldsInput, WorldLabsListWorldsResult, WorldLabsMediaAsset, WorldLabsPreparedUpload, WorldLabsPrepareUploadInput, WorldLabsRequestOptions, WorldLabsResources } from './types.js';

function mediaAsset(value: unknown, id?: string): WorldLabsMediaAsset {
  const asset = jsonObject(value, 'World Labs media asset');
  resourceId(asset.media_asset_id);
  if (id !== undefined && asset.media_asset_id !== id) throw new TypeError('World Labs media asset ID mismatch');
  if (typeof asset.file_name !== 'string' || !['image', 'video'].includes(asset.kind as string)) throw new TypeError('Invalid World Labs media asset');
  return asset as WorldLabsMediaAsset;
}
function preparedUpload(value: unknown): WorldLabsPreparedUpload {
  const prepared = jsonObject(value, 'World Labs prepared upload');
  mediaAsset(prepared.media_asset);
  const info = record(prepared.upload_info, 'World Labs upload info');
  const url = httpURL(info.upload_url, 'World Labs upload URL');
  if (url.protocol !== 'https:' || info.upload_method !== 'PUT') throw new TypeError('World Labs signed upload requires HTTPS PUT');
  if (info.required_headers != null) {
    const headers = record(info.required_headers, 'World Labs upload headers');
    for (const [key, value] of Object.entries(headers)) {
      if (typeof value !== 'string') throw new TypeError('Upload headers must be strings');
      if (['authorization', 'cookie', 'wlt-api-key', 'proxy-authorization'].includes(key.toLowerCase())) throw new TypeError('Upload plan must not contain API credentials');
    }
    new Headers(headers as Record<string, string>);
  }
  return prepared as WorldLabsPreparedUpload;
}
export function resources(client: WorldLabsClient): WorldLabsResources {
  return {
    operations: {
      async get(id: string, options?: WorldLabsRequestOptions) { return (await client.getOperation(id, options)).data; },
    },
    worlds: {
      async get(id: string, options?: WorldLabsRequestOptions) {
        const { data } = await client.request(`worlds/${resourceId(id)}`, 'GET', options);
        return worldRecord(data, id);
      },
      async list(input: WorldLabsListWorldsInput = {}, options?: WorldLabsRequestOptions): Promise<WorldLabsListWorldsResult> {
        const body = jsonObject(input, 'World Labs list input');
        if (body.page_size !== undefined && (typeof body.page_size !== 'number' || !Number.isInteger(body.page_size) || body.page_size < 1 || body.page_size > 100)) throw new TypeError('page_size must be between 1 and 100');
        if (body.page_token != null && typeof body.page_token !== 'string') throw new TypeError('page_token must be a string');
        if (body.sort_by !== undefined && body.sort_by !== 'created_at' && body.sort_by !== 'updated_at') throw new TypeError('Invalid sort_by');
        if (body.status != null && !['SUCCEEDED', 'PENDING', 'FAILED', 'RUNNING'].includes(body.status as string)) throw new TypeError('Invalid world status');
        const { data } = await client.request('worlds:list', 'POST', options, body);
        if (!Array.isArray(data.worlds) || (data.next_page_token != null && typeof data.next_page_token !== 'string')) throw new TypeError('Invalid World Labs list result');
        return { ...data, worlds: data.worlds.map(world => worldRecord(world)), ...(data.next_page_token === undefined ? {} : { next_page_token: data.next_page_token as string | null }) };
      },
      async delete(id: string, options?: WorldLabsRequestOptions): Promise<{ world_id: string; deleted: boolean }> {
        const { data } = await client.request(`worlds/${resourceId(id)}`, 'DELETE', options);
        if (data.world_id !== id || typeof data.deleted !== 'boolean') throw new TypeError('Invalid World Labs deletion response');
        return { world_id: id, deleted: data.deleted };
      },
    },
    credits: {
      async get(options?: WorldLabsRequestOptions): Promise<{ remaining_credits: number }> {
        const { data } = await client.request('credits', 'GET', options);
        if (typeof data.remaining_credits !== 'number' || !Number.isFinite(data.remaining_credits) || data.remaining_credits < 0) throw new TypeError('Invalid World Labs remaining_credits');
        return { remaining_credits: data.remaining_credits };
      },
    },
    mediaAssets: {
      async prepareUpload(input: WorldLabsPrepareUploadInput, options?: WorldLabsRequestOptions): Promise<WorldLabsPreparedUpload> {
        const body = jsonObject(input, 'World Labs upload input');
        text(body.file_name, 'file_name');
        if ([...body.file_name].length > 64 || !['image', 'video'].includes(body.kind as string)) throw new TypeError('Upload requires a file_name of at most 64 characters and image/video kind');
        if (body.extension != null && (typeof body.extension !== 'string' || !/^[a-zA-Z0-9]+$/.test(body.extension))) throw new TypeError('extension must be a file extension without a dot');
        if (body.metadata != null) record(body.metadata, 'media asset metadata');
        const { data } = await client.request('media-assets:prepare_upload', 'POST', options, body);
        return preparedUpload(data);
      },
      async get(id: string, options?: WorldLabsRequestOptions): Promise<WorldLabsMediaAsset> {
        const { data } = await client.request(`media-assets/${resourceId(id)}`, 'GET', options);
        return mediaAsset(data, id);
      },
      async upload(prepared: WorldLabsPreparedUpload, body: Blob | Uint8Array, options: Pick<WorldLabsRequestOptions, 'abortSignal'> = {}): Promise<void> {
        const { upload_info: info } = preparedUpload(prepared);
        if (body instanceof Blob ? body.size === 0 : !(body instanceof Uint8Array) || body.byteLength === 0) throw new TypeError('Upload requires a nonempty Blob or Uint8Array');
        options.abortSignal?.throwIfAborted();
        // Storage uses only the signed plan; it never inherits connection or per-call headers.
        const response = await client.fetcher(info.upload_url, { method: 'PUT', body: body as BodyInit,
          headers: info.required_headers ?? {}, signal: options.abortSignal, redirect: 'manual', credentials: 'omit' });
        if (response.redirected || (response.url && response.url !== info.upload_url) || !response.ok) {
          await response.body?.cancel();
          throw new Error(`World Labs signed upload failed: HTTP ${response.status}`);
        }
        await response.body?.cancel();
      },
    },
  };
}
