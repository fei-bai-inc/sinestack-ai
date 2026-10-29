import type { JSONObject } from '@sinestack/ai-provider';
import { record } from '@sinestack/ai-provider-utils';
const views = ['front', 'left', 'back', 'right'];
function text(value: unknown, label: string): void {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${label} must be a nonempty string`);
}
function imageSource(value: unknown): void {
  if (typeof value === 'string') { text(value, 'image source'); return; }
  const ref = record(value, 'image source'); const keys = Object.keys(ref);
  if (keys.length !== 1 || !['url', 'file_token', 'object'].includes(keys[0]!)) throw new TypeError('Invalid image source');
  if (keys[0] === 'object') { const object = record(ref.object, 'object source'); text(object.bucket, 'bucket'); text(object.key, 'key'); }
  else text(ref[keys[0]!], 'image source');
}
export function validateMultiview(value: unknown, texture = false): void {
  if (!Array.isArray(value) || !value.length) throw new TypeError('inputs must be a nonempty multiview array');
  if (value.length === 1 && value[0] && typeof value[0] === 'object' && 'task_id' in value[0]) {
    const entry = record(value[0], 'task source');
    if (texture || Object.keys(entry).length !== 1) throw new TypeError('Task source cannot be used here or mixed with views');
    text(entry.task_id, 'task_id'); return;
  }
  const positional = value.every(item => typeof item === 'string' || (texture && (item === null ||
    (typeof item === 'object' && item && !Object.keys(item).some(key => views.includes(key))))));
  if (positional) {
    if (value.length !== 4 || !value[0] || value.filter(item => item !== null && item !== '').length < 2) throw new TypeError('Fixed multiview requires front and at least two images in front/left/back/right slots');
    for (const item of value) if (item !== null && item !== '') imageSource(item);
    return;
  }
  const seen = new Set<string>();
  for (const item of value) {
    const entry = record(item, 'named view'); const keys = Object.keys(entry);
    if (keys.length !== 1 || !views.includes(keys[0]!) || seen.has(keys[0]!)) throw new TypeError('Named views must be unique and cannot mix input encodings');
    imageSource(entry[keys[0]!]); seen.add(keys[0]!);
  }
  if (!seen.has('front') || seen.size < 2) throw new TypeError('Named views require front and at least two images');
}
/** Endpoint invariants only. No model whitelist, version selection, defaults or parameter pruning. */
export function validateTripoInput(path: string, input: JSONObject): void {
  if (path === 'generation/text-to-model' || path === 'generation/text-to-image') text(input.prompt, 'prompt');
  else if (path === 'generation/multiview-to-model') validateMultiview(input.inputs);
  else if (path === 'generation/image-to-image') {
    if ((input.input !== undefined) === (input.inputs !== undefined)) throw new TypeError('Provide input or inputs, not both');
    if (input.input !== undefined) text(input.input, 'input');
    else if (!Array.isArray(input.inputs) || !input.inputs.length) throw new TypeError('inputs must contain images');
    else input.inputs.forEach(item => text(item, 'image input'));
    if (input.template === undefined) text(input.prompt, 'prompt'); else text(input.template, 'template');
  } else if (['generation/image-to-model', 'generation/image-to-splat', 'generation/image-to-multiview',
    'generation/edit-multiview', 'generation/image-to-depth', 'mesh/smartsegment', 'mesh/segment', 'mesh/complete',
    'mesh/decimate', 'mesh/uv', 'models/texture', 'models/convert', 'models/import', 'animations/rig-check',
    'animations/rig', 'animations/retarget'].includes(path)) text(input.input, 'input');
  if (path === 'generation/edit-multiview') {
    if (!Array.isArray(input.prompts) || !input.prompts.length) throw new TypeError('prompts must contain edit instructions');
    for (const item of input.prompts) { const edit = record(item, 'edit'); text(edit.prompt, 'prompt'); if (!views.includes(String(edit.view))) throw new TypeError('Invalid edit view'); }
  }
  if (path === 'mesh/smartsegment') {
    if (!['image', 'model'].includes(String(input.seg_type))) throw new TypeError('seg_type must be image or model');
    if (input.seg_type === 'model' && (!Array.isArray(input.transform) || input.transform.length !== 16 || !input.transform.every(n => typeof n === 'number' && Number.isFinite(n)))) throw new TypeError('Model smart segmentation requires a 16-number column-major transform');
  }
  if (path === 'models/texture' && input.texture_prompt !== undefined) {
    const prompt = record(input.texture_prompt, 'texture_prompt');
    if (['text', 'image', 'images'].filter(key => prompt[key] !== undefined).length !== 1) throw new TypeError('texture_prompt requires exactly one of text, image or images');
    if (prompt.style_image !== undefined && prompt.text === undefined) throw new TypeError('style_image requires text');
    if (prompt.text !== undefined) text(prompt.text, 'texture text');
    if (prompt.image !== undefined) imageSource(prompt.image);
    if (prompt.style_image !== undefined) imageSource(prompt.style_image);
    if (prompt.images !== undefined) validateMultiview(prompt.images, true);
  }
  if (path === 'models/convert') text(input.format, 'format');
  if (path === 'animations/retarget') {
    if ((input.animation !== undefined) === (input.animations !== undefined)) throw new TypeError('Provide animation or animations, not both');
    if (input.animation !== undefined) text(input.animation, 'animation');
    else if (!Array.isArray(input.animations) || input.animations.length < 1 || input.animations.length > 5) throw new TypeError('animations requires 1 to 5 presets');
    else input.animations.forEach(item => text(item, 'animation'));
  }
}
