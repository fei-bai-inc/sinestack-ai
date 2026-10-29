# @sinestack/ai-core

基于 Vercel AI SDK 7 的统一资产生成编排器。

## 核心入口

- `generateAsset` / `startAsset` / `getAssetStatus` / `waitForAsset` / `cancelAsset`
- 按资产类别的薄入口：`generate3D`、`generateSoundEffect`、`generateMusic`、`generateAnimation3D`
- `materializeAsset`：将 `AssetFile` 显式下载或解码为 AI SDK `GeneratedFile`

重试策略、AbortSignal 合并与观测回调分发直接委托给精确锁定的 `ai@7.0.155`。详细用法见仓库 [README](https://github.com/fei-bai-inc/sinestack-ai)。
