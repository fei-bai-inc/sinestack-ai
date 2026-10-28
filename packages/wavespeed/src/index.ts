import type { AssetModelMapping, AssetModelV1, JSONObject } from '@sine-ai/provider';
import { snapshotAssetMapping } from '@sine-ai/provider-utils';
import { WaveSpeedAssetModel } from './wavespeed-asset-model.js';
import type { WaveSpeedAssetDefinition, WaveSpeedAssetProviderSettings } from './wavespeed-asset-model.js';

export { WaveSpeedAssetModel };
export type { WaveSpeedAssetDefinition, WaveSpeedAssetProviderSettings };

/** Capability labels share the native prediction protocol; no model catalog is required. */
export interface WaveSpeedAssetProvider {
  music<INPUT = JSONObject>(modelId: string, mapping?: AssetModelMapping<INPUT>): AssetModelV1<INPUT, 'music'>;
  threeD<INPUT = JSONObject>(modelId: string, mapping?: AssetModelMapping<INPUT>): AssetModelV1<INPUT, 'model-3d'>;
  soundEffect<INPUT = JSONObject>(modelId: string, mapping?: AssetModelMapping<INPUT>): AssetModelV1<INPUT, 'sound-effect'>;
  animation3D<INPUT = JSONObject>(modelId: string, mapping?: AssetModelMapping<INPUT>): AssetModelV1<INPUT, 'animation-3d'>;
  asset<INPUT = JSONObject, KIND extends string = string>(modelId: string, definition: WaveSpeedAssetDefinition<INPUT, KIND>): AssetModelV1<INPUT, KIND>;
}

export function createWaveSpeedAssetProvider(settings: WaveSpeedAssetProviderSettings = {}): WaveSpeedAssetProvider {
  const config = { ...settings, headers: settings.headers === undefined ? undefined : { ...settings.headers } };
  return {
    music(modelId, mapping) { return new WaveSpeedAssetModel(modelId, config, { ...snapshotAssetMapping(mapping), kind: 'music' }); },
    threeD(modelId, mapping) { return new WaveSpeedAssetModel(modelId, config, { ...snapshotAssetMapping(mapping), kind: 'model-3d' }); },
    soundEffect(modelId, mapping) { return new WaveSpeedAssetModel(modelId, config, { ...snapshotAssetMapping(mapping), kind: 'sound-effect' }); },
    animation3D(modelId, mapping) { return new WaveSpeedAssetModel(modelId, config, { ...snapshotAssetMapping(mapping), kind: 'animation-3d' }); },
    asset(modelId, definition) { return new WaveSpeedAssetModel(modelId, config, definition); },
  };
}
