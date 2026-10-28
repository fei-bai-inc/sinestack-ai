# 资产生成架构与维护边界

Sine AI 扩展 AI SDK 尚未提供的资产协议。3D、音效和其他类型化入口共用同一套资产编排；重试策略、signal 合并和观测回调分发直接交给 AI SDK。**这里仍有 Sine AI 自有的 submit/status/poll/result/cancel 编排，并不是接入了上游现成的通用 Asset executor。**

## 哪些直接复用，哪些仍需维护

| 职责 | 实现归属 |
|---|---|
| 可重试错误分类、Retry-After、指数退避 | AI SDK `prepareRetries`。 |
| 用户取消与 timeout signal 合并 | AI SDK `mergeAbortSignals`，底层使用原生 AbortSignal。 |
| Callback await 与错误处理 | AI SDK `mergeCallbacks`；等待完成，忽略回调抛错/拒绝。 |
| Delay、ID、HTTP/schema、字节转换 | 复用 `@ai-sdk/provider-utils` 的相关工具。 |
| 文件下载与内存文件结果 | AI SDK `createDownload`、`DefaultGeneratedFile`，由显式物化入口使用。 |
| Asset kind、输入类型、结果和 operation envelope | Sine AI provider 协议。 |
| 选择 direct/async、提交、查询、poll、取消与结果映射 | Sine AI 必要的资产编排。 |

唯一的 internal 依赖入口是 [`packages/core/src/internal/sdk.ts`](../packages/core/src/internal/sdk.ts)：

```ts
export { mergeAbortSignals, prepareRetries, mergeCallbacks } from 'ai/internal';
```

core 精确依赖 `ai@7.0.155` 的这三个内部导出。其他源码通过这个本地入口使用它们，不直接散布 `ai/internal` 导入。使用 helper 降低了基础逻辑的维护量，但不会让资产编排自动由上游维护。

## 包与 provider 协议

| 包 | 职责 |
|---|---|
| `@sine-ai/provider` | `AssetModelV1`、资产文件、operation/status，以及可注入的 `AssetModelMapping`。 |
| `@sine-ai/core` | 协议校验、必要的资产编排、类型化 facade 和显式物化。 |
| `@sine-ai/provider-utils` | 共享 JSON/连接校验、默认文件解析与单次 HTTP；调用公开 AI SDK 请求和响应 helpers。 |
| `@sine-ai/fal` | 通用 fal queue 协议；模型由调用方选择，输入/结果可外部映射。 |
| `@sine-ai/wavespeed` | 通用 WaveSpeed prediction 协议，不维护模型目录。 |
| `@sine-ai/replicate` | 通用 Replicate prediction 与固定版本协议，不维护模型目录。 |

三个远端 adapter 共用 provider-utils 的 transport。这个工具层只验证目的地、构造认证 header 并发起一次请求；它没有循环、重试策略、生命周期或 AbortController。GET/POST、JSON 响应解析与 HTTP 错误分类直接使用 AI SDK 公开实现。fal 取消所需的 PUT 没有对应的 SDK 公开请求 helper，因此只保留一次 fetch，并使用相同的 SDK response handlers。

Provider 的能力方法只设置 kind，modelId 必填，默认原样传递 native JSON。协议层没有模型常量、默认模型、型号白名单或具体模型参数 schema。默认结果解析只处理通用文件约定；任意外部包可以实现 `AssetModelMapping` 并通过 `mapInput` / `mapResult` 独立替换映射。新增同平台模型不需要修改 SDK。

`AssetModelV1<INPUT, KIND>` 标识版本、provider、modelId、kind，并提供以下单次操作：

| 方法 | 职责 |
|---|---|
| `doGenerate` | 一次直接生成，返回资产结果。 |
| `doStart` | 一次异步提交，返回不透明 JSON operation。 |
| `doStatus` | 查询原 operation 一次，必要时获取已完成的结果。 |
| `doCancel` | 可选：请求取消原 operation。 |

模型实现 `doGenerate` 或完整的 `doStart`/`doStatus` 对，也可两者都实现。方法、能力字段及组合会被校验。`idempotentStart` / `idempotentGenerate` 由 adapter 明确保证远端幂等；一个 header 本身不足以建立这个保证。

## 公开入口与不变量

`generateAsset` 选择直接生成或 submit + wait；`startAsset` 只提交；`getAssetStatus` 只查询；`waitForAsset` 等待已有任务；`cancelAsset` 显式请求远端取消。`generate3D` / `generateSoundEffect` / `generateMusic` / `generateAnimation3D` 只约束输入与 kind，进入 `generateAsset`。

获得 operation 后，status 请求失败、webhook 异常或等待取消都不会进入提交路径。远端 failed/cancelled 是任务状态，不是重新提交的理由。类型化 facade 和 provider adapter 不复制这些循环。

operation envelope 绑定版本、provider、modelId、kind 与 provider 自有的 JSON payload。提交和恢复入口都建立冻结的数据快照；恢复在 `onStart` 前完成校验和绑定。之后查询、等待和取消仍使用原连接身份，已有 handle 可随错误提供给调用者。

Provider operation 还校验原连接的 API 地址及远端任务标识。它不包含 API key，也不能代替应用自己的 tenant/connection 授权。原生结果以 `providerMetadata.<provider>.output` 和统一的非空 `assets` 并存，不扩展出第二套结果或执行契约。通用接口、外部映射与各 provider 边界见 [MEDIA_PROVIDERS.md](MEDIA_PROVIDERS.md)。

关键持久化放在公开调用返回之后：`const started = await startAsset(...)`，然后 `await saveOperation(started.operation)`。如果保存失败，继续使用这个 handle 补写或恢复。`onOperation` 是观测事件，其失败不会使提交失败。

## Retry：只保留资产相关的选择

Sine AI 保留每阶段的 retry 次数与幂等门：start/generate/cancel 默认 `0`，status 默认 `2`。正数 start/generate retry 需要对应模型能力。每次逻辑提交的幂等键在重试之外生成，同一提交的重试保持不变。

实际 retry 策略直接由 `prepareRetries` 提供。资产层不实现独立的错误分类、Retry-After 解析、退避上限或 initial delay。也不暴露 `onAttempt`、`onRetry` 作为第二套 retry 观测协议。

## Timeout 与取消：合作式 signal

`timeoutMs` 为本次调用生成 timeout signal，`poll.timeoutMs` 为完成等待阶段生成 timeout signal，后者默认 10 分钟。SDK 将它们与用户 signal 合并并传给 provider、重试及轮询 sleep。第一次 status 查询立即发生，之后默认间隔 2 秒。

这里没有通用的 abort controller 管理层、WeakMap deadline、通用 Promise 竞争或严格墙钟检查。取消是否能结束正在进行的请求，取决于 provider 或自定义 downloader 是否响应 signal。一个忽略 signal 的 Promise 或挂住的 hook，仍可能使调用无法返回；timeout 是取消通知，不是对任意用户代码的强制终止。

webhook 通知等待保留局部 `Promise.race`：等待通知或 SDK `delay` 的完成/取消。这个局部处理不扩展为通用强制超时层。通知到达后的 status 查询仍采用合作式取消。

`poll.delay` 只替换轮询 sleep，调用方应响应收到的 signal。它不接管时钟、完整调度器或持久化重放。本地 abort 也不会自动调用 `doCancel`，远端取消始终是显式操作。

## Hooks：可等待的观测回调

只有五个 hooks：`onStart`、`onOperation`、`onProgress`、`onFinish`、`onError`。`onError` 包括调用退出时的 abort/timeout 错误。

它们通过 SDK `mergeCallbacks` 调用：会 await，但抛错和 Promise rejection 被忽略。因此 callback 失败不改变生成结果、不引发 provider 重试，也不存在 `AssetHookError` 或独立终态状态机。一个永不 settle 的 hook 仍会阻塞调用。

日志、指标和非关键状态展示适合放入 hooks。鉴权、必须成功的持久化或业务事务应由应用显式 await，不能依赖 hook 抛错来阻断执行。

## Webhook 与文件

模型声明 webhook 能力时才调用 `generateAsset` 的 factory；不支持时改用 polling，不调用 factory。接收端负责认证和关联通知，再 resolve `received`。SDK 把通知当成查询时机，之后查询同一 operation；仍非终态时报告错误，不重新提交。

`AssetFile` 保存 URL、binary 或 base64。URL 默认不下载；`materializeAsset` 显式转成 SDK `GeneratedFile`。生成与下载具有独立失败边界，自定义 downloader 负责自己的网络策略和对 signal 的响应。

## 扩展、验证与边界

新增 kind、输入/结果映射和单次 provider 方法，不新增执行框架。协议测试继续覆盖能力选择、查询不重提、幂等键稳定、operation 校验、合作式取消、webhook fallback、callback 错误被忽略和 URL 不自动下载。

Node.js 22/24 是 CI 配置的环境；尚未完成 Cloudflare/workerd 运行验证。Sine AI 不实现数据库、队列、租约或崩溃恢复服务，外部任务系统可以持久化 operation 并分次调用 start/status/cancel。

上游版本和源文件 hash 的检查见 [UPSTREAM.md](UPSTREAM.md)；这次收缩删除的 API 和行为承诺见 [MIGRATION.md](MIGRATION.md)。
