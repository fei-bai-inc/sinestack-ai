# @sinestack/ai-provider

[English](https://github.com/fei-bai-inc/sinestack-ai/blob/main/packages/provider/README.md) | 简体中文

SineStack AI 通用生成与任务模型的协议定义。通过 `TaskDriver` 表达任意带类型结果的操作，通过 `AssetModelV1` 表达文件生成。实现这些接口，即可将公开 API、自托管模型或已有任务服务接入 core 运行时。

## 安装

```sh
npm install @sinestack/ai-provider
```

使用 Node.js 22 或 24 与 ESM，包要求 Node >=22。通过 core 执行 adapter 时，还需安装：

```sh
npm install @sinestack/ai-core ai@7.0.155
```

## 扩展任务或模型

异步任务实现 `doStart` 和 `doStatus`，由 core 管理提交与等待。`TaskDriver` 保留自己的输入/结果类型和领域标识；`AssetModelV1` 增加文件 kind 和资产结果。按需实现取消、删除与凭据校验能力。

返回结构化结果的任务可参考[异步任务示例](https://github.com/fei-bai-inc/sinestack-ai/blob/main/README.zh-CN.md#定义异步任务)。下面的本地文件模型演示文件生成协议。


## 实现文件模型

下面的完整本地实现接收文本并返回二进制文件。将它保存在 TypeScript ESM 项目中：

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

安装 core 后，在同一文件中执行：

```ts
import { generateAsset } from '@sinestack/ai-core';

const result = await generateAsset({ model: textFile, input: { text: 'Hello, SineStack AI' } });
console.log(result.asset);
```

示例在本地运行。远端 adapter 需要配置服务端认证，并使用供应商账号的权限和额度；请求可能计费。

## 选择契约

| 契约 | 实现方式或用途 |
|---|---|
| `AssetModelV1<INPUT, KIND>` | 实现 `doGenerate` 或完整的 `doStart` 与 `doStatus`，可选实现 `doCancel`。完成结果包含非空文件列表。 |
| `TaskDriver<INPUT, RESULT, DOMAIN>` | 实现 `doExecute` 或完整的 `doStart` 与 `doStatus`，可选实现 `doCancel`、`doDelete` 和用于恢复的同步 `validateHandle`。 |
| `Model3DProcessor`、`Model3DAnalyzer`、`RigChecker`、`ModelRigger`、`ModelAnimator` | 使用领域专属的输入和结果类型，实现处理、分析、骨骼检查、绑定与动画。 |
| `AssetFile` | 返回 URL、binary 或 base64 文件，附带媒体类型及可选的文件名、角色与元数据。 |
| `AssetModelMapping` | 通过 `mapInput` 和/或 `mapResult` 适配应用的数据结构。 |
| `AssetOperation`、`TaskHandle` | 持久化完整 JSON 回执，恢复已有操作或任务。 |

公共导出还包括 JSON、警告与 provider 元数据类型。

## 实现生命周期方法

每个 adapter 方法执行一次供应商操作，由 core 负责轮询、重试和生命周期 hooks。传递调用方提供的 abort signal；远端 API 支持幂等或提交级 webhook 时，再声明相应能力。

在 failed/cancelled 状态中提供可用的 `response` 与 `providerMetadata`。等待或生成将终态转换为 Task/Asset 错误时，core 会保留这些诊断信息，调用方无需重新提交即可检查失败任务。

恢复时，按原 provider、路由、模型和授权连接校验回执。保留完整回执，包括 TaskHandle v1 中的 `sine-ai-task` 标记。

按各自的远端 API 分别实现取消和删除。取消响应中的 `requested` 表示请求已被接受；取消完成后使用 `cancelled`。本地 abort signal 停止当前调用，远端取消则需要显式调用供应商操作。

## 指南

- [自定义 provider 示例](https://github.com/fei-bai-inc/sinestack-ai/blob/main/examples/custom-provider.ts)：完整 adapter 示例
- [Core 用法](https://github.com/fei-bai-inc/sinestack-ai/blob/main/packages/core/README.zh-CN.md)：生成、领域调用与任务恢复
- [Provider 工具](https://github.com/fei-bai-inc/sinestack-ai/blob/main/packages/provider-utils/README.zh-CN.md)：JSON、文件映射和 HTTP 辅助函数
- [架构与 Driver 协议](https://github.com/fei-bai-inc/sinestack-ai/blob/main/docs/ARCHITECTURE.zh-CN.md)：详细契约
- [安全](https://github.com/fei-bai-inc/sinestack-ai/blob/main/SECURITY.zh-CN.md)：认证与恢复授权
