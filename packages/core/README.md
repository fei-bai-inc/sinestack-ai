# @sinestack/ai-core

English | [简体中文](https://github.com/fei-bai-inc/sinestack-ai/blob/main/packages/core/README.zh-CN.md)

The execution runtime for SineStack AI's asynchronous generation and task model. Run typed tasks and file-generation models with shared submission, status, polling, recovery, execution controls, and callbacks. Use it with an existing provider or a custom `TaskDriver` / `AssetModelV1` implementation.

## Install

```sh
npm install @sinestack/ai-core ai@7.0.155
```

Use Node.js 22 or 24 with ESM (`.mjs`, or `"type": "module"`). The package requires Node >=22 and the exact `ai@7.0.155` peer.

## Models and execution

`TaskDriver<INPUT, RESULT, DOMAIN>` describes an operation with its own result type. `AssetModelV1<INPUT, KIND>` specializes generation around file outputs. Core executes these contracts while adapters implement the service-specific operations; application code can reuse the same lifecycle as new models and task types are added.

See the [custom asynchronous task example](https://github.com/fei-bai-inc/sinestack-ai/blob/main/README.md#define-an-asynchronous-task) to implement submission/status and resume a structured result.


## Generate and read a file

This local model turns text into a file. Save as `example.mjs` and run `node example.mjs`; it runs locally without credentials.

```js
import { generateAsset, materializeAsset } from '@sinestack/ai-core';

const model = {
  specificationVersion: 'v1',
  provider: 'local',
  modelId: 'text-file',
  kind: 'document',
  async doGenerate({ input }) {
    return {
      assets: [{
        type: 'binary',
        data: new TextEncoder().encode(input.text),
        mediaType: 'text/plain',
      }],
    };
  },
};

const result = await generateAsset({ model, input: { text: 'Hello, SineStack AI' } });
const file = await materializeAsset(result.asset);
console.log(new TextDecoder().decode(file.uint8Array));
```

For remote generation, install a provider package, configure its server-side API key, and pass an explicit model and its input. Provider permissions and credits apply; submissions may be billable.

## API overview

| Purpose | Functions |
|---|---|
| Generate files | `generateAsset`, or kind-specific `generate3D`, `generateMusic`, `generateSoundEffect`, `generateAnimation3D` |
| Submit and track file generation | `startAsset`, `getAssetStatus`, `waitForAsset`, `cancelAsset` |
| Process and inspect 3D models | `processModel3D`, `analyzeModel3D`, `checkRigging`, `rigModel`, `animateModel` |
| Manage typed asynchronous tasks | `startTask`, `getTaskStatus`, `waitForTask`, `cancelTask`, `deleteTask` |
| Read file contents | `materializeAsset` converts URL, binary, or base64 assets to AI SDK `GeneratedFile` objects |

Core also exports provider interfaces, execution options, and error types.

## Work with results

- File generation returns a nonempty `assets` array and its first file as `asset`. Results can also include warnings, usage, provider metadata, responses, and an asynchronous `operation` receipt.
- Domain functions return their specific business fields together with `execution`. Analysis and rig checks return structured findings; `waitForTask` returns `{ result, execution }`.
- URL assets remain references until you download or materialize them. Save temporary outputs to your own storage; retry a failed download using the existing asset rather than submitting another billable generation.

Use `abortSignal`, `timeoutMs`, `retry`, and `hooks` to control execution. Asset polling accepts `poll.intervalMs` and `poll.timeoutMs`; defaults are 2 seconds and 10 minutes. Submission retries default to zero and require a declared idempotency capability when enabled.

`getAssetStatus` and `getTaskStatus` return failed/cancelled states. Waiting or generation converts them to `AssetExecutionError` / `TaskExecutionError` subclasses, preserving available `response` and `providerMetadata` alongside the receipt, phase, and cause. Inspect these fields to diagnose the existing task; redact signed URLs and provider data before logging.

## Resume or stop a task

Persist the full `operation` from `startAsset` or `task` from `startTask`. Resume with the corresponding `waitFor*` function, matching model, and original authorized connection. Recovery reads the existing task instead of submitting it again.

Local abort or timeout stops local waiting. Use `cancelAsset` or `cancelTask` for remote cancellation when supported; `requested` means the request was acknowledged. `deleteTask` removes the remote task or assets according to the provider's deletion API.

## Guides

- [Tripo](https://github.com/fei-bai-inc/sinestack-ai/blob/main/docs/TRIPO.md) and [Meshy](https://github.com/fei-bai-inc/sinestack-ai/blob/main/docs/MESHY.md): remote generation and 3D workflows
- [Viggle](https://github.com/fei-bai-inc/sinestack-ai/blob/main/docs/VIGGLE.md): video/image generation, reusable characters and motions, exports, and scenes
- [Submit and resume example](https://github.com/fei-bai-inc/sinestack-ai/blob/main/examples/submit-and-resume.ts): receipt persistence and recovery
- [Architecture](https://github.com/fei-bai-inc/sinestack-ai/blob/main/docs/ARCHITECTURE.md): lifecycle, retries, hooks, and recovery contracts
- [Security](https://github.com/fei-bai-inc/sinestack-ai/blob/main/SECURITY.md): credentials, downloads, and trust boundaries
