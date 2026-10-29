import {
  generate3D,
  generateAnimation3D,
  generateAsset,
  generateMusic,
  generateSoundEffect,
  materializeAsset,
} from '@sinestack/ai-core';
import type { GenerateAssetResult } from '@sinestack/ai-core';
import { createFalAssetProvider } from '@sinestack/ai-fal';
import type { AssetModelMapping, AssetModelV1, JSONObject } from '@sinestack/ai-provider';
import { AssetProviderTransport, mapAssetResult } from '@sinestack/ai-provider-utils';
import { createReplicateAssetProvider } from '@sinestack/ai-replicate';
import { createWaveSpeedAssetProvider } from '@sinestack/ai-wavespeed';

const fal = createFalAssetProvider({ apiKey: 'test' });
const wavespeed = createWaveSpeedAssetProvider({ apiKey: 'test' });
const replicate = createReplicateAssetProvider({ apiKey: 'test' });

const musicModel: AssetModelV1<JSONObject, 'music'> = fal.music('owner/music-model');
const threeDModel: AssetModelV1<JSONObject, 'model-3d'> = wavespeed.threeD('owner/three-d-model');
const sfxModel: AssetModelV1<JSONObject, 'sound-effect'> = fal.soundEffect('owner/sfx-model');

interface MotionInput {
  readonly prompt: string;
  readonly frames: number;
}

const motionMapping: AssetModelMapping<MotionInput> = {
  mapInput(input) {
    return { text: input.prompt, num_frames: input.frames };
  },
  mapResult(output) {
    return mapAssetResult(output);
  },
};

const motionModel: AssetModelV1<MotionInput, 'animation-3d'> = replicate.animation3D(
  'owner/motion-model',
  motionMapping,
);

export async function typecheckConsumer(): Promise<GenerateAssetResult<'animation-3d'>> {
  void generateMusic({ model: musicModel, input: { prompt: 'Calm piano' } });
  void generate3D({ model: threeDModel, input: { prompt: 'Chair' } });
  void generateSoundEffect({ model: sfxModel, input: { prompt: 'Bell' } });
  void AssetProviderTransport;
  const result = await generateAnimation3D({
    model: motionModel,
    input: { prompt: 'Jump', frames: 60 },
  });
  void materializeAsset(result.asset);
  void generateAsset({
    model: fal.asset('owner/doc-model', { kind: 'document' }),
    input: { title: 'Doc' },
  });
  return result;
}
