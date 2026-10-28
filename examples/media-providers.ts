import { generate3D, generateAnimation3D, generateMusic } from '@sine-ai/core';
import { createFalAssetProvider } from '@sine-ai/fal';
import { createReplicateAssetProvider } from '@sine-ai/replicate';
import { createWaveSpeedAssetProvider } from '@sine-ai/wavespeed';

// Select one scenario explicitly. Running without an argument never submits a job.
// node --experimental-strip-types examples/media-providers.ts wavespeed-music
const scenario = process.argv[2];
const musicInput = { prompt: 'A gentle instrumental piano score with warm strings', instrumental: true };
const threeDInput = { prompt: 'A small stylized wooden lantern with a brass handle' };

switch (scenario) {
  case 'fal-music':
    console.log(await generateMusic({ model: createFalAssetProvider().music(), ...musicInput }));
    break;
  case 'wavespeed-music':
    console.log(await generateMusic({ model: createWaveSpeedAssetProvider().music(), ...musicInput }));
    break;
  case 'replicate-music':
    console.log(await generateMusic({ model: createReplicateAssetProvider().music(), ...musicInput }));
    break;
  case 'fal-motion':
    console.log(await generateAnimation3D({
      model: createFalAssetProvider().animation3D(),
      prompt: 'A person walks forward, stops, and waves', durationSeconds: 4, seed: 42, format: 'json',
    }));
    break;
  case 'wavespeed-3d':
    console.log(await generate3D({ model: createWaveSpeedAssetProvider().threeD(), ...threeDInput }));
    break;
  case 'replicate-3d':
    console.log(await generate3D({ model: createReplicateAssetProvider().threeD(), ...threeDInput }));
    break;
  default:
    console.log('Choose: fal-music | wavespeed-music | replicate-music | fal-motion | wavespeed-3d | replicate-3d');
    console.log('Set the selected provider API key. Selecting a scenario submits a real, billable generation.');
}
