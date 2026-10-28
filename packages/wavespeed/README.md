# @sine-ai/wavespeed

WaveSpeed 的 Sine AI asset provider。音乐、3D 和自定义资产模型共用 prediction 协议；提交、查询分别只执行一次 HTTP 操作，重试与等待交给 `@sine-ai/core`。

```ts
import { generateMusic, generate3D } from '@sine-ai/core';
import { createWaveSpeedAssetProvider } from '@sine-ai/wavespeed';

const wavespeed = createWaveSpeedAssetProvider({
  apiKey: process.env.WAVESPEED_API_KEY,
  // baseURL 默认为 https://api.wavespeed.ai/api/v3，代理地址也需包含 API 路径。
});

const song = await generateMusic({
  model: wavespeed.music(),
  prompt: 'Calm ambient piano with soft pads',
  instrumental: true,
  providerOptions: { wavespeed: { sample_rate: 44100, bitrate: 256000 } },
});

const model = await generate3D({
  model: wavespeed.threeD(),
  prompt: 'A blue ceramic teapot',
  providerOptions: { wavespeed: { texture: true, pbr: true } },
});
```

## 模型与原生映射

| 方法 | 模型 | 输入 |
| --- | --- | --- |
| `music()` | `minimax/music-2.6` | `prompt`、`lyrics?`、`instrumental?`；后者映射为 `is_instrumental` |
| `threeD()` | `tripo3d/h3.1/text-to-3d` | `prompt`；纹理、质量、面数等通过 `providerOptions.wavespeed` 设置 |
| `asset(modelId, definition)` | 完整原生模型路径 | `mapInput` 返回原生 JSON；`mapResult` 接收 `data.outputs` 数组 |

两个预设只接受各自的模型 ID。其他端点使用 `asset()` 并提供该端点的输入、输出映射。`providerOptions.wavespeed` 可补充原生参数，不能覆盖 `mapInput` 已返回的字段。

```ts
const custom = wavespeed.asset<{ prompt: string }, 'model-3d'>('vendor/model/variant', {
  kind: 'model-3d',
  mapInput: input => ({ prompt: input.prompt }),
  mapResult: output => {
    // 按目标模型的实际 schema 校验并提取文件，不能把任意文本当作文件 URL。
    const values = output as Array<{ mesh_url: string }>;
    return {
      assets: values.map(value => ({
        type: 'url' as const,
        url: value.mesh_url,
        mediaType: 'model/gltf-binary',
      })),
    };
  },
});
```

成功结果的 `providerMetadata.wavespeed.output` 保留原生 `data.outputs` 的 JSON 快照，`assets` 提供统一文件视图。预设接受 URL 字符串或显式文件对象 `{ url, content_type?, file_name?, file_size? }`。复杂嵌套结构使用自定义 `mapResult`。没有文件的文本/结构化结果不属于当前 asset 契约。

文件默认保留 URL；不会隐式下载。MIME 优先读取明确的 `content_type`，其次使用已知文件扩展名，无法确定时为 `application/octet-stream`，不会假定音乐均为 MP3 或 3D 产物均为 GLB。

## 提交、恢复和能力边界

`startAsset` 返回的 operation 可 JSON 序列化；使用相同模型、相同 `baseURL`、相同 provider 连接重建后，通过 `getAssetStatus` 或 `waitForAsset` 恢复。operation 中只有协议版本、模型、API 地址和 prediction ID，不保存密钥。连接对应的租户、凭据和授权关系仍由宿主应用维护。

提交默认不重试，模型声明 `idempotentStart: false`。查询错误的重试由 Sine AI core 调用官方 AI SDK 重试实现。任务的 `failed`、`timeout`、`deleted` 为失败终态，`cancelled` 为取消终态，其余非空状态保持等待。客户端中止不会取消远端任务。

支持通过 `webhookUrl` 传入 `standard_webhook` HTTPS 地址；接收方必须自行验证签名并关联 prediction。Webhook 通知只唤醒现有 core，再查询同一个 prediction。

- 默认使用异步提交。`enable_sync_mode: true` 可透传给支持同步模式的模型，但不能与 webhook 同时使用。同步等待结束时返回 `processing`、`code: 5004` 和 prediction ID，仍视为已提交并可恢复。
- 本版本提前拒绝 `enable_base64_output: true`。使用 URL 输出，必要时显式调用 `materializeAsset`。
- 不提供 `doCancel`。WaveSpeed 的删除接口用于删除已结束的任务记录，不能用于取消正在执行的生成。

## 协议来源

- [Submit Task](https://wavespeed.ai/docs/submit-task)
- [Get Result](https://wavespeed.ai/docs/get-result)
- [Sync Mode](https://wavespeed.ai/docs/sync-mode)
- [Webhooks](https://wavespeed.ai/docs/how-to-use-webhooks)
- [Base64 Output](https://wavespeed.ai/docs/base64-output)
- [Delete Task](https://wavespeed.ai/docs/delete-task)
- [MiniMax Music 2.6](https://wavespeed.ai/docs/docs-api/minimax/minimax-music-2.6)
- [Tripo3D H3.1 Text-to-3D](https://wavespeed.ai/docs/docs-api/tripo3d/tripo3d-h3.1-text-to-3d)
