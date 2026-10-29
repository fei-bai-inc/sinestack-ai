# @sinestack/ai-provider-utils

SineStack AI 资产 provider adapter 共用的轻量 JSON 校验、默认文件映射与单次 HTTP 传输工具。

## 职责边界

- `jsonValue` / `jsonObject` / `httpURL`：无副作用的数据快照与安全 URL 校验
- `mapAssetResult` / `snapshotAssetMapping`：通用文件输出解析与外部 mapper 绑定快照
- `AssetProviderTransport`：复用 `@ai-sdk/provider-utils` 的单次 HTTP 请求与错误处理，不包含重试、轮询或生命周期状态机

## 特殊响应

`request(url, method, options, body?, allowEmpty?, handlers?)` 的第六个参数可按请求提供 `successfulResponseHandler` 和 `failedResponseHandler`。两者使用 AI SDK 的 `ResponseHandler`；错误 handler 返回 `APICallError`，由上层共享执行机制决定是否重试。默认仍严格解析 JSON，只有显式 `allowEmpty` 才接受约定的空成功响应。

`requestRaw(url, method, options, { accept?, redirect?, failedResponseHandler? })` 返回未读取的 `Response`，适用于流或下载地址查询。调用方负责读取和取消响应体。默认禁止重定向；显式 `redirect: 'manual'` 只交付原始 301/302/303/307/308 响应，不跟随 `Location`，不向目标地址发送认证信息。调用方必须验证下载地址，并通过独立的非认证下载流程读取产物。

两条路径共用 baseURL origin/path 校验、锁定的认证和调用方 AbortSignal；provider 专用解码与流事件解析仍留在各自 adapter。

详细说明见仓库 [README](https://github.com/fei-bai-inc/sinestack-ai)。
