# Changelog

[English](CHANGELOG.md) | 简体中文

本仓库各 npm 包独立版本。这里只记录实际变更；`Unreleased` 不表示已发布，发布流程见 [PUBLISHING.md](docs/PUBLISHING.zh-CN.md)。

## Unreleased

### 包变更

- `@sinestack/ai-meshy` `0.1.2`：提供具名 provider/resource/response/start/delete 契约，使声明适用于独立依赖版本。保留必选 headers、任务 ID 与泛型结果，不改变请求或计费行为。
- `@sinestack/ai-core`、`@sinestack/ai-provider`、`@sinestack/ai-provider-utils` `0.1.4` 以及 `@sinestack/ai-tripo` `0.1.3`：完善安装、接口用法、恢复和最新错误/传输接口文档。core 同步请求 User-Agent 版本。
- `@sinestack/ai-fal`、`@sinestack/ai-wavespeed`、`@sinestack/ai-replicate` `0.1.1`：补齐 npm 消费者用法、原生参数和取消/删除限制。
- `@sinestack/ai-viggle` `0.1.1`：补齐面向使用者的中英文入门文档及中文技术指南，介绍视频、图像、角色/动作资源、导出和场景能力。
- Meshy 包文档同步完善；各包内部精确依赖保持原兼容版本，不因文档改动强制追新。
- 九个包 README 默认使用英文，提供完整中文副本及适用于 npm 的语言链接，每个 tarball 包含 `README.zh-CN.md`；对应上述尚未发布的版本。

### 仓库质量与流程

- 整个 npm 批次成功后，为每个选中的 npm 包版本分别发布一个 GitHub Release。版本与 npm 完全一致，使用 `ai-core@0.1.4` 这样的无 scope 包版本标签，以及 `@sinestack/ai-core@0.1.4` 这样的完整 npm 包版本标题；每个 Release 恰好包含该包的 tarball 和保留回执源码/npm 数据的单包 `manifest.json` 两个附件。不同包即使版本号相同也分别发布；同批次标签指向同一源码提交。通过 `make_latest: 'false'` 禁止提升为仓库级 Latest，改用 npm dist-tag 选择包版本。保留 npm 成功回执门禁，分离 npm OIDC 与 GitHub 令牌权限，并在公开草稿前验证附件。按依赖顺序处理 Release：后面的包失败时，前面的 Release 保持公开；经完整性校验的重试只读复用匹配的已发布 Release、继续失败的草稿并创建剩余 Release，无需重新发布 npm。新增逐包离线发布计划与双语恢复说明，不自动转换或修改历史 Release。此仓库级自动化变更不提升包版本。
- 中英文 README 以通用异步生成/任务模型、公开扩展协议和自定义任务的提交/持久化/恢复流程为主线；provider 接入作为这套基础的具体实现，并同步 core、provider 和架构介绍。
- 增加贡献、安全报告、PR 检查清单与问题模板，沿用已有独立版本和自动发布流程。
- 根文档与技术指南默认使用英文，提供完整 `*.zh-CN.md` 副本及双向语言导航；贡献模板默认英文并提供中文选项。
- `check` 纳入本地 Markdown 链接/围栏检查与无 key 示例运行，指向本仓库 GitHub `main` 文件的链接在本地校验；工作区外 tarball smoke 同时运行实际 TypeScript 示例并验证双语 README 已打包。
- 补充任务恢复身份、受理后中止、取消竞争、失败观察回调、幂等重试、空控制响应、非法请求体和显式文件物化回归，以及 Meshy 独立安装类型检查。
- 删除只锁品牌文案、函数转发及当前版本的脆弱断言；版本脚本不再读取或改写集成测试源码。
- 同步 main 提交 `c82b640`（Viggle 接入），保留原生错误诊断、可扩展/原始响应传输、SSE、签名上传和九包消费者验证；更新双语说明，并提供中英文 workerd 验证指南。

自动化检查中的供应商请求使用 mock。独立的 [Viggle workerd 验证](tests/workerd/README.zh-CN.md) 在真实本地 Worker 运行时执行，不代表真实 API、资产内容或已部署 Cloudflare 环境的验收。
