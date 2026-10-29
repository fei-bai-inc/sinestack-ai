# @sinestack/ai-viggle

[English](https://github.com/fei-bai-inc/sinestack-ai/blob/main/packages/viggle/README.md) | 简体中文

使用 Viggle 生成视频和图像、制作角色动画、放大视频，以及创建可复用的 Character/Motion 资源、骨骼动作导出文件和高斯泼溅场景。

## 安装

```sh
npm install @sinestack/ai-viggle @sinestack/ai-core ai@7.0.155
```

使用 Node.js 22 或更高版本及 ESM（`.mjs` 或 `"type": "module"`）。必须安装 peer 依赖 `ai@7.0.155`。在服务端设置 `VIGGLE_API_KEY`。

## 生成视频

将示例保存为 `example.mjs`，运行 `node example.mjs`。它会提交一个视频生成任务，可能消耗付费 Viggle 积分。

```js
import { generateAsset } from '@sinestack/ai-core';
import { createViggleProvider } from '@sinestack/ai-viggle';

const viggle = createViggleProvider();
const result = await generateAsset({
  model: viggle.textToVideo(),
  input: {
    prompt: 'A paper airplane glides through a sunlit studio',
    quality: 'high',
    duration_s: 5,
    resolution: '1080p',
    enhance: false,
    seed: 42,
  },
});
console.log(result.assets);
```

H3 必须同时提供 `prompt` 和 `quality`，首尾帧及参考素材条件生成也一样。设置 `enhance: false` 可请求保留原始提示词。结果包含文件引用；请显式下载所需文件并保存。

## 选择工作流

| 目标 | Viggle 工厂方法 | Core 辅助函数 |
| --- | --- | --- |
| 生成 H3 视频 | `textToVideo()`、`firstFrameToVideo()`、`firstLastFrameToVideo()`、`referenceToVideo()` | `generateAsset` |
| 角色动画与渲染 | `characterAnimation()`、`renderVideo()`、`renderDraft()` | `generateAsset` |
| 生成图像 | `image()` | `generateAsset` |
| 视频放大 2 倍 | `upscaleVideo()` | `startTask` / `waitForTask` |
| 创建可复用资源 | `createCharacter()`、`createMotionFromVideo()`、`createMotionFromText()`、`importMotion()` | `startTask` / `waitForTask` |
| 导出独立骨骼动作 | `textToMotion({ format })`、`videoToMotion({ format })` | `generateAnimation3D` |
| 创建和重建场景 | `createScene()`、`createSceneFromPanorama()`、`generateSceneViews()`、`reconstructScene()` | `startTask` / `waitForTask` |

Character/Motion 任务返回原生可复用资源记录。请求的处理完成后，再读取导出结果。动作资产工厂还会获取所选 GLB/FBX 导出，并保留所有返回的骨架。Character `.vsplat`、骨骼动作和场景 `.spz` 文件用途不同；3D Motion 就绪不代表它是可用于渲染的 2D 驱动视频。

## 输入、资源与文件

使用原生参数名，并通过 `Blob` 上传文件或提供 URL。`providerOptions.viggle` 可补充输入，冲突键会被拒绝。只有明确支持 `model` 字段的端点可选择模型；H3、Animate、Image 和固定 2 倍放大器使用端点决定的后端。

原生输出保留在 `providerMetadata.viggle.output` 或任务结果中，包括 alpha 遮罩、批量图像和动作骨架变体。超出安全整数范围的 H3 种子保留为精确的十进制字符串；需要 JavaScript 数值处理时，请使用安全整数种子。

资源方法包括 `videos`、`images`、`renders`、`characters`、`motions`、`scenes` 和 `credits`。列表返回一个原生分页。`renders.events(id, { lastEventId })` 打开一条 SSE 流，由宿主负责重连。`renders.download(id)` 返回签名重定向 URL，不跟随跳转。获取该 URL 时不要携带 API 密钥。

草稿准备、每次上传和草稿提交都是显式步骤。`renders.upload(plan, blob)` 仅使用上传计划要求的请求头发送一次签名 PUT，保留带引号的 ETag，并拒绝重定向。multipart 边界由 Fetch 设置。输出 URL 通常有效一小时，可重新读取结果或导出来刷新。生成的图像在 24 小时后过期。

## 保存并恢复各阶段

后台任务使用 `startAsset` / `waitForAsset` 或 `startTask` / `waitForTask`。持久化完整的 `operation` 或 `task` 回执，并使用相同的授权连接、基础 URL 和能力恢复。持久化或下载失败不应导致再次付费提交。回执不包含 API 密钥。

生成、放大、可复用资源创建和场景阶段是独立操作。请显式传递场景会话和批次引用。普通提交默认不重试；草稿和部分文本/GLB Motion 请求具有专门的幂等约定，详见指南。本地中止只停止本地工作，不停止远端生成。Character/Motion 删除用于移除资源；Viggle 未公开客户端取消端点或提交级 webhook。

## 连接与 Workers

`createViggleProvider` 接受 `apiKey`、`baseURL`、`headers`、`fetch`、`name` 和 `connectionId`。默认 API 根地址为 `https://apis.viggle.ai/v1`；自定义根地址必须包含目标 API 路径。单次调用的请求头不能替换配置的 Bearer 凭据。

在 Cloudflare Workers 中显式传入账户绑定：`createViggleProvider({ apiKey: env.VIGGLE_API_KEY })`。长时间任务使用宿主的持久化调度器和回执存储。仓库记录了 workerd `1.20261029.1` 下四项模拟 HTTP 的本地检查；这不是 Viggle 实际服务或云端部署验收。

## 指南

- [Viggle：原生输入、恢复、安全与保留期限](https://github.com/fei-bai-inc/sinestack-ai/blob/main/docs/VIGGLE.zh-CN.md)
- [Core：任务生命周期与文件物化](https://github.com/fei-bai-inc/sinestack-ai/blob/main/packages/core/README.zh-CN.md)
- [workerd 复现步骤与已记录证据](https://github.com/fei-bai-inc/sinestack-ai/blob/main/tests/workerd/README.zh-CN.md)
