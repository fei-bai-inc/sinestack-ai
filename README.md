# SineStack AI

基于 **Vercel AI SDK 7** 扩展的 TypeScript 资产生成与处理 SDK。

**领域接口分别设计，任务生命周期与执行引擎共用。** 生成 3D、音乐、音效等保留资产接口；模型处理、分析、骨骼检查、绑定和角色动画使用各自的输入与结果。调用方不必使用全局操作字符串，也不必把无文件的检查结果包装成资产。

重试策略、AbortSignal 合并和 callback 分发直接复用 AI SDK。submit/status/poll/result/cancel 编排仍由 SineStack AI 维护；这不是上游现成的通用 Asset executor。

## 包与维护边界

| 包 | 职责 |
|---|---|
| `@sinestack/ai-provider` | 既有 Asset 协议、通用 TaskDriver、领域契约、文件与任务凭据。 |
| `@sinestack/ai-core` | 唯一执行内核、领域入口、旧 Asset 兼容边界、恢复和显式文件物化。 |
| `@sinestack/ai-provider-utils` | JSON/连接校验、常见文件解析、基于 AI SDK 的单次 HTTP 工具。 |
| `@sinestack/ai-fal` | fal queue 提交、查询、结果和取消；无模型目录。 |
| `@sinestack/ai-wavespeed` | WaveSpeed prediction 提交和查询；无模型目录。 |
| `@sinestack/ai-replicate` | Replicate prediction、固定版本及取消；无模型目录。 |
| `@sinestack/ai-tripo` | Tripo v3 生成、Model Processing、检查、骨骼、动画及辅助资源。 |
| `@sinestack/ai-meshy` | Meshy 生成、处理、打印分析/修复、骨骼、动画、独立动作及辅助资源。 |

Provider 方法只完成一次协议操作，不添加自己的 polling、重试、abort 或 hook 引擎。模型版本保持开放，不设 SDK 型号白名单。Tripo 与 Meshy 均实现对应领域契约；公共执行内核没有供应商分支。

## 从源码使用

通过仓库 npm workspaces 使用，需要 Node.js 22 或 24：

```sh
git clone https://github.com/fei-bai-inc/sinestack-ai.git
cd sinestack-ai
npm ci
npm run build
```

无 key、无网络的本地文件生成示例：

```sh
node --experimental-strip-types examples/custom-provider.ts
```

八个 `@sinestack/ai-*` 包使用同一发布版本。Tripo、Meshy 均已纳入打包和独立安装测试；提交代码不会自动发布 npm。完整流程见 [发布说明](docs/PUBLISHING.md)。

## 生成：显式模型 ID 与原生 input

fal、WaveSpeed、Replicate 提供相同的资产工厂：

```ts
provider.music(modelId, mapping?);
provider.threeD(modelId, mapping?);
provider.soundEffect(modelId, mapping?);
provider.animation3D(modelId, mapping?);
provider.asset(modelId, { kind, mapInput?, mapResult? });
```

它们只设置资产 kind，原样传递模型原生 JSON，不把某个模型的 schema 强加给整个平台。调用方负责选择实际存在的模型及其参数。

```ts
import { generate3D } from '@sinestack/ai-core';
import { createWaveSpeedAssetProvider } from '@sinestack/ai-wavespeed';

const wavespeed = createWaveSpeedAssetProvider();
const modelId = process.env.THREE_D_MODEL_ID;
if (!modelId) throw new Error('Set THREE_D_MODEL_ID');

const result = await generate3D({
  model: wavespeed.threeD(modelId),
  input: { prompt: 'A wooden lantern' }, // 使用所选模型要求的原生字段。
});
console.log(result.asset, result.assets);
```

`generateMusic`、`generate3D`、`generateSoundEffect`、`generateAnimation3D` 是按 kind 约束的薄入口，均进入 `generateAsset`。旧平铺字段重载仍保留并标记 deprecated，仅用于明确接收这些字段的外部 mapper 或自定义模型。

`providerOptions.<provider>` 可以补充原生参数，不能覆盖 input 或 mapInput 已提供的同名字段。无需为同协议的新模型更新 SDK。

## 处理、检查、骨骼与动画：不同语义，同一执行内核

```ts
import { processModel3D, checkRigging, rigModel, animateModel } from '@sinestack/ai-core';
import { createTripoProvider } from '@sinestack/ai-tripo';

const tripo = createTripoProvider(); // 服务端 TRIPO_API_KEY。

async function animateCharacter(originalModelTaskId: string, rigVersion: string, preset: string) {
  const report = await checkRigging({
    checker: tripo.rigCheck(),
    input: { input: originalModelTaskId },
  });
  if (!report.riggable) return { report }; // 检测正常完成，不是远端执行失败。

  const rigged = await rigModel({
    rigger: tripo.rig(rigVersion),
    input: { input: originalModelTaskId, rig_type: 'biped' },
  });
  const animated = await animateModel({
    animator: tripo.retarget(),
    input: { input: rigged.taskId, animation: preset },
  });
  return { report, rigged, animated };
}

async function textureModel(sourceTaskId: string, textureVersion: string) {
  return processModel3D({
    processor: tripo.texture(textureVersion),
    input: { input: sourceTaskId, texture_prompt: { text: 'painted wood' } },
  });
}
```

这些调用会创建实际任务；上面的组合示意不替代生产系统的逐阶段持久化。Rig 使用原模型，不使用 Rig Check 的任务 ID；Retarget 使用 Rig 的任务 ID。

处理结果有模型、部件、预览或报告；检查直接返回 `riggable`；动画保留实际文件与供应商报告的 clip 信息。字段由具体能力类型推导，不是一份全局大 union。公共执行器不理解这些业务字段。

Tripo 共实现 20 个业务操作入口与 6 个辅助 API，包含全部生成、Model Processing/Import、Rig Check/Rig/Retarget，以及任务、上传、余额和用量。完整范围、参数及验证边界见 [Tripo 文档](docs/TRIPO.md)。

## Meshy：显式阶段和独立分析

```ts
import { analyzeModel3D, processModel3D } from '@sinestack/ai-core';
import { createMeshyProvider } from '@sinestack/ai-meshy';

const meshy = createMeshyProvider(); // 服务端 MESHY_API_KEY。

async function refineAndAnalyze(previewTaskId: string) {
  const refined = await processModel3D({
    processor: meshy.refine(), // 未指定 ai_model 时继承 preview 的模型。
    input: { preview_task_id: previewTaskId, enable_pbr: true },
  });
  const report = await analyzeModel3D({
    analyzer: meshy.analyzePrintability(),
    input: { input_task_id: refined.taskId, printer_type: 'fdm' },
  });
  return { refined, report }; // 报告有问题，不等于远端任务执行失败。
}
```

`meshy.textTo3D(modelId)` 只创建 geometry preview；`meshy.refine()` 是另一项独立任务，不隐藏第二次付费提交。Image/Multi-Image to 3D、Retexture、Remesh、Convert、Resize、UV、Rig、Animation、图像生成编辑、Text to Motion 和打印处理共 18 个能力入口。独立动作使用 `generateAnimation3D`，应用到角色使用 `animateModel`。

Meshy 没有伪造独立 Rig Check。普通 DELETE 是删除任务/产物，不是取消。动作目录、任务列表、余额和用量是直接资源查询。Creative Lab 专用工作流和 SSE/watch 未纳入此次实现。完整参数、输出、文档差异和联调边界见 [Meshy 文档](docs/MESHY.md)。

## 提交、持久化与恢复

资产 API 的原用法保持：

```ts
const started = await startAsset({ model, input });
await saveOperation(started.operation);
const result = await waitForAsset({ model, operation: started.operation });
```

新领域任务使用公共生命周期入口：

```ts
import { startTask, getTaskStatus, waitForTask } from '@sinestack/ai-core';

const model = tripo.rig(selectedRigVersion);
const started = await startTask({ model, input: { input: originalModelTaskId } });
await saveTask(started.task);

const status = await getTaskStatus({ model, task: started.task });
const completed = await waitForTask({ model, task: started.task });
console.log(completed.result); // 保留该能力的精确结果类型。
```

示例中的模型、输入、版本、源任务和持久化方法由应用提供。`startTask` 只提交；`getTaskStatus` 只观察一次；`waitForTask` 不重新提交。`cancelTask` 和 `deleteTask` 分别表示远端取消、删除，不与本地 abort 混用。驱动不支持的能力在请求前报错。

持久化失败时保留已返回的 handle，补写或恢复，不能因保存失败重复创建计费任务。每个阶段独立保存。hooks 是观察回调，不承担必须成功的业务事务。

任务凭据有独立运行时标记，并绑定 provider、driver、domain、可选 model/connection；旧 Asset receipt 继续接受。包和仓库改名不改变 v1 任务的 `sine-ai-task` 协议标记，已保存任务无需重写或重提。恢复需要原授权账号与连接。凭据不保存 API key，也不能替代租户鉴权。跨供应商资源传递需要显式保存/上传文件，不能互传原生 task ID。

## 可选外部映射与文件

资产的 `mapInput`、`mapResult` 可以分别提供，也支持外部类实例及其原型方法：

```ts
const model = wavespeed.threeD<{ description: string }>('your-provider/your-model', {
  mapInput: input => ({ prompt: input.description }),
});
```

默认输出映射识别常见 URL、文件数组和显式文件对象，不扫描 prose 或任意 metadata 字符串。特殊输出可以注入 mapResult。Tripo 与 Meshy 使用自身端点输出解码，并保留完整原生结果；可扩展的 `TripoTaskDriver`、`MeshyTaskDriver` 接受类型化输入映射及结果 decoder。

旧资产结果保持非空 `assets`、非可选 `asset` 和原生 `providerMetadata.<provider>.output`。新领域结果不强制有文件，公共执行记录位于 `execution`。模型、UV、mask、多视图、动画文件不会因为一个“主文件”而被丢弃。

URL 默认不下载。需要 bytes 时显式使用：

```ts
import { materializeAsset } from '@sinestack/ai-core';
const file = await materializeAsset(result.asset, { maxBytes: 64 * 1024 * 1024 });
```

生成与下载是独立失败边界。持久化文件由应用负责，不应把临时 URL 当永久地址。自定义 downloader 负责网络限制、最大体积及 AbortSignal 响应。

## 连接、安全与执行约定

| Provider | 默认 baseURL | 环境变量 |
|---|---|---|
| fal | `https://queue.fal.run` | `FAL_KEY` |
| WaveSpeed | `https://api.wavespeed.ai/api/v3` | `WAVESPEED_API_KEY` |
| Replicate | `https://api.replicate.com/v1` | `REPLICATE_API_TOKEN` |
| Tripo | `https://openapi.tripo3d.ai/v3` | `TRIPO_API_KEY` |
| Meshy | `https://api.meshy.ai/openapi` | `MESHY_API_KEY` |

连接支持 apiKey/baseURL/headers/fetch/name，Tripo、Meshy 额外支持 connectionId。配置会复制保存；实际认证不能被调用级 headers 覆盖。带凭证请求拒绝重定向；自定义 fetch 也应遵守该限制。签名存储上传独立执行，不能继承 API key 或连接 header。

提交和直接执行默认不重试；正数重试要求明确远端幂等保障。状态读取默认重试两次，由 AI SDK 决定错误分类、退避与 Retry-After。远端 failed/cancelled 不触发重新生成。

普通轮询首次立即查询，默认间隔 2 秒、等待超时 10 分钟。超时与 abort 是合作式信号，不能强制终止忽略信号的 Promise 或挂起的 hook。本地中止不会自动取消远端任务。

五个 hooks 为 onStart/onOperation/onProgress/onFinish/onError，均 await 且忽略回调错误。鉴权、关键持久化和业务事务放在它们之外。

Tripo 与 Meshy 都不伪造提交级 callback URL。Tripo 验签和宿主事务/outbox 见 [TRIPO.md](docs/TRIPO.md)。Meshy 公共文档未提供已核验的签名协议，`parseMeshyWebhook` 明确只是非认证解析；应由宿主授权关联后唤醒既有任务查询，不能信任通知中的结果。SSE/watch 和持久化调度器尚未实现。

## 开发与发布验证

```sh
npm run check
npm run check:upstream
npm run verify:release
```

`check` 包括类型、构建和 mock 契约测试；CI 使用 Node 22/24。`check:upstream` 离线检查 3 个精确上游包和 19 项源码 hash，不联网更新基线。

`verify:release` 还会打包八个 workspace、在工作区之外安装真实 tarball 并检查公开类型和运行调用，最后运行 npm publish dry-run。正式发布沿用 GitHub Actions OIDC 配置；显式发布版本、访问级别和 dist-tag，详见 [PUBLISHING.md](docs/PUBLISHING.md)。

测试不调用真实计费 API，不证明供应商账号权限、所有版本参数组合或二进制模型内容正确；Cloudflare/workerd 运行验证尚未完成。

示例：[自定义 provider](examples/custom-provider.ts)、[聚合平台](examples/media-providers.ts)、[资产恢复](examples/submit-and-resume.ts)、[Tripo](examples/tripo.ts)、[Meshy](examples/meshy.ts)。

## 上游与许可证

基线 `ai@7.0.155`、`@ai-sdk/provider@4.0.34`、`@ai-sdk/provider-utils@5.0.70`。内部导入集中在 `packages/core/src/internal/sdk.ts`，core 的 ai peer 精确锁定；升级需要审阅，不另行维护 SDK 的基础 retry/abort 实现。

Apache-2.0，保留 Vercel 和 SineStack AI 归属。详见 [LICENSE](LICENSE)、[NOTICE](NOTICE)、[上游](docs/UPSTREAM.md)、[架构](docs/ARCHITECTURE.md)、[Media providers](docs/MEDIA_PROVIDERS.md) 和 [历史迁移说明](docs/MIGRATION.md)。
