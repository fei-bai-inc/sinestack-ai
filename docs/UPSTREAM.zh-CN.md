# 上游来源与升级流程

[English](UPSTREAM.md) | 简体中文

SineStack AI 的资产协议和必要编排参考 Vercel AI SDK 7 的视频生成实现。基础 retry、AbortSignal 合并和 callback 分发直接调用上游 helper，采用其行为约定。资产与领域任务共用的 submit/status/poll/result/cancel/delete 编排仍由本项目维护；上游没有可供 `AssetModelV1` 或 `TaskDriver` 直接使用的通用执行器。领域 API 与恢复边界见 [ARCHITECTURE.md](ARCHITECTURE.zh-CN.md)。

本项目与相关上游包均使用 **Apache-2.0**。保留上游 `Copyright 2023 Vercel, Inc.`、SineStack AI 修改归属、完整 `LICENSE`、各包 `NOTICE` 和派生源码说明。

## 精确基线与 internal 边界

| npm 包 | 版本 | 用途 |
|---|---|---|
| `ai` | `7.0.155` | 直接复用 internal helpers；视频生成、提交和查询是编排来源。 |
| `@ai-sdk/provider` | `4.0.34` | 协议来源及公共 JSON、warning、metadata 类型。 |
| `@ai-sdk/provider-utils` | `5.0.70` | 上游 retry primitive、delay、HTTP/schema 和数据转换工具。 |

`@sinestack/ai-core` 的 `ai` peer dependency 精确锁定 `7.0.155`，不使用 `^` 或 `~`。内部接口虽然可通过 package exports 导入，仍需要随版本升级审阅。

三个 internal 导入统一放在 [`internal/sdk.ts`](../packages/core/src/internal/sdk.ts)：

```ts
export { mergeAbortSignals, prepareRetries, mergeCallbacks } from 'ai/internal';
```

其他文件从这个本地入口使用它们。资产层不复制这些 helper，也不保留自己的 Retry-After 算法、通用 abort 竞争工具或 callback 错误协议。

基线来自上述 **npm 发布包内的原始文件**，不是 GitHub `main` 的即时内容。准确路径、用途与 SHA-256 保存在 [`upstream.json`](../upstream.json)，初次核对日期为 2026-10-28。未核实的 release commit 不写入清单。

上游入口：[官方仓库](https://github.com/vercel/ai)、[ai 7.0.155](https://www.npmjs.com/package/ai/v/7.0.155)、[@ai-sdk/provider 4.0.34](https://www.npmjs.com/package/@ai-sdk/provider/v/4.0.34)、[@ai-sdk/provider-utils 5.0.70](https://www.npmjs.com/package/@ai-sdk/provider-utils/v/5.0.70)。

## 跟踪文件的意义

| 文件或协议 | 用途 |
|---|---|
| `ai/src/util/prepare-retries.ts` 与 `retry-with-exponential-backoff.ts` | 直接采用的 retry 配置、错误分类、Retry-After 与退避策略。 |
| `ai/src/util/merge-abort-signals.ts` | 直接采用的 signal / timeout 合并。 |
| `ai/src/util/merge-callbacks.ts` | 直接采用的 await + 忽略 callback 错误语义。 |
| `ai/src/generate-video/{generate-video,start-video,get-video-status}.ts` | submit/status 分离、webhook/polling 和幂等键的派生参考。 |
| 清单所列 `@ai-sdk/provider/src/video-model/v4/*` | Asset 协议、operation 和判别式 status 的来源。 |
| `@ai-sdk/provider-utils/src/{retry-with-exponential-backoff,delay}.ts` | SDK helper 使用的公共底层工具。 |
| `@ai-sdk/provider-utils/src/{get-from-api,post-to-api,response-handler}.ts` | 各 provider 通过共享 transport 使用的公开 HTTP 与 JSON 响应 helper。 |
| `@ai-sdk/provider/src/errors/api-call-error.ts` | HTTP 错误的默认 retry classification，包括 408、409、429 和 5xx。 |
| `@ai-sdk/provider-utils/src/handle-fetch-error.ts` | 经公开 GET/POST helper 间接使用的网络错误处理；不直接 deep import。 |
| `ai/LICENSE` | 上游归属与许可证来源。 |

“跟踪”包括直接依赖、间接依赖和派生参考，不代表所有文件都被复制。`executeStartStatusFlow`、`waitForWebhook` 等视频私有函数不在包导出中，不能把 deep import 当成可用扩展接口。当前实现也没有把 3D 数据包装成 video 来绕过协议限制。

## 采用与保留的语义

| 方面 | 当前约定 |
|---|---|
| 基础重试 | 直接使用 `prepareRetries`，不再提供资产层的 initial/max delay 或 retry callbacks。 |
| HTTP | 默认策略下 GET 与 JSON/multipart POST 使用公开 SDK helpers；PUT/DELETE 与 raw manual 请求使用受限的单次 fetch 及兼容 SDK 的 handlers。当前 `request` 接受逐调用解码器；`requestRaw` 将 body 所有权交给调用方。当前 transport 使用物理 manual 重定向并在逻辑上默认拒绝；旧版固定依赖仍使用 Fetch error 模式。Tripo/Viggle 签名上传与 API 凭据分离。 |
| 阶段选择 | 提交/直接执行/取消/删除默认 0 次重试，status 默认 2 次；正数提交或直接执行重试需要 provider 幂等能力。 |
| Signal | 使用 `mergeAbortSignals` 的合作式取消，不保证强制结束忽略 signal 的 provider 或 hook。 |
| Callbacks | 使用 `mergeCallbacks`：await，忽略回调错误。只作观测，关键持久化在 `startAsset` / `startTask` 返回后显式 await。 |
| Operation / TaskHandle | 校验并冻结对应 provider/model/kind 或 driver/domain/connection 绑定的 JSON 凭据，查询失败不会重新提交。 |
| 产物 | URL 保持引用，通过 `materializeAsset` 显式获取 bytes。 |
| Webhook | 保留通知与 SDK delay 的局部等待竞争；最终 status 请求仍依靠 signal 合作取消。 |
| 远端取消与删除 | `cancelAsset` / `cancelTask` 与 `deleteTask` 分别表达取消、删除；由驱动能力决定是否支持，不把本地 abort 当作二者。 |
| 自定义 sleep | `poll.delay` 只替换 polling sleep，不引入持久化调度或重放。 |

Viggle 使用 transport 扩展实现无损 JSON、专用错误处理、单条 SSE 流与签名下载重定向查询。这些是供应商协议操作，不是另一套重试/轮询引擎。handler 优先级、raw 响应所有权与重定向策略详见[共享 transport 契约](ARCHITECTURE.zh-CN.md#共享-transport-扩展)。

这些差异与边界是明确选择，不应在升级时机械覆盖。早期 API 收缩的历史记录见 [MIGRATION.md](MIGRATION.zh-CN.md)；它不是当前 npm 发布状态声明。

## 离线校验

```sh
npm ci
npm run check:upstream
```

[`scripts/check-upstream.mjs`](../scripts/check-upstream.mjs) 只读取本地 manifest 与已安装包，检查 3 个包的包名、精确版本、license，以及 **19 个原始文件的 SHA-256**。缺包、缺文件或任何不匹配均返回非零退出码。

脚本不联网、不安装依赖、不更新基线。CI 在 Node.js 22/24 上执行 `npm ci` 和 `npm run verify:release`。后者末尾的 publish dry-run 只校验本地归档；它不等于 `npm publish --dry-run`，不会检查 npm 发布权限。只有显式提供 `--base-ref` 的发布 dry-run 才进入 registry 查询和选中包的 npm dry-run。`main` 合入后的自动发布流程及具体命令见 [PUBLISHING.md](PUBLISHING.zh-CN.md)。

检查通过只证明安装内容仍匹配已审阅快照，不证明资产编排无 bug，也不会自动发现上游的新修复。运行时的必要不变量由本项目的协议测试验证。

## 升级步骤

1. 在同一个可审阅改动中更新候选包版本、core 的精确 peer 约束及锁文件；先保留旧 manifest，观察差异。
2. 审阅三个 internal helper 的签名和行为，以及其依赖的 retry/delay 实现；同时审阅共享 transport 使用的公开 HTTP helpers 与错误处理。优先调整集中入口，避免向 provider 和 facade 扩散兼容代码。
3. 对比视频来源的相关修复，确认哪些适用于仍自有的资产编排；保留上表中明确的差异。
4. 更新必要实现与相关回归用例后，再记录新版本、hash、日期和来源；不能只重算 hash 消除告警。
5. 同步受影响的迁移说明和 `NOTICE`，运行 `npm run check` 与 `npm run check:upstream`。

若上游停止附带某个源文件或不再导出某个 internal 接口，需要明确新的验证或集成策略；不能忽略缺失项后视为通过。
