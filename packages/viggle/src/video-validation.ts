import { jsonObject } from '@sinestack/ai-provider-utils';
import type { JSONObject } from '@sinestack/ai-provider';
import { blob, bounded, choice, exactlyOne, inputObject, noFields, nonempty, opaqueId, present, seed, url, values } from './validation.js';

const MIB = 1024 * 1024;
const frameFields = ['first_frame_image', 'first_frame_image_url', 'last_frame_image', 'last_frame_image_url'];
const referenceFields = ['reference_video', 'reference_video_url', 'reference_image', 'reference_image_url'];
const animateFields = ['driving_video', 'driving_video_url', 'character_image', 'character_image_url', 'character_image_urls', 'enhance_mode'];
export type H3Mode = 'text' | 'first-frame' | 'first-last-frame' | 'reference';

function booleans(input: Record<string, unknown>, fields: readonly string[]): void {
  for (const field of fields) if (input[field] !== undefined && typeof input[field] !== 'boolean') throw new TypeError(`${field} must be boolean`);
}
function filesAndURLs(input: Record<string, unknown>, fileField: string, urlField: string, maxBytes: number, httpsOnly = false): number {
  const files = values(input[fileField]); const urls = values(input[urlField]);
  for (const file of files) blob(file, fileField, maxBytes);
  for (const item of urls) url(item, urlField, httpsOnly);
  return files.length + urls.length;
}
function singleSource(input: Record<string, unknown>, fileField: string, urlField: string, maxBytes: number, httpsOnly = false): void {
  const field = exactlyOne(input, [fileField, urlField]);
  if (field === fileField) blob(input[field], field, maxBytes); else url(input[field], field, httpsOnly);
}
export function h3Input(value: unknown, mode: H3Mode): Record<string, unknown> {
  const input = inputObject(value);
  nonempty(input.prompt, 'prompt');
  if (!present(input, 'quality')) throw new TypeError('H3 requires quality');
  choice(input.quality, 'quality', ['low', 'high']);
  noFields(input, animateFields, 'H3 generation');
  if (input.duration_s !== undefined) bounded(input.duration_s, 'duration_s', 5, 15);
  choice(input.resolution, 'resolution', ['480p', '768p', '1080p', '2k', '4k']);
  choice(input.aspect_ratio, 'aspect_ratio', ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9']);
  choice(input.priority, 'priority', [0, 1000]); seed(input.seed);
  booleans(input, ['watermark', 'enhance']);
  if (mode === 'reference') {
    noFields(input, frameFields, 'Reference video');
    const videos = filesAndURLs(input, 'reference_video', 'reference_video_url', 100 * MIB);
    const images = filesAndURLs(input, 'reference_image', 'reference_image_url', 20 * MIB);
    if (videos > 1 || images > 4 || videos + images === 0) throw new TypeError('Reference generation requires 1–5 references, at most 1 video and 4 images');
  } else {
    noFields(input, referenceFields, 'Frame/text generation');
    if (mode === 'text') noFields(input, frameFields, 'Text-to-video');
    else {
      singleSource(input, 'first_frame_image', 'first_frame_image_url', 20 * MIB);
      if (mode === 'first-last-frame') singleSource(input, 'last_frame_image', 'last_frame_image_url', 20 * MIB);
      else noFields(input, ['last_frame_image', 'last_frame_image_url'], 'First-frame generation');
    }
  }
  return input;
}
export function animationInput(value: unknown): Record<string, unknown> {
  const input = inputObject(value);
  noFields(input, [...frameFields, ...referenceFields, 'quality', 'duration_s', 'resolution', 'aspect_ratio', 'seed', 'enhance'], 'Character animation');
  singleSource(input, 'driving_video', 'driving_video_url', 100 * MIB, true);
  const field = exactlyOne(input, ['character_image', 'character_image_url', 'character_image_urls']);
  if (field === 'character_image_urls' && !Array.isArray(input[field])) throw new TypeError('character_image_urls must be an array');
  const images = values(input[field]);
  choice(input.enhance_mode, 'enhance_mode', ['planner', 'normal', 'agent']);
  const agent = input.enhance_mode === 'agent';
  if (images.length < 1 || images.length > (agent ? 10 : 3)) throw new TypeError(`Character animation accepts 1–${agent ? 10 : 3} images in this mode`);
  for (const image of images) {
    if (field === 'character_image') blob(image, field, 20 * MIB); else url(image, field, true);
  }
  if (input.prompt !== undefined) nonempty(input.prompt, 'prompt');
  if (!agent && images.length > 1) {
    nonempty(input.prompt, 'multi-character prompt');
    const prompt = input.prompt.trim();
    const segments = [...prompt.matchAll(/<Character(\d+)>([^]*?)(?=<Character\d+>|$)/gu)];
    if (!prompt.startsWith('<Character1>') || segments.length !== images.length || segments.some((part, i) => Number(part[1]) !== i + 1 || !part[2]?.trim())) {
      throw new TypeError('Multi-character planner/normal prompts require ordered <Character1>…<CharacterN> descriptions');
    }
  }
  choice(input.priority, 'priority', [0, 1000]); booleans(input, ['watermark']);
  return input;
}
export function renderInput(value: unknown): Record<string, unknown> {
  const input = inputObject(value);
  const character = exactlyOne(input, ['image', 'image_url', 'character_id']);
  if (character === 'image') blob(input.image, 'image', Infinity);
  else if (character === 'image_url') url(input.image_url, 'image_url');
  else opaqueId(input.character_id, ['char_']);
  const motion = exactlyOne(input, ['motion_video', 'motion_video_url', 'motion_id']);
  if (motion === 'motion_video') blob(input.motion_video, 'motion_video', Infinity);
  else if (motion === 'motion_video_url') url(input.motion_video_url, 'motion_video_url');
  else opaqueId(input.motion_id, ['mot_']);
  for (const field of ['model', 'mode']) if (input[field] !== undefined) nonempty(input[field], field);
  choice(input.background_mode, 'background_mode', ['original', 'solid', 'transparent', 'inpaint']);
  choice(input.aspect_ratio, 'aspect_ratio', ['source']);
  if (input.bg_color !== undefined) {
    if (input.background_mode !== 'solid') throw new TypeError('bg_color requires background_mode=solid');
    if (typeof input.bg_color !== 'string' || !/^\d{1,3},\d{1,3},\d{1,3}$/u.test(input.bg_color) || input.bg_color.split(',').some(channel => Number(channel) > 255)) throw new TypeError('bg_color must be R,G,B with channels 0–255');
  }
  if (input.background_mode === 'solid' && input.bg_color === undefined) throw new TypeError('Solid Render background requires bg_color');
  if (input.background_url !== undefined) url(input.background_url, 'background_url');
  if (input.character_mapping !== undefined) {
    const mapping = typeof input.character_mapping === 'string' ? JSON.parse(input.character_mapping) as unknown : input.character_mapping;
    jsonObject(mapping, 'character_mapping');
  }
  return input;
}
export function imageInput(value: unknown): Record<string, unknown> {
  const input = inputObject(value);
  nonempty(input.prompt, 'prompt');
  if ([...input.prompt].length > 4000) throw new TypeError('Image prompt exceeds 4000 Unicode characters');
  choice(input.aspect_ratio, 'aspect_ratio', ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3']);
  choice(input.resolution, 'resolution', ['1K', '2K', '1k', '2k']);
  if (input.n !== undefined) bounded(input.n, 'n', 1, 6, true);
  if (input.seed !== undefined) bounded(input.seed, 'seed', 0, 2147483647, true);
  if (filesAndURLs(input, 'reference_image', 'reference_image_url', 24 * MIB) > 8) throw new TypeError('Image generation accepts at most 8 reference images');
  return input;
}
export function upscaleInput(value: unknown): Record<string, unknown> {
  const input = inputObject(value);
  singleSource(input, 'video', 'video_url', 100 * MIB); booleans(input, ['watermark']);
  return input;
}
export function prepareInput(value: unknown): JSONObject {
  const input = jsonObject(value, 'Viggle render preparation');
  for (const field of ['character', 'motion']) {
    const source = jsonObject(input[field], field);
    switch (source.kind) {
      case 'url': url(source.url, `${field}.url`); break;
      case 'asset': opaqueId(source.asset_id, [field === 'character' ? 'char_' : 'mot_']); break;
      case 'official_motion':
        if (field !== 'motion') throw new TypeError('Only motion supports official_motion');
        opaqueId(source.motion_id); break;
      case 'upload':
        nonempty(source.filename, 'filename'); nonempty(source.content_type, 'content_type');
        bounded(source.bytes, 'bytes', 1, Number.MAX_SAFE_INTEGER, true);
        if (source.sha256 !== undefined && (typeof source.sha256 !== 'string' || !/^[a-fA-F0-9]{64}$/u.test(source.sha256))) throw new TypeError('sha256 must be a hexadecimal SHA-256 digest');
        break;
      default: throw new TypeError(`Unsupported ${field} source kind`);
    }
  }
  if (input.output !== undefined) {
    const output = jsonObject(input.output, 'output');
    choice(output.background_mode, 'background_mode', ['original', 'green', 'white', 'transparent']);
    choice(output.aspect_ratio, 'aspect_ratio', ['source']);
  }
  return input;
}
export function draftInput(value: unknown): JSONObject {
  const input = jsonObject(value, 'Viggle render draft'); opaqueId(input.draft_id);
  if (input.upload_completions !== undefined) {
    if (!Array.isArray(input.upload_completions)) throw new TypeError('upload_completions must be an array');
    const handles = new Set<string>();
    for (const item of input.upload_completions) {
      const completion = jsonObject(item, 'upload completion'); opaqueId(completion.upload_handle);
      if (handles.has(completion.upload_handle as string)) throw new TypeError('Duplicate upload completion');
      handles.add(completion.upload_handle as string);
      if (completion.etag !== undefined) nonempty(completion.etag, 'etag');
    }
  }
  return input;
}
