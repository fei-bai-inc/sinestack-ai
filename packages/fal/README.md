# @sinestack/ai-fal

English | [简体中文](https://github.com/fei-bai-inc/sinestack-ai/blob/main/packages/fal/README.zh-CN.md)

Generate music, sound effects, 3D models, and animation files with fal through SineStack AI. Use this package to call file-generation models with their native JSON inputs and manage the resulting tasks from your application.

## Install

```sh
npm install @sinestack/ai-fal @sinestack/ai-core ai@7.0.155
```

Use Node.js 22 or 24 with ESM (`.mjs` or `"type": "module"`; Node >=22 is required). Keep `FAL_KEY` on the server. The `ai` package is a required peer dependency.

## Generate music

Set `FAL_MUSIC_MODEL_ID` to a music model available to your account and `FAL_INPUT_JSON` to its native input JSON, following that model's parameter schema. Save this example as `example.mjs` and run `node example.mjs`. It submits a real task and may use paid provider credits.

```js
import { generateMusic } from '@sinestack/ai-core';
import { createFalAssetProvider } from '@sinestack/ai-fal';

const modelId = process.env.FAL_MUSIC_MODEL_ID;
const inputJSON = process.env.FAL_INPUT_JSON;
if (!modelId || !inputJSON) throw new Error('Set FAL_MUSIC_MODEL_ID and FAL_INPUT_JSON');
const provider = createFalAssetProvider();
const result = await generateMusic({
  model: provider.music(modelId),
  input: JSON.parse(inputJSON),
});
console.log(result.assets, result.providerMetadata?.fal?.output);
```

## Choose a capability

Each factory takes an explicit model ID. The factory selects the asset kind; the model's native schema determines the input fields.

| Provider method | Asset kind | Core helper |
| --- | --- | --- |
| `music(modelId)` | `music` | `generateMusic` |
| `soundEffect(modelId)` | `sound-effect` | `generateSoundEffect` |
| `threeD(modelId)` | `model-3d` | `generate3D` |
| `animation3D(modelId)` | `animation-3d` | `generateAnimation3D` |
| `asset(modelId, { kind })` | Your chosen kind | `generateAsset` |

## Inputs, mappings, and files

Input JSON is sent unchanged by default. Use `providerOptions.fal` for additional native parameters; duplicate keys in `input` are rejected.

Pass optional `mapInput` and `mapResult` functions in the factory options to adapt application inputs or custom file layouts. Each function can be supplied independently:

- `mapInput` receives the caller's input and returns the model's native JSON parameters.
- `mapResult` receives the native JSON body from the result endpoint and returns `{ assets: [...] }` with at least one file asset.

The default result mapper recognizes file URLs, arrays, and explicit file objects such as `{ url, content_type, file_name, file_size }`. Use a custom mapper for other file structures. The native output is also retained as an independent snapshot in `providerMetadata.fal.output`.

Assets remain URL references until you download them. Use core's `materializeAsset` when you need bytes. MIME types come from file metadata or recognized extensions, with `application/octet-stream` as the fallback.

## Save and resume tasks

For background jobs, submit with `startAsset` and persist the complete returned operation. Resume with `getAssetStatus` or `waitForAsset` using the same model, API address, and authorized account. Keep the original operation after a persistence, query, or download failure to avoid submitting another paid task. Receipts contain no API key; your application restores the authorized tenant connection.

Local abort or timeout stops local waiting, not remote generation. Submission defaults to zero retries; status retries query the existing task.

## Provider options

`createFalAssetProvider` accepts `apiKey`, `baseURL`, `headers`, `fetch`, and `name`. The default API root is `https://queue.fal.run`.

Queue model paths support `owner/app`, `workflows/owner/app`, and `comfy/owner/app`. Custom proxy URLs may include a path prefix.

Use `cancelAsset` to request remote cancellation. A `requested` result means you should keep querying the same operation to observe its final status. The adapter provides cancellation, but no task deletion API.

## Guides

- [Media providers: mappings, task lifecycle, connection security, and integration details](https://github.com/fei-bai-inc/sinestack-ai/blob/main/docs/MEDIA_PROVIDERS.md)
- [Core: generation, recovery, and file materialization](https://github.com/fei-bai-inc/sinestack-ai/blob/main/packages/core/README.md)
