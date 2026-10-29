# 手动运行 Viggle workerd 冒烟检查

[English](README.md) | 简体中文

此测试夹具在真实 Cloudflare `workerd` 运行时中运行四项 provider 集成检查。它通过仓库相对路径导入已编译的公共包入口，并为所有 API 和存储响应注入模拟 fetch。它不会连接 Viggle、消耗积分、部署 Worker、打开 HTTP 监听端口，也不需要 Cloudflare 账户。

## 复现

在已安装工作区依赖的仓库根目录运行：

```sh
npm run build
viggle_worker_tools="$(mktemp -d /tmp/sinestack-viggle-workerd.XXXXXX)"
npm install --prefix "$viggle_worker_tools" --save-exact --no-audit --no-fund workerd@1.20261029.1 esbuild@0.28.2
node tests/workerd/build.mjs "$viggle_worker_tools"
"$viggle_worker_tools/node_modules/.bin/workerd" test "$viggle_worker_tools/viggle-smoke-output/config.capnp"
```

工具以及生成的 bundle、配置和 metafile 均写入临时目录。不会修改仓库依赖或 CI 配置。打包使用 esbuild 的 browser 平台、ESM 输出、ES2022 目标，以及 `workerd` / `worker` / `browser` 条件。构建会拒绝外部导入，因此未解析的 Node 模块不能悄悄进入 Worker 运行时。

2026-10-29 记录的验证使用以下配置：

| 设置 | 值 |
|---|---|
| `workerd` npm 包 | `1.20261029.1` |
| `workerd --version` | `workerd 2026-10-29` |
| esbuild | `0.28.2` |
| `compatibilityDate` | `2026-10-29` |
| `compatibilityFlags` | `[]` |
| 显式 `nodejs_compat` | 未启用 |
| provider bundle 中的 `lossless-json` | `4.3.3` |
| provider bundle 中的 `eventsource-parser` | `3.1.1` |

## 四项检查的验证范围

| 入口 | 断言 |
|---|---|
| `textVideoSmoke` | Core 的 `startAsset` 和 `waitForAsset` 可以运行；序列化后的回执通过一次 GET 恢复；H3 的非安全整数种子保留为精确十进制字符串。 |
| `multipartBlobSmoke` | 原生 Blob 字节经过 FormData 序列化和 `Request.formData()` 解析后保持不变，并生成 multipart 边界。 |
| `renderEventsSmoke` | `eventsource-parser` 和原生 TextDecoderStream 可解析跨字节块拆分的 SSE 事件；恢复请求头得以保留，且不会重连。 |
| `signedUploadSmoke` | 签名 PUT 保留二进制数据和带引号的 ETag；API 凭据不会进入存储请求；原生请求处理使用 manual 重定向模式。 |

每个模拟 fetch 都先使用 workerd 原生 `Request` 验证请求。这一点很重要，因为 workerd 拒绝 `redirect: 'error'`；共享传输层实际使用 `manual` 模式，并自行拒绝不允许的重定向。模拟响应不能掩盖该请求初始化错误。

预期结果是四条 `[ PASS ]` 和退出状态 0。这是在模拟 HTTP 条件下的本地运行时兼容性验证，不是 Viggle 实际服务验收、Cloudflare 部署验收，也不保证所有兼容日期和打包配置都可用。长时间任务调度和回执持久化仍由应用负责。

在应用 Worker 中，请显式传入账户绑定：`createViggleProvider({ apiKey: env.VIGGLE_API_KEY })`。夹具使用显式模拟密钥，不会配置生产凭据或测试真实账户。
