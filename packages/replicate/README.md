# @sine-ai/replicate

Replicate 的 Sine AI asset adapter。使用一次 submit/status/cancel 操作接入共享的 `@sine-ai/core`，不内置额外的重试或轮询引擎。

```ts
import { generateMusic, generate3D } from '@sine-ai/core';
import { createReplicateAssetProvider } from '@sine-ai/replicate';

const replicate = createReplicateAssetProvider(); // REPLICATE_API_TOKEN

const music = await generateMusic({
  model: replicate.music(),
  prompt: 'Warm acoustic piano with soft strings',
  instrumental: true,
  providerOptions: { replicate: { audio_format: 'wav' } },
});

const model = await generate3D({
  model: replicate.threeD(),
  prompt: 'A stylized wooden lantern',
});
console.log(music.assets, model.assets);
console.log(music.providerMetadata?.replicate?.output);
```

`music()` 绑定 `minimax/music-2.6`；`threeD()` 绑定 `tencent/hunyuan-3d-3.1`。其它模型通过 `.asset(modelId, { kind, mapInput, mapResult, version? })` 提供真实的原生输入和文件结果映射。`mapResult` 接收 `prediction.output`，不是完整 prediction response。mapper 必须返回非空 `assets`；纯文本或无文件 prediction 不属于当前契约。

官方模型使用 `/models/{owner}/{model}/predictions`。固定版本支持 `owner/model:完整64位version` 或 definition 的 `version`，通过 `/predictions` 提交。查询、取消均依据已保存的 prediction ID，不使用 provider response 中的任意 URLs。

设置支持 `apiKey`、`baseURL`、`headers`、`fetch`、`name`；默认 API root 为 `https://api.replicate.com/v1`。operation 绑定原 API root、模型、prediction ID 和已知版本，不保存 API key；应用需恢复原租户连接。

远端取消只有观察到 `canceled` 才报告 `cancelled`，仍在执行时报告 `requested`。已完成或失败的取消竞争需要继续查询同一 operation。Webhook 仅接收 HTTPS URL，并订阅 `completed`；接收方负责签名验证与任务关联。

提交默认不重试，不声明提交幂等。文件以 URL 引用返回，下载由 `materializeAsset` 显式完成。没有执行真实计费 API 测试。

详情见仓库 [Media providers](../../docs/MEDIA_PROVIDERS.md)。官方来源：[HTTP API](https://replicate.com/docs/reference/http)、[Music schema](https://replicate.com/minimax/music-2.6/api/schema)、[3D schema](https://replicate.com/tencent/hunyuan-3d-3.1/api/schema)。
