# @sinestack/ai-provider

English | [简体中文](https://github.com/fei-bai-inc/sinestack-ai/blob/main/packages/provider/README.zh-CN.md)

The contracts for SineStack AI's general-purpose generation and task model. Use `TaskDriver` for operations with arbitrary typed results and `AssetModelV1` for file generation. Implement these interfaces to connect a public API, a self-hosted model, or an existing job service to the core runtime.

## Install

```sh
npm install @sinestack/ai-provider
```

Use Node.js 22 or 24 with ESM. The package requires Node >=22. To execute your adapter through core, also install:

```sh
npm install @sinestack/ai-core ai@7.0.155
```

## Extend a task or a model

For asynchronous work, implement `doStart` and `doStatus`; core manages submission and waiting. A `TaskDriver` keeps your input/result types and a domain identifier. An `AssetModelV1` adds a file kind and asset results. Cancellation, deletion, and handle validation are optional capabilities.

Start with the [asynchronous task example](https://github.com/fei-bai-inc/sinestack-ai/blob/main/README.md#define-an-asynchronous-task) for a structured-result job. The local file model below demonstrates the file-generation contract.


## Implement a file model

This complete local implementation accepts text and returns a binary file. Save it in a TypeScript ESM project:

```ts
import type { AssetModelV1 } from '@sinestack/ai-provider';

export const textFile: AssetModelV1<{ text: string }, 'document'> = {
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
```

With core installed, execute it in the same file:

```ts
import { generateAsset } from '@sinestack/ai-core';

const result = await generateAsset({ model: textFile, input: { text: 'Hello, SineStack AI' } });
console.log(result.asset);
```

The example runs locally. Remote adapters configure server-side authentication and use the provider account's permissions and credits; requests may be billable.

## Choose a contract

| Contract | Implementation or use |
|---|---|
| `AssetModelV1<INPUT, KIND>` | Implement `doGenerate` or both `doStart` and `doStatus`; optionally add `doCancel`. Completed results contain a nonempty file list. |
| `TaskDriver<INPUT, RESULT, DOMAIN>` | Implement `doExecute` or both `doStart` and `doStatus`; optionally add `doCancel`, `doDelete`, and synchronous `validateHandle` for recovery. |
| `Model3DProcessor`, `Model3DAnalyzer`, `RigChecker`, `ModelRigger`, `ModelAnimator` | Use the domain-specific input and result types for processing, analysis, rig checks, rigging, and animation. |
| `AssetFile` | Return URL, binary, or base64 files with a media type and optional filename, role, and metadata. |
| `AssetModelMapping` | Supply `mapInput` and/or `mapResult` to adapt an application's schema. |
| `AssetOperation`, `TaskHandle` | Persist the complete JSON receipt to resume an existing operation or task. |

Shared exports also include JSON, warning, and provider metadata types.

## Implement lifecycle methods

Each adapter method performs one provider operation; core handles polling, retries, and lifecycle hooks. Forward the supplied abort signal and declare idempotency or per-submission webhook capabilities when the remote API supports them.

Include available `response` and `providerMetadata` on failed/cancelled statuses. Core preserves these diagnostics when waiting or generation turns a terminal status into a Task/Asset error, so callers can inspect the failed task without submitting a replacement.

For recovery, validate the receipt against the original provider, route, model, and authorized connection. Preserve the full receipt, including the `sine-ai-task` marker in TaskHandle v1.

Implement cancellation and deletion according to their separate remote APIs. A cancellation response of `requested` acknowledges the request; use `cancelled` when cancellation is complete. Local abort signals stop the current call, while remote cancellation needs an explicit provider operation.

## Guides

- [Custom provider example](https://github.com/fei-bai-inc/sinestack-ai/blob/main/examples/custom-provider.ts): a complete adapter example
- [Core usage](https://github.com/fei-bai-inc/sinestack-ai/blob/main/packages/core/README.md): generation, domain calls, and task recovery
- [Provider utilities](https://github.com/fei-bai-inc/sinestack-ai/blob/main/packages/provider-utils/README.md): JSON, file mapping, and HTTP helpers
- [Architecture and Driver protocol](https://github.com/fei-bai-inc/sinestack-ai/blob/main/docs/ARCHITECTURE.md): detailed contracts
- [Security](https://github.com/fei-bai-inc/sinestack-ai/blob/main/SECURITY.md): authentication and recovery authorization
