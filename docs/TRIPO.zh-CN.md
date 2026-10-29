# Tripo v3 与领域执行

[English](TRIPO.md) | 简体中文

实现依据为公开的 HTTP v3 文档和官方 Python SDK v1.0.0，审阅日期为 2026-10-29。
模拟契约测试的覆盖不代表付费集成已成功。包名为 `@sinestack/ai-tripo`；领域和任务入口来自 `@sinestack/ai-core`。

## 使用方配置

```sh
npm install @sinestack/ai-tripo @sinestack/ai-core ai@7.0.155
```

使用 Node.js 22 或 24 及 ESM。在服务端设置 `TRIPO_API_KEY`（或传入 `apiKey`），并选择账号可用的模型版本。
默认 API 根地址为 `https://openapi.tripo3d.ai/v3`。
连接配置还接受 `baseURL`、`headers`、`fetch`、`name` 和 `connectionId`。
提交可能产生费用；安装包和运行模拟测试不会授予提供方访问权限或额度。
可运行的生成示例见[包 README](../packages/tripo/README.zh-CN.md)。

## 覆盖范围

| 领域 | 工厂方法 | /v3 下的 HTTP 路由 |
|---|---|---|
| 3D 生成 | textTo3D, imageTo3D, multiviewTo3D | generation/text-to-model, image-to-model, multiview-to-model |
| 其他生成 | imageToSplat, textToImage, imageToImage, imageToMultiview, editMultiview, imageToDepth | generation/image-to-splat, text-to-image, image-to-image, image-to-multiview, edit-multiview, image-to-depth |
| 处理 | texture, segment, smartSegment, complete, retopology, unwrapUV, convert, importModel | models/texture, mesh/segment, mesh/smartsegment, mesh/complete, mesh/decimate, mesh/uv, models/convert, models/import |
| 检查 / 绑定 / 动画 | rigCheck, rig, retarget | animations/rig-check, animations/rig, animations/retarget |
| 资源 | tasks.get, tasks.batch, files.upload, files.presign, account.balance, account.usage | tasks/{id}, tasks/list, files, files/presign, account/balance, account/usage |

`files.put` 负责单独的存储 PUT。导入操作绝不会隐藏在上传或其他任务内部。
已退役的 v2 refine/stylize 被有意排除。Image-to-depth 已在 Python SDK 源码中确认，
但在真实账号验证前仍属于实验性功能。

## 参数覆盖

`packages/tripo/src/types.ts` 定义各端点的原生字段。已知枚举提供补全提示，同时允许扩展字符串。
未知 JSON 字段仍可使用。`tests/tripo.test.mjs` 中的请求/响应固定样例覆盖每个端点；测试断言完整的发送请求体。

几何生成包含独立的几何/图像/纹理种子和版本、面数限制、几何质量、纹理/PBR、部件、四边形/低多边形、
UV、朝向、压缩、对齐和图像自动修复。纹理支持文本加风格图、单图或多图引导。
处理包含分割粒度/参考图、带变换的模型/图像智能分割、补全模式、重拓扑烘焙/UV/部件、UV 烘焙以及全部 19 个 Convert 字段。
Rig 保留 type/spec/version；Retarget 支持单个预设或最多五个预设，以及全部导出开关。

校验强制执行文档规定的端点结构及互斥编码，而不是模型目录。
依赖模型版本的限制/副作用仍由提供方契约定义；适配器不会静默限制面数、改变版本、强制默认设置或转换不兼容参数。
例如，几何与纹理版本互相独立；无纹理生成可能需要同时设置 `texture:false` 和 `pbr:false`。
应用应根据具体模型文档选择有效组合。这里没有实现自动的按版本能力矩阵。

几何多视图有三种形式：命名视图、按正面/左侧/背面/右侧排序的四个字符串槽位（空字符串表示跳过），或一个上游任务引用。
纹理多视图支持命名或按位置排列的图像引用，包括以 null 表示跳过的槽位；不接受上游任务引用形式。

## 领域调用与结果

生成保留 `generateAsset` / `generate3D` 和非空的 `asset/assets`。
处理使用 `processModel3D({ processor, input })`，检查使用 `checkRigging({ checker, input })`，
绑定使用 `rigModel({ rigger, input })`，动画使用 `animateModel({ animator, input })`。

检查直接返回 `riggable`，而不是空资产数组。`false` 也是成功完成的检查。
处理返回 `model`、`files`、可选预览/归一化信息以及操作特有字段。
智能分割保留 `segmentationTaskId` 和 `modelTaskId`；补全可以使用前者。
UV 结果公开 `uvPreview`。动画返回实际文件，且仅在提供方报告时返回片段。
不会推断每个动作对应一个文件。Splat 不会被错误标记为 GLB。

每个领域结果还包括完整的原生 `raw`、`taskId`、存在时的小数额度和 `execution` 元数据对象。
原生输出和响应体分别保留。绑定类型接受文档中的 `rig_type` 和 Python SDK 的 `topology` 别名；缺失的类型保持缺失。
文件是引用，绝不会自动下载。应用负责持久存储，可在临时 URL 过期前显式使用 `materializeAsset`。

## 共享执行与兼容性

`TaskDriver<INPUT, RESULT, DOMAIN>` 是适配器契约，而不是强制的业务 API。
领域契约彼此独立，并组合使用该机制。`core/internal/runtime.ts` 负责唯一的轮询、提交/状态和错误生命周期。
旧的 `internal/executor.ts` 是 Asset 兼容边界。检查不会借助伪造的 AssetFile 执行。
现有 Asset 回执、结果、错误、模式和钩子仍受支持。
重试/退避、信号组合和观察回调处理委托给固定版本的 AI SDK 辅助函数；维护的基线见 [UPSTREAM.zh-CN.md](UPSTREAM.zh-CN.md)。

公开的高级 API 为 startTask/getTaskStatus/waitForTask/cancelTask/deleteTask。
`startTask` 返回 `{ task, ...metadata }`；`waitForTask` 返回 `{ result, execution }`，保留驱动的结果类型。
每份回执有独立的运行时标记、路由/驱动绑定以及可选的连接标识。
恢复后的钩子和需认证的 I/O 之前会先执行纯句柄校验。
v1 线格式判别值 `sine-ai-task` 在 SineStack AI 更名后保持不变，因此现有的持久化回执无需数据迁移或重新提交即可继续使用。

提交默认零次重试；不要重试是否已被接受尚不确定的付费提交。
查询重试只重新读取同一任务。本地中止/超时绝不会发起远程取消或删除。
此 Tripo 适配器既不公开 `doCancel`，也不公开 `doDelete`；对应的 core 生命周期调用会报告不支持。

已实现的观察机制是轮询。可先等待可选的已认证通知，再进行查询；如果查询结果不是终态，则继续轮询。
通知丢失可能耗尽配置的等待预算，因此投递不可靠时建议默认使用轮询。
Tripo adapter 没有 SSE/watch 实现；Viggle 独立的 Render 事件流不改变这一点。持久工作进程、数据库、队列和工作流调度由应用负责。
超时是协作式的；无法强制不配合的提供方 Promise/钩子结束。

## 持久化与阶段

以下是应用集成示意：`tripo`、版本、源任务 ID 和 `saveTask` 由宿主提供。
从 `@sinestack/ai-core` 导入生命周期函数。

```ts
const model = tripo.rig(selectedRigVersion);
const started = await startTask({ model, input: { input: originalModelTaskId } });
await saveTask(started.task); // 应用负责的关键持久化步骤；不是观察钩子。
const completed = await waitForTask({ model, task: started.task });
```

每个阶段分别持久化。如果持久化失败，保留返回的句柄并重试存储，而不是重新提交。
Rig Check 引用原始模型；Rig 也引用原始模型；Retarget 引用绑定任务。
绝不要将检查任务 ID 当作已绑定模型传入。
恢复要求使用相同的授权账号、base URL、路由、版本和连接。回执不包含 API 密钥，也不能替代应用的租户授权。
跨提供方使用需要显式传输文件，而不是把 Tripo 任务 ID 交给 Meshy。

Meshy 通过 `@sinestack/ai-meshy` 实现，使用相同的领域接口和共享运行时。
其无文件分析、绑定产物、多片段结果以及独立的 preview/refine 阶段见 [MESHY.zh-CN.md](MESHY.zh-CN.md)。
通用运行时固定样例与 Meshy 适配器固定样例都是模拟覆盖，不是实时账号接受请求或二进制资产正确性的证明。

## 上传与 Webhook 安全

Multipart 使用现有的 AI SDK 传输辅助函数。签名存储 PUT 刻意使用独立、无凭据且禁用重定向的 fetch；
绝不会接收 API 密钥或连接请求头。此存储 PUT 的自定义 fetch 必须遵守 `redirect:'error'`。
Tripo 固定依赖的 API transport 也使用 Fetch error 模式；当前共享 transport 的 manual 模式扩展不会升级旧的精确依赖。

Tripo 订阅在账号级别配置；不要在创建任务请求中发送虚构的回调 URL。
`verifyTripoWebhook` 使用 Web Crypto 检查基于时间戳加原始请求体字节的 HMAC-SHA256、
重放容差、事件结构以及可选的必需端点 ID。

传入接收方可信的 `expectedEndpointId`。从服务端路由解析连接，绝不要使用不可信的请求头。
返回的 `deduplicationKey` 是已签名的 event.id；投递请求头不属于 HMAC 的一部分。
用可信连接 ID 为该事件键添加前缀，并在一个应用事务中将其与 outbox 通知一起插入。
内存去重缓存不能宣称提供持久的恰好一次投递。
使用已验证的任务事件唤醒已注册的任务，并查询其状态；不要将 Webhook 输出视为权威生成输出。

## 验证边界

本地/CI 契约测试使用伪造的 HTTP 响应，不使用 API 密钥。仍需真实账号验证的内容包括：
全部版本/参数组合、image-to-depth、替代的四视图和批量动画输出结构、Image-to-Image 的仅 inputs 行为、
Smart UV 压缩/版本不一致、二进制模型内容/绑定保留，以及 Tripo 的 Cloudflare/workerd 部署。
已有的 [Viggle/core workerd 检查](../tests/workerd/README.zh-CN.md) 不验证 Tripo 或其独立签名上传客户端。

Tripo 和 Meshy 参与九包发布清单、归档验证及隔离使用方冒烟测试。
各包独立版本化；变更不会强制工作区版本同步。
`verify:release` 以本地归档验证结束，而不是 npm 注册表 dry-run；
只有显式带 `--base-ref` 的发布 dry-run 才会使用注册表检查和针对所选包的 npm dry-run。
两条路径都不会发布。确切边界见 [PUBLISHING.zh-CN.md](PUBLISHING.zh-CN.md)。

来源：[Tripo SDK 矩阵](https://developers.tripo3d.ai/en/docs/sdk)、
[任务查询](https://developers.tripo3d.ai/en/docs/task-query)、
[纹理](https://developers.tripo3d.ai/en/docs/models-texture)、
[转换](https://developers.tripo3d.ai/en/docs/models-convert)、
[绑定](https://developers.tripo3d.ai/en/docs/animations-rig)、
[重定向](https://developers.tripo3d.ai/en/docs/animations-retarget)、
[文件](https://developers.tripo3d.ai/en/docs/files)、
[预签名](https://developers.tripo3d.ai/en/docs/files-presign)、
[Webhook](https://developers.tripo3d.ai/en/docs/webhooks)、
[Python 输出别名](https://github.com/Tripo-Developer/tripo-python-sdk/blob/v1.0.0/tripo3d/models.py)、
[Meshy 绑定](https://docs.meshy.ai/en/api/rigging)、
[Meshy 动画](https://docs.meshy.ai/en/api/animation)。
