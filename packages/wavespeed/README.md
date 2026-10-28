# @sine-ai/wavespeed

WaveSpeed 的通用 Sine AI asset provider。包不维护模型清单、不选择默认模型，也不为某个模型写死参数 schema。只要模型使用 WaveSpeed prediction 协议，就可以传入它的完整模型 ID 和原生 JSON 输入。所有能力共用单次提交/查询协议，重试与等待交给 `@sine-ai/core`。

```ts
import { generateMusic } from '@sine-ai/core';
import { createWaveSpeedAssetProvider } from '@sine-ai/wavespeed';

const wavespeed = createWaveSpeedAssetProvider({
  apiKey: process.env.WAVESPEED_API_KEY,
  // baseURL 默认为 https://api.wavespeed.ai/api/v3，代理地址也需包含 API 路径。
});

const modelId = 'your-provider/your-music-model'; // 来自应用配置，无需向 SDK 注册
const song = await generateMusic({
  model: wavespeed.music(modelId),
  input: {
    // 这些字段应按所选模型的原生 schema 提供，不做跨模型字段猜测。
    prompt: 'Calm ambient piano with soft pads',
    is_instrumental: true,
  },
});
console.log(song.assets, song.providerMetadata?.wavespeed?.output);
```

## 能力入口与可注入映射

`music(modelId)`、`threeD(modelId)`、`soundEffect(modelId)`、`animation3D(modelId)` 只标记资产 kind；它们均接受任意安全模型 ID。自定义资产使用 `asset(modelId, { kind })`。模型 ID 必须显式传入，可以包含多段路径；不提供默认型号或内部白名单。

默认输入直接作为原生 JSON body 提交。模型可以定义任意字段、嵌套 JSON、时长、种子或专有参数；SDK 只做 JSON 与协议校验，模型 schema 由服务端或应用负责。也可传 `providerOptions.wavespeed` 补充字段，但不能覆盖输入已有的键。

特殊输入或结果结构可以外部实现后注入：

```ts
const model = wavespeed.asset<{ description: string }, 'document'>(
  'your-provider/your-document-model',
  {
    kind: 'document',
    mapInput: ({ description }) => ({ text: description }),
    mapResult(output) {
      if (!Array.isArray(output)) throw new TypeError('Expected an output array');
      const first = output[0];
      if (!first || typeof first !== 'object' || Array.isArray(first) ||
          !('file_url' in first) || typeof first.file_url !== 'string') {
        throw new TypeError('Expected a file_url');
      }
      return {
        assets: [{ type: 'url', url: first.file_url, mediaType: 'application/pdf' }],
      };
    },
  },
);
```

`mapInput` 和 `mapResult` 都是可选的，也可作为能力方法的第二个参数注入。mapper 在创建模型时保存，后续修改配置对象不会替换已有模型行为。输入/结果映射只影响数据适配，不改变统一执行机制。

## 结果与文件

`mapResult` 接收原生 `data.outputs`，不接收包含日志、输入和内部请求 URL 的 prediction envelope。默认 mapper 识别输出 URL、数组和显式文件对象 `{ url, content_type?, file_name?, file_size? }`；不把任意文本中的链接当成文件。特殊结构使用外部 mapper，而无需增加 SDK 模型清单。

成功结果的 `providerMetadata.wavespeed.output` 保留独立原生 JSON 快照；`assets` 提供统一非空文件视图。mapper 修改自己的参数不会污染原生输出或原始 response body。没有文件的文本/结构化结果不属于当前 asset 契约。

文件 URL 不会隐式下载。MIME 优先读取明确的 `content_type`，其次使用已知文件扩展名，无法判断时为 `application/octet-stream`。

## 提交、恢复与能力边界

`startAsset` 返回的 operation 可 JSON 序列化；使用相同模型、API 地址和原 provider 连接，通过 `getAssetStatus` 或 `waitForAsset` 恢复。operation 只含协议版本、模型、API 地址和 prediction ID，不保存密钥；应用负责原租户/连接的授权绑定。

提交默认不重试，模型声明 `idempotentStart: false`。查询重试由现有 core 委托给 AI SDK。客户端中止不会取消远端任务，查询失败也不会创建替代任务。

- 支持 HTTPS `standard_webhook`；接收端负责验证签名及关联 prediction，通知只唤醒对同一任务的查询。
- `enable_sync_mode: true` 可以传给支持它的模型，但不能与 webhook 同用。同步等待超时若返回 prediction ID 和 `processing`，仍保留原任务。
- `enable_base64_output: true` 需要显式注入 `mapResult`，由应用根据实际格式返回 base64 资产；不会猜测裸 base64 的 MIME。该模式不能与 webhook 同用。
- 不提供 `doCancel`；WaveSpeed 的删除接口删除已结束的任务记录，不是取消正在运行的生成。

## 协议来源

- [Submit Task](https://wavespeed.ai/docs/submit-task)
- [Get Result](https://wavespeed.ai/docs/get-result)
- [Sync Mode](https://wavespeed.ai/docs/sync-mode)
- [Webhooks](https://wavespeed.ai/docs/how-to-use-webhooks)
- [Base64 Output](https://wavespeed.ai/docs/base64-output)
- [Delete Task](https://wavespeed.ai/docs/delete-task)
