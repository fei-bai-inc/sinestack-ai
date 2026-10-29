import { APICallError } from '@ai-sdk/provider';
import type { AssetModelV1Result, AssetResponse, JSONObject } from '@sinestack/ai-provider';
import { jsonObject } from '@sinestack/ai-provider-utils';
import { ViggleClient, decodeResponse, parseJob } from './client.js';
import { ViggleAssetModel, ViggleTaskDriver } from './driver.js';
import { imageResult, videoFiles, videoResult } from './results.js';
import { renderEvents } from './streams.js';
import { animationInput, draftInput, h3Input, imageInput, prepareInput, renderInput, upscaleInput } from './video-validation.js';
import { blob, bounded, choice, nonempty, opaqueId, url } from './validation.js';
import type * as T from './types.js';

const videoPrefixes = ['vid_', 'anim_', 'render_', 'vsr_'];
function path(family: 'videos' | 'images' | 'renders', id: string): string {
  return `${family}/${encodeURIComponent(opaqueId(id, family === 'videos' ? videoPrefixes : family === 'images' ? ['img_'] : ['render_']))}`;
}
function video(value: unknown, id?: string): T.ViggleVideo {
  const data = parseJob(value, id); opaqueId(data.id, videoPrefixes);
  for (const field of ['video_url', 'alpha_url']) if (data[field] != null) url(data[field], field);
  return data as T.ViggleVideo;
}
function image(value: unknown, id?: string): T.ViggleImageJob {
  const data = parseJob(value, id); opaqueId(data.id, ['img_']);
  if (data.images !== undefined) {
    if (!Array.isArray(data.images)) throw new TypeError('Viggle images must be an array');
    for (const item of data.images) {
      const output = jsonObject(item, 'Viggle image output');
      if (output.url !== null) url(output.url, 'image URL');
    }
  }
  return data as T.ViggleImageJob;
}
function draft(value: unknown): T.ViggleRenderDraft {
  const result = jsonObject(value, 'Viggle render draft'); opaqueId(result.draft_id);
  if (result.uploads !== undefined) {
    if (!Array.isArray(result.uploads)) throw new TypeError('Render uploads must be an array');
    for (const item of result.uploads) uploadPlan(item);
  }
  return result as T.ViggleRenderDraft;
}
function uploadPlan(value: unknown): T.ViggleUploadPlan {
  const plan = jsonObject(value, 'Viggle upload plan');
  opaqueId(plan.upload_handle); url(plan.url, 'upload URL', true);
  if (plan.method !== 'PUT') throw new TypeError('Viggle upload plan requires PUT');
  if (plan.required_headers !== undefined) {
    const headers = jsonObject(plan.required_headers, 'upload headers');
    for (const [key, value] of Object.entries(headers)) {
      nonempty(key, 'upload header');
      if (typeof value !== 'string') throw new TypeError('Upload headers must be strings');
    }
  }
  return plan as T.ViggleUploadPlan;
}

/** Domain factories share one driver and the core task runtime. No hidden submissions. */
export function createVideoCapabilities(client: ViggleClient, fetcher: typeof globalThis.fetch) {
  async function getVideo(id: string, options?: T.ViggleRequestOptions) {
    const response = await client.request(path('videos', id), 'GET', options);
    return { data: decodeResponse(response, value => video(value, id)), response: response.response, url: response.url, statusCode: response.statusCode };
  }
  async function getImage(id: string, options?: T.ViggleRequestOptions) {
    const response = await client.request(path('images', id), 'GET', options);
    return { data: decodeResponse(response, value => image(value, id)), response: response.response, url: response.url, statusCode: response.statusCode };
  }
  function asset<I, K extends 'video' | 'image'>(
    driverId: string, route: string, kind: K, prefixes: readonly string[],
    body: (input: I) => FormData | JSONObject,
    decode: (data: T.ViggleJob) => AssetModelV1Result,
    idempotent = false,
  ) {
    const driver = new ViggleTaskDriver<I, AssetModelV1Result>(client, {
      id: driverId, domain: `${kind}.generate`, prefixes, idempotentStart: idempotent,
      async start(input, options) {
        let headers = options.headers;
        if (idempotent) {
          const supplied = new Headers(headers);
          const key = supplied.get('Idempotency-Key') ?? options.idempotencyKey;
          nonempty(key, 'Idempotency-Key');
          if (key.length > 255) throw new TypeError('Idempotency-Key exceeds 255 characters');
          supplied.set('Idempotency-Key', key); headers = Object.fromEntries(supplied);
        }
        const response = await client.request(route, 'POST', { ...options, headers }, body(input));
        return { data: decodeResponse(response, value => parseJob(value)), response: response.response, url: response.url, statusCode: response.statusCode };
      },
      get: kind === 'image' ? getImage : getVideo,
      decode,
    });
    return new ViggleAssetModel(driver, kind);
  }
  return {
    textToVideo: () => asset<T.ViggleTextToVideoInput, 'video'>('videos.text', 'videos', 'video', ['vid_'], input => client.form(h3Input(input, 'text')), videoResult),
    firstFrameToVideo: () => asset<T.ViggleFirstFrameToVideoInput, 'video'>('videos.first-frame', 'videos', 'video', ['vid_'], input => client.form(h3Input(input, 'first-frame')), videoResult),
    firstLastFrameToVideo: () => asset<T.ViggleFirstLastFrameToVideoInput, 'video'>('videos.first-last-frame', 'videos', 'video', ['vid_'], input => client.form(h3Input(input, 'first-last-frame')), videoResult),
    referenceToVideo: () => asset<T.ViggleReferenceToVideoInput, 'video'>('videos.reference', 'videos', 'video', ['vid_'], input => client.form(h3Input(input, 'reference')), videoResult),
    characterAnimation: () => asset<T.ViggleCharacterAnimationInput, 'video'>('videos.animate', 'videos', 'video', ['anim_'], input => client.form(animationInput(input)), videoResult),
    renderVideo: () => asset<T.ViggleRenderVideoInput, 'video'>('renders.multipart', 'renders', 'video', ['render_'], input => client.form(renderInput(input)), videoResult),
    renderDraft: () => asset<T.ViggleRenderDraftInput, 'video'>('renders.draft', 'renders', 'video', ['render_'], draftInput, videoResult, true),
    image: () => asset<T.ViggleImageInput, 'image'>('images.generate', 'images', 'image', ['img_'], input => client.form(imageInput(input)), imageResult),
    upscaleVideo: () => new ViggleTaskDriver<T.ViggleUpscaleVideoInput, T.ViggleUpscaleVideoResult, 'video.process'>(client, {
      id: 'videos.super-resolution', domain: 'video.process', prefixes: ['vsr_'],
      async start(input, options) {
        const response = await client.request('videos/super-resolution', 'POST', options, client.form(upscaleInput(input)));
        return { data: decodeResponse(response, value => parseJob(value)), response: response.response, url: response.url, statusCode: response.statusCode };
      },
      get: getVideo,
      decode(data) { const files = videoFiles(data); return { taskId: data.id, video: files[0]!, files, raw: data as T.ViggleVideo }; },
    }),
    videos: {
      async get(id: string, options?: T.ViggleRequestOptions) { return (await getVideo(id, options)).data; },
      async list(options: T.ViggleVideoListOptions = {}): Promise<T.ViggleVideoList> {
        const query = new URLSearchParams();
        if (options.limit !== undefined) { bounded(options.limit, 'limit', 1, 100, true); query.set('limit', String(options.limit)); }
        if (options.status !== undefined) {
          choice(options.status, 'status', ['queued', 'processing', 'ready', 'failed', 'cancelled']); query.set('status', options.status);
        }
        if (options.cursor !== undefined) { nonempty(options.cursor, 'cursor'); query.set('cursor', options.cursor); }
        const response = await client.request(`videos${query.size ? `?${query}` : ''}`, 'GET', options);
        return decodeResponse(response, value => {
          const page = jsonObject(value, 'Viggle video list');
          if (!Array.isArray(page.items) || typeof page.has_more !== 'boolean' || (page.next_cursor !== null && typeof page.next_cursor !== 'string')) throw new TypeError('Invalid video pagination');
          return { ...page, items: page.items.map(item => video(item)), next_cursor: page.next_cursor, has_more: page.has_more };
        });
      },
    },
    images: { async get(id: string, options?: T.ViggleRequestOptions) { return (await getImage(id, options)).data; } },
    renders: {
      async prepare(input: T.VigglePrepareRenderInput, options?: T.ViggleRequestOptions): Promise<T.ViggleRenderDraft> {
        const response = await client.request('renders/prepare', 'POST', options, prepareInput(input));
        return decodeResponse(response, draft);
      },
      /** Upload only to the draft's signed destination, without attaching API credentials. */
      async upload(planValue: T.ViggleUploadPlan, file: Blob, options: Pick<T.ViggleRequestOptions, 'abortSignal'> = {}): Promise<{ upload_handle: string; etag?: string }> {
        const plan = uploadPlan(planValue); blob(file, 'upload file', Infinity);
        options.abortSignal?.throwIfAborted();
        const response = await fetcher(plan.url, { method: 'PUT', headers: plan.required_headers, body: file, signal: options.abortSignal, redirect: 'manual', credentials: 'omit' });
        try {
          options.abortSignal?.throwIfAborted();
          if (!response.ok || response.redirected || (response.url && response.url !== plan.url)) {
            throw new APICallError({ message: 'Viggle signed upload failed', url: plan.url, requestBodyValues: undefined,
              statusCode: response.status, responseHeaders: Object.fromEntries(response.headers), isRetryable: false });
          }
          const etag = response.headers.get('etag');
          return { upload_handle: plan.upload_handle, ...(etag === null ? {} : { etag }) };
        } finally {
          try { await response.body?.cancel(); } catch { /* Cleanup cannot undo an accepted upload or replace its error. */ }
        }
      },
      events: (id: string, options?: T.ViggleRenderEventsOptions) => renderEvents(client, id, options),
      async download(id: string, options?: T.ViggleRequestOptions): Promise<{ url: string; response: AssetResponse }> {
        const response = await client.raw(`${path('renders', id)}/download`, options, { redirect: 'manual' });
        try {
          if (response.status !== 302) throw new TypeError('Viggle render download must return HTTP 302');
          const location = url(response.headers.get('location'), 'download Location');
          return { url: location, response: { headers: Object.fromEntries(response.headers) } };
        } finally {
          try { await response.body?.cancel(); } catch { /* Preserve the redirect result or original protocol error. */ }
        }
      },
    },
    credits: {
      async get(options?: T.ViggleRequestOptions): Promise<JSONObject & { balance: number }> {
        const response = await client.request('credits', 'GET', options);
        return decodeResponse(response, value => {
          const balance = jsonObject(value, 'Viggle credits'); bounded(balance.balance, 'balance', 0);
          return balance as JSONObject & { balance: number };
        });
      },
    },
  };
}
