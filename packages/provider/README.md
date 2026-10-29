# @sinestack/ai-provider

SineStack AI 的版本化、provider 中立资产生成契约（`AssetModelV1`）。

## 导出内容

- `AssetModelV1` 及单次操作参数与结果类型（`doGenerate`、`doStart`、`doStatus`、`doCancel`）
- `AssetFile`（URL 引用、binary、base64）与 `AssetOperation` 可序列化恢复信封
- `AssetModelMapping`（可选的输入/结果外部映射契约）
- 复用的 `@ai-sdk/provider` JSON、warning 与 metadata 类型

详细架构与协议约定见仓库 [README](https://github.com/fei-bai-inc/sinestack-ai)。
