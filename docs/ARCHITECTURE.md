# 资产生成执行架构

Sine AI 为资产生成提供一个共享执行层。3D 模型和音效是该执行层上的类型化入口；新增音乐、动作或文档能力时，复用已有的提交、查询、等待、取消、重试、超时与 hooks 行为。

## 包与职责

| 包 | 职责 |
|---|---|
| `@sine-ai/provider` | 定义 `AssetModelV1`、资产文件、状态、operation envelope，以及能力特定输入类型。协议包不执行网络请求。 |
| `@sine-ai/core` | 选择执行路径，校验能力和 operation，运行共享生命周期，处理 retry、timeout、abort、hooks 和结果。提供薄类型接口与显式物化工具。 |
| `@sine-ai/fal` | 将单次 provider 操作映射到 fal API；转换请求、状态与产物。它不实现轮询循环或第二套生命周期。 |

执行器使用 Web API 作为运行时基础。Node.js 22/24 是当前 CI 环境；这不等于所有边缘宿主和第三方依赖已经获得同等验证。provider 连接配置、网络权限与宿主限制由集成方确定。

## 一个版本化模型协议

`AssetModelV1<INPUT, KIND>` 包含 `specificationVersion: 'v1'`、`provider`、`modelId`、`kind`，以及以下方法：

| 方法 | 一次调用的职责 |
|---|---|
| `doGenerate` | 执行一次直接生成并返回 `AssetModelV1Result`。 |
| `doStart` | 提交一次远端生成，返回不透明 operation。 |
| `doStatus` | 对同一个 operation 查询一次状态。 |
| `doCancel` | 可选：请求取消同一个远端 operation。 |

模型实现 `doGenerate`，或者完整的 `doStart`/`doStatus` 对，也可以同时提供两条路径。能力与方法组合必须一致；执行器在 provider 调用之前拒绝不完整或自相矛盾的定义。

`capabilities.idempotentStart` 和 `idempotentGenerate` 表示 provider 真正支持相应幂等语义。`capabilities.webhooks` 表示异步提交可以使用 webhook。能力声明由 adapter 负责兑现。

每个 provider 方法只完成一个远端操作，不自行重试、轮询或发出 core 生命周期事件。参数归一化、HTTP 认证、远端错误转换和状态映射属于 adapter；执行策略属于 core。

## 公开入口如何共享执行

| API | 行为 |
|---|---|
| `generateAsset` | 校验并选择 direct 或 async 路径，最终返回资产结果；`execution` 可指定 `auto`、`direct` 或 `async`。 |
| `startAsset` | 提交后立即返回 `AssetOperation`，不等待生成结束。 |
| `getAssetStatus` | 查询一次已存在的 operation，包括该查询允许的请求重试。 |
| `waitForAsset` | 等待已存在的 operation；使用轮询或传入的 webhook 通知，最后查询同一任务。 |
| `cancelAsset` | 对已存在的 operation 发出 provider 取消请求。 |
| `generate3D`、`generateSoundEffect` | 约束模型 kind 和输入类型，进入 `generateAsset`。它们不添加第二套 retry、poll 或 hook 实现。 |
| `materializeAsset` | 显式把 URL/base64/binary 资产转成可消费的数据；它不重新执行生成。 |

async 路径的核心不变量是：**获得 operation 后，任何状态查询、webhook、hook、timeout 或产物处理失败都不会重新提交任务。** 显式选择的执行路径不支持时直接失败；provider 已收到任务之后不能通过切换执行路径补救。

执行层以一次公开调用为事件边界。`generateAsset` 内部复用提交和等待逻辑，但不会通过重复嵌套公开入口制造多组 `onStart`/终态事件。

## Operation 与恢复

可持久化的 handle 是 `AssetOperation`：

```ts
{
  specificationVersion: 'v1',
  provider: 'provider-name',
  modelId: 'provider-model-id',
  kind: 'model-3d',
  operation: /* JSON payload owned by the provider */,
}
```

core 校验 envelope 的版本、provider、modelId、kind 与当前模型一致，并校验 payload 能作为 JSON 保存。提交和恢复入口都建立冻结的 JSON 数据快照；恢复入口在 `onStart` 之前完成这一步，已有 handle 因而能进入初始事件与错误。payload 的内部语义由 provider 解释。恢复查询、等待或取消必须重建同一 provider/model/kind 的连接，不能把已有任务重新路由给另一个模型。

保存 envelope 与保存 SDK 模型实例是两件事：凭据、fetch 实现和 provider 配置在恢复时重新提供。业务侧可以在 `onOperation` 中保存 handle；如果该 hook 失败，错误仍携带已经创建的 operation，便于修复持久化或继续查询。

Sine AI 不负责数据库、任务队列、租约、定时唤醒或崩溃恢复。`startAsset` 与 `getAssetStatus` 允许外部任务系统分别执行提交与查询；进程内的 `waitForAsset` 只负责当前调用期间的等待。

## Retry 与幂等

`retry.start` 和 `retry.generate` 默认 `0`。配置正数时，模型还必须明确声明相应的幂等能力。`retry.status` 默认 `2`；它重试的是查询请求错误，远端返回的失败或取消状态不会因此重新提交。`retry.cancel` 默认 `0`，重复取消是否安全需要调用者与 provider 明确约定。

每次逻辑提交的幂等键在 provider retry 循环之外生成。同一提交的多个 attempt 复用该键；不同提交使用不同键。用户提供的 `idempotency-key` 按 HTTP header 大小写无关规则识别并保留，provider 参数中的 `idempotencyKey` 与之保持一致。

重试决策只接受 provider 的可重试请求错误。`onAttempt` 与 `onRetry` 在 attempt 流程中被 await；它们的异常会封装成不可重试的 `AssetHookError`，即使原始 hook 抛出的是 `APICallError`，也不会触发重试。`onOperation` 与结果校验在 provider attempt 成功后执行；例如保存 operation 的 hook 报错，不能变成第二次计费提交。

共享 retry 决策由同一个内核处理，能力薄接口不能改写。每种 adapter 仍需要正确区分网络/限流等可重试请求错误与已确认的远端失败。

## 两层 timeout 与 abort

| 配置 | 覆盖范围 |
|---|---|
| `timeoutMs` | 本次调用的活跃执行阶段：provider 请求、等待和主动 lifecycle hooks。 |
| `poll.timeoutMs` | 完成等待阶段，默认 10 分钟；包括进行中的 status 请求和 webhook 后的最终查询。 |
| `poll.intervalMs` | 默认 2 秒，第一次 status 查询立即执行。 |
| `poll.delay` | 替换轮询间隔的 sleep；不接管 host deadline、时钟或完整调度器。 |

执行器将调用者的 AbortSignal 与本次调用/等待阶段的 deadline 结合，并传给 provider 方法。provider 请求、等待和主动 hooks 会与 deadline 竞争，不能因其忽略 signal 就无限阻塞本地的活跃执行阶段；同时要及时清理 timer 和 abort listener。

`onError` 和 `onAbort` 是终态清理通知，即使 signal 已取消也仍会 await，因此这些 hook 必须及时 settle。总 deadline 不强行终止用户的清理代码，也不保证包含这段清理时间的 Promise 在同一时刻返回。中止等待某个用户 Promise 同样不会自动停止该 Promise 背后的副作用。

超时或 abort 只结束本地调用，不能证明远端任务停止。远端生成仍可能成功；已经取得的 operation 保留在错误中，调用者可以之后查询，或显式调用 `cancelAsset`。

自定义 sleep 不提供持久化重放能力，也不会让进程内 Promise 自动跨重启恢复。

## Webhook 与 polling

`generateAsset` 只在模型声明 webhook 能力时调用用户的 webhook factory。没有该能力时进入 polling，避免为不支持 webhook 的 provider 创建无用的监听资源。`startAsset` 的 `webhookUrl` 则服务于已经存在的外部接收端。

factory 提供 URL 和 `received` promise。接收端需要先完成通知认证与 operation 关联，再 resolve promise；core 把该通知作为查询时机，不直接把通知内容当成生成结果。收到通知后仍查询原 operation 的状态，这次查询也在等待 deadline 之内。

对外部已提交任务，`waitForAsset` 可以接收现成的 webhook promise。没有 webhook 时查询状态，pending/running 后按间隔继续；failed/cancelled 进入终态，不创建替代任务。

webhook promise 从接收后就观察 rejection，避免提交尚未完成时出现未处理拒绝。等待结束后清理本地 timer；外部监听端的创建、认证、关联和清理由集成方维护。

## Hooks 与终态规则

正常执行会 await 所有 hook：异步持久化或审计完成后才继续下一阶段。主动 hooks 同时受本次调用的 deadline/abort 约束，终态清理 hooks 的等待规则见上节。hook 抛错不会被悄悄忽略，也不会进入 provider 重试。

| Hook | 触发含义 |
|---|---|
| `onStart` | 本次公开调用的开始。 |
| `onAttempt` | 一次 provider method attempt 即将开始，附带 phase 和 attemptNumber。 |
| `onRetry` | 已决定重试某个 provider 请求，附带错误、次数与等待时间。 |
| `onOperation` | 已获得并校验 operation，可以保存。 |
| `onProgress` | 已观察到 pending/running 的远端状态。 |
| `onFinish` | 本次调用已选定成功结果。 |
| `onError` | 本次调用已选定错误终态。 |
| `onAbort` | 本次调用已选定本地中止终态。 |

终态 hook 只选定一次。`onFinish` 失败时抛出 `AssetHookError`，其 `result` 保留已完成结果，随后不会再发 `onError`。终态错误处理 hook 自身失败时，`AssetHookError.executionError` 保留原执行错误；已有 operation 也继续随错误返回。

“hook await”提供的是当前进程中的执行顺序，不提供跨重启 exactly-once。需要去重的业务回调应基于持久化 operation 或业务幂等键自行定义语义。

## 结果与文件

`AssetModelV1Result.assets` 保存产物列表，并可携带 warnings、usage、providerMetadata 和 response。`generateAsset` 返回的 `asset` 是首个产物的便捷入口，完整列表仍在 `assets`。

`AssetFile` 是 URL、binary 或 base64 的判别联合。URL 默认不下载，这使 3D 模型、纹理、动画和音频可以直接交给对象存储或下游服务。需要 bytes 时显式调用 `materializeAsset`，生成与文件传输的失败边界因此分开。

provider-specific metadata 不会被解释成路由指令或生命周期策略；adapter 负责保留有价值的远端字段，业务层负责计费、权限与存储策略。

## 扩展与防止行为漂移

新增能力先定义输入类型、kind 和 provider 的单次方法，再添加薄类型入口。不要复制整个 `generateAsset` 实现，也不要在 facade 或 adapter 中增加独立 polling/retry。公共错误、hooks 与 operation 约束必须从共享内核继承。

核心契约测试需要覆盖同一组执行不变量：同步/异步能力选择、状态查询失败不重提、幂等键跨 retry 稳定、operation 身份与 JSON 校验、deadline/abort、webhook fallback、hook 错误及单一终态、URL 默认不下载。能力特定测试再验证输入和结果映射。

[`upstream.json`](../upstream.json) 与离线检查阻止未审阅的依赖快照变化；共享执行器和契约测试约束 Sine AI 自己的执行语义。两者职责不同，详见 [上游来源与升级流程](UPSTREAM.md)。
