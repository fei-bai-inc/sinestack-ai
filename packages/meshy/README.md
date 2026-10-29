# @sinestack/ai-meshy

Meshy provider for SineStack AI. Eighteen named generation/processing/analysis/rigging/animation capabilities over seventeen native task resource families, plus task lists/deletion, animation catalog, balance and usage. All jobs use the shared core execution runtime. No provider-specific polling or retry loop.

```ts
import { generate3D, processModel3D, analyzeModel3D } from '@sinestack/ai-core';
import { createMeshyProvider } from '@sinestack/ai-meshy';

const meshy = createMeshyProvider(); // Server-side MESHY_API_KEY.
const modelId = process.env.MESHY_MODEL_ID;
if (!modelId) throw new Error('Choose an explicit Meshy model version');

// Geometry preview only. No hidden refine task or second charge.
const preview = await generate3D({
  model: meshy.textTo3D(modelId),
  input: { prompt: 'A small wooden robot', should_remesh: true },
});
const previewTaskId = preview.providerMetadata?.meshy?.taskId;
if (typeof previewTaskId !== 'string') throw new Error('Missing preview task ID');
const textured = await processModel3D({
  processor: meshy.refine(), // Omission inherits the preview's algorithm version.
  input: { preview_task_id: previewTaskId, enable_pbr: true },
});
const report = await analyzeModel3D({
  analyzer: meshy.analyzePrintability(),
  input: { input_task_id: textured.taskId, printer_type: 'fdm' },
});
console.log(report.printability); // A warning/error finding is not a failed API task.
```

The example creates paid tasks when explicitly executed. For durable applications use `startAsset` / `startTask`, persist each returned receipt, then restore with `waitForAsset` / `waitForTask`. Never restart a task because persistence or file download failed.

Native input fields and unknown JSON extensions are preserved. Optional mappings remain injectable. Factories requiring an algorithm take an explicit open model ID; there is no model catalog or whitelist. `providerOptions.meshy` may supplement, not overwrite input. Set a custom baseURL including `/openapi`, not `/v1`, because Text to 3D uses `/v2`.

Processing uses `processModel3D`; analysis uses `analyzeModel3D`; character rigging and animation use `rigModel` / `animateModel`. Standalone Text to Motion uses `generateAnimation3D`, not a fake rigged character. File results preserve model formats, PBR textures, previews, armatures and actual animation metadata. URLs are not downloaded automatically.

DELETE means removing task/resources, not stopping local waiting or cancelling a running job. Account webhooks do not imply a per-submission callback URL. `parseMeshyWebhook` is deliberately unauthenticated parsing, not signature verification; notifications only wake a registered task's authoritative status query.

This change does not publish the package or call live paid APIs. Creative Lab, SSE streaming and durable scheduling are not included. Full capability, parameter, security, documentation-difference and integration boundaries: [MESHY.md](https://github.com/fei-bai-inc/sinestack-ai/blob/main/docs/MESHY.md).
