import type { JSONObject } from '@sinestack/ai-provider';
import { httpURL, record } from '@sinestack/ai-provider-utils';

export function resourceId(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,255}$/.test(value)) throw new TypeError('Invalid World Labs resource ID');
  return value;
}
export function text(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${label} must be a nonempty string`);
}
function optionalText(value: unknown, label: string): void {
  if (value != null && typeof value !== 'string') throw new TypeError(`${label} must be a string`);
}
function boolean(value: unknown, label: string): void {
  if (value != null && typeof value !== 'boolean') throw new TypeError(`${label} must be a boolean`);
}
function seed(value: unknown): void {
  if (value != null && (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 4294967295)) throw new TypeError('seed must be an unsigned 32-bit integer');
}
export function mediaReference(value: unknown): void {
  const ref = record(value, 'World Labs media reference');
  switch (ref.source) {
    case 'uri': httpURL(ref.uri, 'World Labs media URI'); break;
    case 'media_asset': resourceId(ref.media_asset_id); break;
    case 'data_base64': text(ref.data_base64, 'data_base64'); optionalText(ref.extension, 'extension'); break;
    default: throw new TypeError('Media source must be uri, media_asset, or data_base64');
  }
  const field = ref.source === 'uri' ? 'uri' : ref.source === 'media_asset' ? 'media_asset_id' : 'data_base64';
  for (const key of ['uri', 'media_asset_id', 'data_base64']) {
    if (key !== field && ref[key] !== undefined) throw new TypeError('Media reference must specify only one source');
  }
}
export function validateWorldInput(body: JSONObject): void {
  const prompt = record(body.world_prompt, 'world_prompt');
  optionalText(prompt.text_prompt, 'text_prompt');
  boolean(prompt.disable_recaption, 'disable_recaption');
  switch (prompt.type) {
    case 'text': text(prompt.text_prompt, 'text_prompt'); break;
    case 'image':
      mediaReference(prompt.image_prompt);
      if (prompt.is_pano !== undefined && prompt.is_pano !== 'auto' && typeof prompt.is_pano !== 'boolean') throw new TypeError('is_pano must be auto or a boolean');
      break;
    case 'multi-image': {
      boolean(prompt.reconstruct_images, 'reconstruct_images');
      const images = prompt.multi_image_prompt;
      const max = prompt.reconstruct_images === true ? 8 : 4;
      if (!Array.isArray(images) || images.length < 1 || images.length > max) throw new TypeError(`multi_image_prompt requires 1 to ${max} images`);
      for (const image of images) {
        const item = record(image, 'multi_image_prompt item');
        mediaReference(item.content);
        if (item.azimuth != null && (typeof item.azimuth !== 'number' || !Number.isFinite(item.azimuth))) throw new TypeError('azimuth must be finite');
      }
      break;
    }
    case 'video': mediaReference(prompt.video_prompt); break;
    default: throw new TypeError('world_prompt.type must be text, image, multi-image, or video');
  }
  if (prompt.disable_recaption === true) text(prompt.text_prompt, 'text_prompt with disable_recaption');
  optionalText(body.display_name, 'display_name');
  if (typeof body.display_name === 'string' && [...body.display_name].length > 64) throw new TypeError('display_name exceeds 64 characters');
  seed(body.seed);
  if (body.tags != null && (!Array.isArray(body.tags) || body.tags.length > 10 || !body.tags.every(tag => typeof tag === 'string' && [...tag].length <= 32))) throw new TypeError('tags requires at most 10 strings of at most 32 characters');
  if (body.permission !== undefined) {
    const permission = record(body.permission, 'permission');
    boolean(permission.public, 'permission.public'); boolean(permission.allow_id_access, 'permission.allow_id_access');
    for (const key of ['allowed_readers', 'allowed_writers']) {
      if (permission[key] !== undefined && (!Array.isArray(permission[key]) || !(permission[key] as unknown[]).every(item => typeof item === 'string'))) throw new TypeError(`${key} must be an array of strings`);
    }
  }
}
export function validateDepthInput(body: JSONObject): void {
  mediaReference(body.depth_pano_image);
  text(body.text_prompt, 'text_prompt'); seed(body.seed);
  const min = body.z_min; const max = body.z_max;
  if (min != null || max != null) {
    if (typeof min !== 'number' || typeof max !== 'number' || !Number.isFinite(min) || !Number.isFinite(max) || min <= 0 || max <= min) throw new TypeError('z_min and z_max must be positive with z_max greater than z_min');
  }
  const ref = record(body.depth_pano_image, 'depth_pano_image');
  const extension = ref.source === 'uri' ? new URL(ref.uri as string).pathname.split('.').pop()?.toLowerCase() : typeof ref.extension === 'string' ? ref.extension.toLowerCase() : undefined;
  if (extension === 'png' && (min == null || max == null)) throw new TypeError('PNG depth maps require z_min and z_max');
  if (extension === 'exr' && (min != null || max != null)) throw new TypeError('EXR depth maps must omit z_min and z_max');
}
export function validateExportInput(body: JSONObject, kind: 'splat' | 'mesh'): void {
  resourceId(body.world_id);
  if (kind === 'splat' && body.resolution !== undefined && !['full_res', '500k', '150k', '100k'].includes(body.resolution as string)) throw new TypeError('Invalid splat resolution');
  if (kind === 'mesh' && body.mesh_variant !== undefined && !['textured', 'vertex_colored'].includes(body.mesh_variant as string)) throw new TypeError('Invalid mesh_variant');
}
