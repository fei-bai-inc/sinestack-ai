# 未发布初版的 API 收缩

这次调整以减少基础执行逻辑的长期维护为目标。项目尚未发布到 npm；已经按早期源码接入的调用方需要检查下列变化。

基础机制现在集中通过 `internal/sdk.ts` 使用 AI SDK 的 `prepareRetries`、`mergeAbortSignals`、`mergeCallbacks`。core 的 `ai` peer dependency 精确锁定 `7.0.155`。资产 submit/status/poll/result/cancel 编排仍由 SineStack AI 维护，不是上游新增了通用 Asset executor。

## 删除或改变的部分

| 早期接口或行为 | 当前行为 |
|---|---|
| `retry.initialDelayMs`、`retry.maxDelayMs` | 删除。退避和 Retry-After 采用 SDK 策略；保留各阶段 retry 次数。 |
| `hooks.onAttempt`、`hooks.onRetry` | 删除，不再提供单独的资产 retry callback 协议。 |
| `hooks.onAbort` | 删除。调用因 abort/timeout 退出时通过 `onError` 观测。 |
| `AssetHookError`、hook 错误向调用者传播 | 删除。SDK `mergeCallbacks` 会 await 并忽略 hook 错误。 |
| `onFinish` 失败后通过错误的 `result` 恢复 | 不再需要该路径：hook 抛错被忽略，调用返回原生成结果。 |
| `onOperation` 抛错阻断后续流程 | 不再成立。它只作观测，不能作为必须成功的持久化步骤。 |
| 对 provider/hook 的通用 Promise 竞争、严格墙钟 deadline | 删除。取消采用合作式 signal，不保证任意忽略 signal 的 Promise 按时结束。 |
| 自定义 `abort.ts`、WeakMap deadline 与终态状态机 | 删除，使用 SDK helper；只保留 webhook 通知等待所需的局部竞争。 |

这些是有意减少的行为承诺。一个挂住的 hook 仍会阻塞调用；provider、custom downloader 和自定义 sleep 需要自己响应 signal。不要把 `timeoutMs` 当成强制终止任意用户代码的上限。

## 把关键步骤移出 hooks

五个现有 hooks 是 `onStart`、`onOperation`、`onProgress`、`onFinish`、`onError`，适用于日志、指标和非关键进度展示。

保存任务时，先取得 handle，再显式等待应用自己的持久化函数：

```ts
// model、input 和 saveOperation 由应用提供；saveOperation 是数据库写入。
const started = await startAsset({ model, input });
await saveOperation(started.operation);
```

保存失败时，`started.operation` 仍是已创建任务的 handle，应补写或用它恢复；不要因持久化失败再次提交。鉴权和其他必须成功的业务步骤同样放在观测 hooks 之外。

## 保留的资产约束

stage retry 次数、提交幂等能力检查、每次逻辑提交的稳定幂等键、JSON operation 校验与身份绑定、查询失败不重提、URL 默认不下载和显式远端取消保持不变。自定义能力继续使用 `AssetModelV1`，无需为每种资产另写 polling/retry。

接入更新后运行 `npm run check` 和 `npm run check:upstream`；其他版本的 AI SDK 需要先经过集中 internal 接口和基线审阅。

## Media provider 扩展后的变化

新增 `@sinestack/ai-wavespeed`、`@sinestack/ai-replicate` 的通用资产协议，fal 同样采用通用模型入口；`AssetModelV1` 版本保持不变。四个能力 facade 都支持 `{ model, input }`，只校验 kind 并调用 `generateAsset`。连接和映射约定见 [MEDIA_PROVIDERS.md](MEDIA_PROVIDERS.md)。

fal HTTP 已转向共享 `@sinestack/ai-provider-utils`，与新 provider 一起复用 AI SDK 的公开 HTTP helpers。由此产生以下明确变化：

- HTTP 409 按 SDK 的默认分类可重试。是否重试仍由 core 的阶段 retry 次数决定，提交默认依然为 0。
- 未被 SDK 识别的自定义 fetch 异常保留原样，不再全部包装成可重试网络错误。SDK 识别的连接错误继续使用 SDK 的分类。
- fal PUT 取消使用一次 fetch 加 SDK response handlers；网络异常原样保留，默认 cancel retry 为 0。
- `mapInput` 和 `mapResult` 改为独立可选：默认原生 JSON 输入和共享文件解析。提供时会在构造阶段校验函数类型。完成结果仍需含至少一个资产。
- 所有 adapter 完成结果新增 `providerMetadata.<provider>.output`，保留原生输出快照；该字段和真实任务 ID 由 adapter 保留，不接受自定义 mapper 覆盖。对整个 metadata 做精确快照比较的调用方需要更新预期。

此前已持久化的 fal queue operation 结构没有变化，仍可用原连接恢复。新增 provider 的 operation 不可相互替换，也不可在不同 baseURL 下恢复。

## 移除默认模型与模型预设

此前未发布实现把特定模型的 schema 放进能力入口，限制了接入同平台其他模型。本次移除公共 provider 源码里的模型常量、默认 ID、精确型号校验、参数白名单和型号专有映射。三个 provider 都提供 `music / threeD / soundEffect / animation3D(modelId, mapping?)`；通用 `.asset(modelId, { kind })` 不再要求 identity mapper。

| 旧用法 | 新用法 |
|---|---|
| `fal.music()`、`wavespeed.threeD()` | 显式传入应用选择的 modelId；缺少 ID 在请求前失败。 |
| 导入 `FAL_MUSIC_MODEL` 等模型常量 | 模型 ID 由应用配置；SDK 不再提供支持型号目录。 |
| `generateMusic({ model, prompt, instrumental })` 使用内置映射 | `generateMusic({ model, input: { 目标模型原生字段 } })`。 |
| 更换模型时被某个 preset schema 拒绝 | native input 只做 JSON 校验，不实施模型专属参数限制。 |
| 任意 endpoint 都必须写两个 mapper | 通用文件输出无需 mapper；特殊输入、输出按需分别注入。 |
| WaveSpeed 全局禁止裸 base64 | 没有 mapResult 时提前要求明确格式；外部 mapper 能正确解析时允许。 |

旧平铺参数重载仍保留并标记 deprecated，用于明确接收这些业务输入的外部 mapper 或自定义模型。默认 native JSON 模型使用 `{ model, input }`。例如模型需要 `is_instrumental` 时必须原样传入；SDK 不会将 `instrumental` 自动翻译成某个服务的字段。

模型不需要预登记；远端模型是否支持某个任务、输入字段与输出语义仍由其实际 API 决定。遇到不属于常见 File 约定的输出，注入 mapResult，无需改协议层或执行器。
