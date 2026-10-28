# Sine AI

基于 **Vercel AI SDK 7** 扩展的 TypeScript 资产生成 SDK。`AssetModelV1` 为 3D 模型、音效及自定义能力提供生成、提交、查询、等待和取消接口，`generate3D`、`generateSoundEffect` 是 `generateAsset` 上的薄类型入口。

重试策略、AbortSignal 合并和 callback 分发直接复用 AI SDK，通过唯一的 [`internal/sdk.ts`](packages/core/src/internal/sdk.ts) 集中导入。**通用资产的提交、polling、结果映射与取消编排仍由 Sine AI 维护**；AI SDK 当前没有可直接接入 `AssetModelV1` 的通用 executor。

这版采用最小维护边界：沿用 SDK 的 retry 和观测回调语义，删去了资产层另外实现的强制超时、hook 错误协议和终态状态机。初版 API 的收缩见 [迁移说明](docs/MIGRATION.md)。

## 当前范围

| 包 | 职责 |
|---|---|
| `@sine-ai/provider` | 版本化 `AssetModelV1`、资产结果和可持久化 operation 协议。 |
| `@sine-ai/core` | 必要的资产编排、3D/音效接口、operation 恢复、显式文件物化；基础机制委托给 AI SDK。 |
| `@sine-ai/fal` | fal queue adapter，内置 3D/音效映射，并支持 `fal.asset()` 接入其他 fal endpoint。 |

当前内置模型入口是 `fal.threeD()` → `fal-ai/hunyuan3d-v3/text-to-3d`，以及 `fal.soundEffect()` → `fal-ai/elevenlabs/sound-effects/v2`。默认值与参数映射见 [fal provider](packages/fal/src/index.ts)。音乐、3D 动作和文档可以使用通用协议扩展；当前没有为它们提供现成的专用远端 adapter。

## 从源码使用

**这些包尚未发布到 npm。** 当前通过仓库中的 npm workspaces 开发和使用；下面示例的 `@sine-ai/*` 导入由 workspace 链接解析。

需要 Node.js 22 或 24，以及 npm：

```sh
git clone https://github.com/fei-bai-inc/sine-ai.git
cd sine-ai
npm ci
npm run build
```

先运行无需 API key 或网络的本地 document 示例：

```sh
node --experimental-strip-types examples/custom-provider.ts
```

该示例已纳入 `npm run typecheck`。它返回 UTF-8 文本资产，展示自定义能力如何进入同一套资产编排。

## 生成 3D 模型与音效

fal 连接默认读取 `FAL_KEY`，也可以通过 `createFalAssetProvider({ apiKey })` 显式传入。`baseURL`、`fetch` 和额外 headers 可在连接配置中指定。

```ts
import { generate3D, generateSoundEffect } from '@sine-ai/core';
import { createFalAssetProvider } from '@sine-ai/fal';

const fal = createFalAssetProvider();

const threeD = await generate3D({
  model: fal.threeD(),
  prompt: 'A small stylized stone cottage with a red roof',
  providerOptions: {
    fal: { generate_type: 'LowPoly', face_count: 80_000 },
  },
  poll: { intervalMs: 2_000, timeoutMs: 600_000 },
  timeoutMs: 660_000,
  hooks: {
    onProgress({ status, message }) {
      console.log(status, message);
    },
  },
});

console.log(threeD.asset);  // 首个产物
console.log(threeD.assets); // 全部产物，例如模型和缩略图

const sound = await generateSoundEffect({
  model: fal.soundEffect(),
  prompt: 'Gentle rain on a wooden roof, seamless ambience',
  durationSeconds: 6,
  promptInfluence: 0.5,
  loop: true,
  providerOptions: {
    fal: { output_format: 'mp3_44100_128' },
  },
});

console.log(sound.assets);
```

`providerOptions.fal` 用于模型特定的附加参数，不能覆盖已由输入映射生成的字段。`prompt`、`durationSeconds` 等应通过对应的输入接口传入。

### 文件默认保留为引用

结果中的 `AssetFile` 是 `url`、`binary` 或 `base64`。URL 默认不会被 SDK 下载；可直接交给业务存储或消费端。需要 bytes 时显式调用：

```ts
import { materializeAsset } from '@sine-ai/core';

const file = await materializeAsset(threeD.asset, {
  maxBytes: 64 * 1024 * 1024,
});

console.log(file.mediaType, file.uint8Array.byteLength);
```

物化默认上限是 64 MiB，可传 `abortSignal` 和自定义 `download`。自定义 downloader 负责自己的网络访问策略、读取过程中的大小限制及对 signal 的响应，core 还会检查它返回的 bytes。生成成功与文件下载成功是两个独立阶段。

## 提交、恢复与取消

长任务可以先提交，把 operation 存入自己的任务系统，再由其他请求或进程恢复。关键持久化应在 `startAsset` 返回后显式 await；观测 hook 的错误不会让调用失败。下面用本地文件演示，服务端可把文件操作换成自己的数据库写入：

```ts
import { readFile, writeFile } from 'node:fs/promises';
import {
  startAsset,
  getAssetStatus,
  waitForAsset,
  cancelAsset,
  type AssetOperation,
} from '@sine-ai/core';
import { createFalAssetProvider } from '@sine-ai/fal';

const model = createFalAssetProvider().threeD();
const started = await startAsset({
  model,
  input: { prompt: 'A low-poly wooden treasure chest' },
});

// 保存失败会在这里抛出；started.operation 仍可用于补写或恢复。
await writeFile('asset-operation.json', JSON.stringify(started.operation), 'utf8');

// 之后重建同一个 provider/model/kind 的连接。
const restoredModel = createFalAssetProvider().threeD();
const operation = JSON.parse(
  await readFile('asset-operation.json', 'utf8'),
) as AssetOperation<'model-3d'>;
const status = await getAssetStatus({ model: restoredModel, operation });
console.log(status.status);

// 需要等待结果时调用；不会重新提交任务。
const result = await waitForAsset({
  model: restoredModel,
  operation,
  poll: { timeoutMs: 600_000 },
});
console.log(result.assets);
```

如果用户选择取消，用 `cancelAsset({ model: restoredModel, operation })` 发出独立的取消请求。返回的 `status: 'requested'` 表示 provider 接受了取消请求，`'cancelled'` 表示 adapter 已观察到取消确认；本地 AbortSignal 只通知当前调用取消，不会自动调用远端取消。

SDK 在恢复时检查 operation 的版本、provider、modelId、kind 和 JSON payload。`getAssetStatus`、`waitForAsset`、`cancelAsset` 都围绕同一远端任务工作，不会在查询失败后创建替代任务。

### Webhook

`generateAsset` 接受 `webhook: () => ({ url, received })`。接收端先认证并关联通知，再 resolve `received`；SDK 随后查询原 operation，取得最终结果。模型不支持 webhook 时回到 polling，且不调用该 factory。

外部接收端已存在时，`startAsset` 可传 `webhookUrl`；恢复等待时，`waitForAsset` 可传已有的 webhook promise。通知认证、外部监听资源和持久化由应用维护。

## 接入自己的 endpoint 或 provider

### 复用 fal 的 queue 协议

`fal.asset()` 只需要输入/结果映射，继续使用已有的 submit/status/cancel 协议。下面是假设你已部署了一个返回 `{ url: string }` 的 fal document endpoint；替换 endpoint ID 与映射即可：

```ts
import { generateAsset } from '@sine-ai/core';
import { createFalAssetProvider } from '@sine-ai/fal';

const fal = createFalAssetProvider();
const documentModel = fal.asset<{ prompt: string }, 'document'>(
  'your-owner/your-document-model',
  {
    kind: 'document',
    mapInput({ prompt }) {
      return { prompt };
    },
    mapResult(raw) {
      if (raw === null || typeof raw !== 'object' ||
          !('url' in raw) || typeof raw.url !== 'string') {
        throw new TypeError('Expected a document URL');
      }
      return {
        assets: [{
          type: 'url',
          url: raw.url,
          mediaType: 'application/pdf',
          role: 'document',
        }],
      };
    },
  },
);

const document = await generateAsset({
  model: documentModel,
  input: { prompt: 'Create a one-page product brief' },
});
```

`mapResult` 收到的是 fal REST 的原始结果 body，不是 fal JavaScript SDK 的 `{ data }` 包装。映射应校验实际的远端响应结构。

### 实现 `AssetModelV1`

对于其他服务，直接实现 `AssetModelV1<YourInput, 'your-kind'>`：同步接口提供 `doGenerate`；异步接口成对提供 `doStart`/`doStatus`，按需提供 `doCancel`。每个方法只完成一个 provider 操作，重试、轮询和生命周期仍由 core 处理。

[examples/custom-provider.ts](examples/custom-provider.ts) 是一个完整、无网络的 `document` provider：`doGenerate` 返回带有 `Uint8Array` 的文本文件，然后直接调用 `generateAsset` 和 `materializeAsset`。替换这个单次生成方法即可接入自己的 PDF renderer 或其他资产服务。

## 执行语义

| 项目 | 约定 |
|---|---|
| 提交/直接生成 retry | 默认 `0`；配置正数要求模型明确声明 `idempotentStart` / `idempotentGenerate`。当前 fal adapter 不声明提交幂等，因此不能开启 submit retry。 |
| Status retry | 默认 `2`，即最多 3 次请求 attempt；远端失败状态不会触发重新提交。 |
| 退避与 Retry-After | 直接使用 `ai/internal.prepareRetries`；不另行配置资产层的 initial/max delay 或 retry callbacks。 |
| 幂等键 | 每次逻辑提交一个 key，重试期间保持不变；尊重调用者提供的 `idempotency-key`。 |
| Polling | 第一次查询立即进行，之后默认每 2 秒一次；默认 10 分钟后发出完成等待的 timeout signal。 |
| Timeout / abort | 使用 SDK 合并 signal，采用合作式取消；不会强制结束忽略 signal 的 provider 或挂起的 hook。 |
| Hooks | 只有 `onStart`、`onOperation`、`onProgress`、`onFinish`、`onError`；使用 SDK `mergeCallbacks`，会 await，错误被忽略。 |
| 取消与恢复 | 已取得的 operation 随执行错误返回，便于之后查询或取消；远端尚未返回 handle 的不确定提交不能凭空恢复。 |

**Hooks 只用于观测。** 日志或指标回调失败不会改变生成结果；`onFinish` 抛错后调用仍可成功返回。`onError` 也接收调用退出时的 abort/timeout 错误，hook 自身的错误不会替换原执行错误。关键持久化、鉴权或其他必须成功的步骤应放在 hook 之外。

`timeoutMs` 为本次调用创建 timeout signal，`poll.timeoutMs` 为完成等待阶段创建 timeout signal；后续查询会收到合并后的 signal。这不是 Promise 必定在指定毫秒内结束的保证：provider、自定义 downloader 和 sleep 需要响应 signal，用户 hook 需要自行及时结束。只有 webhook 通知等待保留一个局部的通知/SDK delay 竞争。

`poll.delay` 只替换轮询 sleep。SDK 不提供数据库、任务队列或跨重启调度；这些职责可以由已有任务系统承接。

## 开发与验证

```sh
npm run typecheck
npm test
npm run check
npm run check:upstream
```

`check` 执行类型检查、构建和测试；`check:upstream` 离线核对已安装上游包的精确版本、许可证与 14 个源文件 hash。CI 配置 Node.js 22 / 24 矩阵，不自动发布。

当前测试使用本地模型和 mock fetch，没有执行真实 fal 计费生成。代码采用 Web API，但尚未完成 Cloudflare/workerd 运行验证。

## 上游与许可证

基线为 **`ai@7.0.155`、`@ai-sdk/provider@4.0.34`、`@ai-sdk/provider-utils@5.0.70`**。由于使用 `ai/internal`，core 的 `ai` peer dependency 精确锁定 `7.0.155`，不使用 `^` 范围。内部接口统一经过 `internal/sdk.ts`；升级时必须审阅并更新基线。资产协议与必要编排参考了 SDK 的视频生成/提交/状态逻辑。

项目使用 **Apache-2.0**，保留 `Copyright 2023 Vercel, Inc.` 及 Sine AI 修改归属。详见 [LICENSE](LICENSE)、[NOTICE](NOTICE)、[上游来源与升级流程](docs/UPSTREAM.md) 和 [架构说明](docs/ARCHITECTURE.md)。精确基线记录在 [upstream.json](upstream.json)。
