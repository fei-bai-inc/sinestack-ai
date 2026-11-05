import type { AssetModelMapping } from '@sinestack/ai-provider';
import { WorldLabsClient } from './client.js';
import { WorldLabsAssetModel } from './driver.js';
import { resources } from './resources.js';
import type { WorldLabsDepthToPanoramaInput, WorldLabsExportMeshInput, WorldLabsExportSplatInput, WorldLabsModelId, WorldLabsProviderSettings, WorldLabsResources, WorldLabsWorldInput } from './types.js';
export * from './types.js';
export { WorldLabsAssetModel } from './driver.js';

export interface WorldLabsProvider extends WorldLabsResources {
  world<I = WorldLabsWorldInput>(modelId: WorldLabsModelId, mapping?: AssetModelMapping<I>): WorldLabsAssetModel<I, 'gaussian-splat'>;
  depthToPanorama<I = WorldLabsDepthToPanoramaInput>(mapping?: AssetModelMapping<I>): WorldLabsAssetModel<I, 'image'>;
  exportSplat<I = WorldLabsExportSplatInput>(mapping?: AssetModelMapping<I>): WorldLabsAssetModel<I, 'gaussian-splat'>;
  exportMesh<I = WorldLabsExportMeshInput>(mapping?: AssetModelMapping<I>): WorldLabsAssetModel<I, 'model-3d'>;
}

export function createWorldLabsProvider(settings: WorldLabsProviderSettings = {}): WorldLabsProvider {
  const client = new WorldLabsClient(settings);
  return {
    ...resources(client),
    world<I = WorldLabsWorldInput>(modelId: WorldLabsModelId, mapping?: AssetModelMapping<I>) {
      return new WorldLabsAssetModel<I, 'gaussian-splat'>(client, 'worlds:generate', 'gaussian-splat', modelId, mapping);
    },
    depthToPanorama<I = WorldLabsDepthToPanoramaInput>(mapping?: AssetModelMapping<I>) {
      return new WorldLabsAssetModel<I, 'image'>(client, 'pano:depth_to_rgb', 'image', undefined, mapping);
    },
    exportSplat<I = WorldLabsExportSplatInput>(mapping?: AssetModelMapping<I>) {
      return new WorldLabsAssetModel<I, 'gaussian-splat'>(client, 'export-splat', 'gaussian-splat', undefined, mapping);
    },
    exportMesh<I = WorldLabsExportMeshInput>(mapping?: AssetModelMapping<I>) {
      return new WorldLabsAssetModel<I, 'model-3d'>(client, 'export-mesh', 'model-3d', undefined, mapping);
    },
  };
}
