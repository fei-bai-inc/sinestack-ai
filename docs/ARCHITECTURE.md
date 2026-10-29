# 领域接口与共享执行机制

SineStack AI 的统一边界是**执行机制**，不是所有业务语义。生成、模型处理、分析、检查、骨骼和动画可以使用不同的输入、调用入口及结果结构，通过同一个泛型 runtime 运行。仅仅都是异步 HTTP 请求或都返回 GLB，不意味着应该共用一个业务结果类型。

本项目仍维护必要的 submit/status/poll/result/cancel 编排；重试策略、signal 合并和 callback 分发直接交给 AI SDK。这不是上游现成的通用 Asset executor，也不将 3D 数据伪装成 video 以调用私有函数。

## 实现分层

```text
资产入口 generateAsset / generate3D / generateMusic / ...
    -> Asset 兼容边界 internal/executor.ts
          \
           -> 唯一执行机制 internal/runtime.ts
          /
领域入口 processModel3D / analyzeModel3D / checkRigging / rigModel / animateModel
    -> tasks.ts / domains.ts

runtime -> TaskDriver 单次执行方法 -> provider HTTP / 原生结果解码
```

`internal/executor.ts` 保留旧 Asset 语义、错误和 receipt 的转换，不拥有第二份轮询循环。provider 包不依赖 core，也不实现等待、重试或 callback 调度。共享 runtime 对业务 `RESULT` 不设 assets/riggable/parts/clips 等字段约束。

| 层 | 职责 |
|---|---|
| 应用 | 业务策略、原账号/租户授权、关键持久化、多阶段组合、文件长期保存。 |
| 领域入口 | 用途约束、领域结果校验、自然的返回结构和类型推导。 |
| 唯一 runtime | 提交、查询、等待、阶段重试、信号、取消/删除、执行记录与 hooks。 |
| provider 契约 | AssetModelV1、TaskDriver、独立领域接口和任务凭据。 |
| provider-utils | JSON/连接校验、文件工具和单次 HTTP；没有执行循环。 |
| provider adapter | 认证、原生路由、参数、状态、结果解码及自身 handle 校验。 |

## 对上游的复用

| 职责 | 来源 |
|---|---|
| 错误重试分类、Retry-After、退避 | AI SDK prepareRetries。 |
| 用户 signal 与 timeout 合并 | AI SDK mergeAbortSignals、原生 AbortSignal。 |
| Callback await 与忽略错误 | AI SDK mergeCallbacks。 |
| Delay、ID、HTTP/JSON handlers、字节转换 | @ai-sdk/provider-utils 公开 helpers。 |
| 显式下载与内存文件 | ai createDownload、DefaultGeneratedFile。 |
| 领域协议、receipt 与任务编排 | SineStack AI 自有代码。 |

唯一的内部依赖入口为 [internal/sdk.ts](../packages/core/src/internal/sdk.ts)：

```ts
export { mergeAbortSignals, prepareRetries, mergeCallbacks } from 'ai/internal';
```

依赖仍精确锁定 ai@7.0.155；没有增加一套退避、Retry-After 或通用 abort 引擎。GET、JSON POST、multipart POST 使用公开 SDK helpers。fal 取消所需 PUT、Meshy 删除所需 DELETE 使用同一个受限目的地的单次 fetch 与 SDK response handlers；DELETE 可显式接受空 HTTP 200/204，生成响应仍要求有效 JSON。Tripo signed storage PUT 是不携带 API 凭证的独立上传，不进入认证 transport。

响应 handlers 可以按请求替换，默认行为保持。Viggle 使用局部 lossless JSON decoder 将不安全整数字面量保留为精确字符串；原生 retryable 与 retry_after_ms 传给既有 SDK 错误/重试机制。requestRaw 共享相同认证、地址约束与 signal，可交付单次 SSE 流或原始重定向响应，绝不跟随 Location。Viggle 的 signed PUT 也不继承 API 凭证。

## 独立语义与结果

既有 `AssetModelV1<INPUT,KIND>` 继续承载文件生成，`generateAsset` 保证非空 assets 和非可选 asset。音乐、音效、3D 等 facade 只约束 kind，保留原生输入。fal/WaveSpeed/Replicate 仍不维护模型目录，也不强迫所有模型使用一个参数 schema。

领域契约通过组合 `TaskDriver<INPUT,RESULT,DOMAIN>` 共用执行能力：

| 领域 | 入口与对象 | 结果 |
|---|---|---|
| 模型处理 | processModel3D / Model3DProcessor | 具体 processor 推导模型、部件、UV 或报告。 |
| 模型分析 | analyzeModel3D / Model3DAnalyzer | 分析发现与报告，不要求文件，不表示对模型进行修改。 |
| 骨骼检查 | checkRigging / RigChecker | 直接得到 riggable 等结论，无需空 assets。 |
| 骨骼绑定 | rigModel / ModelRigger | 模型、骨骼和实际附带产物。 |
| 角色动画 | animateModel / ModelAnimator | 文件与供应商明确报告的 clip 信息。 |

不同用途的能力不能仅因生命周期一致而互传。接口使用函数属性及 NoInfer 保留输入约束。处理结果不采用包含所有端点可选字段的大 union；生成和检查也不共享一个强制的 `output + assets` 信封。

新领域结果的业务字段位于顶层，公共执行信息放在 `execution`。高级 `waitForTask` 返回 `{ result, execution }`，其中 result 保留具体驱动类型。领域结果检查与最终组装在 runtime 的调用体内完成，所以 onFinish 观察到的是返回给调用方的同一个对象；结果校验失败走 onError。

文件本体复用 AssetFile。多文件、多个 clip、不同格式和多个 part 分别表达，不为凑统一结构捏造对应关系。没有供应商元数据时保留未知，而不是从文件数量猜 clip 数量。

## Driver 协议

TaskDriver 提供 `doExecute`，或者完整的 `doStart/doStatus`，也可以同时提供。可选的 `doCancel` 与 `doDelete` 区分停止远端工作和删除任务/产物。`validateHandle` 是恢复前的纯同步校验点。

每个方法只做一次 provider 操作。status 返回 pending/running/completed/failed/cancelled；completed 携带泛型 result。runtime 不需要识别 Tripo、Meshy 或任何业务字段，也没有供应商专用分支。

动作目录、余额等普通同步资源查询直接调用请求工具，不制造 task ID 和 pending 状态。Meshy 的独立 motion 走已有资产生成接口；打印分析定义独立分析语义，并复用同一执行机制。本轮没有建立通用 DAG 系统，也没有为了接入 Meshy 修改 runtime。

Viggle 使用独立工厂区分 H3 模式、角色动画、Render、图片、视频处理、角色/动作资源和场景阶段。19 个能力入口组合同一个 ViggleTaskDriver；ViggleAssetModel 只转换资产契约。角色资源就绪不强制输出文件，独立动作保留全部三套 rig，场景结果保留 session、batch、camera、SPZ 与 manifest 原生字段。无自动付费阶段串联。

## 提交、恢复与身份

TaskHandle 使用 `type: 'sine-ai-task'` 与 v1 标记，绑定 provider、driverId、domain、可选 modelId/connectionId，并保留已知 submittedAt 和 opaque JSON handle。这个持久化协议标记刻意保持稳定，不随 SineStack AI 包名和仓库地址变化；不要对数据库中的任务凭据做品牌字符串替换。driverId 用于稳定路由和恢复，不是调用方必须记忆的全局业务操作目录。

新 receipt 的完整 JSON 信封在访问字段前检查 descriptor；提交/恢复建立深冻结快照。恢复的 driver.validateHandle 在 hooks 和认证 I/O 前运行。Tripo 与 Meshy 校验原 baseURL、原生 route、model、connection 与安全 task ID，不接受响应中任意 URL 作为带凭据的目标。Meshy 额外绑定 text preview/refine 阶段，避免同一个 HTTP 路径的任务被错误恢复。

旧 Asset receipt 保持原 specificationVersion/provider/modelId/kind/operation 结构，通过兼容边界进入 runtime。旧 provider 的内层连接校验仍由其单次方法在请求前执行。类型区分不能替代运行时凭据校验。

两种 receipt 都不保存 API key。连接标识只能帮助校验绑定，不能替代应用恢复同一账号/租户并执行授权。无稳定 connectionId 时，仅凭同一个 baseURL 无法识别 API key 是否已换账号。

`startTask` 或 `startAsset` 返回后，显式 await 应用持久化。保存失败时继续保存原 handle，不重新提交。恢复查询失败、webhook 异常、远端 failed 或本地中止都不进入重新提交路径。

## 重试、超时与观察

提交/直接执行/取消/删除默认重试 0 次，状态读取默认 2 次。正数提交或直接执行重试需要 provider 明确声明幂等能力。同一逻辑提交的幂等键在 retry 闭包外产生；返回凭据校验也在闭包外，避免已受理的任务因本地验证失败被再次创建。

真实 retry 分类与退避由 prepareRetries 决定。不新增 onAttempt/onRetry，不重新实现上游网络错误策略。

默认轮询首次立即查询，后续每 2 秒；poll.timeoutMs 默认 10 分钟，timeoutMs 约束本次调用信号。取消是合作式的：不强制结束忽略 signal 的 provider Promise 或不返回的 hook。本地 abort 不调用远端 cancel/delete。poll.delay 仅替换 sleep，不提供持久化重放。

hooks 只有 onStart/onOperation/onProgress/onFinish/onError，通过 mergeCallbacks await 并忽略错误。日志适合放入 hooks，鉴权和必须成功的持久化不适合。

Meshy 普通 DELETE 是移除任务及产物，不是取消运行中的任务。只在已核验的 task family 上声明 doDelete，未伪造 doCancel。收到 409 不表示取消成功，也不触发新任务。

## Webhook 边界

旧 Asset submission webhook factory 及“通知后仍非终态则错误”的行为保持。新任务可提供一个已经认证、关联好的 notification，收到后查询同一任务；查询尚未终态则继续轮询。通知丢失会消耗等待预算，因此交付不可靠时优先普通轮询。Viggle Render events 通过 eventsource-parser 解析单次 SSE，支持 Last-Event-ID，但不自动重连，不拥有第二套执行内核；通用 watch 尚未实现。

Tripo 使用账户级订阅，不声明提交级 callback 能力。verifyTripoWebhook 使用 Web Crypto 验证原始字节与时间窗，返回签名 event.id 作为去重键。宿主应根据可信路由解析 connection，使用可信 endpoint ID，原子保存 connection + event.id 和 outbox。unsigned delivery headers 不能充当已认证的去重身份。

Meshy 也使用账户级订阅，但公开文档未提供已核验的签名协议。parseMeshyWebhook 明确返回 authenticated:false；解析不等于验签，eventKey 也不是已认证身份。宿主负责可信连接和任务关联、授权、限流、持久化去重与 outbox。不能套用 Tripo 签名算法。

Webhook 只唤醒已登记任务的权威查询，不直接接纳其中的生成结果，也不允许回调决定携带凭据访问的地址。

## 旧 Asset 兼容要求

保留非空 assets、非可选 asset、旧 auto/direct/async 选路及双能力模型；query 可以返回 failed/cancelled，wait/generate 才将其转换成终态异常。旧 AssetExecutionError/AssetTimeoutError/AssetAbortError、ASSET_* code、phase 与 operation 继续支持。

原有输入推导、kind 检查、hooks 字段和时机、幂等门及凭据快照保持。Task 与 Asset 的错误/receipt 转换仅存在于兼容边界，不污染通用 runtime 或 provider。

failed/cancelled 状态与终态错误可携带 response/providerMetadata；runtime 和 Asset 兼容转换将原始诊断传递到调用方及 onError，保留 cause、阶段、code 和 receipt。HTTP 200 内的业务失败因此仍可查到供应商 request_id、details 与 remediation。

## 文件、多阶段与验证

AssetFile 可以是 URL、binary、base64。URL 默认不下载，materializeAsset 是显式独立阶段。长期文件保存、下载网络策略和字节上限由应用控制。URL 失效不应触发重新生成收费任务。

Tripo import/check/rig/retarget 和 Meshy preview/refine 均按独立阶段保存与恢复。检查引用不天然是模型资源，task ID 也不能跨供应商直接使用。隐式工作流如果将来提供，需要有明确的各阶段状态和持久化边界，不能冒充单个远端提交。

Node 22/24 CI 包括旧 provider 回归、各领域运行与类型测试、Tripo 20 个操作、Meshy 18 个能力与 Viggle 19 个能力的 mock 契约、恢复、上传/通知安全。发布验证还会在工作区之外安装九个 `@sinestack/ai-*` tarball，检查公开声明与运行调用。版本脚本更新公共 runtime 的 User-Agent，不再修改仅作兼容层的 executor。

Viggle 另在真实 workerd 中执行任务恢复、精确 seed、multipart、SSE 与签名 PUT 用例，未启用 nodejs_compat，使用注入的 mock fetch。底层请求使用 workerd 支持的 manual 重定向模式，并由认证 transport 默认拒绝 3xx；signed PUT 也显式拒绝跳转。可复现用例见 [Worker 验证](../tests/workerd/README.md)。

这些测试不证明真实 API 权限、所有模型版本组合和二进制资产内容正确，也不代表已部署到 Cloudflare。真实计费联调、Creative Lab、通用 watch 与持久化调度器仍有各自独立的验收边界。

详见 [Tripo](TRIPO.md)、[Meshy 实现与联调边界](MESHY.md)、[Viggle 实现与联调边界](VIGGLE.md)、[聚合 provider](MEDIA_PROVIDERS.md)、[发布](PUBLISHING.md)、[上游精确基线](UPSTREAM.md) 和 [历史迁移](MIGRATION.md)。
