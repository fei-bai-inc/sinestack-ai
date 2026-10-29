# Security

[English](SECURITY.md) | 简体中文

## 报告方式

不要在公开 Issue、PR 或日志中提交有效 API key、签名下载 URL、账号数据或尚未修复漏洞的利用细节。

优先使用仓库的 [私密漏洞报告入口](https://github.com/fei-bai-inc/sinestack-ai/security/advisories/new)。此入口取决于 GitHub 的 private vulnerability reporting 设置；若不可用，通过 [维护者公开联系入口](https://github.com/liziyu1209) 请求私密沟通渠道。在建立私密渠道前，只说明需要安全联系，不公开漏洞细节。

报告请包含受影响包及版本、运行环境、最小复现、影响和不含真实凭据的证据。仓库当前没有承诺固定响应 SLA 或旧版本长期支持；修复会明确列出受影响与已修复版本。

## 使用边界

- 供应商 key 只放在服务端环境或安全存储中，不进入浏览器 bundle、仓库、错误日志或持久化任务凭据。
- `TaskHandle` / `AssetOperation` 不是授权令牌。宿主应用必须验证租户、账号、连接和任务归属；同一个 baseURL 不证明是同一个账号。
- 当前共享认证 transport 发送 `redirect: 'manual'` 并默认拒绝重定向；raw manual 模式只暴露原始重定向响应。fal/WaveSpeed/Replicate/Tripo/Meshy 的旧版精确 transport 依赖仍使用 `redirect: 'error'`。自定义 `fetch` 必须遵守传入模式，不得跟随跳转。独立签名上传省略 API key 和连接 headers：Viggle 使用 manual 模式并拒绝重定向；Tripo 要求 error 模式。
- 文件 URL 不会自动下载。使用 `materializeAsset` 时设置适当的 `maxBytes`；宿主应限制不可信下载目标，避免 SSRF，并负责文件的长期存储。
- Webhook 不是生成结果的权威来源。Tripo 验签需要原始请求字节、可信 endpoint 和防重放处理；`parseMeshyWebhook` 仅解析，明确不提供认证。宿主负责授权关联、持久化去重和触发既有任务查询。
- 本地 abort / timeout 不代表远端计费任务停止。不要因轮询、下载或持久化失败重新创建任务。
- Task/Asset 错误可保留 `response` 和 `providerMetadata`，其中可能包含签名 URL、提交内容与账号信息。记录或分享诊断信息前应先脱敏。

协议说明见 [架构](docs/ARCHITECTURE.zh-CN.md)、[Tripo](docs/TRIPO.zh-CN.md)、[Meshy](docs/MESHY.zh-CN.md)、[Viggle](docs/VIGGLE.zh-CN.md) 和 [聚合 provider](docs/MEDIA_PROVIDERS.zh-CN.md)。

## 仓库检查与局限

CI 使用假凭据验证协议与安全边界，并检查上游精确依赖基线；这不是完整安全审计，也不能证明供应商服务、任意自定义 transport 或宿主应用安全。真实凭据一旦暴露，应先撤销或轮换；删除当前文件不能撤回 Git 历史、npm 包和已下载的副本。
