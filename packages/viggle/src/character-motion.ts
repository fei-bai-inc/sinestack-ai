import type { AssetModelV1Result, JSONObject } from '@sinestack/ai-provider';
import { httpURL, invalidResponse, jsonObject } from '@sinestack/ai-provider-utils';
import type { AssetProviderResponse } from '@sinestack/ai-provider-utils';
import type { ViggleClient } from './client.js';
import type { ViggleRequestOptions } from './types.js';
import { ViggleAssetModel, ViggleTaskDriver } from './driver.js';
import { bounded, choice, inputObject, nonempty } from './validation.js';
import type * as T from './resource-types.js';

const statuses = new Set(['queued', 'processing', 'ready', 'failed', 'cancelled']);

/** Resource identifiers remain opaque, but must never change the authenticated request path. */
export function viggleResourceId(value: unknown, prefix: 'char_' | 'mot_' | 'scn_'): string {
  if (typeof value !== 'string' || !value.startsWith(prefix) || value.length === prefix.length || /[\/\\?#%\s\u0000-\u001f]/u.test(value)) {
    throw new TypeError(`Expected a complete ${prefix} resource ID`);
  }
  return value;
}
export function decodeResource<T>(response: AssetProviderResponse, decode: (value: unknown) => T): T {
  try { return decode(response.value); }
  catch (cause) { throw invalidResponse(response, cause, 'Viggle'); }
}
export function resourceInput(value: unknown): Record<string, unknown> {
  return inputObject(value, 'Viggle resource input');
}
export function resourceString(value: unknown, field: string, max = Infinity): asserts value is string {
  nonempty(value, field);
  if (value.length > max) throw new TypeError(`Invalid ${field}`);
}
export function resourceNumber(value: unknown, field: string, min: number, max = Infinity, integer = false): asserts value is number {
  bounded(value, field, min, max, integer);
}
export function resourceChoice(value: unknown, field: string, choices: readonly string[]): void {
  choice(value, field, choices);
}
export function resourceBoolean(value: unknown, field: string): void {
  if (value !== undefined && typeof value !== 'boolean') throw new TypeError(`Invalid ${field}`);
}
export function resourceOneOf(input: Record<string, unknown>, fields: readonly string[]): string {
  const supplied = fields.filter(field => input[field] !== undefined);
  if (supplied.length !== 1) throw new TypeError(`Supply exactly one of ${fields.join(', ')}`);
  return supplied[0]!;
}
export function resourceFile(value: unknown, field: string, maxBytes = Infinity): asserts value is Blob {
  if (!(value instanceof Blob) || value.size === 0 || value.size > maxBytes) throw new TypeError(`Invalid ${field} file`);
}
function optionalStrings(input: Record<string, unknown>, fields: readonly string[]): void {
  for (const field of fields) if (input[field] !== undefined) resourceString(input[field], field);
}
function source(input: Record<string, unknown>, fields: readonly string[], fileField: string): void {
  const field = resourceOneOf(input, fields);
  if (field === fileField) resourceFile(input[field], field);
  else { resourceString(input[field], field); httpURL(input[field], field); }
}
function parseExtraction(value: unknown): void {
  if (value == null) return;
  const extraction = jsonObject(value, 'Viggle extraction');
  if (!statuses.has(String(extraction.status))) throw new TypeError('Unknown Viggle extraction status');
  if (extraction.error != null) jsonObject(extraction.error, 'Viggle extraction error');
  if (extraction.skeletons != null && (!Array.isArray(extraction.skeletons) || !extraction.skeletons.every(item => typeof item === 'string'))) throw new TypeError('Invalid Viggle skeletons');
}
export function parseViggleResource(value: unknown, prefix: 'char_' | 'mot_' | 'scn_', expectedId?: string): JSONObject {
  const record = jsonObject(value, 'Viggle resource');
  const id = viggleResourceId(record.id, prefix);
  if (expectedId !== undefined && id !== expectedId) throw new TypeError('Viggle resource identity mismatch');
  if (!statuses.has(String(record.status))) throw new TypeError('Unknown Viggle resource status');
  if (record.progress != null) resourceNumber(record.progress, 'progress', 0, 100);
  if (record.error != null) jsonObject(record.error, 'Viggle resource error');
  if (record.capabilities != null && (!Array.isArray(record.capabilities) || !record.capabilities.every(item => typeof item === 'string'))) throw new TypeError('Invalid Viggle capabilities');
  for (const field of ['created_at', 'completed_at', 'updated_at']) if (record[field] != null && typeof record[field] !== 'string') throw new TypeError(`Invalid ${field}`);
  parseExtraction(record.vsplat); parseExtraction(record.glb);
  return record;
}
export function parseViggleCharacter(value: unknown, expectedId?: string): T.ViggleCharacter {
  const record = parseViggleResource(value, 'char_', expectedId);
  resourceChoice(record.type, 'Character type', ['render', 'vsplat', 'all']);
  return record as T.ViggleCharacter;
}
export function parseViggleMotion(value: unknown, expectedId?: string): T.ViggleMotion {
  const record = parseViggleResource(value, 'mot_', expectedId);
  resourceChoice(record.type, 'Motion type', ['render', 'glb', 'all']);
  return record as T.ViggleMotion;
}

export function characterBody(client: ViggleClient, value: unknown): FormData {
  const input = resourceInput(value);
  resourceChoice(input.type, 'Character type', ['render', 'vsplat', 'all']);
  const textOnly = input.type === 'vsplat' && input.enhance_prompt !== undefined &&
    ['image', 'image_url', 'ref_url'].every(field => input[field] === undefined);
  if (!textOnly) source(input, ['image', 'image_url', 'ref_url'], 'image');
  if (input.enhance_prompt !== undefined) {
    resourceString(input.enhance_prompt, 'enhance_prompt', 1000);
    if (!['vsplat', 'all'].includes(String(input.type)) || input.enhance === false) throw new TypeError('enhance_prompt requires enhanced vsplat extraction');
  }
  optionalStrings(input, ['model', 'task_id']);
  if (input.name !== undefined && typeof input.name !== 'string') throw new TypeError('Invalid name');
  for (const field of ['enhance', 'filter_low_quality', 'use_sparse_W', 'render_thumbnail']) resourceBoolean(input[field], field);
  resourceChoice(input.variant, 'variant', ['optimized', 'original']);
  resourceChoice(input.prune_preset, 'prune_preset', ['geometric', 'draft', 'balanced', 'quality', 'compact', 'compact_hq']);
  resourceChoice(input.joint_set, 'joint_set', ['body', 'expression', 'full']);
  for (const field of ['quality', 'model_precision']) if (input[field] !== undefined) {
    resourceNumber(input[field], field, Number.MIN_VALUE, 1);
  }
  if (input.prune_budget !== undefined) resourceNumber(input.prune_budget, 'prune_budget', Number.MIN_VALUE);
  if (input.scale_parts !== undefined) {
    if (input.joint_set !== 'full') throw new TypeError('scale_parts requires joint_set=full');
    let scale: unknown = input.scale_parts;
    if (typeof scale === 'string') { try { scale = JSON.parse(scale); } catch { throw new TypeError('scale_parts must be a JSON object'); } }
    const factors = jsonObject(scale, 'scale_parts');
    for (const [field, value] of Object.entries(factors)) resourceNumber(value, `scale_parts.${field}`, -Infinity);
  }
  return client.form(input);
}
export function motionVideoBody(client: ViggleClient, value: unknown): FormData {
  const input = resourceInput(value);
  source(input, ['motion_video', 'motion_video_url', 'video_url'], 'motion_video');
  resourceChoice(input.type, 'Motion type', ['render', 'glb', 'all']);
  optionalStrings(input, ['model', 'task_id', 'thumbnail_path', 'thumbnail_url']);
  if (input.name !== undefined && typeof input.name !== 'string') throw new TypeError('Invalid name');
  if (input.thumbnail_path !== undefined && input.thumbnail_url !== undefined) throw new TypeError('Supply only one thumbnail field');
  for (const field of ['enable_smoothing', 'apply_std_joints']) resourceBoolean(input[field], field);
  if (input.target_fps !== undefined) resourceNumber(input.target_fps, 'target_fps', Number.MIN_VALUE);
  if (input.smooth_velocity_threshold !== undefined) resourceNumber(input.smooth_velocity_threshold, 'smooth_velocity_threshold', 0);
  return client.form(input);
}
export function motionTextBody(value: unknown): JSONObject {
  const input = jsonObject(value, 'Viggle text motion input');
  resourceString(input.text, 'text', 400);
  if (input.duration_seconds !== undefined) resourceNumber(input.duration_seconds, 'duration_seconds', 3, 60);
  if (input.guidance_scale !== undefined) resourceNumber(input.guidance_scale, 'guidance_scale', 0, 30);
  resourceBoolean(input.smooth, 'smooth');
  optionalStrings(input, ['task_id']);
  if (input.name !== undefined && typeof input.name !== 'string') throw new TypeError('Invalid name');
  return input;
}
export function motionImportBody(value: unknown): JSONObject {
  const input = jsonObject(value, 'Viggle import motion input');
  const field = resourceOneOf(input, ['template_id', 'template_uuid']);
  resourceString(input[field], field);
  optionalStrings(input, ['model']);
  if (input.name !== undefined && typeof input.name !== 'string') throw new TypeError('Invalid name');
  return input;
}
function validateDownloadURLs(record: JSONObject, fields: readonly string[]): void {
  for (const field of fields) if (record[field] != null) { resourceString(record[field], field); httpURL(record[field], field); }
}
export function parseViggleCharacterExport(value: unknown, id?: string): T.ViggleCharacterExport {
  const record = parseViggleResource(value, 'char_', id);
  if (record.download_type != null) resourceChoice(record.download_type, 'download_type', ['vsplat']);
  validateDownloadURLs(record, ['vsplat_url', 'thumbnail_url']);
  return record as T.ViggleCharacterExport;
}
export function parseViggleMotionExport(value: unknown, id?: string): T.ViggleMotionExport {
  const record = parseViggleResource(value, 'mot_', id);
  if (record.download_type != null) resourceChoice(record.download_type, 'download_type', ['glb', 'fbx']);
  validateDownloadURLs(record, ['mixamo_url', 'metahuman_url', 'metahuman_body_url']);
  return record as T.ViggleMotionExport;
}
export function motionAssets(record: T.ViggleMotionExport, format: T.ViggleMotionExportFormat): AssetModelV1Result {
  if (record.download_type != null && record.download_type !== format) throw new TypeError('Viggle returned a different export format');
  const rigs = [['mixamo', 50], ['metahuman', 441], ['metahuman_body', 86]] as const;
  const assets = rigs.flatMap(([rig, joints]) => {
    const url = record[`${rig}_url`];
    return typeof url === 'string' ? [{ type: 'url' as const, url,
      mediaType: format === 'glb' ? 'model/gltf-binary' : 'application/octet-stream',
      filename: `${record.id}-${rig}.${format}`, role: 'animation', metadata: { rig, joints, format, representation: 'skeletal-animation' } }] : [];
  });
  if (!assets.length) throw new TypeError('Viggle motion export is ready but has no animation files');
  return { assets, providerMetadata: { viggle: { output: record } } };
}

/** Resource access is direct and never creates a task, polls, or performs a hidden export. */
export function characterMotionResources(client: ViggleClient) {
  const path = (family: 'characters' | 'motions', id: string) => `${family}/${encodeURIComponent(viggleResourceId(id, family === 'characters' ? 'char_' : 'mot_'))}`;
  async function remove(family: 'characters' | 'motions', id: string, options?: ViggleRequestOptions): Promise<T.ViggleDeleteAcknowledgement> {
    const response = await client.request(path(family, id), 'DELETE', options);
    return decodeResource(response, value => {
      const result = jsonObject(value, 'Viggle deletion');
      if (result.status !== 'deleted') throw new TypeError('Viggle did not acknowledge deletion');
      return result as T.ViggleDeleteAcknowledgement;
    });
  }
  return {
    characters: {
      async create(input: T.ViggleCharacterInput, options?: ViggleRequestOptions): Promise<T.ViggleCharacter> {
        const response = await client.request('characters', 'POST', options, characterBody(client, input));
        return decodeResource(response, value => parseViggleCharacter(value));
      },
      async get(id: string, options?: ViggleRequestOptions): Promise<T.ViggleCharacter> {
        const response = await client.request(path('characters', id), 'GET', options);
        return decodeResource(response, value => parseViggleCharacter(value, id));
      },
      async list(options?: ViggleRequestOptions): Promise<T.ViggleResourceList<T.ViggleCharacter>> {
        const response = await client.request('characters', 'GET', options);
        return decodeResource(response, value => {
          const page = jsonObject(value, 'Viggle character list');
          if (!Array.isArray(page.data)) throw new TypeError('Expected character data array');
          return { ...page, data: page.data.map(item => parseViggleCharacter(item)) };
        });
      },
      delete: (id: string, options?: ViggleRequestOptions) => remove('characters', id, options),
      async export(id: string, downloadType?: 'vsplat', options?: ViggleRequestOptions): Promise<T.ViggleCharacterExport> {
        resourceChoice(downloadType, 'download_type', ['vsplat']);
        const response = await client.request(`${path('characters', id)}/export${downloadType === undefined ? '' : '?download_type=vsplat'}`, 'GET', options);
        return decodeResource(response, value => parseViggleCharacterExport(value, id));
      },
    },
    motions: {
      async createFromVideo(input: T.ViggleMotionVideoInput, options?: ViggleRequestOptions): Promise<T.ViggleMotion> {
        const response = await client.request('motions', 'POST', options, motionVideoBody(client, input));
        return decodeResource(response, value => parseViggleMotion(value));
      },
      async createFromText(input: T.ViggleMotionTextInput, options?: ViggleRequestOptions): Promise<T.ViggleMotion> {
        const response = await client.request('motions', 'POST', options, motionTextBody(input));
        return decodeResource(response, value => parseViggleMotion(value));
      },
      async import(input: T.ViggleMotionImportInput, options?: ViggleRequestOptions): Promise<T.ViggleMotion> {
        const response = await client.request('motions/import', 'POST', options, motionImportBody(input));
        return decodeResource(response, value => parseViggleMotion(value));
      },
      async get(id: string, options?: ViggleRequestOptions): Promise<T.ViggleMotion> {
        const response = await client.request(path('motions', id), 'GET', options);
        return decodeResource(response, value => parseViggleMotion(value, id));
      },
      async list(options?: ViggleRequestOptions): Promise<T.ViggleResourceList<T.ViggleMotion>> {
        const response = await client.request('motions', 'GET', options);
        return decodeResource(response, value => {
          const page = jsonObject(value, 'Viggle motion list');
          if (!Array.isArray(page.data)) throw new TypeError('Expected motion data array');
          return { ...page, data: page.data.map(item => parseViggleMotion(item)) };
        });
      },
      delete: (id: string, options?: ViggleRequestOptions) => remove('motions', id, options),
      async export(id: string, downloadType?: T.ViggleMotionExportFormat, options?: ViggleRequestOptions): Promise<T.ViggleMotionExport> {
        resourceChoice(downloadType, 'download_type', ['glb', 'fbx']);
        const response = await client.request(`${path('motions', id)}/export${downloadType === undefined ? '' : `?download_type=${downloadType}`}`, 'GET', options);
        return decodeResource(response, value => parseViggleMotionExport(value, id));
      },
    },
  };
}

/** Distinct semantic factories compose the shared task protocol, never another polling loop. */
export function createCharacterMotionCapabilities(client: ViggleClient) {
  const resources = characterMotionResources(client);
  const characterDriver = () => new ViggleTaskDriver<T.ViggleCharacterInput, T.ViggleCharacter, 'character.create'>(client, {
    id: 'characters.create', domain: 'character.create', prefixes: ['char_'],
    async start(input, options) {
      const response = await client.request('characters', 'POST', options, characterBody(client, input));
      return { data: decodeResource(response, value => parseViggleCharacter(value)), response: response.response, url: response.url, statusCode: response.statusCode };
    },
    async get(id, options) {
      const response = await client.request(`characters/${encodeURIComponent(viggleResourceId(id, 'char_'))}`, 'GET', options);
      return { data: decodeResource(response, value => parseViggleCharacter(value, id)), response: response.response, url: response.url, statusCode: response.statusCode };
    },
    decode: data => parseViggleCharacter(data),
  });
  const textDriver = () => new ViggleTaskDriver<T.ViggleMotionTextInput, T.ViggleMotion, 'motion.create'>(client, {
    id: 'motions.text', domain: 'motion.create', prefixes: ['mot_'], idempotentStart: true,
    async start(input, options) {
      const response = await client.request('motions', 'POST', options, motionTextBody({ ...input, task_id: input.task_id ?? options.idempotencyKey }));
      return { data: decodeResource(response, value => parseViggleMotion(value)), response: response.response, url: response.url, statusCode: response.statusCode };
    },
    async get(id, options) {
      const response = await client.request(`motions/${encodeURIComponent(viggleResourceId(id, 'mot_'))}`, 'GET', options);
      return { data: decodeResource(response, value => parseViggleMotion(value, id)), response: response.response, url: response.url, statusCode: response.statusCode };
    },
    decode: data => parseViggleMotion(data),
  });
  const videoDriver = () => new ViggleTaskDriver<T.ViggleMotionVideoInput, T.ViggleMotion, 'motion.create'>(client, {
    id: 'motions.video', domain: 'motion.create', prefixes: ['mot_'],
    async start(input, options) {
      const response = await client.request('motions', 'POST', options, motionVideoBody(client, input));
      return { data: decodeResource(response, value => parseViggleMotion(value)), response: response.response, url: response.url, statusCode: response.statusCode };
    },
    async get(id, options) {
      const response = await client.request(`motions/${encodeURIComponent(viggleResourceId(id, 'mot_'))}`, 'GET', options);
      return { data: decodeResource(response, value => parseViggleMotion(value, id)), response: response.response, url: response.url, statusCode: response.statusCode };
    },
    decode: data => parseViggleMotion(data),
  });
  const importDriver = () => new ViggleTaskDriver<T.ViggleMotionImportInput, T.ViggleMotion, 'motion.import'>(client, {
    id: 'motions.import', domain: 'motion.import', prefixes: ['mot_'],
    async start(input, options) {
      const response = await client.request('motions/import', 'POST', options, motionImportBody(input));
      return { data: decodeResource(response, value => parseViggleMotion(value)), response: response.response, url: response.url, statusCode: response.statusCode };
    },
    async get(id, options) {
      const response = await client.request(`motions/${encodeURIComponent(viggleResourceId(id, 'mot_'))}`, 'GET', options);
      return { data: decodeResource(response, value => parseViggleMotion(value, id)), response: response.response, url: response.url, statusCode: response.statusCode };
    },
    decode: data => parseViggleMotion(data),
  });
  function animationModel<I extends T.ViggleMotionTextInput | T.ViggleMotion3DVideoInput>(mode: 'text' | 'video', settings: T.ViggleMotionModelOptions = {}) {
    const format = settings.format ?? 'glb';
    resourceChoice(format, 'motion format', ['glb', 'fbx']);
    const driver = new ViggleTaskDriver<I, AssetModelV1Result, 'animation-3d'>(client, {
      id: `motions.${mode}.animation.${format}`, domain: 'animation-3d', prefixes: ['mot_'], idempotentStart: true,
      async start(input, options) {
        const native = { ...input, task_id: input.task_id ?? options.idempotencyKey };
        if (mode === 'video' && native.type !== undefined && native.type !== 'glb') throw new TypeError('Standalone animation generation requires type=glb');
        const body = mode === 'text' ? motionTextBody(native) : motionVideoBody(client, { ...native, type: 'glb' });
        const response = await client.request('motions', 'POST', options, body);
        return { data: decodeResource(response, value => parseViggleMotion(value)), response: response.response, url: response.url, statusCode: response.statusCode };
      },
      async get(id, options) {
        const response = await client.request(`motions/${encodeURIComponent(viggleResourceId(id, 'mot_'))}/export?download_type=${format}`, 'GET', options);
        return { data: decodeResource(response, value => parseViggleMotionExport(value, id)), response: response.response, url: response.url, statusCode: response.statusCode };
      },
      decode: data => motionAssets(parseViggleMotionExport(data), format),
    });
    return new ViggleAssetModel(driver, 'animation-3d');
  }
  return {
    ...resources,
    createCharacter: characterDriver,
    createMotionFromText: textDriver,
    createMotionFromVideo: videoDriver,
    importMotion: importDriver,
    textToMotion: (settings?: T.ViggleMotionModelOptions) => animationModel<T.ViggleMotionTextInput>('text', settings),
    videoToMotion: (settings?: T.ViggleMotionModelOptions) => animationModel<T.ViggleMotion3DVideoInput>('video', settings),
  };
}
