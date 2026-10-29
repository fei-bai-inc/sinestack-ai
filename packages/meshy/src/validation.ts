import type { JSONObject } from '@sinestack/ai-provider';
import { record } from '@sinestack/ai-provider-utils';

export function nonempty(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${label} must be a nonempty string`);
}
export function boundedNumber(value: unknown, label: string, min: number, max = Infinity, integer = false): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) throw new TypeError(`Invalid ${label}`);
}
function strings(value: unknown, label: string, max = Infinity): void {
  if (!Array.isArray(value) || value.length < 1 || value.length > max) throw new TypeError(`${label} requires 1 to ${max} entries`);
  for (const item of value) nonempty(item, label);
}
function source(input: JSONObject, field: string, arrayLimit?: number): void {
  if (input.input_task_id === undefined && input[field] === undefined) throw new TypeError(`Provide input_task_id or ${field}`);
  // Keep both source fields when supplied: Meshy owns its documented precedence.
  if (input.input_task_id !== undefined) nonempty(input.input_task_id, 'input_task_id');
  if (input[field] !== undefined) {
    if (arrayLimit === undefined) nonempty(input[field], field);
    else strings(input[field], field, arrayLimit);
  }
}
function prompt(value: unknown, label: string, max: number): void {
  nonempty(value, label);
  if ([...value].length > max) throw new TypeError(`${label} exceeds ${max} characters`);
}
/** Only endpoint invariants. No version whitelist, defaults, clamping or hidden stages. */
export function validateMeshyInput(route: string, input: JSONObject): void {
  if (route === 'v2/text-to-3d') {
    if (input.mode === 'preview') prompt(input.prompt, 'prompt', 800);
    else if (input.mode === 'refine') nonempty(input.preview_task_id, 'preview_task_id');
    else throw new TypeError('Text to 3D requires preview or refine mode');
  } else if (route === 'v1/image-to-3d') source(input, 'image_url');
  else if (route === 'v1/multi-image-to-3d') {
    source(input, 'image_urls', 4);
    if (input.texture_image_urls !== undefined) {
      strings(input.texture_image_urls, 'texture_image_urls', 4);
      if (input.texture_prompt !== undefined || input.texture_image_url !== undefined) throw new TypeError('texture_image_urls cannot be combined with other texture guidance');
    }
  } else if (['v1/retexture', 'v1/remesh', 'v1/convert', 'v1/resize', 'v1/uv-unwrap', 'v1/rigging', 'v1/print/multi-color', 'v1/print/analyze', 'v1/print/repair'].includes(route)) source(input, 'model_url');
  if (route === 'v1/retexture') {
    if (input.multiview_image_urls !== undefined) {
      strings(input.multiview_image_urls, 'multiview_image_urls', 4);
      if (input.text_style_prompt !== undefined || input.image_style_url !== undefined) throw new TypeError('Multiview texture guidance cannot be combined with text or single image');
    } else {
      if (input.text_style_prompt === undefined && input.image_style_url === undefined) throw new TypeError('Retexture requires text or image style guidance');
      if (input.text_style_prompt !== undefined) prompt(input.text_style_prompt, 'text_style_prompt', 800);
      if (input.image_style_url !== undefined) nonempty(input.image_style_url, 'image_style_url');
    }
  }
  if (route === 'v1/convert') strings(input.target_formats, 'target_formats');
  if (route === 'v1/resize') {
    if (['resize_height', 'resize_longest_side', 'auto_size'].filter(key => input[key] !== undefined).length !== 1) throw new TypeError('Resize requires exactly one sizing mode');
    for (const key of ['resize_height', 'resize_longest_side']) if (input[key] !== undefined) {
      boundedNumber(input[key], key, 0);
      if (input[key] === 0) throw new TypeError(`${key} must be positive`);
    }
    if (input.auto_size !== undefined && typeof input.auto_size !== 'boolean') throw new TypeError('auto_size must be boolean');
  }
  if (route === 'v1/rigging' && input.height_meters !== undefined) boundedNumber(input.height_meters, 'height_meters', 0);
  if (route === 'v1/animations') {
    nonempty(input.rig_task_id, 'rig_task_id');
    if (['action_id', 'action_ids', 'motion_task_id'].filter(key => input[key] !== undefined).length !== 1) throw new TypeError('Provide exactly one animation source');
    if (input.action_id !== undefined) boundedNumber(input.action_id, 'action_id', 0, 32767, true);
    if (input.motion_task_id !== undefined) nonempty(input.motion_task_id, 'motion_task_id');
    if (input.action_ids !== undefined) {
      if (!Array.isArray(input.action_ids) || !input.action_ids.length || input.action_ids.length > 10 || new Set(input.action_ids).size !== input.action_ids.length) throw new TypeError('action_ids requires 1 to 10 unique IDs');
      input.action_ids.forEach(id => boundedNumber(id, 'action_id', 0, 32767, true));
    }
    if (input.post_process != null) {
      const post = record(input.post_process, 'post_process');
      if (post.operation_type !== undefined) nonempty(post.operation_type, 'operation_type');
      if (post.fps !== undefined) boundedNumber(post.fps, 'fps', 1, Infinity, true);
    }
  }
  if (route === 'v1/text-to-motion') {
    prompt(input.prompt, 'prompt', 400);
    boundedNumber(input.duration, 'duration', 2, 10);
    if (!Number.isInteger(input.duration * 2)) throw new TypeError('duration must use half-second steps');
  }
  if (route === 'v1/text-to-image' || route === 'v1/image-to-image') {
    nonempty(input.ai_model, 'ai_model'); nonempty(input.prompt, 'prompt');
    if (route === 'v1/image-to-image') source(input, 'reference_image_urls', 5);
    if (input.generate_multi_view === true && input.aspect_ratio !== undefined) throw new TypeError('Multi-view images cannot specify aspect_ratio');
  }
  if (route === 'v1/print/multi-color') {
    if (input.max_colors !== undefined) boundedNumber(input.max_colors, 'max_colors', 1, 16, true);
    if (input.max_depth !== undefined) boundedNumber(input.max_depth, 'max_depth', 3, 6, true);
  }
  if (route === 'v1/print/analyze' || route === 'v1/print/repair') {
    const fields = ['intended_print_height_mm', 'intended_print_longest_side_mm'];
    if (fields.filter(key => input[key] !== undefined).length > 1) throw new TypeError('Print height and longest side are mutually exclusive');
    for (const key of fields) if (input[key] !== undefined) boundedNumber(input[key], key, 1, 1000);
  }
  if (route === 'v1/print/split') {
    nonempty(input.input_task_id, 'input_task_id');
    if (input.mode === 'by_parts' || input.mode === 'by_color') prompt(input.prompt, 'prompt', 600);
    for (const key of ['connector_size', 'connector_height']) if (input[key] !== undefined) boundedNumber(input[key], key, 0.1, 0.8);
  }
}
