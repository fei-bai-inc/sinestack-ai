import type { AssetModelV1, JSONObject } from '@sinestack/ai-provider';
import { snapshotAssetMapping } from '@sinestack/ai-provider-utils';
import { ReplicateAssetModel } from './replicate-asset-model.js';
import type { ReplicateAssetDefinition, ReplicateAssetMapping, ReplicateAssetProviderSettings } from './replicate-asset-model.js';

export { ReplicateAssetModel };
export type { ReplicateAssetDefinition, ReplicateAssetMapping, ReplicateAssetProviderSettings };

/** Capability helpers select the asset kind, never a model or model-specific schema. */
export interface ReplicateAssetProvider {
  music<INPUT = JSONObject>(modelId: string, mapping?: ReplicateAssetMapping<INPUT>): AssetModelV1<INPUT, 'music'>;
  threeD<INPUT = JSONObject>(modelId: string, mapping?: ReplicateAssetMapping<INPUT>): AssetModelV1<INPUT, 'model-3d'>;
  soundEffect<INPUT = JSONObject>(modelId: string, mapping?: ReplicateAssetMapping<INPUT>): AssetModelV1<INPUT, 'sound-effect'>;
  animation3D<INPUT = JSONObject>(modelId: string, mapping?: ReplicateAssetMapping<INPUT>): AssetModelV1<INPUT, 'animation-3d'>;
  asset<INPUT = JSONObject, KIND extends string = string>(modelId: string, definition: ReplicateAssetDefinition<INPUT, KIND>): AssetModelV1<INPUT, KIND>;
}

export function createReplicateAssetProvider(settings: ReplicateAssetProviderSettings = {}): ReplicateAssetProvider {
  const config = { ...settings, headers: settings.headers === undefined ? undefined : { ...settings.headers } };
  function createModel<INPUT, KIND extends string>(modelId: string, kind: KIND, mapping?: ReplicateAssetMapping<INPUT>) {
    const callbacks = snapshotAssetMapping(mapping);
    const version = mapping?.version;
    return new ReplicateAssetModel(modelId, config, {
      ...callbacks, kind, ...(version === undefined ? {} : { version }),
    });
  }
  return {
    music(modelId, mapping) {
      return createModel(modelId, 'music', mapping);
    },
    threeD(modelId, mapping) {
      return createModel(modelId, 'model-3d', mapping);
    },
    soundEffect(modelId, mapping) {
      return createModel(modelId, 'sound-effect', mapping);
    },
    animation3D(modelId, mapping) {
      return createModel(modelId, 'animation-3d', mapping);
    },
    asset(modelId, definition) { return new ReplicateAssetModel(modelId, config, definition); },
  };
}
