# Media providers

本批扩展为 Sine AI 的资产协议提供三个 provider 的文件生成能力。所有模型继续进入 `@sine-ai/core`；没有新增 provider 专属的 polling、retry、hook 或 abort 执行器。

## 内置模型

| Provider | 入口 | 默认模型 | 资产 kind |
|---|---|---|---|
| fal | `threeD()` | `fal-ai/hunyuan3d-v3/text-to-3d` | `model-3d` |
| fal | `soundEffect()` | `fal-ai/elevenlabs/sound-effects/v2` | `sound-effect` |
| fal | `music()` | `fal-ai/minimax-music/v2.6` | `music` |
| fal | `animation3D()` | `fal-ai/hunyuan-motion` | `animation-3d` |
| WaveSpeed | `music()` | `minimax/music-2.6` | `music` |
| WaveSpeed | `threeD()` | `tripo3d/h3.1/text-to-3d` | `model-3d` |
| Replicate | `music()` | `minimax/music-2.6` | `music` |
| Replicate | `threeD()` | `tencent/hunyuan-3d-3.1` | `model-3d` |

新增 presets 绑定上表的已校验 schema，不会仅因 modelId 相似就把相同字段映射用于另一模型。接入其他 endpoint，使用 `.asset()` 显式提供映射；它继续复用该 provider 的提交、查询和取消协议。

`generateMusic` 的公共输入为 `prompt`、可选 `lyrics` 和 `instrumental`。`generateAnimation3D` 为 `prompt`、可选 `durationSeconds`、`seed` 和 `format: 'fbx' | 'json'`。这两个函数只拆分参数并调用 `generateAsset`。

MiniMax 的公共字段相近，但服务的输入约束和专有参数并不完全相同。fal 与 Replicate 的有声歌曲需要歌词或开启 `lyrics_optimizer`；纯音乐使用 `instrumental: true`。WaveSpeed 的当前参数 schema 允许省略歌词。fal 的音频格式设置放在 `providerOptions.fal.audio_setting`；Replicate 使用 `providerOptions.replicate.audio_format`、`sample_rate`、`bitrate`。不要将一个 provider 的专有选项直接搬到另一个 provider。

## 连接与恢复

| Provider | 默认 baseURL | 默认环境变量 | HTTP 认证 |
|---|---|---|---|
| fal | `https://queue.fal.run` | `FAL_KEY` | `Authorization: Key …` |
| WaveSpeed | `https://api.wavespeed.ai/api/v3` | `WAVESPEED_API_KEY` | `Authorization: Bearer …` |
| Replicate | `https://api.replicate.com/v1` | `REPLICATE_API_TOKEN` | `Authorization: Bearer …` |

`create*AssetProvider({ apiKey, baseURL, headers, fetch, name })` 支持显式配置。连接创建时复制设置，后续修改原对象不会改变已有连接。调用级 headers 不能覆盖实际 Authorization。自定义 baseURL 可包含代理路径前缀，必须使用 HTTP(S)，且不能包含凭证、query 或 fragment。

提交得到 `AssetOperation` 后，由调用方持久化，再重建原连接调用 `getAssetStatus` 或 `waitForAsset`。WaveSpeed、Replicate operation 保存规范化的 baseURL、模型 ID、prediction ID 和协议版本；Replicate 固定版本还会核对 model version。fal 保留原 queue URLs 并校验 origin、owner/app、request ID 和路径。

operation 不保存 API key。相同 provider name、modelId、baseURL 并不能证明是同一租户或同一凭证；应用仍需持久化自己的连接 ID，并恢复原连接。不要把不可信用户提交的 operation 当作授权凭据。

所有请求地址都从可信连接和经校验的 operation 构造，或按 fal queue 的固定路径验证。响应里的任意 result URL 不会被拿来发送 API 凭证。请求拒绝重定向；注入的自定义 `fetch` 同样必须遵守 `redirect: 'error'`。

## 原生结果与文件

| Provider | `mapResult` 输入 | 保留位置 |
|---|---|---|
| fal | result endpoint 的完整 JSON body | `providerMetadata.fal.output` |
| WaveSpeed | prediction 的 `data.outputs` 数组 | `providerMetadata.wavespeed.output` |
| Replicate | prediction 的 `output` JSON 值 | `providerMetadata.replicate.output` |

adapter 在调用 mapper 前保存原生 output 的独立快照；mapper 的修改或自定义 metadata 不能覆盖真实的 `output` 与任务 ID。`name` 用于连接和 operation 身份，不改变上表的 metadata 命名空间。

原生输出与 `assets` 并存，不新增一套生成结果类型。`assets` 必须非空；`result.asset` 仍是首个文件。URL、binary、base64 文件继续使用 `AssetFile`。Replicate 的完整 prediction response 中可能包含输入、日志和内部链接，这些字段不会被复制进 `providerMetadata.replicate.output`；原始 HTTP response 仍可在现有响应字段中读取。

内置模型 mapper 按已验证的文件结构提取资产。不会把任意文本字符串当成文件；不会把 3D 输出的纹理、预览图全部标成 GLB。文件 MIME 优先使用 provider 明确提供的值，再按已知文件扩展名识别，不明确时使用 `application/octet-stream`。fal 动作的 `motion_json` 是 JSON 文件引用，`format: 'json'` 映射成 fal 的 `output_format: 'dict'`；并非把任意 inline JSON 伪装成文件。

当前契约面向实际生成文件或文件引用的模型，不覆盖所有纯文本、分类或无文件结构化 prediction。自定义 `.asset()` 必须给出与实际 endpoint 相符的 `mapResult`。

## Provider 协议

### fal

单次提交发往完整模型路径。状态请求为 GET，完成后再 GET result；取消为 PUT。音乐与动作仅增加输入、结果映射，复用原 fal queue model。

### WaveSpeed

POST `/{完整 modelId}` 提交原生 JSON；GET `/predictions/{id}/result` 同时取得状态和输出。支持超过两个路径段的模型 ID。`created`、`queued` 映射为 pending，其他非空非终态映射为 running；`failed`、`timeout`、`deleted` 为 failed，`cancelled` 为 cancelled。

`enable_sync_mode: true` 可以使用，但不能与 webhook 同用。同步等待超时返回 `processing`、`data.code: 5004` 和任务 ID 时，提交仍被保留，之后继续查询原任务。不会仅根据 `data.error` 或客户端等待超时判定任务失败并重新提交。

第一版显式拒绝 `enable_base64_output: true`，避免在恢复时无法可靠判断裸 base64 的文件格式；可使用 URL 输出，再调用 `materializeAsset`。`/predictions/delete` 删除完成记录，不用于取消运行中的任务，因此不暴露 `doCancel`。

### Replicate

`owner/model` 使用 POST `/models/{owner}/{model}/predictions`。固定版本可写 `owner/model:完整64位version`，或在 `.asset()` definition 里传 `version`；此时 POST `/predictions`，body 为 `{ version, input }`。同时指定两个版本时必须相同。

GET `/predictions/{id}` 查询原 prediction。POST `/predictions/{id}/cancel` 发出取消；仅在观察到 `canceled` 时返回 `cancelled`。若仍为 starting/processing，返回 `requested`；若取消与 succeeded/failed 竞争，返回错误并保留原 operation，调用方查询同一任务以确认结果。

## 重试、取消和 webhook

三个 adapter 都未声明提交幂等性。提交 retry 仍为 0，配置正数会在 core 中被拒绝；有一个 `idempotency-key` header 不代表远端保证去重。一次提交网络异常可能代表“是否接收未知”，不能自动再次创建任务。状态 retry 仍使用现有 core 和 AI SDK 的策略。

本地 abort 只取消本次等待或 HTTP 请求，不自动取消远端生成。远端取消需要显式 `cancelAsset`；WaveSpeed 返回 unsupported。所有可恢复错误沿用 core 的 operation 保留机制。

fal 使用 `fal_webhook` query；WaveSpeed 使用 HTTPS `standard_webhook` query；Replicate 使用 HTTPS webhook 和 `webhook_events_filter: ['completed']`。adapter 只发送回调地址。接收端仍负责签名验证、任务关联和去重；通过 core 的 webhook 等待收到通知后，仍查询原 operation 获取结果。

## 复用边界与验证

`@sine-ai/provider-utils` 不包含执行器。它统一安全的 JSON 快照、HTTP 目的地校验与配置快照，GET/POST 调用公开的 `getFromApi`、`postJsonToApi`，响应处理调用 `createJsonResponseHandler`、`createJsonErrorResponseHandler`。HTTP retry classification 直接使用 SDK 的 `APICallError`，不再在 fal 里维护状态码列表或把任意 fetch 异常标成可重试。

AI SDK 没有公开 PUT helper。fal 取消保留一次薄 PUT 请求，并复用相同 SDK response handlers；PUT 网络异常保留原错误，不额外复制 SDK 的内部网络错误分类。这不改变默认 cancel retry 为 0 的约定。

内置模型 schema、状态映射、原生输出、恢复、取消、URL 与配置绑定通过 mock fetch 测试。Node.js 22/24 是 CI 验证目标；没有真实计费生成结果或 Cloudflare/workerd 验证承诺。

## 官方协议与 schema

- [fal MiniMax Music 2.6](https://fal.ai/models/fal-ai/minimax-music/v2.6/api)
- [fal Hunyuan Motion](https://fal.ai/models/fal-ai/hunyuan-motion/api)
- [WaveSpeed submit](https://wavespeed.ai/docs/submit-task)、[result](https://wavespeed.ai/docs/get-result)、[sync mode](https://wavespeed.ai/docs/sync-mode)、[delete](https://wavespeed.ai/docs/delete-task)
- [WaveSpeed webhooks](https://wavespeed.ai/docs/how-to-use-webhooks)、[webhook verification](https://wavespeed.ai/docs/verify-webhooks)
- [WaveSpeed MiniMax Music 2.6](https://wavespeed.ai/docs/docs-api/minimax/minimax-music-2.6)、[Tripo H3.1](https://wavespeed.ai/docs/docs-api/tripo3d/tripo3d-h3.1-text-to-3d)
- [Replicate HTTP API](https://replicate.com/docs/reference/http)
- [Replicate MiniMax Music 2.6 schema](https://replicate.com/minimax/music-2.6/api/schema)、[Hunyuan 3D 3.1 schema](https://replicate.com/tencent/hunyuan-3d-3.1/api/schema)
