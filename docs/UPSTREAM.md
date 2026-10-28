# 上游来源与升级流程

Sine AI 的资产协议和执行流程以 Vercel AI SDK 7 的视频生成实现为起点。它把提交、状态查询、等待、重试和生命周期回调收敛到同一个资产执行层，供 3D、音效以及后续能力复用。

本项目使用 **Apache-2.0**。上游发布包的许可证同样是 Apache-2.0，归属为 `Copyright 2023 Vercel, Inc.`。根目录和每个发布包都保留完整 `LICENSE` 与各自的 `NOTICE`；派生源码还需要保留文件级来源和修改声明。

## 固定基线

| npm 包 | 已审阅版本 | 用途 |
|---|---|---|
| `ai` | `7.0.155` | 视频生成、提交、单次查询、重试策略与 abort 组合的参考实现 |
| `@ai-sdk/provider` | `4.0.34` | `VideoModelV4`、异步 operation 类型，以及可直接复用的 JSON、warning、metadata 类型 |
| `@ai-sdk/provider-utils` | `5.0.70` | 公共重试、延迟、HTTP、schema 和数据转换工具 |

来源是上述版本 **npm 发布包内的原始文件**，不是 GitHub `main` 的即时内容。准确的路径、用途及原始字节 SHA-256 保存在 [`upstream.json`](../upstream.json)。初次核对日期为 2026-10-28。没有经过核实的 release commit 不写入清单。

上游入口：

- [Vercel AI SDK 官方仓库](https://github.com/vercel/ai)
- [ai 7.0.155](https://www.npmjs.com/package/ai/v/7.0.155)
- [@ai-sdk/provider 4.0.34](https://www.npmjs.com/package/@ai-sdk/provider/v/4.0.34)
- [@ai-sdk/provider-utils 5.0.70](https://www.npmjs.com/package/@ai-sdk/provider-utils/v/5.0.70)

## 来源对应关系

| 上游文件或协议 | Sine AI 中的用途 |
|---|---|
| `ai/src/generate-video/generate-video.ts` | 参考同步/异步路径、提交与轮询的边界、webhook 等待、超时和结果聚合 |
| `ai/src/generate-video/start-video.ts` | 参考一次提交、重试期间稳定的幂等键、返回不透明 operation |
| `ai/src/generate-video/get-video-status.ts` | 参考单次查询与提交的分离 |
| `ai/src/util/prepare-retries.ts`、`retry-with-exponential-backoff.ts` | 参考可重试错误与 Retry-After 策略；跟踪可能使用的内部集成接口 |
| `ai/src/util/merge-abort-signals.ts` | 参考调用者取消与 deadline 的组合 |
| `@ai-sdk/provider/src/video-model/v4/*` 中清单所列文件 | `@sine-ai/provider` 的 `AssetModelV1` 与 operation/status 协议来源 |
| `@ai-sdk/provider-utils/src/retry-with-exponential-backoff.ts`、`delay.ts` | 已复用或审阅的公共执行工具 |

这里的“来源”包含派生参考与直接依赖，**不代表每个列出的文件都被逐行复制**。具体改编说明见对应源码头和包内 `NOTICE`。新增需要长期跟踪的上游文件时，应同时添加到 manifest。

## 复用接口的边界

`@ai-sdk/provider` 和 `@ai-sdk/provider-utils` 的根导出提供公共类型、HTTP、schema、字节转换及 retry primitive。`ai` 根导出包括 `DefaultGeneratedFile` 和 `createDownload`，但 `DefaultGeneratedFile` 只保存 bytes/base64，不能表示尚未下载的 URL。

`ai/internal` 虽然有 package export，但它仍是内部集成路径；其中 `prepareRetries` 与 `mergeAbortSignals` 的变更需要单独审阅。调用点应集中管理，不应散落到各个 provider 或能力接口。清单记录这些文件，并不意味着本项目承诺使用所有这些内部函数。

上游 `executeStartStatusFlow`、`waitForWebhook`、`mergeProviderMetadata` 和 `normalizeVideoCallInputs` 不是公共包导出。不能把 `node_modules/ai/src/...` 的深层路径当成扩展协议。Sine AI 为这些职责建立自己的共享资产实现。

## 有意修改的执行语义

Sine AI 与上游 `generateVideo` 不保证逐项行为相同。以下差异是明确的设计决策，升级时不能被机械覆盖。

| 方面 | Sine AI 的约定 |
|---|---|
| 能力扩展 | `generate3D`、`generateSoundEffect` 等薄接口进入同一 `generateAsset` 执行层；provider 方法执行一次远端操作。 |
| 提交重试 | 默认 `0`。显式配置正数还要求模型声明对应的 `idempotentStart` 或 `idempotentGenerate` 能力；仅放置幂等 header 不足以证明远端幂等。 |
| 查询重试 | 默认 `2`，只重试查询请求错误；远端 `failed`/`cancelled` 状态不会触发重新提交。 |
| Operation | envelope 绑定 provider、modelId、kind 与版本，并验证 payload 的 JSON 可序列化性；恢复时使用原模型。 |
| 产物 | URL 默认保持引用；需要数据时显式调用 `materializeAsset`。 |
| 等待超时 | `poll.timeoutMs` 默认 10 分钟，同时覆盖等待、进行中的 status 请求和 webhook 后的最终查询。 |
| 整体超时 | `timeoutMs` 约束 provider 请求、等待和主动 hooks；它与等待阶段的 timeout 分开配置。`onError`/`onAbort` 终态清理仍会被 await，必须及时 settle。 |
| Hooks | 正常执行会 await，失败封装为不可重试的 `AssetHookError` 并向调用者传播。终态选定后不再发送另一个终态事件。 |
| 完成 hook 失败 | `AssetHookError.result` 保留已完成的结果；存在 operation 时错误也保留该 handle。 |
| 取消 | `cancelAsset` 只在 provider 支持时请求远端取消；中止本地请求或等待不等于远端任务已停止。 |
| 自定义 sleep | `poll.delay` 只替换轮询 sleep，不替换运行时的 deadline 和调度机制。 |

上游当前的 `poll.delay` 也不能视为完整 durable scheduler。Sine AI 没有在这里增加持久化调度、重放、队列或崩溃恢复服务。

## 离线校验

安装锁文件指定的依赖后运行：

```sh
npm ci
npm run check:upstream
```

[`scripts/check-upstream.mjs`](../scripts/check-upstream.mjs) 只读取本地 manifest 和已安装的 npm 包：

1. 解析每个包的 `package.json`，检查包名、精确版本与 license 字段。
2. 对清单中的 13 个文件读取原始字节并计算 SHA-256。
3. 缺包、缺文件、版本或许可证变化、hash 不匹配都会返回非零退出码并显示差异。

脚本不联网、不读取远端 `main`、不安装依赖，也不更新 manifest。CI 在 Node.js 22 和 24 上运行 `npm ci`、`npm run check` 与 `npm run check:upstream`；它不执行发布。

通过校验只证明**本次安装仍匹配已审阅的上游快照**。它不证明 Sine AI 的执行语义正确，也不自动发现上游的新修复。执行语义由共享内核和跨能力契约测试验证。

## 升级步骤

1. 在一个可审阅的改动中更新候选依赖版本与锁文件，保留原 `upstream.json`，先观察校验报告的变化。
2. 对比清单中的上游文件，重点看 retry 分类、提交幂等、状态终止、timeout、abort、webhook、结果与 metadata 变化。
3. 判断每项修复是否适用于资产协议，并保留上表中有意不同的语义；不能只更新 hash 消除告警。
4. 修改共享内核或契约，增加能够覆盖该变化的回归用例，确认所有薄接口仍走同一执行路径。
5. 审阅完成后更新清单中的版本、文件 hash、日期和来源说明，并同步需要变化的 `NOTICE`。
6. 运行 `npm run check` 和 `npm run check:upstream`。提交说明应指出采纳的修复与继续保留的差异。

若发布包停止附带某个源文件，应明确更换可验证的来源和检查策略；不要跳过缺失文件后把验证视为通过。
