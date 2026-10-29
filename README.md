# SineStack AI

基于 **Vercel AI SDK 7** 扩展的 TypeScript 资产生成 SDK。3D、音效、音乐、3D 动作、文档及自定义资产类型共用 `AssetModelV1`，通过同一套生成、提交、查询、等待和取消接口执行。

**Provider adapter 实现平台协议，不维护模型目录。** fal、WaveSpeed、Replicate 的所有入口都接受显式模型 ID；没有默认模型、型号白名单或针对某个模型的固定参数 schema。新增同协议模型无需登记到 SDK 或更新 SDK。

重试策略、AbortSignal 合并和 callback 分发直接复用 AI SDK。资产协议所需的 submit/status/poll/result/cancel 编排仍由 SineStack AI 维护；上游当前没有可直接接入 `AssetModelV1` 的通用 executor。

## 包与维护边界

| 包 | 职责 |
|---|---|
| `@sinestack/ai-provider` | 版本化资产协议、结果、operation 和可选的外部映射接口。 |
| `@sinestack/ai-core` | 唯一的资产编排、按 kind 的薄入口、恢复和显式文件物化。 |
| `@sinestack/ai-provider-utils` | 共享 JSON/连接校验、默认文件解析；HTTP 请求和响应处理委托给 AI SDK 公开 helpers。 |
| `@sinestack/ai-fal` | fal queue 的提交、查询、结果获取、取消协议。 |
| `@sinestack/ai-wavespeed` | WaveSpeed prediction 的提交和查询协议。 |
| `@sinestack/ai-replicate` | Replicate prediction 的提交、查询、取消和固定版本协议。 |

每个 adapter 方法只完成一次 provider 操作，不增加自己的 polling、重试、abort 或 hook 执行机制。kind 入口只标记资产类型，不选择模型，也不推断远端模型能力。

## 安装与从源码使用

从 npm 安装（需要 Node.js 22 或 24，以及锁定的 `ai@7.0.155`）：

```sh
npm install ai@7.0.155 @sinestack/ai-core @sinestack/ai-fal @sinestack/ai-wavespeed @sinestack/ai-replicate
```

或通过仓库的 npm workspaces 从源码构建：

```sh
git clone https://github.com/fei-bai-inc/sinestack-ai.git
cd sinestack-ai
npm ci
npm run build
```

无需 key 或网络的本地 document 示例：

```sh
node --experimental-strip-types examples/custom-provider.ts
```

## 显式模型 ID 与原生 input

三个 provider 提供相同的入口：

```ts
provider.music(modelId);
provider.threeD(modelId);
provider.soundEffect(modelId);
provider.animation3D(modelId);
provider.asset(modelId, { kind: 'document' });
```

调用方选择平台上实际存在、接受相应任务的模型，并按该模型的原生 schema 提供 `input`。SDK 校验 JSON 与协议字段，不把一个模型的参数规则套在整类能力上。

```ts
import { generateMusic, generate3D, generateAsset } from '@sinestack/ai-core';
import type { JSONObject } from '@sinestack/ai-provider';
import { createFalAssetProvider } from '@sinestack/ai-fal';
import { createWaveSpeedAssetProvider } from '@sinestack/ai-wavespeed';
import { createReplicateAssetProvider } from '@sinestack/ai-replicate';

const fal = createFalAssetProvider();
const wavespeed = createWaveSpeedAssetProvider();
const replicate = createReplicateAssetProvider();

// modelId 与原生 input 来自应用配置；SDK 不需要预先知道该模型。
async function createMusic(modelId: string, input: JSONObject) {
  return generateMusic({ model: fal.music(modelId), input });
}

async function createThreeD(modelId: string, input: JSONObject) {
  return generate3D({ model: wavespeed.threeD(modelId), input });
}

async function createDocument(modelId: string, input: JSONObject) {
  return generateAsset({
    model: replicate.asset(modelId, { kind: 'document' }),
    input,
  });
}
```

`generateMusic`、`generate3D`、`generateSoundEffect`、`generateAnimation3D` 的原生输入形式只检查 kind，然后调用 `generateAsset`。参数不会被裁剪或悄悄改名。例如模型要求 `text`、`is_instrumental` 或 `duration`，就直接在 input 中使用这些字段。

`providerOptions.fal / wavespeed / replicate` 可以补充原生参数，但不能覆盖 input 或 `mapInput` 已提供的同名字段。推荐把模型输入放在 `input`，避免重复定义。

## 外部实现、按需注入映射

`mapInput` 和 `mapResult` 都是可选、可独立替换的函数。缺省时原样提交原生 JSON，并使用共享的常见文件解析器。

映射既可以是普通对象，也可以是外部包实现的类实例。创建 model 时会保存方法引用并绑定原实例，因此原型方法、`this` 和私有字段都可正常使用。

应用需要统一业务输入或处理特殊输出时，自行提供映射：

```ts
import { generateMusic } from '@sinestack/ai-core';
import type { AssetModelMapping } from '@sinestack/ai-provider';

interface SongRequest {
  description: string;
  seconds: number;
}

// 可由任意外部包导出，再注入连接；不需要修改 provider 或 executor。
const mapping: AssetModelMapping<SongRequest> = {
  mapInput(input) {
    return { text: input.description, duration: input.seconds };
  },
};

const model = fal.music<SongRequest>('your-owner/your-music-model', mapping);

const result = await generateMusic({
  model,
  input: { description: 'A calm piano score', seconds: 120 },
});
```

特殊结果 schema 可以单独注入 `mapResult`。它收到平台的原生 output，必须返回真实文件的非空 `assets`；结果的任务身份、原生输出快照仍由 adapter 保留。完整示例与默认解析边界见 [Media providers](docs/MEDIA_PROVIDERS.md)。

## 文件与原生结果

结果提供：

- `result.asset`：首个文件。
- `result.assets`：全部标准化文件。
- `result.providerMetadata.<provider>.output`：独立保留的原生输出快照。

默认解析支持根 URL、URL 数组、显式 `{ url, content_type?, file_name?, file_size? }` 文件对象，以及嵌套文件对象和常见文件列表。它不会扫描文本中的链接，也不会把任意 metadata 字符串当文件。未知结构通过 `mapResult` 扩展，未知文件格式保守使用 `application/octet-stream`。

URL 默认保留引用，不隐式下载。需要 bytes 时：

```ts
import { materializeAsset } from '@sinestack/ai-core';

const file = await materializeAsset(result.asset, {
  maxBytes: 64 * 1024 * 1024,
});
```

物化默认上限 64 MiB。生成与下载是独立阶段；自定义 downloader 负责自己的网络策略、大小限制和 AbortSignal 响应。

## 提交、持久化与恢复

```ts
import { startAsset, getAssetStatus, waitForAsset, cancelAsset } from '@sinestack/ai-core';

const model = fal.threeD('your-owner/your-geometry-model');
const started = await startAsset({
  model,
  input: { prompt: 'A wooden lantern' },
});

// 由应用保存整个 operation，以及对应的原连接 ID。
// await store.put(taskId, JSON.stringify(started.operation));

const status = await getAssetStatus({ model, operation: started.operation });
const result = await waitForAsset({ model, operation: started.operation });
```

恢复会检查版本、provider、modelId、kind 和 provider operation 中的任务身份/API 地址。查询失败不会再次提交。operation 不保存密钥；应用仍需恢复原租户、账号与连接。

远端取消通过 `cancelAsset` 显式发出。`requested` 表示接受取消请求，`cancelled` 表示已观察到确认。本地 abort 不会自动取消远端任务。WaveSpeed 没有已验证的远端取消协议，因此不暴露该能力。

关键持久化应在 `startAsset` 返回后显式 await。观测 hook 的错误不会使提交失败，也不能承担必须成功的事务步骤。

## 连接与 webhook

| Provider | 默认 baseURL | 默认环境变量 |
|---|---|---|
| fal | `https://queue.fal.run` | `FAL_KEY` |
| WaveSpeed | `https://api.wavespeed.ai/api/v3` | `WAVESPEED_API_KEY` |
| Replicate | `https://api.replicate.com/v1` | `REPLICATE_API_TOKEN` |

连接支持 `apiKey`、`baseURL`、`headers`、`fetch`、`name`，配置会复制保存。调用级 headers 不能覆盖实际认证，带凭证的请求拒绝重定向。

`startAsset` 可传 `webhookUrl`；`generateAsset` 可传 `webhook: () => ({ url, received })`。接收端负责认证、关联与去重，再 resolve 通知；core 随后查询原 operation 取得结果。通知不会导致新提交。

## 执行语义

| 项目 | 约定 |
|---|---|
| 提交/直接生成 retry | 默认 0；正数需要模型明确声明远端幂等。三个远端 adapter 均不声明提交幂等。 |
| Status retry | 默认 2，由 SDK 实现退避、错误分类和 Retry-After；不重新创建任务。 |
| Polling | 首次查询立即进行，之后默认每 2 秒一次；等待默认 10 分钟 timeout signal。 |
| Timeout / abort | SDK 合并信号，采用合作式取消；不会强行结束忽略信号的 provider 或挂起 hook。 |
| Hooks | 五个观测事件：onStart、onOperation、onProgress、onFinish、onError；SDK await 并忽略 callback 错误。 |
| 文件 | 保持引用，显式物化；没有后台存储、数据库或持久化调度器。 |

`@sinestack/ai-provider-utils` 复用 AI SDK 的 GET/POST 与 response handlers，不维护另一套 retry policy。fal PUT 取消没有上游公开请求 helper，因此保留一次薄 fetch，并复用相同 SDK response handlers。

## 开发与示例

```sh
npm run check
npm run check:upstream
node --experimental-strip-types examples/media-providers.ts
```

`check` 包含类型、构建和 mock 测试。`check:upstream` 离线核对 3 个上游包的精确版本、许可证和 19 项源文件 hash。CI 使用 Node.js 22/24，不自动发布。

[media-providers.ts](examples/media-providers.ts) 接受 provider、kind、modelId、原生 JSON；不传参数只打印用法。[generate-assets.ts](examples/generate-assets.ts) 展示应用显式选择实际模型，[submit-and-resume.ts](examples/submit-and-resume.ts) 展示外部持久化。示例里的模型选择不构成 SDK 支持清单。

测试不调用真实计费 API；尚未完成 Cloudflare/workerd 验证。

## 上游与许可证

基线为 `ai@7.0.155`、`@ai-sdk/provider@4.0.34`、`@ai-sdk/provider-utils@5.0.70`。core 的 `ai` peer dependency 精确锁定；internal 导入集中在 `packages/core/src/internal/sdk.ts`，升级需审阅。

项目采用 Apache-2.0，保留 Vercel 与 SineStack AI 的归属。详见 [LICENSE](LICENSE)、[NOTICE](NOTICE)、[UPSTREAM.md](docs/UPSTREAM.md)、[ARCHITECTURE.md](docs/ARCHITECTURE.md)、[PUBLISHING.md](docs/PUBLISHING.md) 和 [迁移说明](docs/MIGRATION.md)。
