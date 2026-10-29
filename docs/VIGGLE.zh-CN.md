# Viggle provider

[English](VIGGLE.md) | 简体中文

`@sinestack/ai-viggle` 将公开的 Viggle V1 API 接入 SineStack AI 的资产与任务运行时，覆盖视频生成、角色动画、渲染、图像生成、视频放大、可复用角色与动作、3D 导出、场景操作和账户余额。协议参考资料于 **2026-10-29** 核对。

**验证使用模拟 HTTP 契约测试，并非 Viggle 实际 API 验收。** 测试验证请求序列化、响应解释以及不重复提交的恢复过程，不证明视觉质量、当前账户权限或线上可用性。

仓库记录了同一公共 provider 和 core 在真实 **workerd 1.20261029.1** 运行时下的四项本地冒烟检查，使用 **esbuild 0.28.2** 打包，兼容日期为 **2026-10-29**，未设置兼容标志或 Node polyfill。检查覆盖持久化恢复、精确种子、原生 multipart 编码、SSE 和签名 PUT。注入的模拟响应返回前，每个请求都会经过原生 Worker `Request`；未调用真实 Viggle，也未部署到云端。复现步骤见 [tests/workerd](../tests/workerd/README.zh-CN.md)。

## 配置与模型选择

```ts
import { createViggleProvider } from '@sinestack/ai-viggle';

const viggle = createViggleProvider({
  // 省略时，apiKey 默认读取 VIGGLE_API_KEY。
  apiKey: process.env.VIGGLE_API_KEY,
  // 可选：标识恢复操作时使用的授权连接。
  connectionId: 'production-viggle-account',
  // baseURL: 'https://apis.viggle.ai/v1',
  // fetch: customFetch,
  // headers: { 'X-Viggle-Source': 'my-integration' },
});
```

默认基础 URL **已经包含 `/v1`**。代理可使用其他来源和路径。API 使用 Bearer 认证；单次调用的请求头不能替换配置的凭据。调用支持普通请求头和 AbortSignal。任务句柄和资产操作均不包含 API 密钥。

在 Cloudflare Workers 中显式传入账户绑定：`createViggleProvider({ apiKey: env.VIGGLE_API_KEY })`；Node 环境变量回退不能替代 Worker 绑定。使用宿主的持久化调度器，并保存每次操作的回执。

并非所有 Viggle 端点都支持自由选择模型。H3、Animate、Image 和固定 2 倍放大器使用原生请求对应的后端。工厂不会虚构模型名称或注入不受支持的 `model` 字段。Viggle 明确支持 `model` 的地方，尤其是 2D 角色/动作预处理和渲染，由调用方提供原生字符串。这些字段不用于选择 3D 提取后端。已知值只是提示，不是内置模型目录，也不保证账户可使用未来的模型。

参考：[认证](https://docs.viggle.ai/v1/authentication)、[V1 概览](https://docs.viggle.ai/v1/api-reference/overview)、[迁移](https://docs.viggle.ai/v1/production/migrate-from-legacy)。

## 能力覆盖

生成工厂返回 `AssetModelV1`；处理和可复用资源操作返回 `TaskDriver`。它们共享 `start` / `status` / `wait` 机制，同时保留各操作特有的输入与结果。

| 工厂 | 运行时 API | `/v1` 下的原生端点 |
|---|---|---|
| `textToVideo()` | `generateAsset` / `startAsset` | `POST videos`，无来源字段 |
| `firstFrameToVideo()` | `generateAsset` / `startAsset` | `POST videos`，首帧 |
| `firstLastFrameToVideo()` | `generateAsset` / `startAsset` | `POST videos`，首尾帧 |
| `referenceToVideo()` | `generateAsset` / `startAsset` | `POST videos`，参考视频/图像 |
| `characterAnimation()` | `generateAsset` / `startAsset` | `POST videos`，驱动视频和角色 |
| `renderVideo()` | `generateAsset` / `startAsset` | `POST renders`，multipart |
| `renderDraft()` | `generateAsset` / `startAsset` | `POST renders`，JSON 草稿提交 |
| `image()` | `generateAsset` / `startAsset` | `POST images` |
| `upscaleVideo()` | `startTask` / `waitForTask` | `POST videos/super-resolution` |
| `createCharacter()` | `startTask` / `waitForTask` | `POST characters` |
| `createMotionFromVideo()` | `startTask` / `waitForTask` | `POST motions`，multipart |
| `createMotionFromText()` | `startTask` / `waitForTask` | `POST motions`，JSON |
| `importMotion()` | `startTask` / `waitForTask` | `POST motions/import` |
| `textToMotion({ format? })` | `generateAnimation3D` / `startAsset` | 文本创建 Motion，然后导出动作 |
| `videoToMotion({ format? })` | `generateAnimation3D` / `startAsset` | GLB Motion 提取，然后导出动作 |
| `createScene()` | `startTask` / `waitForTask` | `POST scenes/pano` |
| `createSceneFromPanorama()` | `startTask` / `waitForTask` | `POST scenes/custom-pano` |
| `generateSceneViews()` | `startTask` / `waitForTask` | `POST scenes/generate` |
| `reconstructScene()` | `startTask` / `waitForTask` | `POST scenes/reconstruct` |

直接资源方法执行一次 API 操作。列表方法返回一个原生分页，不会自动遍历整个集合或启动轮询。

| 资源 | 方法 |
|---|---|
| `videos` | `get(id, options?)`、`list(options?)` |
| `images` | `get(id, options?)` |
| `renders` | `prepare(input, options?)`、`upload(plan, blob, options?)`、`events(id, options?)`、`download(id, options?)` |
| `characters` | `create`、`get`、`list`、`delete`、`export` |
| `motions` | `createFromVideo`、`createFromText`、`import`、`get`、`list`、`delete`、`export` |
| `scenes` | `create`、`customPanorama`、`generateViews`、`reconstruct`、`get` |
| `credits` | `get(options?)` |

使用完整的公共 ID，不要删除前缀。`videos.get` 接受 `render_`、`vid_`、`anim_` 和 `vsr_`；图像使用 `img_`，角色使用 `char_`，动作使用 `mot_`，场景使用 `scn_`。视频列表文档说明它合并 Render、H3 和 Animate 来源，但尚未承诺放大结果会出现在该列表中。

已停用的 `GET /v1/renders/{id}` 返回 405，不应使用。所有视频任务轮询均使用 `GET /v1/videos/{id}`。适配器不添加旧版 `/api/*`、`/v1/avatars`、`/v1/animations`、虚构的模板列表端点或任意 `/models` 目录。

参考：[完整索引](https://docs.viggle.ai/llms.txt)、[视频详情](https://docs.viggle.ai/v1/api-reference/videos/get)、[视频列表](https://docs.viggle.ai/v1/api-reference/videos/list)。

## 有类型约束的原生输入

输入保留 Viggle 的原生字段名。文件可作为 `Blob` 提供；URL 输入保持为 URL，调用方不必通过 SDK 下载后重新上传。已知字段保留类型和必需来源之间的关系。无需发布新包即可传入额外原生字段。`providerOptions.viggle` 补充输入；冲突键会被拒绝，而不是静默改变请求。

文件与 URL 字段按各端点的规则序列化。例如 H3 和 Image 的参考图像使用重复表单字段；Animate 的 `character_image_urls` 则在表单字段中编码为 JSON 数组。multipart 边界由 `fetch` 设置。

### H3 视频模式

四种 H3 模式都要求非空 `prompt` 和显式 `quality: 'low' | 'high'`。首帧及参考素材条件生成同样要求两者。常用原生控制项包括 `duration_s`、`resolution`、`aspect_ratio`、`seed`、`watermark`、`enhance` 和 `priority`。

```ts
import { generateAsset } from '@sinestack/ai-core';

const result = await generateAsset({
  model: viggle.firstLastFrameToVideo(),
  input: {
    prompt: 'The character turns toward the window',
    quality: 'high',
    first_frame_image_url: firstFrameUrl,
    last_frame_image_url: lastFrameUrl,
    duration_s: 8,
    resolution: '1080p',
    enhance: false,
    seed: 42,
  },
});
```

Viggle 根据输入字段选择模式。参考字段不能与首尾帧混用，尾帧必须搭配首帧。语义工厂拒绝缺失或矛盾的来源，避免参考生成请求静默退化为纯文本生成。H3 当前接受一个参考视频和四张参考图像。输出时长为 5–15 秒，与参考视频时长独立。视频带有原生音频；API 未说明独立音频开关。`enhance` 默认触发 provider 的提示词改写；设置为 `false` 可请求保留原始提示词。

H3 返回的随机种子可能超过 JavaScript 安全整数范围。适配器将不安全的 JSON 整数保留为原生数据中的十进制字符串，避免数值舍入。应用需要普通数值处理时，请自行提供安全整数种子。

参考：[文本生成视频](https://docs.viggle.ai/v1/api-reference/videos/create-from-text)、[首帧](https://docs.viggle.ai/v1/api-reference/videos/create-from-first-frame)、[首尾帧](https://docs.viggle.ai/v1/api-reference/videos/create-from-first-last-frame)、[参考视频/图像](https://docs.viggle.ai/v1/api-reference/videos/create-from-reference-video)。

### Animate、Render 与 Image

| 能力 | 相关原生约定 |
|---|---|
| Animate | 必须提供驱动视频。`planner` / `normal` 使用 1 张图像，或搭配有序目标标签使用 2–3 张；`agent` 接受 1–10 张有序图像。角色上传文件不能与角色 URL 混用。 |
| Render | 恰好一个角色来源和一个动作来源，各自从上传文件、URL 或已保存资产 ID 中选择。显式来源避免 Viggle 的环境相关空请求回退行为。 |
| Render 背景 | multipart 支持 original/solid/transparent 以及 inpaint 别名；solid 使用 `bg_color`。透明输出包含前景视频和独立 alpha 遮罩。 |
| Image | 始终使用 multipart，包括纯文本输入。`n` 为 1–6，最多 8 张参考图像。生成种子范围为 0–2147483647。 |
| Upscale | 恰好一个视频上传文件或 URL。固定放大 2 倍，没有目标分辨率选择项。 |

Animate 的 `planner` / `normal` 多角色提示词必须以连续的 `<Character1>`、`<Character2>` 以及必要时的 `<Character3>` 目标描述开头。缺少这些标签时，原生服务可能忽略第一张之外的图像。`agent` 直接读取编辑指令。H3 的质量、帧和参考控制项不属于 Animate。

`planner` / `normal` 使用 5–16 秒驱动视频，`agent` 使用 5–60 秒视频。API 较宽泛的准入检查可能接受超出 planner/normal 工作进程支持范围的片段，因此请求被接受不代表最终成功。SDK 不会解码视频字节来推断时长。

Image 的 `2K` 输出尺寸取决于是否提供参考图像。例如，纯文本方形 2K 输出为 2048×2048，而带参考图像的方形 2K 输出为 1536×1536。请使用返回的尺寸，不要根据请求档位推断。图像任务要么生成所有请求图像，要么失败，不承诺部分成功。

参考：[Animate](https://docs.viggle.ai/v1/api-reference/videos/create-from-character-animation)、[Render](https://docs.viggle.ai/v1/api-reference/renders/create)、[透明输出](https://docs.viggle.ai/v1/guides/transparent-output)、[Image](https://docs.viggle.ai/v1/api-reference/images/create)、[放大](https://docs.viggle.ai/v1/api-reference/videos/super-resolution)。

### 角色、骨骼动作与场景

| 操作类别 | 有类型约束的参数组 |
|---|---|
| 创建角色 | 图像/URL 来源、name、2D model、render/vsplat/all 类型、enhance 和 enhance_prompt；variant、model_precision、quality、过滤/剪枝控制、joint_set、use_sparse_W、scale_parts、render_thumbnail 和 task_id |
| 视频创建动作 | 视频/URL 来源、name、2D model、render/glb/all 类型、缩略图路径；enable_smoothing、target_fps、smooth_velocity_threshold、apply_std_joints 和 task_id |
| 文本创建动作 | text、duration_seconds、guidance_scale、smooth、name 和 task_id |
| 导入官方动作 | template_id 或旧版 template_uuid、name 和预处理 model |
| 创建场景 | sessionId、prompt 和可选 references/quality，或全景图 URL/Blob |
| 自定义全景图 | sessionId、全景图 URL/Blob、panoramaC2w 和 metersPerUnit |
| 场景视图 | sessionId、referenceBatchIds、targetC2w 或 targetPosition、projection、fov 和 seed |
| 场景重建 | sessionId 和显式 referenceBatchIds |

启用增强时，仅生成 vsplat 的 Character 可通过 `enhance_prompt` 创建而无需图像。`type=all` 仍要求图像，因为它同时创建可渲染的 2D Character。文本生成的 Motion 是独立骨骼动作，不要求已有绑定骨架的角色。这两类操作保留原生参数，不借用 Tripo/Meshy 语义。

Character 的关节集合为 body、expression 或 full。Motion 导出提供 Mixamo、MetaHuman 和 MetaHuman-body 变体；API 没有与 Character 的 119 关节 expression 集合专门对应的 Motion 导出。适配器保留这一差异。`format` 选择所需的预生成 GLB/FBX 导出，不会暗中启动新的转换任务。

场景相机矩阵、目标位置、视图批次和会话保留为显式原生数据。全景图工作流可使用 multipart 上传；场景请求并非只支持 JSON。旧版 Render 的 `scene_id` 别名指的是 Motion，不应与新的 Scene 任务或其 `sessionId` 混淆。

参考：[创建 Character](https://docs.viggle.ai/v1/api-reference/characters/create)、[视频创建 Motion](https://docs.viggle.ai/v1/api-reference/motions/create)、[文本创建 Motion](https://docs.viggle.ai/v1/api-reference/motions/create-from-text)、[Motion 导出](https://docs.viggle.ai/v1/api-reference/motions/export)、[创建场景](https://docs.viggle.ai/v1/api-reference/scenes/pano)、[场景视图](https://docs.viggle.ai/v1/api-reference/scenes/generate)。

## 显式阶段与持久化恢复

```ts
import { startAsset, waitForAsset, startTask, waitForTask } from '@sinestack/ai-core';

const model = viggle.characterAnimation();
const started = await startAsset({
  model,
  input: { driving_video_url: drivingVideoUrl, character_image_urls: [characterUrl] },
});
await saveOperation(started.operation);

// 在另一个 worker 中重建相同的授权 provider 连接。
const finished = await waitForAsset({ model, operation: started.operation });
await copyOutputFiles(finished.assets);

if (finished.asset.type !== 'url') throw new Error('Expected Viggle video URL');
const upscaler = viggle.upscaleVideo();
const submitted = await startTask({ model: upscaler, input: { video_url: finished.asset.url } });
await saveTask(submitted.task);
const upscaled = await waitForTask({ model: upscaler, task: submitted.task });
await copyOutputFiles(upscaled.result.files);
```

持久化和复制函数由宿主提供。每次付费提交都有独立回执；保存回执失败应重试存储，而不是再次向 provider 发出 POST。恢复操作只读取已有资源。不同能力、基础 URL 或连接不能接管保存的句柄。任务回执与可复用资源 ID 不能互换。

可复用 Character/Motion 创建通过任务运行时返回原生资源记录。复用前检查请求的 2D 和 3D 处理状态；`type=all` 代表两者。3D 结果就绪后再请求对应导出。文本生成的 3D Motion 不是保存的 2D 驱动视频，不能仅因就绪便宣称可用于渲染。

`textToMotion` 和 `videoToMotion` 提供资产封装，同时获取所选 GLB 或 FBX 导出。它们保留所有返回的骨架变体，包括独立的 MetaHuman body 骨架。Character `.vsplat`、Motion GLB/FBX 和场景 `.spz` 具有不同文件语义。SDK 不会从高斯泼溅构造网格，也不会隐式重定向骨骼动作。

场景结果保留原生会话、输出批次、全景图和 SPZ 数据。创建全景图、生成视图和重建是独立任务边界；调用方显式传递 `sessionId` 和批次引用。不存在隐藏额外模型执行或计费的自动场景工作流。

## 草稿上传与幂等性

准备草稿是显式资源操作，支持上传描述、公网 HTTPS URL、已就绪资产 ID 和官方动作引用。`renders.upload(plan, blob)` 向返回的签名上传 URL 发送一次 PUT，**仅使用其要求的请求头**。它不会将 Viggle API 密钥和配置的 API 请求头带到对象存储请求中，会拒绝重定向，并原样返回 `upload_handle` 和存储服务的 ETag。应用在提交草稿前显式上传每个声明的槽位。

```ts
const draft = await viggle.renders.prepare({
  character: {
    kind: 'upload', filename: 'character.png', content_type: 'image/png', bytes: characterBlob.size,
  },
  motion: { kind: 'asset', asset_id: motionId },
  output: { background_mode: 'transparent', aspect_ratio: 'source' },
});

// 此草稿只声明一个角色上传。
const [uploadPlan] = draft.uploads ?? [];
if (!uploadPlan || draft.uploads?.length !== 1) {
  throw new Error('Expected one character upload plan');
}
const completion = await viggle.renders.upload(uploadPlan, characterBlob);
const submitted = await startAsset({
  model: viggle.renderDraft(),
  input: { draft_id: draft.draft_id, upload_completions: [completion] },
  headers: { 'Idempotency-Key': stableSubmissionKey },
});
await saveOperation(submitted.operation);
```

跨进程执行时持久化草稿和上传完成记录。保留返回的 `upload_handle` 及任何带引号的 ETag。草稿提交不会在调用方不知情时重新准备或上传。幂等保证适用于相同键与规范化后的草稿请求体；使用旧键更改输入属于错误。上传 URL 过期时需要新上传计划，而不是在未观察状态的情况下重试整个付费工作流。

multipart Render 提交忽略 `Idempotency-Key`。其他普通生成提交也不会因该请求头而获得重试保证。它们默认提交重试次数为零。现有运行时负责所有重试；状态重试读取同一个已接受 ID。部分 3D API 单独说明了 `task_id`，它不是 provider 全局幂等机制。

`createMotionFromText()` 和 `textToMotion()` 使用文档说明的文本 Motion `task_id` 保证。`videoToMotion()` 强制独立的 `type: 'glb'`，API 也为此说明了 `task_id` 重试安全性。调用方省略 `task_id` 时，这些工厂会提供运行时的稳定键。通用 `createMotionFromVideo()` 也允许 render/all 处理，不宣称这种更广泛的提交具备幂等性。

草稿输出背景与 multipart 不同：original/green/white/transparent，且当前只提供 `aspect_ratio: 'source'`。不要将 multipart 的任意纯色配置复制到草稿输出结构，也不要假定列出的重新构图比例已经实现。

参考：[准备](https://docs.viggle.ai/v1/api-reference/renders/prepare)、[提交](https://docs.viggle.ai/v1/api-reference/renders/create)、[异步恢复](https://docs.viggle.ai/v1/production/async-jobs)。

## 观察、错误与结果可用性

Viggle 的 queued/processing/ready 状态映射为共享运行时的 pending/running/completed。failed 和 cancelled 为终态；仅有 HTTP 200 并不表示生成成功。原生错误数据包括 code、retryable、request_id、details 和 remediation。HTTP 错误保留原生可重试提示；任何重试由 core 现有重试逻辑执行。任务和资产的终态错误保留响应与 provider 元数据，供诊断使用。未知进度阶段标签不会使已识别的生命周期状态失效。

`renders.events(id, { lastEventId })` 打开一条经过认证的 SSE 连接并返回异步可迭代对象。它解析事件帧，不启动轮询、不自动重连，也不表示在流式传输生成的视频字节。连接失败时，调用方可用最后一个已完整处理的事件 ID 重连。如果历史不可用，以 `videos.get` 获取的快照为准。其他资源类别通过普通 GET 端点轮询。

`renders.download(id)` 从原生 HTTP 302 返回 `{ url, response }`，不跟随重定向。请单独下载签名 URL，不要携带 Viggle Bearer 令牌。生成结果也只包含引用；不会隐式下载大型视频、图像或 3D 文件。

Viggle 未公开客户端取消端点。Render 可自行进入 cancelled，但本地中止只停止本地工作。Character/Motion 删除是资源删除，不是远端取消。适配器不宣称支持提交级 webhook。

资产的原生输出保留在 `providerMetadata.viggle.output`，任务则保留在对应原生任务结果中。视频与 alpha、所有图像输出均会保留。资产映射不会扫描任意提示词、输入或元数据 URL 并误认其为生成文件。

签名输出 URL 通常有效一小时，可重新读取结果或导出来刷新。生成图像在 24 小时后删除；历史任务仍可为 ready，但每个 `images[].url` 已为 null。直接资源 GET 保留历史可读性，而承诺文件缺失的资产完成操作会失败，绝不能静默提交替代任务。请在 provider 保留期结束前，将所需输出保存到应用拥有的存储中。

参考：[异步任务](https://docs.viggle.ai/v1/production/async-jobs)、[错误](https://docs.viggle.ai/v1/production/errors)、[SSE](https://docs.viggle.ai/v1/api-reference/renders/events)、[下载](https://docs.viggle.ai/v1/api-reference/renders/download)、[图像状态](https://docs.viggle.ai/v1/api-reference/images/get)、[保留期限](https://docs.viggle.ai/v1/pricing)。

## 验证与文档差异

契约测试覆盖语义视频/图像请求、multipart 文件保留、原生响应保留、独立 alpha 输出、JSON 草稿幂等性、SSE 分块、手动下载、错误恢复、非安全整数种子及不重复提交的恢复。类型测试检查必需来源、已知字段类型、互斥输入，以及生成和处理的分离。领域测试覆盖 Character/Motion/Scene 调用。

官方概览与生成的 schema 并未完全同步。例如，概览省略视频放大器，通用视频 schema 显示了错误的放大任务 ID 前缀，自动示例混用了不兼容的视频模式字段。场景专用页面还说明了 multipart 表单，与概览中全部使用 JSON 的措辞不同。适配器契约优先采用端点专用参数说明；其余线上行为仍需使用已授权的 Viggle 账户核验。

本文不宣称 Mix Turbo、Multi、Move 或 Mic 等旧产品名称是可独立调用的 V1 API。provider 实现公开的资源契约，不额外建立轮询引擎、持久化队列、自动资产清理或隐藏的多阶段组合。
