# 通用 Media provider 接口

Provider adapter 的职责是接入平台协议。它不维护模型目录，不选择默认模型，不将某个模型的 schema 当成整个能力的 schema。

## 任意模型与资产 kind

fal、WaveSpeed、Replicate 都提供：

```ts
provider.music(modelId, mapping?);
provider.threeD(modelId, mapping?);
provider.soundEffect(modelId, mapping?);
provider.animation3D(modelId, mapping?);
provider.asset(modelId, { kind, mapInput?, mapResult? });
```

modelId 必填，只校验平台要求的安全路径或版本格式，不存在内置白名单。能力入口只设置 kind；例如 `music(id)` 与 `asset(id, { kind: 'music' })` 使用同一个协议类。新 kind 也通过 `.asset()` 接入，无需扩展执行器。

调用方负责选择实际存在且接受目标任务的模型，提供符合模型 schema 的原生 JSON。adapter 支持同一平台协议下的模型接入，但不会自动推断每个模型的参数、额度、权限或输出语义。

## 原生输入是默认路径

```ts
const model = fal.music('your-owner/your-music-model');
const result = await generateMusic({
  model,
  input: {
    text: 'Describe the requested music',
    duration: 120,
    custom_model_setting: { enabled: true },
  },
});
```

上例字段由应用按目标模型定义；SDK 不裁剪、不改名，也不套用其他模型的时长、prompt 长度、面数或枚举限制。`providerOptions.<provider>` 可补充字段，不能覆盖 input 或 mapInput 已返回的同名键。

四个 core 能力 facade 支持任意 INPUT 的 `{ model, input }` 签名，保留 kind 与输入类型检查，最终只调用 `generateAsset`。旧平铺 prompt / durationSeconds 等重载已标记 deprecated，仅兼容显式输入映射或自定义模型；它们不是所有远端模型的通用原生 schema。

## 映射由外部提供

`AssetModelMapping<INPUT>` 包含两个独立可选函数：

```ts
interface AssetModelMapping<INPUT> {
  mapInput?(input: INPUT): JSONObject | PromiseLike<JSONObject>;
  mapResult?(output: JSONValue): AssetModelV1Result | PromiseLike<AssetModelV1Result>;
}
```

缺省 mapInput 时使用安全的原生 JSON 快照；缺省 mapResult 时使用公开的 `@sinestack/ai-provider-utils.mapAssetResult`。可以只替换其中一个。提供的函数会在提交前校验，配置和函数引用会快照保存。

例如应用选择统一业务字段并解析一个特殊 mesh 字段：

```ts
import type { AssetModelMapping } from '@sinestack/ai-provider';

interface GeometryRequest { description: string; detail: number }

const mapping: AssetModelMapping<GeometryRequest> = {
  mapInput: input => ({ text: input.description, steps: input.detail }),
  mapResult(output) {
    if (output === null || typeof output !== 'object' || Array.isArray(output) ||
        !('mesh_url' in output) || typeof output.mesh_url !== 'string') {
      throw new TypeError('Expected the endpoint-specific mesh_url');
    }
    return {
      assets: [{
        type: 'url', url: output.mesh_url, mediaType: 'model/gltf-binary',
      }],
    };
  },
};

const model = fal.threeD<GeometryRequest>('your-owner/your-geometry-model', mapping);
```

该 mapping 可以来自任何外部包，再由宿主注入。SDK 不需要登记这个 modelId。模型若输出常见 File 对象，通常连结果 mapper 都不需要。

## 原生结果与文件

| Provider | 交给 mapper 的原生 JSON | 保留位置 |
|---|---|---|
| fal | result endpoint 的完整 body | `providerMetadata.fal.output` |
| WaveSpeed | prediction 的 `data.outputs` | `providerMetadata.wavespeed.output` |
| Replicate | prediction 的 `output` | `providerMetadata.replicate.output` |

输出快照、mapper 参数和原始 response body 相互隔离。mapper 不能覆盖真实 output 与任务 ID。`name` 改变连接/operation 身份，不改变上述 metadata 命名空间。

默认文件解析支持：

- 根 HTTP(S) URL 和根 URL 数组。
- 显式 `{ url, content_type?, file_name?, file_size? }` File 对象及其嵌套数组、对象。
- `files / assets / output / outputs` 等常见文件列表容器。
- 重复 URL 去重，保持第一次出现的顺序并保留可用的明确文件 metadata。

不会扫描 prose 中的链接，不把普通 metadata 字符串或 `mesh_url` 等未知私有字段自动解释为文件。特殊 schema 注入 mapResult。MIME 优先采用 provider 明确给出的值，再按已知文件扩展名识别；未知格式使用 application/octet-stream。

当前结果契约需要非空的真实 `assets`，仍提供非可选的 `result.asset`。纯文本、分类和没有文件的任意 JSON prediction 不属于该契约。映射失败会保留原 operation，不重新提交任务。URL 不自动下载；需要 bytes 时显式调用 `materializeAsset`。

## 连接与恢复

| Provider | 默认 baseURL | 默认环境变量 | 认证 |
|---|---|---|---|
| fal | `https://queue.fal.run` | `FAL_KEY` | `Key` |
| WaveSpeed | `https://api.wavespeed.ai/api/v3` | `WAVESPEED_API_KEY` | `Bearer` |
| Replicate | `https://api.replicate.com/v1` | `REPLICATE_API_TOKEN` | `Bearer` |

连接支持显式 apiKey、baseURL、headers、fetch、name。baseURL 可带代理路径前缀，不能含凭证、query 或 fragment。认证由连接配置锁定；API 请求拒绝重定向，自定义 fetch 也必须遵守 redirect:error。

startAsset 返回后由应用显式持久化整个 operation，并保存原连接 ID。恢复需要同一平台、modelId、kind、API 地址及原账号。operation 不保存密钥，不能独立证明租户/凭证身份。

WaveSpeed、Replicate 根据固定 baseURL 和经校验的 prediction ID 构造状态、取消地址，不使用响应中的任意 URLs。fal 验证 queue URL 的 origin、owner/app、request ID 和操作路径。

## 协议特有行为

### fal

POST 完整模型路径；状态为 GET，完成后 GET result；取消为 PUT。所有 kind 使用同一个 queue model。模型专有参数不进入协议校验。

### WaveSpeed

POST `/{完整 modelId}` 提交原生 JSON，GET `/predictions/{id}/result` 获取状态及 outputs。支持多段模型路径。created/queued 为 pending，其他非空非终态为 running；failed/timeout/deleted 为 failed，cancelled 为 cancelled。

同步等待超时若返回 ID、processing 和 data.code:5004，仍保留任务并继续查询，不因 data.error 重提。enable_sync_mode 与 webhook 不能同时使用。

裸 base64 没有可靠的文件格式信息。启用 enable_base64_output:true 时需要显式 mapResult，由应用提供正确的 mediaType；不限制可自行解析的外部实现。平台的 base64/webhook 互斥仍会校验。

WaveSpeed 删除接口删除任务历史，不取消运行中的推理，因此不暴露 doCancel。

### Replicate

owner/model 使用 POST `/models/{owner}/{model}/predictions`。固定版本支持 `owner/model:完整64位version` 或 mapping 的 `version`，使用 POST `/predictions` 的 `{ version, input }`。同时提供两种版本时必须相同。

GET prediction 查询原任务，POST `/predictions/{id}/cancel` 取消。观察到 canceled 才返回 cancelled；仍在执行时返回 requested。取消与 succeeded/failed 竞争时报告错误并保留原 operation，继续查询原任务确认结果。

## 重试、取消和 webhook

三个 adapter 均不声明提交幂等；提交 retry 默认为 0，正数会被 core 幂等门拒绝。查询、轮询、取消信号和 hooks 继续由唯一 core 编排，使用 AI SDK 的基础机制。客户端超时或本地 abort 不表示远端失败，也不自动取消生成。

fal 使用 fal_webhook query；WaveSpeed 使用 HTTPS standard_webhook query；Replicate 使用 HTTPS webhook 和 completed 事件过滤。adapter 发送回调地址，宿主负责签名验证、关联与去重；通知后 core 查询同一 operation。

## 复用与验证边界

共享 provider-utils 只包含 JSON/文件映射、目的地校验和单次 HTTP。GET/POST 使用 SDK getFromApi/postJsonToApi；响应与错误使用官方 handlers。fal PUT 仅保留一次 fetch，沿用 SDK response handlers，不复制内部网络错误分类。

测试使用 SDK 从未登记的模型 ID，验证任意原生字段、默认文件解析、外部 mapping、恢复、取消、URL/配置绑定及提交不重试。Node 22/24 为验证目标；没有真实计费调用或 Workerd 验证承诺。

协议来源：[fal Queue](https://docs.fal.ai/model-apis/model-endpoints/queue)、[WaveSpeed submit](https://wavespeed.ai/docs/submit-task)、[result](https://wavespeed.ai/docs/get-result)、[sync](https://wavespeed.ai/docs/sync-mode)、[webhooks](https://wavespeed.ai/docs/how-to-use-webhooks)、[base64](https://wavespeed.ai/docs/base64-output)、[delete](https://wavespeed.ai/docs/delete-task)、[Replicate HTTP API](https://replicate.com/docs/reference/http)。
