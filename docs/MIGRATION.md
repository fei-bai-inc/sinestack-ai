# 未发布初版的 API 收缩

这次调整以减少基础执行逻辑的长期维护为目标。项目尚未发布到 npm；已经按早期源码接入的调用方需要检查下列变化。

基础机制现在集中通过 `internal/sdk.ts` 使用 AI SDK 的 `prepareRetries`、`mergeAbortSignals`、`mergeCallbacks`。core 的 `ai` peer dependency 精确锁定 `7.0.155`。资产 submit/status/poll/result/cancel 编排仍由 Sine AI 维护，不是上游新增了通用 Asset executor。

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
