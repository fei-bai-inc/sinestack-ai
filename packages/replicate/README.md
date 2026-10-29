# @sinestack/ai-replicate

Replicate 的通用 SineStack AI asset adapter。任意符合平台 ID 格式的模型都可以使用同一套提交、查询、恢复、取消协议，无需在 SDK 中登记模型或添加白名单。

```ts
import { generateMusic } from '@sinestack/ai-core';
import { createReplicateAssetProvider } from '@sinestack/ai-replicate';

const replicate = createReplicateAssetProvider(); // REPLICATE_API_TOKEN

const result = await generateMusic({
  model: replicate.music('your-owner/your-music-model'),
  input: {
    // 这里按你选择的模型 schema 传入原生 JSON 字段。
    prompt: 'Warm acoustic piano with soft strings',
    duration: 90,
  },
});
console.log(result.assets);
console.log(result.providerMetadata?.replicate?.output);
```

模型 ID 必填。`music(modelId)`、`threeD(modelId)`、`soundEffect(modelId)`、`animation3D(modelId)` 只选择资产 kind，不选择模型或参数 schema。`asset(modelId, { kind })` 支持其他文件生成能力。

默认输入按 JSON 原样提交给模型，默认结果映射识别常见文件 URL 和文件对象。特殊输入、输出可以由应用实现并注入：

```ts
const document = replicate.asset<{ title: string }, 'document'>('your-owner/document-model', {
  kind: 'document',
  mapInput: input => ({ document_title: input.title }),
  mapResult(output) {
    if (output === null || typeof output !== 'object' || Array.isArray(output) ||
        !('document_uri' in output) || typeof output.document_uri !== 'string') {
      throw new TypeError('Expected document_uri from the model');
    }
    return { assets: [{ type: 'url', url: output.document_uri, mediaType: 'application/pdf' }] };
  },
});
```

`mapInput`、`mapResult` 均可省略，也可独立替换。`mapResult` 接收 `prediction.output`，不是完整 prediction response。默认解析无法识别的文件结构需要显式映射；它不会推断所有模型 schema。结果必须包含真实资产，纯文本或无文件 prediction 不属于当前契约。原生 output 的独立快照始终保留在 `providerMetadata.replicate.output`。

`owner/model` 使用 `/models/{owner}/{model}/predictions`。固定版本支持 `owner/model:完整64位version`，或在任一模型构造方法的 mapping 中指定 `version`，通过 `/predictions` 提交。查询、取消依据已保存的 prediction ID，不使用 provider response 中的任意 URLs。

设置支持 `apiKey`、`baseURL`、`headers`、`fetch`、`name`；默认 API root 为 `https://api.replicate.com/v1`。operation 绑定原 API root、模型、prediction ID 和已知版本，不保存 API key；应用需恢复原租户连接。

远端取消只有观察到 `canceled` 才报告 `cancelled`，仍在执行时报告 `requested`。已完成或失败的取消竞争需要继续查询同一 operation。Webhook 仅接收 HTTPS URL，并订阅 `completed`；接收方负责签名验证与任务关联。

每个 provider 方法仅执行一次远端操作，等待、重试与生命周期继续使用 `@sinestack/ai-core`。提交默认不重试，不声明提交幂等。文件不自动下载，需要 bytes 时显式调用 `materializeAsset`。

协议来源：[Replicate HTTP API](https://replicate.com/docs/reference/http)。测试使用 mock fetch，没有执行真实计费 API 请求。
