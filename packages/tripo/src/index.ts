import type { AssetModelMapping, JSONObject } from '@sinestack/ai-provider';
import { TripoClient } from './client.js';
import { TripoAssetModel, TripoTaskDriver } from './driver.js';
import { animationResult, modelResult, rigCheckResult, rigResult, segmentResult, smartSegmentResult, uvResult } from './results.js';
import { resources } from './resources.js';
import type * as T from './types.js';
export * from './types.js';
export { TripoAPIError, TripoClient } from './client.js';
export type { TripoRequestOptions } from './client.js';
export type { TripoPresignedUpload } from './resources.js';
export { TripoAssetModel, TripoTaskDriver } from './driver.js';
export type { TripoTaskMapping } from './driver.js';
export { verifyTripoWebhook } from './webhooks.js';
export type { TripoWebhookOptions } from './webhooks.js';
export { validateTripoInput, validateMultiview } from './validation.js';

export function createTripoProvider(settings: T.TripoProviderSettings = {}) {
  const client = new TripoClient({ ...settings, headers: { ...settings.headers } });
  const requiredModel = (value: string): string => { if (typeof value !== 'string' || !value.trim()) throw new TypeError('Explicit modelId is required'); return value; };
  const asset = <I, K extends string>(path: string, kind: K, modelId?: string, mapping?: AssetModelMapping<I>) => new TripoAssetModel<I, K>(client, path, kind, modelId, mapping);
  const processor = <I, R extends object>(path: string, decode: (task: T.TripoTaskRecord) => R, modelId?: string) => new TripoTaskDriver<I, R, 'model3d.process'>(client, path, 'model3d.process', modelId, { decode });
  return {
    ...resources(client),
    textTo3D<I = T.TripoTextTo3DInput>(modelId: string, mapping?: AssetModelMapping<I>) { return asset('generation/text-to-model', 'model-3d', requiredModel(modelId), mapping); },
    imageTo3D<I = T.TripoImageTo3DInput>(modelId: string, mapping?: AssetModelMapping<I>) { return asset('generation/image-to-model', 'model-3d', requiredModel(modelId), mapping); },
    multiviewTo3D<I = T.TripoMultiviewTo3DInput>(modelId: string, mapping?: AssetModelMapping<I>) { return asset('generation/multiview-to-model', 'model-3d', requiredModel(modelId), mapping); },
    imageToSplat<I = T.TripoSplatInput>(mapping?: AssetModelMapping<I>) { return asset('generation/image-to-splat', 'gaussian-splat', undefined, mapping); },
    textToImage<I = T.TripoTextToImageInput>(modelId: string, mapping?: AssetModelMapping<I>) { return asset('generation/text-to-image', 'image', requiredModel(modelId), mapping); },
    imageToImage<I = T.TripoImageToImageInput>(modelId: string, mapping?: AssetModelMapping<I>) { return asset('generation/image-to-image', 'image', requiredModel(modelId), mapping); },
    imageToMultiview<I = T.TripoImageToMultiviewInput>(mapping?: AssetModelMapping<I>) { return asset('generation/image-to-multiview', 'image', undefined, mapping); },
    editMultiview<I = T.TripoEditMultiviewInput>(mapping?: AssetModelMapping<I>) { return asset('generation/edit-multiview', 'image', undefined, mapping); },
    /** Documented in the official Python SDK; still needs a real account integration check. */
    imageToDepth<I = T.TripoDepthInput>(mapping?: AssetModelMapping<I>) { return asset('generation/image-to-depth', 'image', undefined, mapping); },
    texture(modelId?: string) { return processor<T.TripoTextureInput, T.TripoModelResult>('models/texture', modelResult, modelId); },
    segment(modelId?: string) { return processor<T.TripoSegmentInput, T.TripoSegmentResult>('mesh/segment', segmentResult, modelId); },
    smartSegment() { return processor<T.TripoSmartSegmentInput, T.TripoSmartSegmentResult>('mesh/smartsegment', smartSegmentResult); },
    complete(modelId?: string) { return processor<T.TripoCompleteInput, T.TripoModelResult>('mesh/complete', modelResult, modelId); },
    retopology(modelId?: string) { return processor<T.TripoRetopologyInput, T.TripoModelResult>('mesh/decimate', modelResult, modelId); },
    unwrapUV(modelId?: string) { return processor<T.TripoUVInput, T.TripoUVResult>('mesh/uv', uvResult, modelId); },
    convert() { return processor<T.TripoConvertInput, T.TripoModelResult>('models/convert', modelResult); },
    importModel() { return processor<T.TripoImportInput, T.TripoModelResult>('models/import', modelResult); },
    rigCheck() { return new TripoTaskDriver<T.TripoRigCheckInput, T.TripoRigCheckResult, 'model3d.rig.check'>(client, 'animations/rig-check', 'model3d.rig.check', undefined, { decode: rigCheckResult }); },
    rig(modelId?: string) { return new TripoTaskDriver<T.TripoRigInput, T.TripoRigResult, 'model3d.rig'>(client, 'animations/rig', 'model3d.rig', modelId, { decode: rigResult }); },
    retarget() { return new TripoTaskDriver<T.TripoRetargetInput, T.TripoAnimationResult, 'model3d.animate'>(client, 'animations/retarget', 'model3d.animate', undefined, { decode: animationResult }); },
    /** Extension point for future asset endpoints on the same Tripo task protocol. */
    asset<I = JSONObject, K extends string = string>(path: string, definition: T.TripoAssetDefinition<I, K>) { return asset(path, definition.kind, definition.modelId, definition); },
  };
}
export type TripoProvider = ReturnType<typeof createTripoProvider>;
