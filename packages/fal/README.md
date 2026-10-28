# @sine-ai/fal

fal 的通用 Sine AI asset provider。任意采用 fal queue 协议的文件生成 endpoint 都可以直接指定 modelId 接入；SDK 不维护可用模型名单，不选择默认模型，也不把某个模型的参数 schema 用于其他模型。

```ts
import { generateMusic, generateAsset } from '@sine-ai/core';
import { createFalAssetProvider } from '@sine-ai/fal';

const fal = createFalAssetProvider(); // FAL_KEY
const modelId = process.env.FAL_MUSIC_MODEL_ID!;

const music = await generateMusic({
  model: fal.music(modelId),
  input: {
    // 按这个 endpoint 的原生 schema 传入。
    prompt: 'Warm acoustic guitar and gentle piano',
    is_instrumental: true,
  },
});

const document = await generateAsset({
  model: fal.asset('your-owner/document-renderer', { kind: 'document' }),
  input: { title: 'Product brief', pages: 2 },
});
```

## 能力入口

`threeD(modelId)`、`soundEffect(modelId)`、`music(modelId)`、`animation3D(modelId)` 都要求显式 modelId，分别标记 `model-3d`、`sound-effect`、`music`、`animation-3d`。它们共用相同 queue model，默认原样发送 JSON input。新模型无需修改或更新 SDK。

`asset(modelId, { kind })` 可以标记自定义资产类别。SDK 验证安全的模型路径和可序列化 JSON，不预先限制各模型的参数名称、范围或枚举；远端模型 schema 仍需由调用方遵守。

`providerOptions.fal` 可补充原生参数，不能覆盖本次 input 已包含的字段。

## 可注入映射

输入、输出映射是可选扩展，不是每次接入模型的必需步骤。公共应用想保留自己的一套参数名称，或者 endpoint 返回特殊文件结构时，可以在任意入口注入：

```ts
const model = fal.music<{ description: string }>('your-owner/custom-music', {
  mapInput: input => ({ text: input.description }),
  mapResult(output) {
    if (output === null || typeof output !== 'object' ||
        Array.isArray(output) || !('audio_url' in output) ||
        typeof output.audio_url !== 'string') {
      throw new TypeError('Expected audio_url');
    }
    return {
      assets: [{ type: 'url', url: output.audio_url, mediaType: 'audio/wav' }],
    };
  },
});
```

`mapInput` 接收调用方 input；`mapResult` 接收 fal result endpoint 的原生 JSON body，不是 JavaScript 客户端的 `{ data }` 包装。只提供其中一个函数时，另一个仍使用默认实现。映射函数在模型创建时快照保存。

默认结果解析支持 URL、文件列表和嵌套的显式 `{ url, content_type?, file_name?, file_size? }` 文件对象；不会扫描说明文字或普通 metadata 字符串中的 URL。不能从特殊 schema 提取文件时，错误会提示注入 `mapResult`。结果必须含至少一个实际资产。

原生结果的独立快照保存在 `providerMetadata.fal.output`，自定义 mapper 不会污染它或原始 `response.body`。文件 MIME 读取明确元数据或可靠扩展名，无法判断时为 `application/octet-stream`。URL 默认不下载。

## 连接和执行

设置支持 `apiKey`、`baseURL`、`headers`、`fetch`、`name`，默认 API 地址为 `https://queue.fal.run`。自定义代理可包含路径前缀。队列路径支持普通 `owner/app`，以及 `workflows/owner/app`、`comfy/owner/app`。连接和任务 URL 会验证原 origin、包含 namespace 的完整 app 路径和 request ID，操作凭据不会发送到任意返回 URL。

`startAsset` 返回的 operation 可持久化，随后用同一连接和模型调用 `getAssetStatus`、`waitForAsset` 或 `cancelAsset`。operation 不包含 API key；应用仍需保存原连接身份。

所有输入和输出映射都复用同一执行路径。adapter 不实现重试、轮询、hook 或独立 abort 引擎。fal 单次 HTTP 操作通过 `@sine-ai/provider-utils` 复用 AI SDK helpers；核心执行语义见仓库 [README](../../README.md)。
