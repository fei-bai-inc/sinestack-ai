# @sinestack/ai-provider-utils

SineStack AI 资产 provider adapter 共用的轻量 JSON 校验、默认文件映射与单次 HTTP 传输工具。

## 职责边界

- `jsonValue` / `jsonObject` / `httpURL`：无副作用的数据快照与安全 URL 校验
- `mapAssetResult` / `snapshotAssetMapping`：通用文件输出解析与外部 mapper 绑定快照
- `AssetProviderTransport`：复用 `@ai-sdk/provider-utils` 的单次 HTTP 请求与错误处理，不包含重试、轮询或生命周期状态机

详细说明见仓库 [README](https://github.com/fei-bai-inc/sinestack-ai)。
