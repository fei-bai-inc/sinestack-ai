# @sine-ai/fal

通过同一套 fal queue 协议，为 Sine AI 提供 3D 模型、音效、音乐和 3D 动作生成。包尚未发布，当前在仓库 workspace 内使用。

```ts
import { generateMusic, generateAnimation3D } from '@sine-ai/core';
import { createFalAssetProvider } from '@sine-ai/fal';

const fal = createFalAssetProvider(); // FAL_KEY

const music = await generateMusic({
  model: fal.music(),
  prompt: 'Warm acoustic guitar and gentle piano, a calm instrumental',
  instrumental: true,
  providerOptions: { fal: { audio_setting: { format: 'wav' } } },
});

const motion = await generateAnimation3D({
  model: fal.animation3D(),
  prompt: 'A person walks forward and jumps over a puddle',
  durationSeconds: 3,
  format: 'json',
  seed: 42,
});

console.log(music.assets, motion.assets);
console.log(motion.providerMetadata?.fal?.output);
```

## 预设和参数

| 入口 | 默认 endpoint | 资产 |
|---|---|---|
| `threeD()` | `fal-ai/hunyuan3d-v3/text-to-3d` | 模型文件及可用缩略图 |
| `soundEffect()` | `fal-ai/elevenlabs/sound-effects/v2` | 音效文件 |
| `music()` | `fal-ai/minimax-music/v2.6` | 音乐文件 |
| `animation3D()` | `fal-ai/hunyuan-motion` | FBX 动作文件或 JSON 动作文件 |

音乐输入使用 `prompt`、`lyrics?`、`instrumental?`。该 fal endpoint 要求 prompt 为 10–2000 字符、歌词最多 3500 字符；需要提供歌词，或启用 `instrumental: true`，或通过 `providerOptions.fal.lyrics_optimizer: true` 自动生成歌词。附加参数支持 `audio_setting` 和 `enable_safety_checker`。`audio_setting` 包括 `format: 'mp3' | 'wav' | 'pcm'`，以及模型支持的 `sample_rate`、`bitrate` 枚举。

动作输入使用 `prompt`、`durationSeconds?`、`seed?`、`format?: 'fbx' | 'json'`。时长为 0.5–12 秒；`json` 被映射为 fal 的 `output_format: 'dict'`。附加参数支持 `providerOptions.fal.guidance_scale`。输出中的 `motion_json` 是 JSON **文件引用**，不被解读为内联动作数据；同时返回 FBX 和 JSON 时，两者都会保留。

新增的 `music()`、`animation3D()` 只接受上述已验证的 endpoint ID。其他模型使用 `fal.asset(modelId, { kind, mapInput, mapResult })`，为实际原生 schema 提供映射。所有映射都共用相同 queue adapter；mapper 必须返回至少一个实际资产。

## 结果、恢复和连接

每次完成结果都保留 `providerMetadata.fal.output`，内容为 fal REST 结果端点的原生 JSON body。它在自定义 `mapResult` 运行前复制，mapper 不能覆盖该字段和真实 `requestId`。URL 资产不自动下载；缺少可靠格式信息时使用 `application/octet-stream`。

连接配置支持 `apiKey`、`baseURL`、`headers`、`fetch`、`name`。默认地址为 `https://queue.fal.run`；自定义代理地址允许路径前缀。使用 `startAsset` 提交后，可以持久化返回的 operation，再以相同连接重建模型并调用 `getAssetStatus`、`waitForAsset` 或 `cancelAsset`。operation 不包含 API key；持久化层仍需记录原连接身份。

adapter 每次只提交、查询或取消一个任务，不实现自己的 polling、重试或 hook。HTTP/JSON 基础操作通过 `@sine-ai/provider-utils` 委托给 AI SDK；完整执行语义见仓库 [README](../../README.md)。

模型 schema 来源：[MiniMax Music 2.6](https://fal.ai/models/fal-ai/minimax-music/v2.6/api)、[Hunyuan Motion](https://fal.ai/models/fal-ai/hunyuan-motion/api)。测试使用 mock fetch，未执行真实计费请求。
