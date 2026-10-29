# @sinestack/ai-replicate

[English](https://github.com/fei-bai-inc/sinestack-ai/blob/main/packages/replicate/README.md) | 简体中文

通过 SineStack AI 使用 Replicate 生成音乐、音效、3D 模型和动画文件。此包适合使用模型原生 JSON 输入调用文件生成服务，并在应用中管理生成任务。

## 安装

```sh
npm install @sinestack/ai-replicate @sinestack/ai-core ai@7.0.155
```

使用 Node.js 22 或 24 和 ESM（`.mjs` 或 `"type": "module"`；要求 Node >=22）。将 `REPLICATE_API_TOKEN` 保存在服务端。`ai` 是必需的 peer dependency。

## 生成音乐

将 `REPLICATE_MUSIC_MODEL_ID` 设置为账号可用的音乐模型，将 `REPLICATE_INPUT_JSON` 设置为符合该模型参数要求的原生输入 JSON。将示例保存为 `example.mjs`，运行 `node example.mjs`。执行会提交真实任务，可能消耗服务商的付费额度。

```js
import { generateMusic } from '@sinestack/ai-core';
import { createReplicateAssetProvider } from '@sinestack/ai-replicate';

const modelId = process.env.REPLICATE_MUSIC_MODEL_ID;
const inputJSON = process.env.REPLICATE_INPUT_JSON;
if (!modelId || !inputJSON) throw new Error('Set REPLICATE_MUSIC_MODEL_ID and REPLICATE_INPUT_JSON');
const provider = createReplicateAssetProvider();
const result = await generateMusic({
  model: provider.music(modelId),
  input: JSON.parse(inputJSON),
});
console.log(result.assets, result.providerMetadata?.replicate?.output);
```

## 选择能力

每个工厂方法都要求显式模型 ID。工厂方法选择资产类别，输入字段由模型的原生参数规范决定。

| Provider 方法 | 资产类别 | Core helper |
| --- | --- | --- |
| `music(modelId)` | `music` | `generateMusic` |
| `soundEffect(modelId)` | `sound-effect` | `generateSoundEffect` |
| `threeD(modelId)` | `model-3d` | `generate3D` |
| `animation3D(modelId)` | `animation-3d` | `generateAnimation3D` |
| `asset(modelId, { kind })` | 自选类别 | `generateAsset` |

## 输入、映射与文件

默认原样发送输入 JSON。通过 `providerOptions.replicate` 补充其他原生参数；与 `input` 重复的键会报错。

在工厂选项中传入可选的 `mapInput` 和 `mapResult`，可适配应用输入或自定义文件结构。两个函数可以分别设置：

- `mapInput` 接收调用方输入，返回模型需要的原生 JSON 参数。
- `mapResult` 接收`prediction.output`，返回包含至少一个文件资产的 `{ assets: [...] }`。

默认结果映射识别文件 URL、数组，以及 `{ url, content_type, file_name, file_size }` 这样的显式文件对象。其他文件结构使用自定义映射。原生输出也会作为独立快照保存在 `providerMetadata.replicate.output`。

资产在下载前保持为 URL 引用。需要字节数据时，使用 core 的 `materializeAsset`。MIME 类型取自文件元数据或可识别的扩展名，无法判断时使用 `application/octet-stream`。

## 保存与恢复任务

后台任务使用 `startAsset` 提交，并保存返回的完整 operation。通过相同模型、API 地址和授权账号，使用 `getAssetStatus` 或 `waitForAsset` 恢复。持久化、查询或下载失败后保留原 operation，避免再次提交付费任务。凭据不包含 API key；应用负责恢复已授权的租户连接。

本地 abort 或 timeout 停止本地等待，不会停止远端生成。提交默认零重试；状态重试查询已有任务。

## 服务商选项

`createReplicateAssetProvider` 接受 `apiKey`、`baseURL`、`headers`、`fetch` 和 `name`。默认 API 根地址为 `https://api.replicate.com/v1`。

使用 `owner/model` 调用模型 prediction 接口，或使用 `owner/model:full-64-character-version` 固定版本。也可以在工厂选项中传入 `version`，通过版本化 prediction 接口提交。

使用 `cancelAsset` 请求远端取消。Replicate 报告 `canceled` 后才会返回 `cancelled`；返回 `requested` 时应继续查询同一 operation。此 adapter 不提供删除 API。

Webhook URL 必须使用 HTTPS，并订阅 `completed`。验证签名并关联 prediction 后，再根据通知查询任务状态。

## 指南

- [媒体服务商：映射、任务生命周期、连接安全与集成细节](https://github.com/fei-bai-inc/sinestack-ai/blob/main/docs/MEDIA_PROVIDERS.zh-CN.md)
- [Core：生成、恢复与文件物化](https://github.com/fei-bai-inc/sinestack-ai/blob/main/packages/core/README.zh-CN.md)
