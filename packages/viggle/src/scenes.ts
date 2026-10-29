import type { JSONObject } from '@sinestack/ai-provider';
import { httpURL, jsonObject } from '@sinestack/ai-provider-utils';
import type { ViggleClient } from './client.js';
import { ViggleTaskDriver } from './driver.js';
import type { ViggleRequestOptions } from './types.js';
import { decodeResource, parseViggleResource, resourceChoice, resourceFile, resourceInput, resourceNumber, resourceOneOf, resourceString, viggleResourceId } from './character-motion.js';
import type * as T from './resource-types.js';

const MIB = 1024 * 1024;
const BATCH_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

function session(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/u.test(value)) throw new TypeError('Invalid scene sessionId');
}
function noFields(input: Record<string, unknown>, fields: readonly string[]): void {
  const supplied = fields.filter(field => input[field] !== undefined);
  if (supplied.length) throw new TypeError(`These fields do not belong to this scene operation: ${supplied.join(', ')}`);
}
function matrix(value: unknown, field: string, rigid = false): asserts value is T.ViggleMatrix4 {
  if (!Array.isArray(value) || value.length !== 4 || value.some(row => !Array.isArray(row) || row.length !== 4 || row.some(cell => typeof cell !== 'number' || !Number.isFinite(cell)))) throw new TypeError(`${field} must be a finite 4x4 matrix`);
  if (value[3].some((cell: number, index: number) => cell !== (index === 3 ? 1 : 0))) throw new TypeError(`${field} must have last row [0,0,0,1]`);
  if (!rigid) return;
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
    let dot = 0;
    for (let k = 0; k < 3; k++) dot += value[i][k] * value[j][k];
    if (Math.abs(dot - (i === j ? 1 : 0)) > 1e-4) throw new TypeError(`${field} rotation must be orthonormal`);
  }
  const r = value;
  const determinant = r[0][0] * (r[1][1] * r[2][2] - r[1][2] * r[2][1]) -
    r[0][1] * (r[1][0] * r[2][2] - r[1][2] * r[2][0]) +
    r[0][2] * (r[1][0] * r[2][1] - r[1][1] * r[2][0]);
  if (Math.abs(determinant - 1) > 1e-4) throw new TypeError(`${field} must use a proper rotation without mirroring`);
}
function batches(value: unknown): void {
  if (!Array.isArray(value) || value.length < 1 || value.length > 35 || value.some(id => typeof id !== 'string' || !BATCH_ID.test(id)) || new Set(value).size !== value.length) throw new TypeError('referenceBatchIds must contain 1–35 distinct lowercase UUIDs from this scene session');
}
function sceneTransportBody(client: ViggleClient, input: Record<string, unknown>): JSONObject | FormData {
  const hasFiles = Object.values(input).some(value => value instanceof Blob || (Array.isArray(value) && value.some(item => item instanceof Blob)));
  if (!hasFiles) return jsonObject(input, 'Viggle scene input');
  // Scene arrays/matrices are JSON-valued form fields; only image files repeat.
  const formInput = Object.fromEntries(Object.entries(input).map(([key, value]) => [key,
    Array.isArray(value) && key !== 'referenceImageFiles' ? JSON.stringify(value) : value]));
  return client.form(formInput);
}
export function sceneCreateBody(client: ViggleClient, value: unknown): JSONObject | FormData {
  const input = resourceInput(value); session(input.sessionId);
  const source = resourceOneOf(input, ['prompt', 'panoramaUri', 'panorama']);
  if (source === 'prompt') {
    resourceString(input.prompt, 'prompt', 1000);
    resourceChoice(input.quality, 'quality', ['low', 'medium', 'high']);
    if (input.referenceImages !== undefined && input.referenceImageFiles !== undefined) throw new TypeError('Use referenceImages or referenceImageFiles, not both');
    if (input.referenceImages !== undefined) {
      if (!Array.isArray(input.referenceImages) || input.referenceImages.length > 8) throw new TypeError('referenceImages accepts at most 8 URLs');
      for (const reference of input.referenceImages) httpURL(reference, 'referenceImages');
    }
    if (input.referenceImageFiles !== undefined) {
      if (!Array.isArray(input.referenceImageFiles) || input.referenceImageFiles.length < 1 || input.referenceImageFiles.length > 8) throw new TypeError('referenceImageFiles accepts 1–8 files');
      for (const reference of input.referenceImageFiles) resourceFile(reference, 'referenceImageFiles', 10 * MIB);
    }
  } else {
    noFields(input, ['quality', 'referenceImages', 'referenceImageFiles']);
    if (source === 'panorama') resourceFile(input.panorama, 'panorama', 50 * MIB);
    else httpURL(input.panoramaUri, 'panoramaUri');
  }
  return sceneTransportBody(client, input);
}
export function sceneCustomPanoramaBody(client: ViggleClient, value: unknown): JSONObject | FormData {
  const input = resourceInput(value); session(input.sessionId);
  const source = resourceOneOf(input, ['panoramaUri', 'panorama']);
  if (source === 'panorama') resourceFile(input.panorama, 'panorama', 50 * MIB);
  else httpURL(input.panoramaUri, 'panoramaUri');
  noFields(input, ['prompt', 'referenceImages', 'referenceImageFiles', 'quality']);
  matrix(input.panoramaC2w, 'panoramaC2w', true);
  const scale = input.metersPerUnit === undefined ? 1 : input.metersPerUnit;
  resourceNumber(scale, 'metersPerUnit', 0.05);
  const translation = Math.max(...input.panoramaC2w.slice(0, 3).map(row => Math.abs(row[3])));
  if (translation + 25 * scale >= 4000) throw new TypeError('The custom scene exceeds the SPZ coordinate range');
  return sceneTransportBody(client, input);
}
export function sceneGenerateBody(value: unknown): JSONObject {
  const input = jsonObject(value, 'Viggle scene generation input'); session(input.sessionId); batches(input.referenceBatchIds);
  const target = resourceOneOf(input, ['targetC2w', 'targetPosition']);
  if (target === 'targetC2w') matrix(input.targetC2w, 'targetC2w');
  else {
    const position = jsonObject(input.targetPosition, 'targetPosition');
    if (Object.keys(position).some(field => !['position', 'yaw', 'pitch'].includes(field))) throw new TypeError('Unknown targetPosition field');
    if (!Array.isArray(position.position) || position.position.length !== 3) throw new TypeError('targetPosition.position must have 3 coordinates');
    position.position.forEach(value => resourceNumber(value, 'targetPosition.position', -Infinity));
    if (position.yaw != null) resourceNumber(position.yaw, 'yaw', -Infinity);
    if (position.pitch != null) resourceNumber(position.pitch, 'pitch', -90, 90);
  }
  resourceChoice(input.projection, 'projection', ['perspective', 'pano']);
  if (input.fov !== undefined) resourceNumber(input.fov, 'fov', 20, 140);
  if (input.seed !== undefined) resourceNumber(input.seed, 'seed', 0, 4294967295, true);
  return input;
}
export function sceneReconstructBody(value: unknown): JSONObject {
  const input = jsonObject(value, 'Viggle scene reconstruction input'); session(input.sessionId); batches(input.referenceBatchIds);
  noFields(input, ['targetC2w', 'targetPosition', 'projection', 'fov', 'seed']);
  return input;
}

export function parseViggleSceneTask(value: unknown, expectedId?: string, expectedOperation?: T.ViggleSceneTask['operation'], expectedSession?: string): T.ViggleSceneTask {
  const task = parseViggleResource(value, 'scn_', expectedId); session(task.sessionId);
  resourceString(task.operation, 'scene operation'); resourceChoice(task.operation, 'scene operation', ['pano', 'generate', 'reconstruct']);
  if (expectedOperation !== undefined && task.operation !== expectedOperation) throw new TypeError('Viggle returned a different scene operation');
  if (expectedSession !== undefined && task.sessionId !== expectedSession) throw new TypeError('Viggle returned a different scene session');
  for (const field of ['createdAt', 'completedAt', 'credits']) if (task[field] != null) resourceNumber(task[field], field, 0);
  if (task.queuePosition != null) resourceNumber(task.queuePosition, 'queuePosition', 0, Infinity, true);
  if (task.result != null) {
    const result = jsonObject(task.result, 'Viggle scene result');
    if (result.operation !== task.operation || result.sessionId !== task.sessionId) throw new TypeError('Scene result belongs to a different operation or session');
    for (const field of ['spz', 'preview', 'panorama']) if (result[field] != null) {
      const file = jsonObject(result[field], `scene ${field}`); httpURL(file.url, `scene ${field} URL`);
    }
    for (const field of ['referenceViewCount', 'newViewCount']) if (result[field] != null) resourceNumber(result[field], field, 0, Infinity, true);
    if (result.outputBatch != null) {
      const batch = jsonObject(result.outputBatch, 'scene output batch');
      if (typeof batch.batchId !== 'string' || !BATCH_ID.test(batch.batchId)) throw new TypeError('Invalid scene batch ID');
      httpURL(jsonObject(batch.manifest, 'scene batch manifest').url, 'scene batch manifest URL');
      resourceChoice(batch.kind, 'scene batch kind', ['initial', 'generated']);
      if (batch.createdAt != null) resourceNumber(batch.createdAt, 'batch createdAt', 0);
      if (batch.views !== undefined) {
        if (!Array.isArray(batch.views)) throw new TypeError('Invalid scene batch views');
        for (const item of batch.views) {
          const view = jsonObject(item, 'scene view');
          resourceNumber(view.index, 'view index', 0, Infinity, true); httpURL(view.url, 'scene view URL'); matrix(view.c2w, 'view c2w');
          if (!Array.isArray(view.intrinsic)) throw new TypeError('Invalid scene intrinsics');
          view.intrinsic.forEach(value => resourceNumber(value, 'view intrinsic', -Infinity));
        }
      }
    }
  }
  if (task.status === 'ready' && task.result == null) throw new TypeError('Ready scene task has no result');
  return task as T.ViggleSceneTask;
}

/** Each scene stage is explicit; no automatic view generation, reconstruction, or paid chaining. */
export function createSceneCapabilities(client: ViggleClient) {
  async function submit<I>(route: string, operation: T.ViggleSceneTask['operation'], input: I, body: JSONObject | FormData, options?: ViggleRequestOptions) {
    const response = await client.request(`scenes/${route}`, 'POST', options, body);
    const sessionId = resourceInput(input).sessionId; session(sessionId);
    return { data: decodeResource(response, value => parseViggleSceneTask(value, undefined, operation, sessionId)), response: response.response, url: response.url, statusCode: response.statusCode };
  }
  async function get(id: string, options?: ViggleRequestOptions, operation?: T.ViggleSceneTask['operation'], sessionId?: string) {
    const response = await client.request(`scenes/${encodeURIComponent(viggleResourceId(id, 'scn_'))}`, 'GET', options);
    return { data: decodeResource(response, value => parseViggleSceneTask(value, id, operation, sessionId)), response: response.response, url: response.url, statusCode: response.statusCode };
  }
  const driver = <I extends T.ViggleSceneInput, D extends string>(route: string, operation: T.ViggleSceneTask['operation'], domain: D, body: (input: I) => JSONObject | FormData) =>
    new ViggleTaskDriver<I, T.ViggleSceneTask, D>(client, {
      id: `scenes.${route}`, domain, prefixes: ['scn_'],
      start: (input, options) => submit(route, operation, input, body(input), options),
      get: (id, options, handle) => get(id, options, operation, handle.sessionId),
      decode: data => parseViggleSceneTask(data, undefined, operation),
    });
  return {
    scenes: {
      async create(input: T.ViggleSceneCreateInput, options?: ViggleRequestOptions) {
        return (await submit('pano', 'pano', input, sceneCreateBody(client, input), options)).data;
      },
      async customPanorama(input: T.ViggleSceneCustomPanoramaInput, options?: ViggleRequestOptions) {
        return (await submit('custom-pano', 'pano', input, sceneCustomPanoramaBody(client, input), options)).data;
      },
      async generateViews(input: T.ViggleSceneGenerateInput, options?: ViggleRequestOptions) {
        return (await submit('generate', 'generate', input, sceneGenerateBody(input), options)).data;
      },
      async reconstruct(input: T.ViggleSceneReconstructInput, options?: ViggleRequestOptions) {
        return (await submit('reconstruct', 'reconstruct', input, sceneReconstructBody(input), options)).data;
      },
      async get(id: string, options?: ViggleRequestOptions) { return (await get(id, options)).data; },
    },
    createScene: () => driver<T.ViggleSceneCreateInput, 'scene.create'>('pano', 'pano', 'scene.create', input => sceneCreateBody(client, input)),
    createSceneFromPanorama: () => driver<T.ViggleSceneCustomPanoramaInput, 'scene.create'>('custom-pano', 'pano', 'scene.create', input => sceneCustomPanoramaBody(client, input)),
    generateSceneViews: () => driver<T.ViggleSceneGenerateInput, 'scene.generate-views'>('generate', 'generate', 'scene.generate-views', sceneGenerateBody),
    reconstructScene: () => driver<T.ViggleSceneReconstructInput, 'scene.reconstruct'>('reconstruct', 'reconstruct', 'scene.reconstruct', sceneReconstructBody),
  };
}
