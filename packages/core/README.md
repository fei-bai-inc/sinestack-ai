# @sinestack/ai-core

基于 Vercel AI SDK 7 的统一资产生成编排器。

## 核心入口

- `generateAsset` / `startAsset` / `getAssetStatus` / `waitForAsset` / `cancelAsset`
- 按资产类别的薄入口：`generate3D`、`generateSoundEffect`、`generateMusic`、`generateAnimation3D`
- `materializeAsset`：将 `AssetFile` 显式下载或解码为 AI SDK `GeneratedFile`

远端失败或取消状态可附带 `response` 与 `providerMetadata`。这些诊断信息会保留到 `TaskExecutionError` / `AssetExecutionError` 及 `onError` 观察到的同一个错误对象中，并保留原有 cause、任务凭据和错误代码；失败状态不触发重新提交。

重试策略、AbortSignal 合并与观测回调分发直接委托给精确锁定的 `ai@7.0.155`。详细用法见仓库 [README](https://github.com/fei-bai-inc/sinestack-ai)。
