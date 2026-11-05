# World Labs provider

[English](WORLDLABS.md) | 简体中文

`@sinestack/ai-worldlabs` 将 World Labs Marble World API 接入 SineStack AI 已有的资产生命周期。协议参考：[OpenAPI](https://docs.worldlabs.ai/api/reference/openapi.yaml)、[quickstart](https://docs.worldlabs.ai/api/index.md) 和[生成示例](https://docs.worldlabs.ai/api/world-generation-examples.md)，核对日期为 2026-11-05。本文说明 adapter 契约，不代表真实 API 验收。

## 安装与连接

```sh
npm install @sinestack/ai-worldlabs @sinestack/ai-core ai@7.0.155
```

使用 Node >=22 与 ESM。密钥应保留在服务端。通过 [World Labs 平台](https://platform.worldlabs.ai) 获取 API key 和 API 额度；账号权限与计费由 World Labs 控制。

```ts
import { createWorldLabsProvider } from '@sinestack/ai-worldlabs';

const worldlabs = createWorldLabsProvider({
  // Node 服务端省略 apiKey 时读取 WORLDLABS_API_KEY。
  apiKey: process.env.WORLDLABS_API_KEY,
  connectionId: 'production-worldlabs-account',
  // baseURL: 'https://api.worldlabs.ai/marble/v1',
  // fetch: customFetch,
  // headers: { 'X-Application': 'world-editor' },
  // name: 'worldlabs',
});
```

配置项为 `apiKey`、`baseURL`、`fetch`、`headers`、`name` 和 `connectionId`。默认 API 根地址为 `https://api.worldlabs.ai/marble/v1`。认证将原始 key 放入 `WLT-Api-Key`，不加 Bearer 前缀。共享 transport 的 `apiKeyHeader` 选项提供这一行为；旧 provider 保留原有精确 transport 版本。自定义 fetch 必须遵守目的地、signal、凭据和重定向约束。使用 secret binding 的宿主应显式传入 key；环境变量回退不会读取任意宿主 binding。

## 工厂与原生输入

每个工厂返回 `AssetModelV1`，可通过 `generateAsset`、`startAsset`、`getAssetStatus` 和 `waitForAsset` 使用。

| 工厂 | 输出 kind | 原生请求 |
|---|---|---|
| `world(modelId, mapping?)` | `gaussian-splat` | `POST /worlds:generate`；工厂指定 `model` |
| `depthToPanorama(mapping?)` | `image` | `POST /pano:depth_to_rgb` |
| `exportSplat(mapping?)` | `gaussian-splat` | `POST /worlds/{world_id}:export`；`asset_type: 'splats'`、`format: 'ply'` |
| `exportMesh(mapping?)` | `model-3d` | `POST /worlds/{world_id}:export`；`asset_type: 'mesh'`、`format: 'glb'` |

`world` 必须显式指定模型 ID。`marble-1.1` 是 quickstart 使用的模型；支持未来模型字符串，无需发布新包，但不保证账号可用性。参见 [API 模型](https://docs.worldlabs.ai/api/models.md)。

```ts
import { generateAsset } from '@sinestack/ai-core';

const generated = await generateAsset({
  model: worldlabs.world('marble-1.1'),
  input: {
    display_name: '阳光温室',
    world_prompt: {
      type: 'text',
      text_prompt: '阳光充足的温室，蜿蜒的石板小路穿行其中',
    },
  },
});
```

`WorldLabsWorldInput` 保留原生字段名，要求 `world_prompt`。可选顶层字段包括 `display_name`、`seed`、`tags`、`permission` 和 `model`；若传入 `model`，必须与工厂一致。JSON 扩展字段允许供应商增加参数，同时保留已知字段类型。

| `world_prompt.type` | 必选来源 | 其他原生字段 |
|---|---|---|
| `text` | `text_prompt` | 文本提示字段 |
| `image` | `image_prompt` | `is_pano: boolean \| 'auto'`，可选 `text_prompt`、`disable_recaption` |
| `multi-image` | `multi_image_prompt: { content, azimuth? }[]` | 可选 `reconstruct_images`、`text_prompt`、`disable_recaption` |
| `video` | `video_prompt` | 可选 `text_prompt`、`disable_recaption` |

媒体引用使用判别字段 `source`：`{ source: 'uri', uri }`、`{ source: 'media_asset', media_asset_id }` 或 `{ source: 'data_base64', data_base64, extension? }`。URI 由 World Labs 直接获取，必须能被其服务器访问，不依赖应用 cookie 或凭据。SDK 不会下载 URI 输入再重新上传。

```ts
const fromPanorama = await generateAsset({
  model: worldlabs.world('marble-1.1'),
  input: {
    world_prompt: {
      type: 'image',
      image_prompt: { source: 'uri', uri: 'https://example.com/panorama.jpg' },
      is_pano: true,
    },
  },
});
```

仅对已确认的 360° 等距柱状全景使用 `is_pano: true`，普通图像使用 `false`，由服务判断时使用 `'auto'`。原生媒体限制由服务决定。

`WorldLabsDepthToPanoramaInput` 要求 `depth_pano_image`（相同的媒体引用联合类型）和 `text_prompt`，可选 `z_min`、`z_max` 与 `seed`。[深度接口](https://docs.worldlabs.ai/api/reference/pano/depth_to_rgb.md) 要求完整的 360°、2:1 深度全景。PNG 深度必须同时提供正数 `z_min` 和 `z_max`，且 `z_max > z_min`；浮点深度 EXR 省略范围。服务可能裁剪非 2:1 输入。

```ts
const panorama = await generateAsset({
  model: worldlabs.depthToPanorama(),
  input: {
    depth_pano_image: { source: 'uri', uri: 'https://example.com/depth.exr' },
    text_prompt: '温暖的木屋，柔和的午后阳光照入室内',
  },
});

const splat = await generateAsset({
  model: worldlabs.exportSplat(),
  input: { world_id: worldId, resolution: '500k' },
});
const mesh = await generateAsset({
  model: worldlabs.exportMesh(),
  input: { world_id: worldId, mesh_variant: 'textured' },
});
```

这里的 `worldId` 是已有且已授权的世界 ID。泼溅导出分辨率可为 `full_res`、`500k`、`150k` 或 `100k`；网格变体为 `textured` 或 `vertex_colored`。世界生成、深度转换和每次导出分别是独立服务操作，各自具有回执并可能计费。

`providerOptions.worldlabs` 用于补充原生字段。重复输入键及覆盖选定模型、导出类别或格式的尝试会被拒绝。各工厂可接受 `AssetModelMapping<I>`，适配应用输入和结果。`mapResult` 接收原始 `operation.response` 完成快照，不是通用文件包装或稍后查询的世界数据。

## 持久化与恢复操作

operation ID 标识作业，world ID 标识持久资源。轮询使用 `GET /operations/{operation_id}`。`done: false` 映射为 `running`；`metadata.progress.description` 可提供进度消息，但 adapter 不虚构数值百分比。`done: true` 且存在 `error` 时映射为失败，成功的 `response` 按工厂类型解码。

提交响应可能已经完成，导出尤其如此。完整原生操作会保存在可序列化回执内，直接复用，不额外 GET。完成快照足以生成结果；需要最新资源时显式调用 `worlds.get`。

```ts
import { startAsset, waitForAsset } from '@sinestack/ai-core';
import type { AssetOperation } from '@sinestack/ai-core';

async function submitWorld(save: (json: string) => Promise<void>) {
  const { operation } = await startAsset({
    model: worldlabs.world('marble-1.1'),
    input: { world_prompt: { type: 'text', text_prompt: '安静的石砌庭院' } },
  });
  try {
    await save(JSON.stringify(operation));
  } catch (cause) {
    throw Object.assign(new Error('世界已受理，但回执未保存', { cause }), { operation });
  }
  return operation;
}

async function resumeWorld(serialized: string) {
  const operation = JSON.parse(serialized) as AssetOperation<'gaussian-splat'>;
  return await waitForAsset({
    model: worldlabs.world(operation.modelId),
    operation,
    poll: { intervalMs: 2_000, timeoutMs: 20 * 60_000 },
  });
}
```

持久存储与调度由应用提供。`startAsset` 返回后显式保存完整回执，不依赖仅作观察、允许失败的 hooks。持久化、状态查询或下载失败后恢复同一回执；再次 start 可能重复计费。提交的网络响应丢失时，不能假定可安全重试。

恢复时使用原 provider 名称、API 根地址、connection ID、工厂/路由、模型 ID 和 operation ID。回执不包含 API key，也不是授权令牌；应用必须先确定正确的租户和账号。运行时回执校验不替代授权。

不声明幂等提交、提交级 webhook、SSE/watch 或远端取消支持。core 默认不重试提交。本地超时或 abort 结束本地工作，无法取消已受理操作。`worlds.delete` 删除资源，不是取消操作。

## 结果、原生输出与尺度

世界结果必须包含真实的泼溅资产。存在 full-resolution SPZ 时先返回该文件，再返回其他分辨率 SPZ、网格资产、全景和缩略图。Marble 查看器 URL 与 caption 不会映射为可下载资产。深度转换返回 `pano_url`，导出返回原生导出 URL。URL 资产在显式物化前一直保持引用；adapter 不下载、解码、渲染、变换或上传结果文件。

`providerMetadata.worldlabs` 保留 `operationId`、`output`（原始完成响应）、`operation`（完整原生操作），以及可取得时的 `worldId`。已结算 `cost.total_credits` 映射到 `usage.credits`；cost 缺失时不推算价格。资源调用返回原生数据，不添加 core 结果包装。

OpenAPI World schema 使用 `world_id`，quickstart 完成快照使用 `id`。adapter 接受两种形式，值冲突时拒绝。World GET 响应可能是直接 World，或 quickstart 的 `{ world: World }`；`worlds.get` 从任一形式返回原生 World 对象，不虚构缺失字段。

泼溅文件在自身 metadata 和原生输出中保留 `semantics_metadata`。根据 [World Labs 渲染指南](https://docs.worldlabs.ai/api/rendering-spz.md)，将高斯中心和线性尺寸乘以 `metric_scale_factor`，然后从缩放后的中心 Y 坐标减去 `ground_plane_offset`。地面偏移不作用于尺寸。对数尺度尺寸应加上 `log(metric_scale_factor)`。渲染器坐标轴转换另行处理；adapter 不静默变换 SPZ 数据或假定尺度值。

## 直接资源与上传

| 方法 | 行为 |
|---|---|
| `worlds.get(id, options?)` | 读取当前原生世界数据 |
| `worlds.list(input = {}, options?)` | 使用原生筛选/分页列出世界 |
| `worlds.delete(id, options?)` | 显式删除已授权的世界 |
| `operations.get(id, options?)` | 读取一个原生操作 |
| `credits.get(options?)` | 读取原生 API 额度余额 |
| `mediaAssets.prepareUpload(input, options?)` | 获取媒体资产及签名上传计划 |
| `mediaAssets.get(id, options?)` | 读取一个原生媒体资产 |
| `mediaAssets.upload(prepared, body, { abortSignal }?)` | 单次签名 PUT；返回 void |

准备上传接受 `{ file_name, kind: 'image' | 'video', extension?, metadata? }`，返回 `{ media_asset, upload_info: { upload_url, upload_method, required_headers? } }`。

```ts
async function uploadImage(bytes: Blob | Uint8Array, abortSignal?: AbortSignal) {
  const prepared = await worldlabs.mediaAssets.prepareUpload({
    file_name: 'panorama.jpg', kind: 'image', extension: 'jpg',
  }, { abortSignal });
  await worldlabs.mediaAssets.upload(prepared, bytes, { abortSignal });
  return prepared.media_asset;
}
```

上传后，在下一次显式生成调用中，用返回的媒体资产 ID 构造 `source: 'media_asset'` 引用。准备/上传媒体本身不会生成世界。

API 请求限制在配置的 API origin/路径范围内。签名上传使用独立的单次 PUT，目标是准备好的 URL，仅发送 `required_headers`，使用 `credentials: 'omit'` 并以 manual 模式拒绝重定向。不继承 API key、provider headers 或 core 请求头。不要传入任意不可信上传计划；签名 URL 应按敏感信息处理。物化输出 URL 时仍需应用自己的下载授权策略。

## 集成与验证边界

包参与常规 TypeScript 构建、独立版本发布登记、归档检查，以及工作区外 npm 使用方运行时/类型样例。参见[发布流程](PUBLISHING.zh-CN.md)、[架构](ARCHITECTURE.zh-CN.md)和[导入时不发起请求的示例](../examples/worldlabs.ts)。不引入官方 World Labs SDK 依赖或独立重试/轮询引擎。

模拟协议样例可检查序列化、操作恢复、原生元数据和凭据路由，不能证明真实 API 权限、当前价格、世界质量、真实资产解码、全部模型/参数组合或 Cloudflare/workerd 部署。本文不作真实环境验收声明。
