import type { AssetModelMapping, AssetModelV1, JSONObject } from '@sinestack/ai-provider';
import { snapshotAssetMapping } from '@sinestack/ai-provider-utils';
import { FalAssetModel } from './fal-asset-model.js';
import type { FalAssetDefinition, FalAssetProviderSettings } from './fal-asset-model.js';

export { FalAssetModel };
export type { FalAssetDefinition, FalAssetProviderSettings };

/** Capability factories label the result kind; model IDs and native inputs are never catalog-limited. */
export interface FalAssetProvider {
  threeD<INPUT = JSONObject>(modelId: string, mapping?: AssetModelMapping<INPUT>): AssetModelV1<INPUT, 'model-3d'>;
  soundEffect<INPUT = JSONObject>(modelId: string, mapping?: AssetModelMapping<INPUT>): AssetModelV1<INPUT, 'sound-effect'>;
  music<INPUT = JSONObject>(modelId: string, mapping?: AssetModelMapping<INPUT>): AssetModelV1<INPUT, 'music'>;
  animation3D<INPUT = JSONObject>(modelId: string, mapping?: AssetModelMapping<INPUT>): AssetModelV1<INPUT, 'animation-3d'>;
  asset<INPUT = JSONObject, KIND extends string = string>(modelId: string, definition: FalAssetDefinition<INPUT, KIND>): AssetModelV1<INPUT, KIND>;
}

export function createFalAssetProvider(settings: FalAssetProviderSettings = {}): FalAssetProvider {
  const config = { ...settings, headers: settings.headers === undefined ? undefined : { ...settings.headers } };
  return {
    threeD(modelId, mapping) {
      return new FalAssetModel(modelId, config, { ...snapshotAssetMapping(mapping), kind: 'model-3d' });
    },
    soundEffect(modelId, mapping) {
      return new FalAssetModel(modelId, config, { ...snapshotAssetMapping(mapping), kind: 'sound-effect' });
    },
    music(modelId, mapping) {
      return new FalAssetModel(modelId, config, { ...snapshotAssetMapping(mapping), kind: 'music' });
    },
    animation3D(modelId, mapping) {
      return new FalAssetModel(modelId, config, { ...snapshotAssetMapping(mapping), kind: 'animation-3d' });
    },
    asset(modelId, definition) {
      return new FalAssetModel(modelId, config, definition);
    },
  };
}
