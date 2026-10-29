import { generateAsset } from '@sinestack/ai-core';
import type { JSONObject } from '@sinestack/ai-provider';
import { createFalAssetProvider } from '@sinestack/ai-fal';
import { createReplicateAssetProvider } from '@sinestack/ai-replicate';
import { createWaveSpeedAssetProvider } from '@sinestack/ai-wavespeed';

// No model catalog or implicit model selection. Calling without arguments performs no generation.
// node --experimental-strip-types examples/media-providers.ts fal music owner/model '{"native_field":"value"}'
const [provider, kind, modelId, inputJSON] = process.argv.slice(2);
const factories = {
  fal: createFalAssetProvider,
  wavespeed: createWaveSpeedAssetProvider,
  replicate: createReplicateAssetProvider,
};

if (!provider || !kind || !modelId || !inputJSON) {
  console.log('Usage: media-providers.ts <fal|wavespeed|replicate> <kind> <modelId> <native-input-json>');
  console.log('Set the selected provider API key. Explicit arguments submit a real, billable generation.');
} else {
  if (!Object.hasOwn(factories, provider)) throw new TypeError('Unknown provider.');
  const connection = factories[provider as keyof typeof factories]();
  const result = await generateAsset({
    model: connection.asset(modelId, { kind }),
    // The provider adapter validates plain JSON before any request.
    input: JSON.parse(inputJSON) as JSONObject,
  });
  console.log(result.assets);
  console.log(result.providerMetadata);
}
