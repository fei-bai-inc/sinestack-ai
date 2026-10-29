# @sinestack/ai-core

[English](https://github.com/fei-bai-inc/sinestack-ai/blob/main/packages/core/README.md) | 简体中文

SineStack AI 通用异步生成与任务模型的执行运行时。为带类型的任务与文件生成模型提供提交、状态查询、轮询、恢复、执行控制和回调。既可使用现有 provider，也可执行自定义 `TaskDriver` / `AssetModelV1` 实现。

## 安装

```sh
npm install @sinestack/ai-core ai@7.0.155
```

使用 Node.js 22 或 24 与 ESM（`.mjs`，或设置 `"type": "module"`）。包要求 Node >=22，并依赖精确版本的 `ai@7.0.155` peer。

## 模型与执行

`TaskDriver<INPUT, RESULT, DOMAIN>` 描述具有独立结果类型的操作，`AssetModelV1<INPUT, KIND>` 则表达输出文件的生成模型。Core 执行这些协议，adapter 实现具体服务操作；接入新模型和任务类型后，应用继续使用相同的生命周期。

通过[自定义异步任务示例](https://github.com/fei-bai-inc/sinestack-ai/blob/main/README.zh-CN.md#定义异步任务)了解如何实现提交/状态查询，并恢复结构化结果。


## 生成并读取文件

下面的本地模型将文本转为文件。保存为 `example.mjs`，运行 `node example.mjs`；示例在本地执行，无需凭据。

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

远端生成需要安装 provider 包、配置服务端 API key，并显式传入模型及其输入。调用受供应商账号权限和额度限制，提交可能计费。

## API 概览

| 用途 | 函数 |
|---|---|
| 生成文件 | `generateAsset`，或按 kind 约束的 `generate3D`、`generateMusic`、`generateSoundEffect`、`generateAnimation3D` |
| 提交与跟踪文件生成 | `startAsset`、`getAssetStatus`、`waitForAsset`、`cancelAsset` |
| 处理与检查 3D 模型 | `processModel3D`、`analyzeModel3D`、`checkRigging`、`rigModel`、`animateModel` |
| 管理带类型的异步任务 | `startTask`、`getTaskStatus`、`waitForTask`、`cancelTask`、`deleteTask` |
| 读取文件内容 | `materializeAsset` 将 URL、binary 或 base64 资产转为 AI SDK `GeneratedFile` 对象 |

core 还导出 provider 接口、执行选项与错误类型。

## 使用结果

- 文件生成返回非空的 `assets` 数组，并通过 `asset` 提供首个文件。结果还可包含警告、用量、provider 元数据、响应以及异步 `operation` 回执。
- 领域函数返回各自的业务字段和 `execution`。分析与骨骼检查返回结构化结论；`waitForTask` 返回 `{ result, execution }`。
- URL 资产在下载或物化之前仍是引用。将临时产物保存到自己的存储中；下载失败时使用已有资产重试下载，避免再次提交计费生成。

通过 `abortSignal`、`timeoutMs`、`retry` 和 `hooks` 控制执行。Asset 轮询支持 `poll.intervalMs` 和 `poll.timeoutMs`，默认分别为 2 秒和 10 分钟。提交默认不重试，启用重试要求模型声明幂等能力。

`getAssetStatus` 和 `getTaskStatus` 返回 failed/cancelled 状态；等待或生成会将其转为 `AssetExecutionError` / `TaskExecutionError` 的相应子类，并在回执、phase 和 cause 之外保留可用的 `response` 与 `providerMetadata`。使用这些字段诊断已有任务；记录日志前先脱敏签名 URL 和供应商数据。

## 恢复或停止任务

持久化 `startAsset` 返回的完整 `operation` 或 `startTask` 返回的完整 `task`。使用匹配模型、原授权连接和对应的 `waitFor*` 函数恢复。恢复读取已有任务，不会重新提交。

本地 abort 或超时会停止本地等待。供应商支持时，使用 `cancelAsset` 或 `cancelTask` 请求远端取消；`requested` 表示请求已被接受。`deleteTask` 按供应商删除 API 的语义移除远端任务或产物。

## 指南

- [Tripo](https://github.com/fei-bai-inc/sinestack-ai/blob/main/docs/TRIPO.zh-CN.md) 与 [Meshy](https://github.com/fei-bai-inc/sinestack-ai/blob/main/docs/MESHY.zh-CN.md)：远端生成和 3D 工作流
- [Viggle](https://github.com/fei-bai-inc/sinestack-ai/blob/main/docs/VIGGLE.zh-CN.md)：视频/图像生成、可复用角色与动作、导出及场景
- [提交与恢复示例](https://github.com/fei-bai-inc/sinestack-ai/blob/main/examples/submit-and-resume.ts)：回执持久化与恢复
- [架构](https://github.com/fei-bai-inc/sinestack-ai/blob/main/docs/ARCHITECTURE.zh-CN.md)：生命周期、重试、hooks 与恢复契约
- [安全](https://github.com/fei-bai-inc/sinestack-ai/blob/main/SECURITY.zh-CN.md)：凭据、下载与信任边界
