# @sinestack/ai-tripo

English | [简体中文](https://github.com/fei-bai-inc/sinestack-ai/blob/main/packages/tripo/README.zh-CN.md)

Generate and process 3D models with Tripo through SineStack AI. Build workflows from text or images through texturing, mesh editing, rigging, and animation, with access to Tripo's upload, task, and account resources.

## Install

```sh
npm install @sinestack/ai-tripo @sinestack/ai-core ai@7.0.155
```

Use Node.js 22 or 24 with ESM (`.mjs` or `"type": "module"`; Node >=22 is required). The `ai` package is a required peer dependency. Set `TRIPO_API_KEY` on the server and `TRIPO_MODEL_ID` to a model version available to your account.

## Generate a model

Save this example as `example.mjs` and run `node example.mjs`. It submits a real task and may use paid Tripo credits.

```js
import { generate3D } from '@sinestack/ai-core';
import { createTripoProvider } from '@sinestack/ai-tripo';

const modelId = process.env.TRIPO_MODEL_ID;
if (!modelId) throw new Error('Set TRIPO_MODEL_ID to an available model version');
const tripo = createTripoProvider();
const generated = await generate3D({
  model: tripo.textTo3D(modelId),
  input: { prompt: 'A small wooden robot', texture: true, pbr: true },
});
console.log(generated.assets, generated.providerMetadata?.tripo?.taskId);
```

## Choose a workflow

| Goal | Tripo methods | Core helper |
| --- | --- | --- |
| Generate 3D models | `textTo3D(modelId)`, `imageTo3D(modelId)`, `multiviewTo3D(modelId)` | `generate3D` |
| Generate images and splats | `textToImage(modelId)`, `imageToImage(modelId)`, `imageToMultiview()`, `editMultiview()`, `imageToDepth()`, `imageToSplat()` | `generateAsset` |
| Texture and edit meshes | `texture()`, `segment()`, `smartSegment()`, `complete()`, `retopology()`, `unwrapUV()` | `processModel3D` |
| Convert or import models | `convert()`, `importModel()` | `processModel3D` |
| Check and rig characters | `rigCheck()`, `rig()` | `checkRigging`, `rigModel` |
| Animate a rig | `retarget()` | `animateModel` |

Generation factories shown with `modelId` require an explicit version. Processing methods that accept an optional version can leave it omitted. Use the selected model's native input fields; a native `model` value must agree with the factory version. Supply additional parameters in `providerOptions.tripo`; duplicate keys in `input` are rejected. Asset factories accept optional input and result mappings.

## Connect processing stages

Each generation or processing call creates its own task and may incur a separate charge. Save the result's task ID for the next stage:

- Pass the original model's task ID to `rig()`, rather than the task ID from `rigCheck()`.
- Pass the rig task ID to `retarget()`.
- Treat `riggable: false` as a completed check whose result says the model cannot be rigged.

Generated files remain URL references until you materialize and save them. Use core's `materializeAsset` when you need file bytes.

## Uploads and resources

`files.upload`, `files.presign`, and `files.put` transfer files. Call `importModel()` when you want to create an import task from uploaded data. Account resources are direct requests. The [Tripo guide](https://github.com/fei-bai-inc/sinestack-ai/blob/main/docs/TRIPO.md) documents native inputs, results, uploads, and resource methods.

## Save and resume tasks

For background jobs, use `startAsset` or `startTask` and persist the complete returned `operation` or `task`. Resume through `waitForAsset` or `waitForTask` with the original authorized connection, route, and model. Save each stage separately and reuse its receipt after persistence, query, or download failures to avoid another paid submission. Receipts contain no API key; tenant authorization remains with your application.

Local abort or timeout stops local waiting. This adapter provides no remote cancellation or deletion; the corresponding core calls report unsupported. Submission defaults to zero retries, while status retries query the existing task.

## Connection and webhooks

`createTripoProvider` accepts `apiKey`, `baseURL`, `headers`, `fetch`, `name`, and `connectionId`. The default API root is `https://openapi.tripo3d.ai/v3`.

Configure webhooks at the account level. Use `verifyTripoWebhook` with the original request bytes, then route the notification to the authorized task. See the guide for connection security, signed uploads, deduplication, and delivery handling.

## Guides

- [Tripo: API usage, security, and integration notes](https://github.com/fei-bai-inc/sinestack-ai/blob/main/docs/TRIPO.md)
- [Tripo workflow examples](https://github.com/fei-bai-inc/sinestack-ai/blob/main/examples/tripo.ts)
- [Core: task lifecycle and file materialization](https://github.com/fei-bai-inc/sinestack-ai/blob/main/packages/core/README.md)
