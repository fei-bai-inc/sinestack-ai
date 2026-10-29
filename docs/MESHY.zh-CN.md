# Meshy 提供方

[English](MESHY.md) | 简体中文

`@sinestack/ai-meshy` 通过现有的 SineStack AI 运行时实现 Meshy 公开的生成、处理、分析、绑定、动画和账号 API。
协议参考资料审阅于 2026-10-29。契约测试使用模拟 HTTP；不属于真实 API 验收。

## 使用方配置

```sh
npm install @sinestack/ai-meshy @sinestack/ai-core ai@7.0.155
```

使用 Node.js 22 或 24 及 ESM。在服务端设置 `MESHY_API_KEY`（或传入 `apiKey`），并为所需能力选择可用的模型/模式。
需要账号权限和额度；提交的每个阶段都可能单独计费。
连接配置包括 `baseURL`、`headers`、`fetch`、`name` 和 `connectionId`；自定义 fetch 必须遵守拒绝重定向的要求。
[包 README](../packages/meshy/README.zh-CN.md) 包含可运行的生成/处理示例。

## 能力与 API 覆盖

基础 URL 为 `https://api.meshy.ai/openapi`。Text to 3D 使用 v2；其他已实现的 API 家族使用 v1。
不要为整个提供方配置 `/v1` 后缀。

| 工厂方法 | 调用方 API | /openapi 下的原生路由 |
|---|---|---|
| textTo3D(modelId) | generate3D / startAsset | v2/text-to-3d, mode=preview |
| refine(modelId?) | processModel3D / startTask | v2/text-to-3d, mode=refine |
| imageTo3D(modelId) | generate3D | v1/image-to-3d |
| multiImageTo3D(modelId) | generate3D | v1/multi-image-to-3d |
| textToImage(modelId) | generateAsset | v1/text-to-image |
| imageToImage(modelId) | generateAsset | v1/image-to-image |
| textToMotion(mode) | generateAnimation3D | v1/text-to-motion |
| retexture(modelId?) | processModel3D | v1/retexture |
| remesh() | processModel3D | v1/remesh |
| convert() | processModel3D | v1/convert |
| resize() | processModel3D | v1/resize |
| unwrapUV() | processModel3D | v1/uv-unwrap |
| rig() | rigModel | v1/rigging |
| animate() | animateModel | v1/animations |
| multiColorPrint() | processModel3D | v1/print/multi-color |
| analyzePrintability() | analyzeModel3D | v1/print/analyze |
| repairPrintability() | processModel3D | v1/print/repair |
| autoSplit() | processModel3D | v1/print/split |

这些是横跨 17 个任务资源家族的 18 项语义能力。
每个任务家族都有显式的 `tasks.get(family,id)`、`tasks.list(family,query)` 和 `tasks.delete(family,id)` 资源方法。
列表返回原生的一页，而不是自动遍历所有分页的集合。不存在伪造的批量端点或服务端上传 API。
Meshy 输入直接接受文档规定的任务 ID、URL 和 data URI。

`animations.list(filters)` 调用 `v1/animations/library`，这是返回动画目录的非任务查询。
筛选字段包括 search、category、sub_category 和 action_ids（CSV 字符串或数字数组）。
SDK 不捆绑预设目录，也不假定 ID 连续。
`account.balance()` 和 `account.usage(query)` 保留原生字段、零/小数额度、null 重置时间、分页、端点筛选条件和时间戳。
`X-Meshy-Metadata` 可以通过普通调用请求头提供。

## 参数契约

原生字段声明于 `packages/meshy/src/types.ts`。已知模型/格式字符串是编辑器建议，而不是允许列表。
无需发布新版本即可接受新的模型 ID 和额外的 JSON 字段。
不会在本地解析 `latest`，也不会自动迁移模型、推断质量降级或限制面数。
要求模型的生成工厂必须显式传入模型；处理工厂保留省略值。
特别是 `refine()` 会保持 `ai_model` 缺失，使 Meshy 能继承 preview 的版本。
与工厂选择冲突的原生模型/阶段会在提交前被拒绝。

| 输入家族 | 覆盖的参数组 |
|---|---|
| 3D 几何 | ai_model, model_type, topology, target_polycount, should_remesh, geometry_resolution, pose_mode, seed, moderation, save_pre_remeshed_model, auto_size, origin_at, decimation_mode, target_formats, experimental, alpha_thumbnail；原生已弃用字段保持显式且不作修改 |
| 文本预览 | prompt, negative_prompt, art_style, texture_richness，显式 preview 阶段 |
| 单图/多图 | image_url/image_urls 或 input_task_id, should_texture, image_enhancement，文档规定时的 multi_view_thumbnails, texture_image_urls |
| 纹理/refine | enable_pbr, texture_resolution, texture_prompt, texture_image_url, remove_lighting, hd_texture；refine 使用 preview_task_id |
| Retexture | 模型来源, text_style_prompt, image_style_url 或 multiview_image_urls, enable_original_uv，纹理/PBR/格式与预览控制 |
| Remesh/Convert/Resize/UV | 任务/URL 来源、拓扑/数量/减面、输出格式、尺寸和原点；已弃用的 remesh 尺寸/转换字段会保留，不会被静默转移到额外任务 |
| Rig | 任务/URL 来源, height_meters，原生 animation_type，可选 name，已弃用的纹理覆盖 |
| Animation | rig_task_id；action_id、action_ids 或 motion_task_id；post_process 的 operation_type 和 fps；name |
| Motion | prompt，显式 prime/swift 或未来模式，duration |
| 图像 | prompt, ai_model, generate_multi_view, pose_mode, aspect_ratio, remove_background；编辑使用 reference_image_urls 或上游图像任务 |
| 打印 | 打印机类型/品牌、预期毫米尺寸、颜色/深度控制、alpha 缩略图、拆分模式/提示词/布局/连接件设置和输出格式 |

端点级校验覆盖必需来源、互斥的动画/缩放/打印尺寸形式、图像/动作数量、动作时长步长和拆分连接件范围。
版本特定权限、面数限制、几何/纹理质量组合以及模型特有副作用仍由 Meshy 契约规定，而不是在本地再建一套模型注册表。
仅允许任意 JSON 不被视为类型化覆盖：请求固定样例显式包含声明的原生参数组，并比较完整请求体。

部分面向人的端点文档同时允许 `input_task_id` 和直接来源，且任务 ID 优先，而通用 OpenAPI 描述曾使用互斥措辞。
适配器遵循端点页面：两者都保留。Retexture 同样保留文本加单图引导；由 Meshy 选择其文档规定的优先级。
多视图纹理引导仍保持互斥。

内置工厂上的 `mapInput` 是可选的，并保留自定义输入推断。Asset 工厂也接受 `mapResult`。
对于 Meshy，此映射器接收完整的原生任务记录（部分输出位于顶层，其他位于 result 下），而不只是 task.result。
自定义输出契约可实现/导出带解码器的 `MeshyTaskDriver`。映射不能修改保留的响应/原生快照。

`providerOptions.meshy` 补充原生输入；重复键会被拒绝，绝不会静默覆盖。
只插入声明的路由/阶段/模型选择字段。未知的原生 JSON 值不会被裁剪。

## 结果与领域边界

生成返回现有的非空 asset/assets 契约。处理返回 model/files/models、纹理和预览。
绑定额外返回动画和骨架。角色动画仅在明确报告时保留文件、动画格式、骨架和片段元数据。
多个动作可能位于一个 GLB/FBX 内；SDK 绝不会根据 URL 数量推断片段数量。

可打印模型分析返回 `printability`，不伪造文件。状态为 `warning` 或 `error` 的报告仍然是成功的分析任务，
与远程 FAILED 状态不同。修复和拆分有各自的结果，包括报告中提供的修复报告、预期尺寸、partCount 和 promptIgnored。

此适配器没有独立验证的 Meshy Rig Check 端点。不会因提交成功而捏造 `riggable:true`。
独立的 Text to Motion 生成动作资产，之后可通过 motion_task_id 输入 animate；它不是角色绑定操作。

适配器只提取已知的输出文件字段，保留 GLB/FBX/其他模型格式、MTL、PBR 贴图、重网格化前文件、
alpha 与多视图预览、基础绑定动画、后处理动画输出和动作文件。
不会将提示词/输入/元数据中的 URL 扫描为文件。可选的空 URL 会被跳过。
原生输出保留在 providerMetadata.meshy.output 中，领域调用还会保留在 raw 中。
领域记录公开 taskId、报告的额度和 expiresAt。文件元数据含稳定的响应路径 assetId 和报告的过期时间。
不会自动下载文件，也不会根据 URL 解析断言二进制内容。

已经过去的 expires_at 不会将观察到的 SUCCEEDED 任务变成新任务。
即使文件已不存在，仍可通过 tasks.get 访问原生历史。
承诺返回文件的实体结果调用在缺失文件时会失败；绝不会重新创建任务。
应用必须在文件仍可用时显式保存。

## 显式阶段与持久化

文本生成先进行 preview，再可选地进行 refine；提供方不会把两者都隐藏在 textTo3D 后面。
每次 POST 都有独立返回的回执和计费边界。示例函数见 [examples/meshy.ts](../examples/meshy.ts)；导入示例不会启动任务。

以下持久化示意假定应用提供 `meshy`、`chosenModelId`、`prompt`、`savePreview` 和 `saveRefine`；
从 `@sinestack/ai-core` 导入生命周期函数。

```ts
const previewModel = meshy.textTo3D(chosenModelId);
const started = await startAsset({ model: previewModel, input: { prompt } });
await savePreview(started.operation);
const preview = await waitForAsset({ model: previewModel, operation: started.operation });

const previewTaskId = preview.providerMetadata?.meshy?.taskId;
if (typeof previewTaskId !== 'string') throw new Error('Missing preview task ID');
const processor = meshy.refine();
const next = await startTask({
  model: processor,
  input: { preview_task_id: previewTaskId },
});
await saveRefine(next.task);
const refined = await waitForTask({ model: processor, task: next.task });
```

宿主持久化方法刻意保持显式。如果 start 返回后存储失败，保留该回执并重试存储，而不是重新 POST。
用于恢复任务的模型必须使用相同的授权连接、路由、阶段、领域和算法选择。
回执既不携带 API 密钥，也不携带账号授权。
跨提供方传输需要显式文件，而不是把 Tripo 任务 ID 传给 Meshy。

MeshyTaskDriver 执行单次 POST/GET/DELETE。共享 core 负责提交/等待/状态的重试/信号/钩子。
Model3DAnalyzer 和 analyzeModel3D 在该运行时上提供独立的分析语义。
TaskHandle v1 线格式判别值保持为 `sine-ai-task`，在包更名后也不改变。
共享 HTTP 传输支持 DELETE，并支持显式启用的空 HTTP 200/204 响应，但不会因此接受格式错误/空的生成响应。
提交默认零次重试；查询重试读取同一个任务。不宣称远程提交具有幂等性保证。

## 删除、取消与通知

普通任务 DELETE 删除任务/资源；不等同于取消。领域驱动公开 doDelete，而不是 doCancel。
Asset 任务可通过 tasks.delete 显式删除。进行中的任务可能返回 409；
该响应表示删除失败，并不能证明任务已停止。本地中止只停止本地等待。

Meshy Webhook 在账号级别配置。此适配器不会在创建请求中发送虚构的回调 URL。
已审阅的公开 Webhook 参考资料未提供签名验证协议，因此 parseMeshyWebhook 显式返回 authenticated:false。
其 eventKey 只是一个不可信的去重提示，而不是经过认证的投递标识。不要复用 Tripo 的 HMAC 协议。

从可信的服务端路由/存储解析连接和允许的任务家族。在宿主边界认证/授权通知，并进行限流；
通知只能用于唤醒已注册任务的权威 GET 查询。绝不要从不可信通知派生携带凭据的 fetch 目标，也不要接受其中的输出文件。
重复和乱序事件不得使已存储的任务状态回退。不使用回调时仍可使用默认轮询。Meshy SSE/watch 尚未实现；Viggle 独立的 `renders.events` API 不改变这一边界。

## 重要原生行为与尚未解决的文档差异

- Resize 使用米；预期打印尺寸使用毫米。SDK 不会将二者中的任一个等同于缩放因子。
- UV Unwrap 不保证保留原始纹理、骨骼或动画。请遵循原生操作的影响。
- Rigging 端点页面支持带纹理的人形模型；OpenAPI 包含具有 biped/quadruped 值的 animation_type。
  原生字段已公开，但没有真实验证时不宣称支持非人形或具备相关权限。
- Text to Motion 在自己的端点页面中有文档，但不包含在已审阅的 OpenAPI 文档中。
- 动画的 post_process.operation_type 可省略；省略会被保留，且不会请求额外文件。
- 已弃用模型/参数的提示不意味着提供方继续提供它们。默认不会选择任何已退役模型。

## 范围与验证

上述主要核心 API 已实现；这不意味着包装了 Meshy 的每一项 API 产品。
Meshy Creative Lab 的专用产品工作流（具有不同的取消语义）和 Meshy SSE 流尚未实现；持久工作进程、队列和自动工作流组合仍由应用负责。

Node 22/24 CI 覆盖旧提供方回归、Meshy 全部 18 项业务能力、原生请求体、结果、无效输入、类型推断、
删除/取消分离、凭据路由、恢复/不重新提交、通知和账号资源。
发布验证包含在独立使用方中验证全部九个 tarball。
模拟覆盖和本地发布验证不同于成功的提供方集成。

Meshy 尚未验证：真实账号权限/额度、全部版本/参数组合、实际 Webhook 投递/认证、
二进制模型/UV/绑定/动画内容及 Cloudflare/workerd 执行。已有的
[Viggle/core workerd 检查](../tests/workerd/README.zh-CN.md) 不证明 Meshy 兼容性；其精确 transport 依赖
仍使用 Fetch 的 `redirect: 'error'`。这些测试不会发起付费 API 调用、执行 npm publish 或进行网关/云迁移。

## 协议参考

[OpenAPI](https://docs.meshy.ai/openapi.json)、[文本转 3D](https://docs.meshy.ai/en/api/text-to-3d)、
[图像转 3D](https://docs.meshy.ai/en/api/image-to-3d)、[多图](https://docs.meshy.ai/en/api/multi-image-to-3d)、
[重新纹理化](https://docs.meshy.ai/en/api/retexture)、[重网格化](https://docs.meshy.ai/en/api/remesh)、
[转换](https://docs.meshy.ai/en/api/convert)、[调整尺寸](https://docs.meshy.ai/en/api/resize)、
[UV](https://docs.meshy.ai/en/api/uv-unwrap)、[绑定](https://docs.meshy.ai/en/api/rigging)、
[动画/目录](https://docs.meshy.ai/en/api/animation)、[动作](https://docs.meshy.ai/en/api/text-to-motion)、
[图像](https://docs.meshy.ai/en/api/text-to-image)、[分析](https://docs.meshy.ai/en/api/analyze-printability)、
[修复](https://docs.meshy.ai/en/api/repair-printability)、[拆分](https://docs.meshy.ai/en/api/auto-split)、
[Webhook](https://docs.meshy.ai/en/api/webhooks)、[保留期](https://docs.meshy.ai/en/api/asset-retention)、
[余额](https://docs.meshy.ai/en/api/balance)、[使用量](https://docs.meshy.ai/en/api/usage)。

## 独立包发布

Meshy 是按发布顺序注册并参与隔离使用方验证的九个独立版本包之一。
依赖固定版本是各包的兼容性选择，并不要求工作区内所有版本相同。
当前版本请查阅包清单；Meshy 首次发布的版本号不是以后版本的安装要求。

公开的请求/启动/删除结果具有命名契约（`MeshyTaskResponse`、`MeshyTaskStartResult`、
`MeshyAssetStartResult`、`MeshyTaskDeletion`），并保留必需的响应头和原生任务 ID。
其声明引用 Meshy 声明的协议依赖，而不是某个传输实现的嵌套依赖路径。
隔离使用方使用独立的包版本检查这些 API。

首次发布还需要 npm 侧的引导/Trusted Publisher 配置；源码修改和 dry-run 不会执行这些配置。
版本、合并与发布规则见 [PUBLISHING.zh-CN.md](PUBLISHING.zh-CN.md)。
