# @sinestack/ai-tripo

[English](https://github.com/fei-bai-inc/sinestack-ai/blob/main/packages/tripo/README.md) | 简体中文

通过 SineStack AI 使用 Tripo 生成和处理 3D 模型。从文本或图片生成模型，再进行纹理处理、网格编辑、骨骼绑定和动画制作，同时使用 Tripo 的上传、任务和账户资源。

## 安装

```sh
npm install @sinestack/ai-tripo @sinestack/ai-core ai@7.0.155
```

使用 Node.js 22 或 24 和 ESM（`.mjs` 或 `"type": "module"`；要求 Node >=22）。`ai` 是必需的 peer dependency。在服务端设置 `TRIPO_API_KEY`，将 `TRIPO_MODEL_ID` 设置为账号可用的模型版本。

## 生成模型

将示例保存为 `example.mjs`，运行 `node example.mjs`。执行会提交真实任务，可能消耗 Tripo 的付费额度。

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

## 选择工作流

| 目标 | Tripo 方法 | Core helper |
| --- | --- | --- |
| 生成 3D 模型 | `textTo3D(modelId)`、`imageTo3D(modelId)`、`multiviewTo3D(modelId)` | `generate3D` |
| 生成图片与 splat | `textToImage(modelId)`、`imageToImage(modelId)`、`imageToMultiview()`、`editMultiview()`、`imageToDepth()`、`imageToSplat()` | `generateAsset` |
| 纹理与网格编辑 | `texture()`、`segment()`、`smartSegment()`、`complete()`、`retopology()`、`unwrapUV()` | `processModel3D` |
| 转换或导入模型 | `convert()`、`importModel()` | `processModel3D` |
| 检查与绑定骨骼 | `rigCheck()`、`rig()` | `checkRigging`、`rigModel` |
| 为骨骼制作动画 | `retarget()` | `animateModel` |

表中带 `modelId` 的生成工厂要求显式版本。接受可选版本的处理方法可以省略版本参数。使用所选模型的原生输入字段；原生 `model` 值必须与工厂版本一致。通过 `providerOptions.tripo` 补充其他参数；与 `input` 重复的键会报错。资产工厂支持可选的输入与结果映射。

## 连接处理阶段

每次生成或处理调用都会创建独立任务，并可能单独计费。保存结果中的任务 ID，供下一阶段使用：

- 向 `rig()` 传入原模型的任务 ID，而不是 `rigCheck()` 的任务 ID。
- 向 `retarget()` 传入骨骼绑定任务 ID。
- `riggable: false` 表示检查已完成，结果是该模型无法绑定骨骼。

生成文件在物化并保存前保持为 URL 引用。需要文件字节时，使用 core 的 `materializeAsset`。

## 上传与资源

`files.upload`、`files.presign` 和 `files.put` 用于传输文件。需要从已上传数据创建导入任务时，调用 `importModel()`。账户资源是直接请求。[Tripo 指南](https://github.com/fei-bai-inc/sinestack-ai/blob/main/docs/TRIPO.zh-CN.md)介绍原生输入、结果、上传和资源方法。

## 保存与恢复任务

后台任务使用 `startAsset` 或 `startTask`，并保存返回的完整 `operation` 或 `task`。通过原授权连接、路由和模型，使用 `waitForAsset` 或 `waitForTask` 恢复。每个阶段单独保存；持久化、查询或下载失败后复用原凭据，避免再次付费提交。凭据不包含 API key；应用负责租户授权。

本地 abort 或 timeout 停止本地等待。此 adapter 不提供远端取消或删除，对应 core 调用会报告不支持。提交默认零重试，状态重试查询已有任务。

## 连接与 webhook

`createTripoProvider` 接受 `apiKey`、`baseURL`、`headers`、`fetch`、`name` 和 `connectionId`。默认 API 根地址为 `https://openapi.tripo3d.ai/v3`。

在账户级别配置 webhook。使用原始请求字节调用 `verifyTripoWebhook`，然后将通知路由到已授权任务。连接安全、签名上传、去重和投递处理见指南。

## 指南

- [Tripo：API 用法、安全与集成说明](https://github.com/fei-bai-inc/sinestack-ai/blob/main/docs/TRIPO.zh-CN.md)
- [Tripo 工作流示例](https://github.com/fei-bai-inc/sinestack-ai/blob/main/examples/tripo.ts)
- [Core：任务生命周期与文件物化](https://github.com/fei-bai-inc/sinestack-ai/blob/main/packages/core/README.zh-CN.md)
