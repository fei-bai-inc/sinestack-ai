# Contributing

[English](CONTRIBUTING.md) | 简体中文

本仓库使用 npm workspaces、TypeScript 和 Node 内置测试运行器。改动通过 PR 合入 `main`；不需要供应商 API key，也不要在普通测试中创建计费任务。

## 本地开发

使用 Node.js 22 或 24、npm 10 或更新版本；CI 在 Node 22/24 上运行同一套检查。正式 npm 发布的 CLI 要求见 [PUBLISHING.md](docs/PUBLISHING.zh-CN.md)。

使用 SDK 的 TypeScript 应用采用 ESM 和 `NodeNext` 模块解析，安装 `@types/node`，并在 TypeScript 6 的 `compilerOptions.types` 中包含 `node`。启用 `skipLibCheck: false` 时，当前上游声明还需要 `@types/json-schema`。包的兼容目标为 Node 22/24。[运行时固定样例](tests/workerd/README.zh-CN.md) 记录了四项使用模拟 HTTP 的真实 workerd Viggle/core 检查；这不是 Cloudflare 部署或所有 provider 的验证。浏览器、Deno 和 Bun 运行仍未验证。

```sh
npm ci
npm run check
```

`check` 包括构建、公开类型及示例类型检查、行为测试、本地 Markdown 文件链接检查，以及无 key 的自定义 provider 示例运行。它不访问供应商 API。安装依赖、打包后的消费者安装和带 base ref 的 npm dry-run 需要访问 npm registry。

按改动运行单个测试：

```sh
npm run build
node --test tests/task-runtime.test.mjs
```

提交前运行完整消费者检查，并相对最新的 `origin/main` 检查版本：

```sh
npm run verify:release
npm run check:release-version -- origin/main
```

如果本地没有最新的 `origin/main`，先 `git fetch origin main`。`verify:release` 只验证，不发布；带 `--base-ref` 的发布 dry-run 与真实发布是独立步骤。完整说明见 [发布流程](docs/PUBLISHING.zh-CN.md)。

## 改动与测试要求

- 复用 [共享执行机制](docs/ARCHITECTURE.zh-CN.md)。Provider 只完成单次协议操作，不另写 polling/retry/abort 引擎。
- 修复 bug 时添加能捕获原问题的行为回归；新增能力覆盖输入/结果边界、终态、恢复身份、失败路径及类型约束。
- 测试使用明确的假凭据和注入的 transport，不依赖环境中的真实 key，不访问计费 API。不要把 mock 契约验证描述为真实供应商联调。
- 断言用户可见的结果、错误、状态转移和是否重复提交；不要用源码字符串、文案、包数量或函数存在性替代行为验证。
- 正向和负向类型用例放在 `tests/*.test-d.ts`；发布后消费者的公开类型/运行场景放在 `tests/package-consumer/`。这里的导入必须来自包入口，不依赖工作区源码路径。
- 修改示例时保留服务端凭据边界。除明确标为本地示例的文件外，导入模块不应创建计费任务。

## 文档与版本

文档按当前结构维护，不另外建立平行规范：

- [README](README.zh-CN.md)：通用生成/任务模型、扩展协议、生命周期用法和导航。先介绍共享模型，再将 provider 包作为具体实现介绍。
- `packages/*/README.md`：npm 包用户入口；跳往仓库的链接用完整 URL。
- `docs/TRIPO.zh-CN.md`、`docs/MESHY.zh-CN.md`、`docs/VIGGLE.zh-CN.md`、`docs/MEDIA_PROVIDERS.zh-CN.md`：供应商参数与行为边界。
- [ARCHITECTURE](docs/ARCHITECTURE.zh-CN.md)：执行契约；[UPSTREAM](docs/UPSTREAM.zh-CN.md)：上游来源及升级要求。
- [PUBLISHING](docs/PUBLISHING.zh-CN.md)：唯一版本与发布操作规范；[MIGRATION](docs/MIGRATION.zh-CN.md)：历史兼容迁移。
- [CHANGELOG](CHANGELOG.zh-CN.md)：按包记录未发布改动，不把已通过检查当作已发布。

现有文件名默认使用英文；完整简体中文副本放在同目录的 `*.zh-CN.md`，标题下提供双向语言链接。每次 PR 同步更新两种语言，保持 API 标识、命令、示例和验证边界一致。有对应译本时，导航链接应保持所选语言。包 README 的语言链接使用完整仓库 URL，每个 npm tarball 都包含 `README.zh-CN.md`。LICENSE 和 NOTICE 保持原始法律文本，不另作译本替代。

PR 中同步更新受影响的文档；无影响时说明原因。区分已实现、mock 验证和真实 API 验证，不写未运行的结果。`check:docs` 检查本地文件目标和代码围栏；指向本仓库 GitHub `main` 文件的完整链接会在当前检出目录内解析，因此 npm 页面中的语言链接也无需联网即可检查。它不验证其他外部 URL、标题锚点、翻译准确性或示例语义；示例还需要类型检查与运行验证。

任何 `packages/<name>/` 内的改动（包括两种语言的 README）都按现有独立版本规则升版。包间精确依赖不自动追新，不为无关包强制统一版本。使用 `version:release` 后按 [PUBLISHING](docs/PUBLISHING.zh-CN.md) 更新锁文件。测试、根文档与仓库流程的独立改动不需要包升版。

## 提交问题与安全报告

普通问题使用 [GitHub Issues](https://github.com/fei-bai-inc/sinestack-ai/issues)，提供包版本、Node 版本、最小复现、预期/实际结果，以及脱敏后的错误。供应商返回可能包含签名 URL、输入内容和账号信息，不要直接粘贴完整日志。默认问题表单使用英文，并链接到中文表单。

安全问题遵循 [SECURITY.md](SECURITY.zh-CN.md)，不要公开提交密钥、可利用细节或私人数据。
