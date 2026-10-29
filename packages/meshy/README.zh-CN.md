# @sinestack/ai-meshy

[English](https://github.com/fei-bai-inc/sinestack-ai/blob/main/packages/meshy/README.md) | 简体中文

通过 SineStack AI 使用 Meshy 生成 3D 模型、添加纹理并完成后续处理。适用于文本或图片生成 3D、可打印性分析与修复、角色骨骼绑定、动画制作，以及独立的文本生成动作工作流。

## 安装

```sh
npm install @sinestack/ai-meshy @sinestack/ai-core ai@7.0.155
```

使用 Node.js 22 或 24 和 ESM（`.mjs` 或 `"type": "module"`；要求 Node >=22）。`ai` 是必需的 peer dependency。在服务端设置 `MESHY_API_KEY`，将 `MESHY_MODEL_ID` 设置为账号可用的模型版本。

## 生成模型、添加纹理并分析

将示例保存为 `example.mjs`，运行 `node example.mjs`。示例创建三个独立任务：几何预览、纹理细化和可打印性分析。每个阶段都可能消耗 Meshy 的付费额度。

```js
import { generate3D, processModel3D, analyzeModel3D } from '@sinestack/ai-core';
import { createMeshyProvider } from '@sinestack/ai-meshy';

const meshy = createMeshyProvider();
const modelId = process.env.MESHY_MODEL_ID;
if (!modelId) throw new Error('Choose an explicit Meshy model version');

// 生成几何预览。
const preview = await generate3D({
  model: meshy.textTo3D(modelId),
  input: { prompt: 'A small wooden robot', should_remesh: true },
});
const previewTaskId = preview.providerMetadata?.meshy?.taskId;
if (typeof previewTaskId !== 'string') throw new Error('Missing preview task ID');
const textured = await processModel3D({
  processor: meshy.refine(), // 继承预览阶段的算法版本。
  input: { preview_task_id: previewTaskId, enable_pbr: true },
});
const report = await analyzeModel3D({
  analyzer: meshy.analyzePrintability(),
  input: { input_task_id: textured.taskId, printer_type: 'fdm' },
});
console.log(report.printability);
```

`textTo3D` 生成几何预览。添加纹理时，显式调用 `refine()` 并传入预览任务 ID。后续分析使用细化模型的 `taskId`。可打印性警告或错误发现属于分析结果，不代表 API 任务失败。

## 选择工作流

| 目标 | Meshy 方法 | Core helper |
| --- | --- | --- |
| 生成 3D 模型 | `textTo3D(modelId)`、`imageTo3D(modelId)`、`multiImageTo3D(modelId)` | `generate3D` |
| 生成图片 | `textToImage(modelId)`、`imageToImage(modelId)` | `generateAsset` |
| 添加或替换纹理 | `refine()`、`retexture()` | `processModel3D` |
| 编辑与导出网格 | `remesh()`、`convert()`、`resize()`、`unwrapUV()` | `processModel3D` |
| 准备打印 | `multiColorPrint()`、`repairPrintability()`、`autoSplit()` | `processModel3D` |
| 分析可打印性 | `analyzePrintability()` | `analyzeModel3D` |
| 角色绑定与动画 | `rig()`、`animate()` | `rigModel`、`animateModel` |
| 生成独立动作 | `textToMotion(mode)` | `generateAnimation3D` |

表中带 `modelId` 的生成工厂要求显式模型。`textToMotion` 需要选择支持的 mode。省略 `refine()` 的版本时，会继承预览阶段的算法版本。

## 输入与输出

使用所选模型的原生输入字段。额外 JSON 字段会保留，`providerOptions.meshy` 可以补充参数，但不会覆盖 `input`。工厂支持可选映射，用于适配应用输入；资产工厂还支持结果映射。

文件结果保留模型格式、PBR 纹理、预览、骨骼和动画元数据。文件在下载前保持为 URL 引用；需要字节数据时使用 core 的 `materializeAsset`。Provider 还提供任务列表与删除、动画目录、余额和用量资源。原生参数与资源方法见指南。

## 保存与恢复阶段

后台工作流使用 `startAsset` 或 `startTask`，并保存每次返回的完整 `operation` 或 `task`。通过相同授权账号、路由、阶段和模型选择，使用 `waitForAsset` 或 `waitForTask` 恢复。持久化、查询或下载失败后复用原凭据，避免再次付费提交。凭据不包含 API key；应用负责租户授权。

提交默认零重试；状态重试查询已有任务。本地 abort 或 timeout 停止本地等待，不会停止远端工作。

## 删除任务

使用 `deleteTask` 处理领域任务凭据，或使用 `meshy.tasks.delete(family, id)` 处理原生任务 ID（包括资产任务）。删除会移除任务资源，不会取消正在运行的生成任务。`409` 响应表示删除失败。此 adapter 不支持远端取消，`cancelTask` 和 `cancelAsset` 会报告不支持。

## 连接与 webhook

`createMeshyProvider` 接受 `apiKey`、`baseURL`、`headers`、`fetch`、`name` 和 `connectionId`。默认根地址为 `https://api.meshy.ai/openapi`。自定义根地址必须包含 `/openapi`；adapter 会按操作选择 `/v1` 或 `/v2`。

在账户级别配置 webhook。`parseMeshyWebhook` 解析载荷，但不进行认证。应用应认证通知，将其关联到已登记任务，并通过授权连接查询这些任务。连接安全、去重和投递处理见指南。

## 指南

- [Meshy：API 用法、安全与集成说明](https://github.com/fei-bai-inc/sinestack-ai/blob/main/docs/MESHY.zh-CN.md)
- [Meshy 持久化工作流示例](https://github.com/fei-bai-inc/sinestack-ai/blob/main/examples/meshy.ts)
- [Core：任务生命周期与文件物化](https://github.com/fei-bai-inc/sinestack-ai/blob/main/packages/core/README.zh-CN.md)
