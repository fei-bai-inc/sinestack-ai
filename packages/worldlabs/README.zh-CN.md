# @sinestack/ai-worldlabs

[English](https://github.com/fei-bai-inc/sinestack-ai/blob/main/packages/worldlabs/README.md) | 简体中文

通过 SineStack AI 调用 World Labs 生成 Marble 世界。可使用文本、图像、全景、多视图或视频创建高斯泼溅，也可从深度图生成 RGB 全景，并将世界导出为 PLY 泼溅或 GLB 网格。

## 安装

```sh
npm install @sinestack/ai-worldlabs @sinestack/ai-core ai@7.0.155
```

使用 Node.js 22 或 24 与 ESM（`.mjs` 或 `"type": "module"`；要求 Node >=22）。core 要求安装 `ai` peer dependency。在服务端设置 `WORLDLABS_API_KEY`，或显式传入 `apiKey`。

## 生成世界

保存为 `example.mjs`，运行 `node example.mjs`。执行会提交真实操作，可能消耗付费 API 额度。

```js
import { generateAsset } from '@sinestack/ai-core';
import { createWorldLabsProvider } from '@sinestack/ai-worldlabs';

const worldlabs = createWorldLabsProvider();
const generated = await generateAsset({
  model: worldlabs.world('marble-1.1'),
  input: {
    world_prompt: {
      type: 'text',
      text_prompt: '阳光充足的温室，蜿蜒的石板小路穿行其中',
    },
  },
});
console.log(generated.assets, generated.providerMetadata?.worldlabs?.worldId);
```

`world(modelId)` 必须显式指定模型 ID，支持未来的模型字符串。可用性和价格由 World Labs 决定。其他原生字段可放在 `input` 或 `providerOptions.worldlabs`；重复的输入字段以及对工厂选定参数的覆盖会被拒绝。

## 工厂与资源

| 工厂 | 输出 kind | 输入 |
|---|---|---|
| `world(modelId)` | `gaussian-splat` | `world_prompt` 及可选的原生世界字段 |
| `depthToPanorama()` | `image` | `depth_pano_image`、`text_prompt`，可选深度范围与 seed |
| `exportSplat()` | `gaussian-splat` | `world_id`，可选 `resolution`；导出 PLY |
| `exportMesh()` | `model-3d` | `world_id`，可选 `mesh_variant`；导出 GLB |

所有工厂均通过 `generateAsset` 或 `startAsset` / `waitForAsset` 执行，可接受 `AssetModelMapping` 输入/结果映射。直接资源接口包括 `worlds.get/list/delete`、`operations.get`、`credits.get` 和 `mediaAssets.prepareUpload/get/upload`。资源方法返回原生数据；upload 返回 void。

## 保存与恢复

使用显式 await 的存储写入，保存 `startAsset` 返回的完整 `operation`。通过 `waitForAsset` 恢复时，使用相同的模型/工厂、API base URL、provider 名称以及已授权的 `connectionId`。已受理操作的回执保存失败时，应保留回执并重试持久化，不要重复提交。operation ID 标识作业；world ID 标识生成的资源，供导出和删除使用。

adapter 不提供幂等提交、提交级 webhook 或远端取消。本地 abort 和超时只结束本地等待。删除世界是独立、显式的资源操作。core 默认不重试提交，状态查询只轮询已有操作。

结果返回 URL 引用，不下载文件。存在 full-resolution SPZ 时，世界结果将其放在首位，并保留原生输出及泼溅 `semantics_metadata`；渲染时由应用应用尺度和坐标转换。需要字节时显式调用 core 的 `materializeAsset`。

## 连接

`createWorldLabsProvider` 接受 `apiKey`、`baseURL`、`fetch`、`headers`、`name` 和 `connectionId`。默认根地址为 `https://api.worldlabs.ai/marble/v1`；使用 `WLT-Api-Key` 请求头发送原始 key。签名媒体上传仅发送上传计划的 headers，省略浏览器凭据并拒绝重定向。密钥和回执应保留在服务端，应用负责恢复操作的授权。

## 指南

- [World Labs 指南：原生输入、持久化、结果和资源](https://github.com/fei-bai-inc/sinestack-ai/blob/main/docs/WORLDLABS.zh-CN.md)
- [导入时不发起请求的工作流示例](https://github.com/fei-bai-inc/sinestack-ai/blob/main/examples/worldlabs.ts)
- [Core 生命周期与文件物化](https://github.com/fei-bai-inc/sinestack-ai/blob/main/packages/core/README.zh-CN.md)

接入依据公开 API 规范与 quickstart。模拟检查不证明真实 API 访问、生成内容质量或 Cloudflare/workerd 验收。
