import type { AssetModelMapping, JSONObject } from '@sinestack/ai-provider';
import { MeshyClient } from './client.js';
import { MeshyAssetModel, MeshyTaskDriver } from './driver.js';
import { meshyAnimationResult, meshyAutoSplitResult, meshyModelResult, meshyPrintAnalysisResult, meshyPrintRepairResult, meshyRigResult } from './results.js';
import { meshyResources } from './resources.js';
import type { MeshyResources } from './resources.js';
import { nonempty } from './validation.js';
import type * as T from './types.js';
export * from './types.js';
export { MeshyClient } from './client.js';
export type { MeshyResponse, MeshyTaskResponse, MeshyDeleteResult } from './client.js';
export type { MeshyResources, MeshyTaskDeletion } from './resources.js';
export { MeshyAssetModel, MeshyTaskDriver } from './driver.js';
export type { MeshyTaskDefinition, MeshyTaskStartResult, MeshyAssetStartResult } from './driver.js';
export type { MeshyTaskFamily } from './routes.js';
export { parseMeshyWebhook } from './webhooks.js';
export { validateMeshyInput } from './validation.js';

export interface MeshyProvider extends MeshyResources {
  textTo3D<I = T.MeshyTextTo3DInput>(modelId: T.MeshyModelId, mapping?: AssetModelMapping<I>): MeshyAssetModel<I, 'model-3d'>;
  imageTo3D<I = T.MeshyImageTo3DInput>(modelId: T.MeshyModelId, mapping?: AssetModelMapping<I>): MeshyAssetModel<I, 'model-3d'>;
  multiImageTo3D<I = T.MeshyMultiImageTo3DInput>(modelId: T.MeshyModelId, mapping?: AssetModelMapping<I>): MeshyAssetModel<I, 'model-3d'>;
  textToImage<I = T.MeshyTextToImageInput>(modelId: string, mapping?: AssetModelMapping<I>): MeshyAssetModel<I, 'image'>;
  imageToImage<I = T.MeshyImageToImageInput>(modelId: string, mapping?: AssetModelMapping<I>): MeshyAssetModel<I, 'image'>;
  textToMotion<I = T.MeshyTextToMotionInput>(mode: T.MeshyMotionMode, mapping?: AssetModelMapping<I>): MeshyAssetModel<I, 'animation-3d'>;
  /** Omit modelId to inherit the preview's algorithm version. */
  refine<I = T.MeshyRefineInput>(modelId?: T.MeshyModelId, mapping?: T.MeshyInputMapping<I>): MeshyTaskDriver<I, T.MeshyModelResult, 'model3d.process'>;
  retexture<I = T.MeshyRetextureInput>(modelId?: T.MeshyModelId, mapping?: T.MeshyInputMapping<I>): MeshyTaskDriver<I, T.MeshyModelResult, 'model3d.process'>;
  remesh<I = T.MeshyRemeshInput>(mapping?: T.MeshyInputMapping<I>): MeshyTaskDriver<I, T.MeshyModelResult, 'model3d.process'>;
  convert<I = T.MeshyConvertInput>(mapping?: T.MeshyInputMapping<I>): MeshyTaskDriver<I, T.MeshyModelResult, 'model3d.process'>;
  resize<I = T.MeshyResizeInput>(mapping?: T.MeshyInputMapping<I>): MeshyTaskDriver<I, T.MeshyModelResult, 'model3d.process'>;
  unwrapUV<I = T.MeshyUVInput>(mapping?: T.MeshyInputMapping<I>): MeshyTaskDriver<I, T.MeshyModelResult, 'model3d.process'>;
  multiColorPrint<I = T.MeshyMultiColorPrintInput>(mapping?: T.MeshyInputMapping<I>): MeshyTaskDriver<I, T.MeshyModelResult, 'model3d.process'>;
  repairPrintability<I = T.MeshyPrintRepairInput>(mapping?: T.MeshyInputMapping<I>): MeshyTaskDriver<I, T.MeshyPrintRepairResult, 'model3d.process'>;
  autoSplit<I = T.MeshyAutoSplitInput>(mapping?: T.MeshyInputMapping<I>): MeshyTaskDriver<I, T.MeshyAutoSplitResult, 'model3d.process'>;
  analyzePrintability<I = T.MeshyPrintAnalysisInput>(mapping?: T.MeshyInputMapping<I>): MeshyTaskDriver<I, T.MeshyPrintAnalysisResult, 'model3d.analyze'>;
  rig<I = T.MeshyRigInput>(mapping?: T.MeshyInputMapping<I>): MeshyTaskDriver<I, T.MeshyRigResult, 'model3d.rig'>;
  animate<I = T.MeshyAnimationInput>(mapping?: T.MeshyInputMapping<I>): MeshyTaskDriver<I, T.MeshyAnimationResult, 'model3d.animate'>;
  asset<I = JSONObject, K extends string = string>(route: string, definition: T.MeshyAssetDefinition<I, K>): MeshyAssetModel<I, K>;
}

export function createMeshyProvider(settings: T.MeshyProviderSettings = {}): MeshyProvider {
  const client = new MeshyClient({ ...settings, headers: { ...settings.headers } });
  const selected = (id: string) => { nonempty(id, 'Explicit modelId'); return id; };
  const asset = <I, K extends string>(route: string, kind: K, id?: string, mapping?: AssetModelMapping<I>, variant?: 'preview' | 'refine', modelField?: 'ai_model' | 'mode') => new MeshyAssetModel(client, route, kind, id, mapping, variant, modelField);
  const process = <I, R extends object>(route: string, decode: (task: T.MeshyTaskRecord) => R, mapping?: T.MeshyInputMapping<I>, modelId?: string, variant?: 'refine') =>
    new MeshyTaskDriver(client, { route, decode, modelId, variant, supportsDelete: true }, 'model3d.process', mapping);
  return {
    ...meshyResources(client),
    /** Geometry preview only. Refine is a separately persisted, explicitly billable stage. */
    textTo3D<I = T.MeshyTextTo3DInput>(modelId: T.MeshyModelId, mapping?: AssetModelMapping<I>) { return asset<I, 'model-3d'>('v2/text-to-3d', 'model-3d', selected(modelId), mapping, 'preview'); },
    imageTo3D<I = T.MeshyImageTo3DInput>(modelId: T.MeshyModelId, mapping?: AssetModelMapping<I>) { return asset<I, 'model-3d'>('v1/image-to-3d', 'model-3d', selected(modelId), mapping); },
    multiImageTo3D<I = T.MeshyMultiImageTo3DInput>(modelId: T.MeshyModelId, mapping?: AssetModelMapping<I>) { return asset<I, 'model-3d'>('v1/multi-image-to-3d', 'model-3d', selected(modelId), mapping); },
    textToImage<I = T.MeshyTextToImageInput>(modelId: string, mapping?: AssetModelMapping<I>) { return asset<I, 'image'>('v1/text-to-image', 'image', selected(modelId), mapping); },
    imageToImage<I = T.MeshyImageToImageInput>(modelId: string, mapping?: AssetModelMapping<I>) { return asset<I, 'image'>('v1/image-to-image', 'image', selected(modelId), mapping); },
    textToMotion<I = T.MeshyTextToMotionInput>(mode: T.MeshyMotionMode, mapping?: AssetModelMapping<I>) { return asset<I, 'animation-3d'>('v1/text-to-motion', 'animation-3d', selected(mode), mapping, undefined, 'mode'); },
    /** Omit ai_model to inherit the preview's model rather than forcing latest. */
    refine<I = T.MeshyRefineInput>(modelId?: T.MeshyModelId, mapping?: T.MeshyInputMapping<I>) { return process<I, T.MeshyModelResult>('v2/text-to-3d', meshyModelResult, mapping, modelId, 'refine'); },
    retexture<I = T.MeshyRetextureInput>(modelId?: T.MeshyModelId, mapping?: T.MeshyInputMapping<I>) { return process<I, T.MeshyModelResult>('v1/retexture', meshyModelResult, mapping, modelId); },
    remesh<I = T.MeshyRemeshInput>(mapping?: T.MeshyInputMapping<I>) { return process<I, T.MeshyModelResult>('v1/remesh', meshyModelResult, mapping); },
    convert<I = T.MeshyConvertInput>(mapping?: T.MeshyInputMapping<I>) { return process<I, T.MeshyModelResult>('v1/convert', meshyModelResult, mapping); },
    resize<I = T.MeshyResizeInput>(mapping?: T.MeshyInputMapping<I>) { return process<I, T.MeshyModelResult>('v1/resize', meshyModelResult, mapping); },
    unwrapUV<I = T.MeshyUVInput>(mapping?: T.MeshyInputMapping<I>) { return process<I, T.MeshyModelResult>('v1/uv-unwrap', meshyModelResult, mapping); },
    multiColorPrint<I = T.MeshyMultiColorPrintInput>(mapping?: T.MeshyInputMapping<I>) { return process<I, T.MeshyModelResult>('v1/print/multi-color', meshyModelResult, mapping); },
    repairPrintability<I = T.MeshyPrintRepairInput>(mapping?: T.MeshyInputMapping<I>) { return process<I, T.MeshyPrintRepairResult>('v1/print/repair', meshyPrintRepairResult, mapping); },
    autoSplit<I = T.MeshyAutoSplitInput>(mapping?: T.MeshyInputMapping<I>) { return process<I, T.MeshyAutoSplitResult>('v1/print/split', meshyAutoSplitResult, mapping); },
    analyzePrintability<I = T.MeshyPrintAnalysisInput>(mapping?: T.MeshyInputMapping<I>) { return new MeshyTaskDriver(client, { route: 'v1/print/analyze', decode: meshyPrintAnalysisResult, supportsDelete: true }, 'model3d.analyze', mapping); },
    rig<I = T.MeshyRigInput>(mapping?: T.MeshyInputMapping<I>) { return new MeshyTaskDriver(client, { route: 'v1/rigging', decode: meshyRigResult, supportsDelete: true }, 'model3d.rig', mapping); },
    animate<I = T.MeshyAnimationInput>(mapping?: T.MeshyInputMapping<I>) { return new MeshyTaskDriver(client, { route: 'v1/animations', decode: meshyAnimationResult, supportsDelete: true }, 'model3d.animate', mapping); },
    /** For a future file-producing endpoint with the same task protocol; no model catalog. */
    asset<I = JSONObject, K extends string = string>(route: string, definition: T.MeshyAssetDefinition<I, K>) { return asset<I, K>(route, definition.kind, definition.modelId, definition); },
  };
}
