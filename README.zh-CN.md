# SineStack AI

[English](README.md) | 简体中文

SineStack AI 是 **Vercel AI SDK 7 的兼容扩展**，提供通用异步生成与任务模型。它复用 AI SDK 的类型和执行工具，可与现有 AI SDK 调用在同一项目中使用。定义任务的输入、结果和服务操作后，即可在生成、处理、分析和资源创建等任务中复用提交、状态查询、轮询、恢复、执行控制与生命周期回调。

Provider 包是这些协议的具体实现，既可直接使用，也可作为自定义接入的参考。

## 核心概念

| 协议 | 表达什么 | 如何扩展 |
|---|---|---|
| `TaskDriver<INPUT, RESULT, DOMAIN>` | 具有独立输入、结果和领域的任务 | 异步任务实现 `doStart` / `doStatus`；通过领域 API 直接执行的任务实现 `doExecute` |
| `AssetModelV1<INPUT, KIND>` | 输出文件的生成模型 | 实现 `doStart` / `doStatus` 或 `doGenerate`，返回 URL、binary 或 base64 资产 |
| `TaskHandle` / `AssetOperation` | 已提交任务的可序列化引用 | 保存完整凭据，使用匹配的模型和连接恢复 |

`@sinestack/ai-provider` 定义这些协议，`@sinestack/ai-core` 负责执行。编写 adapter 时，还可使用 `@sinestack/ai-provider-utils` 提供的 HTTP、JSON 和文件映射工具。

任务结果可以是文件、报告、生成内容或资源记录。每个任务保留自己的输入和结果类型，新领域与资产类型通过公开接口扩展。

## 已实现的 Provider

基于上述协议，库中已实现六个可直接使用的 provider 包，提供带类型的模型与任务接口。各包指南包含安装、凭据配置、原生参数和使用示例。

| Provider | 包名 | 主要能力 |
|---|---|---|
| [Tripo](packages/tripo/README.zh-CN.md) | `@sinestack/ai-tripo` | 3D/图像生成、模型处理、骨骼检查、绑定与动画 |
| [Meshy](packages/meshy/README.zh-CN.md) | `@sinestack/ai-meshy` | 3D/图像生成、预览/细化、打印分析、绑定、动画与独立动作 |
| [Viggle](packages/viggle/README.zh-CN.md) | `@sinestack/ai-viggle` | 视频/图像生成、角色动画、动作导出与高斯泼溅场景 |
| [fal](packages/fal/README.zh-CN.md) | `@sinestack/ai-fal` | 原生参数资产生成、队列状态、结果获取与取消 |
| [WaveSpeed](packages/wavespeed/README.zh-CN.md) | `@sinestack/ai-wavespeed` | 原生参数资产生成、prediction 状态与结果映射 |
| [Replicate](packages/replicate/README.zh-CN.md) | `@sinestack/ai-replicate` | 指定模型或固定版本的 prediction、状态、结果获取与取消 |

Provider 调用使用你的服务账号，可能产生费用，凭据应保留在服务端。自定义 adapter 还可接入自托管模型或应用已有的任务后端。

## 安装

使用 Node.js 22 或 24 和 ESM：

```sh
npm install @sinestack/ai-core @sinestack/ai-provider ai@7.0.155
```

使用已有接入时，再安装对应 provider 包；接入自己的服务时，实现下面的模型协议。

## 定义异步任务

将生成服务的客户端适配为 `TaskDriver`。下面定义一个返回结构化结果的文档生成任务：

```ts
import type { JSONValue, TaskDriver, TaskStatus } from '@sinestack/ai-provider';

interface DocumentInput { prompt: string }
interface DocumentResult { sections: readonly string[] }

// 应用提供生成服务客户端。read() 将原生状态和结果映射为
// TaskStatus：pending、running、completed、failed 或 cancelled。
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

每个方法执行一次服务操作，core 提供轮询、进度回调、超时/中止信号和分阶段重试。服务支持取消或删除时，补充 `doCancel` 或 `doDelete`。完整协议见 [provider 开发指南](packages/provider/README.zh-CN.md)。

## 提交、持久化与恢复

将上面的任务适配器与自己的 `DocumentJobs` 客户端组合使用。以下函数提交文档生成任务、保存凭据，并在后续进程中恢复：

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

应用可使用数据库，或为每个任务单独保存文件。恢复时通过原授权连接查询已保存的任务；存储和 worker 调度由应用提供。

| 操作 | 通用任务 | 文件生成模型 |
|---|---|---|
| 提交 | `startTask` → `task` | `startAsset` → `operation` |
| 查询一次状态 | `getTaskStatus` | `getAssetStatus` |
| 等待结果 | `waitForTask` → `{ result, execution }` | `waitForAsset` → 资产结果 |
| 请求远端取消 | `cancelTask` | `cancelAsset` |
| 删除远端资源 | 能力支持时使用 `deleteTask` | Provider 资源接口 |

通过 `poll`、`timeoutMs` 和 `abortSignal` 配置等待，通过 `hooks` 展示进度，使用 `retry` 控制各阶段重试次数。提交重试要求声明幂等支持；本地 abort 结束本地等待，远端任务的取消通过取消接口执行。

## 文件生成与领域接口

当结果是一组文件时，使用 `AssetModelV1`。`generateAsset({ model, input })` 执行生成并等待完成；`startAsset` 与 `waitForAsset` 将同一过程拆为可恢复的步骤。结果提供主文件 `asset`、全部文件 `assets` 和 provider 元数据。`materializeAsset` 将 URL、binary 或 base64 资产读取为字节。

SDK 还提供常见任务领域的调用入口：

| 用途 | 入口 |
|---|---|
| 按类型生成文件 | `generate3D`、`generateMusic`、`generateSoundEffect`、`generateAnimation3D` |
| 模型处理与分析 | `processModel3D`、`analyzeModel3D`、`checkRigging` |
| 骨骼绑定与角色动画 | `rigModel`、`animateModel` |

这些接口保留各领域的输入与结果，并使用共享执行运行时。扩展其他任务领域时，定义自己的 `TaskDriver`，通过通用任务 API 调用；扩展其他文件类别时，定义资产 kind，通过 `generateAsset` 调用。

## 文档与开发

- **编写接入：**[provider 协议](packages/provider/README.zh-CN.md)、[传输和映射工具](packages/provider-utils/README.zh-CN.md)、[自定义文件模型示例](examples/custom-provider.ts)。
- **使用运行时：**[core API](packages/core/README.zh-CN.md)、[任务架构](docs/ARCHITECTURE.zh-CN.md)、[持久化示例](examples/submit-and-resume.ts)。
- **Provider 指南：**[Tripo](docs/TRIPO.zh-CN.md)、[Meshy](docs/MESHY.zh-CN.md)、[Viggle](docs/VIGGLE.zh-CN.md)、[Media providers](docs/MEDIA_PROVIDERS.zh-CN.md)。
- **项目参考：**[AI SDK 基线](docs/UPSTREAM.zh-CN.md)、[迁移](docs/MIGRATION.zh-CN.md)、[安全](SECURITY.zh-CN.md)、[workerd 检查](tests/workerd/README.zh-CN.md)。
- **参与开发：**[贡献指南](CONTRIBUTING.zh-CN.md)、[发布流程](docs/PUBLISHING.zh-CN.md)、[变更记录](CHANGELOG.zh-CN.md)。

在仓库目录中运行：

```sh
npm ci
npm run build
npm run example:local
npm run verify:release
```

Apache-2.0。归属信息见 [LICENSE](LICENSE) 和 [NOTICE](NOTICE)。
