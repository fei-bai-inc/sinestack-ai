# @sinestack/ai-worldlabs

English | [简体中文](https://github.com/fei-bai-inc/sinestack-ai/blob/main/packages/worldlabs/README.zh-CN.md)

Generate Marble worlds with World Labs through SineStack AI. Use text, images, panoramas, multiple views, or video to create Gaussian splats; generate RGB panoramas from depth and export worlds as PLY splats or GLB meshes.

## Install

```sh
npm install @sinestack/ai-worldlabs @sinestack/ai-core ai@7.0.155
```

Use Node.js 22 or 24 with ESM (`.mjs` or `"type": "module"`; Node >=22 is required). Core requires the `ai` peer dependency. Set `WORLDLABS_API_KEY` on the server, or pass `apiKey` explicitly.

## Generate a world

Save as `example.mjs` and run `node example.mjs`. Running it submits a real operation and may use paid API credits.

```js
import { generateAsset } from '@sinestack/ai-core';
import { createWorldLabsProvider } from '@sinestack/ai-worldlabs';

const worldlabs = createWorldLabsProvider();
const generated = await generateAsset({
  model: worldlabs.world('marble-1.1'),
  input: {
    world_prompt: {
      type: 'text',
      text_prompt: 'A sunlit greenhouse with winding stone paths',
    },
  },
});
console.log(generated.assets, generated.providerMetadata?.worldlabs?.worldId);
```

`world(modelId)` requires an explicit model ID and accepts future model strings. Availability and price are determined by World Labs. Additional native fields belong in `input` or `providerOptions.worldlabs`; duplicate input fields and overrides of factory-selected parameters are rejected.

## Factories and resources

| Factory | Output kind | Input |
|---|---|---|
| `world(modelId)` | `gaussian-splat` | `world_prompt` plus optional native world fields |
| `depthToPanorama()` | `image` | `depth_pano_image`, `text_prompt`, optional depth limits and seed |
| `exportSplat()` | `gaussian-splat` | `world_id`, optional `resolution`; exports PLY |
| `exportMesh()` | `model-3d` | `world_id`, optional `mesh_variant`; exports GLB |

All factories use `generateAsset`, or `startAsset` / `waitForAsset`, and accept optional `AssetModelMapping` input/result mappings. Direct resources expose `worlds.get/list/delete`, `operations.get`, `credits.get`, and `mediaAssets.prepareUpload/get/upload`. Resource methods return native data; upload returns void.

## Save and resume

Persist the complete `operation` returned by `startAsset` with an explicitly awaited storage write. Resume with `waitForAsset`, the same model/factory, API base URL, provider name, and authorized `connectionId`. If saving an accepted receipt fails, retain that receipt and retry persistence rather than submitting again. Operation IDs identify jobs; world IDs identify resulting resources and are used for exports and deletion.

The adapter has no idempotent start, submission webhook, or remote cancellation capability. Local abort and timeout end local waiting. World deletion is a separate explicit resource action. Core defaults to zero submission retries and polls the existing operation for status.

Results contain URL references without downloading files. World results put the full-resolution SPZ first when present and retain native output plus splat `semantics_metadata`; applications must apply scale and coordinate conversion when rendering. Use core's `materializeAsset` explicitly when bytes are needed.

## Connection

`createWorldLabsProvider` accepts `apiKey`, `baseURL`, `fetch`, `headers`, `name`, and `connectionId`. The default root is `https://api.worldlabs.ai/marble/v1`; authentication uses the raw key in `WLT-Api-Key`. Signed media uploads use only upload-plan headers, omit browser credentials, and reject redirects. Keep keys and receipts server-side and authorize restored operations in your application.

## Guides

- [World Labs guide: native inputs, persistence, results, and resources](https://github.com/fei-bai-inc/sinestack-ai/blob/main/docs/WORLDLABS.md)
- [Import-safe workflow examples](https://github.com/fei-bai-inc/sinestack-ai/blob/main/examples/worldlabs.ts)
- [Core lifecycle and file materialization](https://github.com/fei-bai-inc/sinestack-ai/blob/main/packages/core/README.md)

The integration follows the public API specification and quickstart. Mocked checks do not establish live API access, generated content quality, or Cloudflare/workerd acceptance.
