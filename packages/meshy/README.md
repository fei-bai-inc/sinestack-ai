# @sinestack/ai-meshy

English | [简体中文](https://github.com/fei-bai-inc/sinestack-ai/blob/main/packages/meshy/README.zh-CN.md)

Generate, texture, and prepare 3D models with Meshy through SineStack AI. Use it for text- and image-to-3D workflows, printability analysis and repair, character rigging, animation, and standalone text-to-motion generation.

## Install

```sh
npm install @sinestack/ai-meshy @sinestack/ai-core ai@7.0.155
```

Use Node.js 22 or 24 with ESM (`.mjs` or `"type": "module"`; Node >=22 is required). The `ai` package is a required peer dependency. Set `MESHY_API_KEY` on the server and `MESHY_MODEL_ID` to a model version available to your account.

## Generate, texture, and analyze a model

Save this example as `example.mjs` and run `node example.mjs`. It creates three separate tasks: geometry preview, texture refinement, and printability analysis. Each stage may use paid Meshy credits.

```js
import { generate3D, processModel3D, analyzeModel3D } from '@sinestack/ai-core';
import { createMeshyProvider } from '@sinestack/ai-meshy';

const meshy = createMeshyProvider();
const modelId = process.env.MESHY_MODEL_ID;
if (!modelId) throw new Error('Choose an explicit Meshy model version');

// Generate the geometry preview.
const preview = await generate3D({
  model: meshy.textTo3D(modelId),
  input: { prompt: 'A small wooden robot', should_remesh: true },
});
const previewTaskId = preview.providerMetadata?.meshy?.taskId;
if (typeof previewTaskId !== 'string') throw new Error('Missing preview task ID');
const textured = await processModel3D({
  processor: meshy.refine(), // Inherit the preview's algorithm version.
  input: { preview_task_id: previewTaskId, enable_pbr: true },
});
const report = await analyzeModel3D({
  analyzer: meshy.analyzePrintability(),
  input: { input_task_id: textured.taskId, printer_type: 'fdm' },
});
console.log(report.printability);
```

`textTo3D` produces the geometry preview. Call `refine()` explicitly to add textures, using the preview's task ID. Analysis then takes the refined model's `taskId`. Printability warnings or error findings are analysis results; they do not mean the API task failed.

## Choose a workflow

| Goal | Meshy methods | Core helper |
| --- | --- | --- |
| Generate 3D models | `textTo3D(modelId)`, `imageTo3D(modelId)`, `multiImageTo3D(modelId)` | `generate3D` |
| Generate images | `textToImage(modelId)`, `imageToImage(modelId)` | `generateAsset` |
| Add or replace textures | `refine()`, `retexture()` | `processModel3D` |
| Edit and export meshes | `remesh()`, `convert()`, `resize()`, `unwrapUV()` | `processModel3D` |
| Prepare for printing | `multiColorPrint()`, `repairPrintability()`, `autoSplit()` | `processModel3D` |
| Analyze printability | `analyzePrintability()` | `analyzeModel3D` |
| Rig and animate characters | `rig()`, `animate()` | `rigModel`, `animateModel` |
| Generate standalone motion | `textToMotion(mode)` | `generateAnimation3D` |

Generation factories shown with `modelId` require an explicit model. For `textToMotion`, choose a supported mode. Omitting the version from `refine()` inherits the preview's algorithm version.

## Inputs and outputs

Use the selected model's native input fields. Additional JSON fields are preserved, and `providerOptions.meshy` can supplement parameters without overwriting `input`. Factories accept optional mappings to adapt application inputs; asset factories also support result mappings.

File results preserve model formats, PBR textures, previews, armatures, and animation metadata. Files remain URL references until you download them; use core's `materializeAsset` when you need bytes. The provider also exposes task listing and deletion, an animation catalog, balance, and usage resources. See the guide for native parameters and resource methods.

## Save and resume stages

For background workflows, use `startAsset` or `startTask` and persist each complete returned `operation` or `task`. Resume with `waitForAsset` or `waitForTask` on the same authorized account, route, stage, and model selection. Reuse the original receipt after persistence, query, or download failures to avoid another paid submission. Receipts contain no API key; your application maintains tenant authorization.

Submission defaults to zero retries; status retries query the existing job. Local abort or timeout stops local waiting, not remote work.

## Delete tasks

Use `deleteTask` with domain task receipts, or `meshy.tasks.delete(family, id)` with native task IDs, including asset jobs. Deletion removes task resources; it does not cancel running generation. A `409` response means deletion failed. Remote cancellation is unsupported by this adapter, so `cancelTask` and `cancelAsset` report unsupported.

## Connection and webhooks

`createMeshyProvider` accepts `apiKey`, `baseURL`, `headers`, `fetch`, `name`, and `connectionId`. The default root is `https://api.meshy.ai/openapi`. Custom roots must include `/openapi`; the adapter selects `/v1` or `/v2` for each operation.

Configure webhooks at the account level. `parseMeshyWebhook` parses payloads without authenticating them. Authenticate notifications in your application, associate them with registered tasks, and query those tasks on the authorized connection. See the guide for connection security, deduplication, and delivery handling.

## Guides

- [Meshy: API usage, security, and integration notes](https://github.com/fei-bai-inc/sinestack-ai/blob/main/docs/MESHY.md)
- [Durable Meshy workflow examples](https://github.com/fei-bai-inc/sinestack-ai/blob/main/examples/meshy.ts)
- [Core: task lifecycle and file materialization](https://github.com/fei-bai-inc/sinestack-ai/blob/main/packages/core/README.md)
