import type { AssetFile, AssetModelV1Result, JSONObject, JSONValue } from '@sinestack/ai-provider';
import { httpURL, jsonObject, mapAssetResult } from '@sinestack/ai-provider-utils';
import type { TripoAnimationResult, TripoModelResult, TripoRigCheckResult, TripoRigResult, TripoSegmentResult, TripoSmartSegmentResult, TripoTaskRecord, TripoUVResult } from './types.js';

/** Only these provider output fields are files. Do not scan arbitrary metadata or prose. */
const roots: ReadonlyArray<readonly [string, string]> = [
  ['model_url', 'model'], ['pbr_model_url', 'model'], ['base_model_url', 'model'], ['model', 'model'], ['pbr_model', 'model'], ['base_model', 'model'],
  ['seg_model_url', 'model'], ['model_urls', 'model'], ['models', 'model'],
  ['splat_url', 'splat'], ['splat', 'splat'],
  ['image_url', 'image'], ['image', 'image'], ['images', 'image'], ['image_urls', 'image'],
  ['generated_image', 'image'], ['generated_image_url', 'image'], ['output_image', 'image'],
  ['depth_url', 'depth'], ['depth_image_url', 'depth'], ['depth_image', 'depth'],
  ['front_view_url', 'front'], ['left_view_url', 'left'], ['back_view_url', 'back'], ['right_view_url', 'right'],
  ['generate_multiview_image', 'view'], ['multiview_images', 'view'], ['views', 'view'],
  ['rendered_video_url', 'preview-video'], ['rendered_image_url', 'preview'], ['rendered_image', 'preview'], ['preview_url', 'preview'],
  ['mask_url', 'mask'], ['uv_render_url', 'uv-preview'], ['texture_url', 'texture'], ['textures', 'texture'],
  ['animation_url', 'animation'], ['animation_urls', 'animation'],
];
export function tripoFiles(output: JSONObject): readonly AssetFile[] {
  const files = new Map<string, AssetFile>();
  function visit(value: JSONValue | undefined, role: string, source: string): void {
    if (value === null || value === undefined || value === '') return;
    if (typeof value === 'string') {
      if (!/^https?:\/\//i.test(value)) return;
      const url = httpURL(value, 'Tripo output URL').href;
      if (files.has(url)) return;
      const file = mapAssetResult(url).assets[0]!;
      files.set(url, { ...file, role, metadata: { source } }); return;
    }
    if (Array.isArray(value)) { value.forEach((item, index) => visit(item, role, `${source}[${index}]`)); return; }
    if (typeof value !== 'object') return;
    const object = value as JSONObject;
    if (typeof object.url === 'string' && object.url) {
      const file = mapAssetResult(object).assets[0]!;
      if (file.type === 'url' && !files.has(file.url)) files.set(file.url, { ...file, role, metadata: { ...file.metadata, source } });
      return;
    }
    for (const [key, item] of Object.entries(object)) visit(item, ['front', 'left', 'back', 'right'].includes(key) ? key : role, `${source}.${key}`);
  }
  for (const [key, role] of roots) visit(output[key], role, key);
  return [...files.values()];
}
function info(task: TripoTaskRecord) {
  return { taskId: task.task_id, raw: jsonObject(task.output, 'Tripo output'),
    ...(typeof task.credits_consumed === 'number' ? { creditsConsumed: task.credits_consumed } : {}) };
}
export function assetResult(task: TripoTaskRecord, kind: string): AssetModelV1Result {
  const output = jsonObject(task.output, 'Tripo output');
  const files = tripoFiles(output);
  const primary = files.find(file => kind === 'model-3d' ? file.role === 'model'
    : kind === 'gaussian-splat' ? file.role === 'splat' || file.role === 'model'
    : kind === 'image' ? ['image', 'depth', 'front', 'left', 'back', 'right', 'view'].includes(file.role ?? '')
    : !['preview', 'preview-video', 'mask', 'uv-preview'].includes(file.role ?? ''));
  if (!primary) throw new TypeError(`Tripo returned no primary ${kind} file`);
  return { assets: [primary, ...files.filter(file => file !== primary)],
    ...(typeof task.credits_consumed === 'number' ? { usage: { credits: task.credits_consumed } } : {}),
    providerMetadata: { tripo: { taskId: task.task_id, output } } };
}
export function modelResult(task: TripoTaskRecord): TripoModelResult {
  const metadata = info(task);
  const files = tripoFiles(metadata.raw);
  const model = files.find(file => file.role === 'model');
  if (!model) throw new TypeError('Tripo returned no processed model file');
  const preview = files.find(file => file.role === 'preview');
  const scale = metadata.raw.normalize_scale;
  const translation = metadata.raw.normalize_translation;
  if (scale !== undefined && (typeof scale !== 'number' || !Number.isFinite(scale))) throw new TypeError('Invalid normalize_scale');
  if (translation !== undefined && (!Array.isArray(translation) || translation.length !== 3 || !translation.every(n => typeof n === 'number' && Number.isFinite(n)))) throw new TypeError('Invalid normalize_translation');
  return { ...metadata, model, files, ...(preview ? { preview } : {}),
    ...(typeof scale === 'number' ? { normalizeScale: scale } : {}),
    ...(translation === undefined ? {} : { normalizeTranslation: translation as [number, number, number] }) };
}
export function segmentResult(task: TripoTaskRecord): TripoSegmentResult {
  const result = modelResult(task); return { ...result, ...(result.raw.parts === undefined ? {} : { parts: result.raw.parts }) };
}
export function smartSegmentResult(task: TripoTaskRecord): TripoSmartSegmentResult {
  const result = modelResult(task); const mask = result.files.find(file => file.role === 'mask');
  return { ...result, ...(mask ? { mask } : {}),
    ...(typeof result.raw.seg_task_id === 'string' ? { segmentationTaskId: result.raw.seg_task_id } : {}),
    ...(typeof result.raw.model_task_id === 'string' ? { modelTaskId: result.raw.model_task_id } : {}),
    ...(typeof result.raw.prompt === 'string' ? { prompt: result.raw.prompt } : {}) };
}
export function uvResult(task: TripoTaskRecord): TripoUVResult {
  const result = modelResult(task); const uvPreview = result.files.find(file => file.role === 'uv-preview');
  return { ...result, ...(uvPreview ? { uvPreview } : {}) };
}
export function rigCheckResult(task: TripoTaskRecord): TripoRigCheckResult {
  const result = info(task);
  const rigType = result.raw.rig_type ?? result.raw.topology;
  if (typeof result.raw.riggable !== 'boolean' || (rigType != null && typeof rigType !== 'string')) throw new TypeError('Invalid Tripo rig check result');
  return { ...result, riggable: result.raw.riggable, ...(typeof rigType === 'string' ? { rigType } : {}) };
}
export function rigResult(task: TripoTaskRecord): TripoRigResult {
  const result = modelResult(task); return { ...result,
    ...(typeof result.raw.rig_type === 'string' ? { rigType: result.raw.rig_type } : {}),
    ...(typeof result.raw.spec === 'string' ? { skeletonSpec: result.raw.spec } : {}) };
}
export function animationResult(task: TripoTaskRecord): TripoAnimationResult {
  const result = info(task); const files = tripoFiles(result.raw);
  if (!files.some(file => file.role === 'model' || file.role === 'animation')) throw new TypeError('Tripo returned no animation file');
  return { ...result, files, ...(result.raw.clips === undefined ? {} : { clips: result.raw.clips }) };
}
