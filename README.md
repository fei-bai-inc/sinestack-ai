# SineStack AI

English | [简体中文](README.zh-CN.md)

SineStack AI is a **compatible extension of Vercel AI SDK 7**, providing a shared model for asynchronous generation and tasks. It reuses AI SDK types and execution utilities, so you can use it alongside existing AI SDK calls. Define typed inputs, results, and service operations to reuse submission, status queries, polling, recovery, execution controls, and lifecycle callbacks across generation, processing, analysis, and resource creation.

The supported AI SDK version is `ai@7.0.155`. Provider packages implement these contracts for direct use or as references for your own integrations.

## Core concepts

| Contract | What it represents | How you extend it |
|---|---|---|
| `TaskDriver<INPUT, RESULT, DOMAIN>` | A task with its own input, result, and domain | Implement `doStart` / `doStatus` for asynchronous work, or `doExecute` for direct execution through domain APIs |
| `AssetModelV1<INPUT, KIND>` | A generation model that produces files | Implement `doStart` / `doStatus` or `doGenerate`; return URL, binary, or base64 assets |
| `TaskHandle` / `AssetOperation` | A serializable reference to submitted work | Persist the complete receipt and restore it with the matching model and connection |

`@sinestack/ai-provider` defines these contracts. `@sinestack/ai-core` executes them. Optional `@sinestack/ai-provider-utils` helpers cover HTTP, JSON, and file mapping for adapter authors.

Task results can contain files, reports, generated content, or resource records. Input and result types belong to each task; new domains and asset kinds can be added through the public interfaces.

## Included providers

The library includes six ready-to-use provider packages built on these contracts. Each package provides typed model and task interfaces; its guide covers installation, credentials, native parameters, and examples.

| Provider | Package | Capabilities |
|---|---|---|
| [Tripo](packages/tripo/README.md) | `@sinestack/ai-tripo` | 3D/image generation, model processing, rig checks, rigging, and animation |
| [Meshy](packages/meshy/README.md) | `@sinestack/ai-meshy` | 3D/image generation, preview/refine, print analysis, rigging, animation, and motion |
| [Viggle](packages/viggle/README.md) | `@sinestack/ai-viggle` | Video/image generation, character animation, motion export, and Gaussian-splat scenes |
| [fal](packages/fal/README.md) | `@sinestack/ai-fal` | Native-input asset generation, queue status, results, and cancellation |
| [WaveSpeed](packages/wavespeed/README.md) | `@sinestack/ai-wavespeed` | Native-input asset generation, prediction status, and result mapping |
| [Replicate](packages/replicate/README.md) | `@sinestack/ai-replicate` | Named or pinned model predictions, status, results, and cancellation |

Provider calls use your service account and may incur charges. Keep credentials server-side. Custom adapters can also connect self-hosted models or an application's existing job backend.

## Install

Use Node.js 22 or 24 with ESM:

```sh
npm install @sinestack/ai-core @sinestack/ai-provider ai@7.0.155
```

Install a provider package when using an existing integration, or implement a model against the contracts below.

## Define an asynchronous task

Wrap the client for your generation service in a `TaskDriver`. This example defines a document-generation task with a structured result:

```ts
import type { JSONValue, TaskDriver, TaskStatus } from '@sinestack/ai-provider';

interface DocumentInput { prompt: string }
interface DocumentResult { sections: readonly string[] }

// The application supplies its service client. read() maps native states/results
// to TaskStatus: pending, running, completed, failed, or cancelled.
interface DocumentJobs {
  create(input: DocumentInput, signal: AbortSignal): Promise<{ id: string }>;
  read(id: string, signal: AbortSignal): Promise<TaskStatus<DocumentResult>>;
}

function jobId(handle: JSONValue): string {
  if (handle === null || typeof handle !== 'object' || Array.isArray(handle) ||
      !('id' in handle) || typeof handle.id !== 'string' || !handle.id.trim()) {
    throw new TypeError('Invalid document job handle');
  }
  return handle.id;
}

export function createDocumentTask(
  jobs: DocumentJobs,
  connectionId: string,
): TaskDriver<DocumentInput, DocumentResult, 'document.generate'> {
  return {
    specificationVersion: 'v1',
    provider: 'my-generation-service',
    driverId: 'document-generator',
    domain: 'document.generate',
    connectionId,
    validateHandle(handle) { jobId(handle); },
    async doStart({ input, abortSignal }) {
      const { id } = await jobs.create(input, abortSignal);
      return { handle: { id } };
    },
    doStatus({ handle, abortSignal }) {
      return jobs.read(jobId(handle), abortSignal);
    },
  };
}
```

Each method performs one service operation. Core supplies the polling loop, progress callbacks, timeout/abort signals, and stage-specific retries. Add `doCancel` or `doDelete` when your service supports those operations. See the [provider authoring guide](packages/provider/README.md) for the full contract.

## Submit, persist, and resume

Use the task above with your `DocumentJobs` client. The following functions submit a document, save its handle, and resume it in a later process:

```ts
import { readFile, writeFile } from 'node:fs/promises';
import { startTask, waitForTask } from '@sinestack/ai-core';
import type { TaskHandle } from '@sinestack/ai-provider';

async function submitDocument(jobs: DocumentJobs, prompt: string) {
  const model = createDocumentTask(jobs, 'documents-account');
  const { task } = await startTask({ model, input: { prompt } });
  try {
    await writeFile('document-task.json', JSON.stringify(task));
  } catch (cause) {
    throw Object.assign(new Error('Could not save the accepted task', { cause }), { task });
  }
  return task;
}

async function resumeDocument(jobs: DocumentJobs) {
  const model = createDocumentTask(jobs, 'documents-account');
  const task: TaskHandle<'document.generate'> = JSON.parse(
    await readFile('document-task.json', 'utf8'),
  );
  const { result } = await waitForTask({ model, task });
  return result.sections;
}
```

Use a database or a separate file per job in an application. Recovery queries the saved task with the original authorized connection; storage and worker scheduling remain application-owned.

| Operation | Generic tasks | File-generation models |
|---|---|---|
| Submit | `startTask` → `task` | `startAsset` → `operation` |
| Read status once | `getTaskStatus` | `getAssetStatus` |
| Wait for the result | `waitForTask` → `{ result, execution }` | `waitForAsset` → asset result |
| Request remote cancellation | `cancelTask` | `cancelAsset` |
| Delete remote resources | `deleteTask` when supported | Provider resource API |

Configure waiting with `poll`, `timeoutMs`, and `abortSignal`; report progress through `hooks`. `retry` controls attempts by stage. Submission retries require declared idempotency support, and local abort ends local waiting rather than cancelling the remote job.

## File generation and domain interfaces

Use `AssetModelV1` when the result is one or more files. `generateAsset({ model, input })` runs generation through completion; `startAsset` and `waitForAsset` split the same work into resumable steps. Results expose the primary `asset`, all `assets`, and provider metadata. `materializeAsset` reads a URL, binary, or base64 asset into bytes.

The SDK also provides entry points for common task domains:

| Use case | Entry points |
|---|---|
| Typed file generation | `generate3D`, `generateMusic`, `generateSoundEffect`, `generateAnimation3D` |
| Model processing and analysis | `processModel3D`, `analyzeModel3D`, `checkRigging` |
| Rigging and character animation | `rigModel`, `animateModel` |

These interfaces retain domain-specific inputs and results while using the shared execution runtime. For another task domain, define its `TaskDriver` and use the generic task APIs. For another file category, define an asset kind and use `generateAsset`.

## Documentation and development

- **Build an integration:** [provider contracts](packages/provider/README.md), [transport and mapping utilities](packages/provider-utils/README.md), [custom file model example](examples/custom-provider.ts).
- **Use the runtime:** [core API](packages/core/README.md), [task architecture](docs/ARCHITECTURE.md), [persistence examples](examples/submit-and-resume.ts).
- **Provider guides:** [Tripo](docs/TRIPO.md), [Meshy](docs/MESHY.md), [Viggle](docs/VIGGLE.md), [media providers](docs/MEDIA_PROVIDERS.md).
- **Project reference:** [AI SDK baseline](docs/UPSTREAM.md), [migration](docs/MIGRATION.md), [security](SECURITY.md), [workerd checks](tests/workerd/README.md).
- **Contribute:** [development guide](CONTRIBUTING.md), [release process](docs/PUBLISHING.md), [changelog](CHANGELOG.md).

From a repository checkout:

```sh
npm ci
npm run build
npm run example:local
npm run verify:release
```

Apache-2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE) for attribution.
