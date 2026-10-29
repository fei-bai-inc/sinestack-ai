import type { AssetFile, AssetModelV1Result, JSONObject, JSONValue } from '@sinestack/ai-provider';
import { httpURL, jsonObject, mapAssetResult } from '@sinestack/ai-provider-utils';
import type { MeshyAnimationResult, MeshyAutoSplitResult, MeshyModelResult, MeshyPrintabilityReport, MeshyPrintAnalysisResult, MeshyPrintRepairResult, MeshyRigResult, MeshyTaskRecord } from './types.js';
import { boundedNumber, nonempty } from './validation.js';

const mime: Readonly<Record<string, string>> = {
  glb: 'model/gltf-binary', gltf: 'model/gltf+json', usdz: 'model/vnd.usdz+zip',
  obj: 'model/obj', stl: 'model/stl', '3mf': 'model/3mf',
};
/** Explicit output fields only. Source images, prompts, metadata and doc URLs are not files. */
export function meshyFiles(task: MeshyTaskRecord): readonly AssetFile[] {
  const files: AssetFile[] = [];
  function add(value: JSONValue | undefined, role: string, source: string, format?: string): void {
    if (value === undefined || value === null || value === '') return;
    nonempty(value, `Meshy file ${source}`);
    const url = httpURL(value, `Meshy file ${source}`).href;
    const file = mapAssetResult(url).assets[0]!;
    files.push({ ...file, ...(format && mime[format] ? { mediaType: mime[format]! } : {}), role,
      metadata: { ...file.metadata, assetId: `${task.id}:${source}`, source,
        ...(format ? { format } : {}), ...(typeof task.expires_at === 'number' && task.expires_at > 0 ? { expiresAt: task.expires_at } : {}) } });
  }
  function dict(value: JSONValue | undefined, role: string, source: string, formats = false): void {
    if (value == null) return;
    for (const [key, item] of Object.entries(jsonObject(value, source))) {
      const actualRole = formats && key === 'mtl' ? 'material'
        : formats && key.startsWith('pre_remeshed') ? 'pre-remeshed-model' : role;
      add(item, actualRole, `${source}.${key}`, formats ? key : undefined);
    }
  }
  dict(task.model_urls, 'model', 'model_urls', true);
  if (!files.some(file => file.role === 'model')) add(task.model_url, 'model', 'model_url');
  add(task.pre_remeshed_glb_url, 'pre-remeshed-model', 'pre_remeshed_glb_url', 'glb');
  add(task.thumbnail_url, 'preview', 'thumbnail_url');
  add(task.alpha_thumbnail_url, 'preview', 'alpha_thumbnail_url');
  dict(task.thumbnail_urls, 'preview', 'thumbnail_urls');
  if (task.texture_urls != null) {
    if (!Array.isArray(task.texture_urls)) throw new TypeError('Invalid Meshy texture_urls');
    task.texture_urls.forEach((entry, index) => {
      const texture = jsonObject(entry, 'Meshy texture');
      for (const key of ['base_color', 'metallic', 'roughness', 'normal', 'emission', 'metallic_roughness']) add(texture[key], 'texture', `texture_urls[${index}].${key}`);
    });
  }
  if (task.image_urls != null) {
    if (!Array.isArray(task.image_urls)) throw new TypeError('Invalid Meshy image_urls');
    task.image_urls.forEach((value, index) => add(value, 'image', `image_urls[${index}]`));
  }
  if (task.result != null) {
    const result = jsonObject(task.result, 'Meshy result');
    for (const format of ['glb', 'fbx']) add(result[`rigged_character_${format}_url`], 'model', `result.rigged_character_${format}_url`, format);
    for (const format of ['glb', 'fbx']) add(result[`animation_${format}_url`], 'animation', `result.animation_${format}_url`, format);
    add(result.processed_usdz_url, 'animation', 'result.processed_usdz_url', 'usdz');
    add(result.processed_animation_fps_fbx_url, 'animation', 'result.processed_animation_fps_fbx_url', 'fbx');
    add(result.processed_armature_fbx_url, 'armature', 'result.processed_armature_fbx_url', 'fbx');
    add(result.motion_url, 'motion', 'result.motion_url', typeof result.motion_format === 'string' ? result.motion_format : undefined);
    if (result.basic_animations != null) {
      const basic = jsonObject(result.basic_animations, 'basic_animations');
      for (const action of ['walking', 'running']) {
        for (const format of ['glb', 'fbx']) add(basic[`${action}_${format}_url`], 'animation', `result.basic_animations.${action}_${format}_url`, format);
        add(basic[`${action}_armature_glb_url`], 'armature', `result.basic_animations.${action}_armature_glb_url`, 'glb');
      }
    }
  }
  return files;
}
function info(task: MeshyTaskRecord) {
  return { taskId: task.id, raw: jsonObject(task, 'Meshy retained task') as MeshyTaskRecord,
    ...(typeof task.consumed_credits === 'number' ? { creditsConsumed: task.consumed_credits } : {}),
    ...(typeof task.expires_at === 'number' && task.expires_at > 0 ? { expiresAt: task.expires_at } : {}) };
}
function preferred(files: readonly AssetFile[]): AssetFile | undefined {
  return files.find(file => file.metadata?.format === 'glb') ?? files[0];
}
export function meshyAssetResult(task: MeshyTaskRecord, kind: string): AssetModelV1Result {
  const files = meshyFiles(task);
  const role = kind === 'model-3d' ? 'model' : kind === 'image' ? 'image' : kind === 'animation-3d' ? 'motion' : undefined;
  const primary = role ? preferred(files.filter(file => file.role === role)) : files.find(file => file.role !== 'preview');
  if (!primary) throw new TypeError(`Meshy returned no primary ${kind} file; use an explicit result mapper for a custom schema`);
  return { assets: [primary, ...files.filter(file => file !== primary)],
    ...(typeof task.consumed_credits === 'number' ? { usage: { credits: task.consumed_credits } } : {}) };
}
export function meshyModelResult(task: MeshyTaskRecord): MeshyModelResult {
  const files = meshyFiles(task);
  const modelFiles = files.filter(file => file.role === 'model');
  const model = preferred(modelFiles);
  if (!model) throw new TypeError('Meshy returned no processed model file');
  return { ...info(task), model, files,
    models: Object.fromEntries(modelFiles.map(file => [String(file.metadata?.format ?? file.metadata?.source), file])),
    textures: files.filter(file => file.role === 'texture'), previews: files.filter(file => file.role === 'preview') };
}
export function meshyRigResult(task: MeshyTaskRecord): MeshyRigResult {
  const result = meshyModelResult(task);
  return { ...result, animations: result.files.filter(file => file.role === 'animation'), armatures: result.files.filter(file => file.role === 'armature') };
}
export function meshyAnimationResult(task: MeshyTaskRecord): MeshyAnimationResult {
  const files = meshyFiles(task), animations = files.filter(file => file.role === 'animation');
  const armatures = files.filter(file => file.role === 'armature');
  if (!animations.length && !armatures.length) throw new TypeError('Meshy returned no animation or armature file');
  const output = jsonObject(task.result, 'Meshy animation output');
  return { ...info(task), files, animations, armatures, ...(output.clips === undefined ? {} : { clips: output.clips }) };
}
export function meshyPrintAnalysisResult(task: MeshyTaskRecord): MeshyPrintAnalysisResult {
  const report = jsonObject(task.printability, 'Meshy printability');
  nonempty(report.status, 'printability.status');
  for (const key of ['issue_count', 'error_count', 'warning_count']) if (report[key] !== undefined) boundedNumber(report[key], key, 0, Infinity, true);
  // A warning/error verdict is successful analysis, not a failed API task.
  return { ...info(task), printability: report as MeshyPrintabilityReport };
}
export function meshyPrintRepairResult(task: MeshyTaskRecord): MeshyPrintRepairResult {
  return { ...meshyModelResult(task),
    ...(task.intended_print == null ? {} : { intendedPrint: jsonObject(task.intended_print, 'intended_print') }),
    ...(task.print_repair_report == null ? {} : { repairReport: jsonObject(task.print_repair_report, 'print_repair_report') }) };
}
export function meshyAutoSplitResult(task: MeshyTaskRecord): MeshyAutoSplitResult {
  if (task.part_count !== undefined) boundedNumber(task.part_count, 'part_count', 0, Infinity, true);
  if (task.prompt_ignored !== undefined && typeof task.prompt_ignored !== 'boolean') throw new TypeError('Invalid prompt_ignored');
  return { ...meshyModelResult(task),
    ...(typeof task.part_count === 'number' ? { partCount: task.part_count } : {}),
    ...(typeof task.prompt_ignored === 'boolean' ? { promptIgnored: task.prompt_ignored } : {}) };
}
