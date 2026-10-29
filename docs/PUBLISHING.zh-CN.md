# 发布 `@sinestack/ai-*`

[English](PUBLISHING.md) | 简体中文

九个包使用**独立版本**。只发布发生变更的包，按依赖顺序依次为：`@sinestack/ai-provider`、`@sinestack/ai-provider-utils`、`@sinestack/ai-core`、`@sinestack/ai-fal`、`@sinestack/ai-wavespeed`、`@sinestack/ai-replicate`、`@sinestack/ai-tripo`、`@sinestack/ai-meshy` 和 `@sinestack/ai-viggle`。未变更的包保留自己的版本和现有的精确依赖固定版本，即使依赖已有更新版本也不改变。

## Pull Request 与版本规则

1. 对 `main` 的所有变更都通过 PR 完成。分支必须包含当前 `main`，通过 `Release version`、`Node 22` 和 `Node 24`，解决审查讨论，并使用 **Squash and merge**。不要直接推送、强制推送或删除 `main`。
2. `packages/<name>/` 下任何文件的变更，都要求**该包**的稳定版本严格高于 PR 基线上的版本。共享的 `tsconfig.base.json` 或 TypeScript 编译器锁定版本变更会影响所有包的构建，因此要求每个包都提升版本。这些输入之外的仓库级变更不要求提升包版本。新的包路径会无法通过检查，直到显式添加其发布顺序和发布配置。对于已注册的包，若其整个目录在基线树中都不存在，则使用已提交的稳定初始版本，并以 `isNew: true` 和 `previousVersion: null` 被选中。已有目录若缺失基线元数据或元数据格式错误，仍会失败；不能将其当作新包。PR 检查不会从代码推断 major/minor/patch；审查者为每个包选择合适的语义版本。

   **`0.x` 的版本选择：**向后兼容的修复、重构、依赖变更和新增功能提升 patch（`0.1.0` → `0.1.1`）；已确认不兼容的公开 API、类型或文档约定行为变更提升 minor（`0.1.0` → `0.2.0`）。逐包独立评估。`1.x` 及以后遵循普通 SemVer：兼容修复提升 patch，兼容功能提升 minor，破坏性变更提升 major。如果兼容性不确定，先解决不确定性再选择版本；CI 只检查所选版本是否递增。
3. 只提升受影响的包，例如：

   ```sh
   npm run version:release -- fal 0.1.1
   ```

   该命令只更新该包及其工作区锁文件条目。现有内部依赖的固定版本**不会**自动更新：未变更的依赖方可以继续使用旧的已发布版本。如果依赖方需要新依赖，则更新其精确固定版本，然后因为其清单已变更而提升该依赖方的版本。仅对需要更新的依赖方重复此过程。完成全部版本提升和依赖固定版本修改后，运行 `npm install --package-lock-only --ignore-scripts --no-audit --no-fund` 并提交 `package-lock.json`：当工作区版本已提升时，npm 需要为旧的固定版本建立嵌套锁条目。`core` 的版本提升还会更新其运行时 user-agent；版本操作不会重写测试。根工作区版本相互独立。

4. 其他 PR 合并后，更新分支并再次检查；每个变更包的拟用版本仍必须高于它自己在 `main` 上的版本。提交所有变更的清单、锁文件和源码/测试文件；不接受仅在 CI 中写入的版本。
5. 合并后，关注 **Publish npm and GitHub releases**。没有包变更意味着成功的无操作，不会产生 npm 或 GitHub 发布。合并会启动工作流，但不能保证任一发布成功。

仓库检查定义于 [ci.yml](../.github/workflows/ci.yml)；分支保护和审批设置属于 GitHub 配置，不能由已检入文件强制执行。维护者应要求 `Release version`、`Node 22`、`Node 24`、分支保持最新、讨论已解决以及 squash 合并，并阻止直接/强制推送和分支删除。有其他维护者可用时应要求审查者。目标分支不是 `main` 的 PR 会有意无法通过发布版本检查，因此不能满足 `main` 的门禁。普通贡献者检查不使用发布密钥或 OIDC 写权限。

## 自动 npm 与 GitHub 发布

[`.github/workflows/release.yml`](../.github/workflows/release.yml) 在每次推送到 `main` 时运行，将已提交的合并树与前一个提交比较，验证包版本和依赖固定版本，并运行 `npm ci` 与 `npm run verify:release`。它会打包所有包用于隔离使用方验证，然后仅对尚未发布的变更包运行 `npm publish --dry-run`，并且**只发布选中的变更包**。npm 批次成功且非空后，后续依赖作业为每个选中的包版本分别发布一个 GitHub Release。PR 必须在合并前包含版本变更；工作流绝不自动创建版本提交。仅修改此发布自动化的仓库级变更不要求提升包版本。

发布通过 `queue: max` 串行执行。GitHub 可能不按合并顺序启动排队运行；队列最多有 100 个待运行任务。预检会在写入前检查每个选中包的 npm `latest` 和目标完整性，拒绝让 `latest` 回退；像 npm 的 `0.0.0-stage` 占位版本这样的预发布版本，会按照 SemVer 优先级与稳定目标版本比较。当包已存在时，若之前的 `main` 版本缺失，则阻止发布；只有全新的包才允许不存在之前的版本。未以对应精确版本被选中的内部依赖，必须已在 npm 上存在，否则发布会在写入前失败。检查失败和已取消的运行：之后无关包的发布**不会**使之前失败的包发布变得不再必要。

GitHub 的 `npm` 环境以及 npm 上的每个包都需要配置 Trusted Publisher：组织/用户为 `fei-bai-inc`，仓库为 `sinestack-ai`，工作流为 `release.yml`，环境为 `npm`。npm 作业授予 `contents: read` 和 `id-token: write`；要求 npm CLI >= 11.5.1。不使用长期发布令牌；`NPM_READ_TOKEN` 是可选的，仅用于读取注册表。只有后续的 GitHub 发布作业授予 `contents: write`，并使用自动提供的 `github.token`；无需另设长期 GitHub 令牌。

新包必须在首次自动发布前配置 Trusted Publisher。npm 要求包先存在。一种创建方式是以非 `latest` 标签暂存一个独立的、非正式发布的引导版本，并保留该暂存版本直到首个正式版本发布：拒绝唯一的暂存版本可能导致 npm 的占位包及其 Trusted Publisher 配置被删除。绝不要暂存计划正式发布的版本。在首个稳定版本发布之前，npm 可能将占位版本 `0.0.0-stage` 设为 `latest`。真正的新仓库包没有之前的 `main` 版本；这一情况与已有包缺失之前发布版本的情况明确区分。已有包仍要求其之前的 `main` 版本已在 npm 上存在。所有选中的包（包括新包）仍必须在任何写入前通过精确依赖、目标完整性和 latest 标签检查。OIDC 失败时不得回退到存储的发布令牌。

### 发布回执与 GitHub 附件

工作流向 `npm run release:publish` 传入 `--receipt artifacts/published.json`。CLI 在尝试发布前清除旧回执，只有所有选中包均已发布，或其现有 npm tarball 完整性已验证后，才写入新回执。npm 批次失败时不会留下成功回执，即使部分包已发布。无变更运行写入 `{ "schemaVersion": 1, "packages": [] }`，不会执行任何 GitHub 写入。

非空批次的回执记录仓库 URL、干净源码的提交及树、npm 访问级别和 dist-tag，以及每个选中包的名称、版本、tarball 文件名、字节数、SHA-256 和 npm 完整性值。GitHub 作业使用 npm 作业保存的回执与产物，而不重新计算包选择。在任何 GitHub 发布之前，会验证所有选中的本地产物、回执、打包清单及检出的源码；实际发布拒绝脏工作树。

每个选中的包版本都有独立的 Release。例如，npm 包 `@sinestack/ai-core@0.1.4` 使用标签 `ai-core@0.1.4`（仅移除固定的 `@sinestack/` scope），标题则使用完整 npm 包版本标识 `@sinestack/ai-core@0.1.4`。版本与该包的 npm 版本完全一致，不采用根版本或源码 SHA。不同包即使版本号相同，也分别创建 Release。同一批次的所有标签均指向回执中记录的同一个源码提交。

每个 Release **恰好有两个附件**：该包的 `.tgz` 和 `manifest.json`。后者是确定性 JSON，沿用发布回执的结构及源码/npm 数据，但 `packages` 仅包含该 Release 对应的一个包；它既不是完整批次回执，也不是包含全部包的打包清单。每个 Release 首先以草稿创建，只有两个上传均通过大小和 SHA-256 验证后才公开。不完整的草稿保持未发布状态。

当包的 npm 版本包含 `-`，或回执中的 npm dist-tag 不是 `latest` 时，该包的 Release 标记为预发布。创建和公开发布均使用 `make_latest: 'false'`，避免独立包争夺 GitHub 仓库级 Latest 标识。请使用 npm dist-tag 选择某个包的当前版本。此工作流不会转换或自动修改历史 Release。

### 失败与恢复

- 使用 **Re-run failed jobs** 重试失败的 **main push run**。沿用相同提交和选中的版本。已在 npm 上的包仅在其 tarball 完整性匹配时才会跳过；不匹配会在任何写入前中止，并要求在新 PR 中使用新版本。
- 如果某个选中包现在已有更新的 `latest`，其旧运行会失败，而不会回滚标签。确认较新的包发布包含了之前的变更。其他选中包可能仍需新的版本化 PR；不要假设后续无关运行已经发布了它们。
- 如果选中包的精确内部依赖在 npm 上缺失，先修复并重试之前失败的依赖发布，再重试依赖方发布。如果队列已满，被取消的运行也需要处理。
- 如果 npm 已成功但后续 GitHub 作业失败，使用 **Re-run failed jobs**，仅以保存的回执和 tarball 重试 GitHub 作业。不要为了修复 GitHub 步骤重新发布 npm 或重新构建不同归档；保留重试所需的工作流产物。
- GitHub Release 按现有包依赖顺序处理。若后面的包失败，前面已完成的 Release 保持公开，当前未完成的 Release 保持草稿，后续包不受操作。重跑时只读验证匹配的已发布 Release，继续失败的草稿，再创建剩余包的 Release。
- GitHub 重试复用各包版本的标签和匹配的草稿。匹配的已上传附件会被复用；仅在草稿中，才允许删除并重试处于 starter/open 状态的不完整零字节附件。标签目标、源码身份或附件内容冲突会直接失败，不会覆盖，需要维护者调查。完整且匹配的已发布 Release 是只读无操作；已发布 Release 缺少附件时直接失败，而不修改该 Release。

## 本地验证

```sh
npm ci
npm run check:release-version -- origin/main
npm run verify:release
```

版本检查将当前工作树（包括未跟踪文件）与已获取的 `origin/main` 比较。如果该引用缺失或过期，先运行 `git fetch origin main`。包 README 变更算作包变更；根文档、测试和仅工作流的变更不要求提升包版本，除非改变了上述共享编译器输入。

| 命令 | 范围 | 网络 / 修改 |
| --- | --- | --- |
| `npm run check` | 构建、公开/示例类型、行为测试、本地 Markdown 链接/代码围栏及无需密钥的本地示例 | 不调用提供方；只产生构建输出 |
| `npm run check:upstream` | 已安装依赖版本和已登记的源码哈希 | 离线；不更新基线 |
| `npm run verify:release` | 全部检查、九个包的 tarball、隔离使用方类型/运行时/本地示例，然后验证归档元数据/完整性 | 使用方安装访问 npm；写入本地构建产物；绝不发布 |
| `npm run release:dry-run` | 不提供基线引用时，验证已有本地归档 | 不调用注册表，也不调用 `npm publish` |
| `npm run release:dry-run -- --base-ref origin/main` | 选择变更包、比较注册表完整性，并对尚未发布的选中版本运行 `npm publish --dry-run` | 读取 npm；不写入注册表；私有包可能需要读取认证 |
| `npm run release:github -- --dry-run` | 验证保存的发布回执、打包清单、所有选中的 tarball 和源码身份；为每个包返回一个计划，包含其标签、标题、说明和两个附件（无包时返回空数组） | 离线；无需令牌；不写入 npm 或 GitHub |

`release:github` 运行 `node scripts/github-release.mjs`；默认产物目录为 `artifacts`（可用 `--artifacts <directory>` 覆盖）。执行 GitHub dry-run 时，获取成功 npm 作业保存的 `published.json`、打包清单 `manifest.json` 及 tarball，并检出相同源码提交。单独运行 `npm run verify:release` 不会生成发布回执。不带 `--dry-run` 时，此命令会写入 GitHub，要求 `GH_TOKEN` 或 `GITHUB_TOKEN`；工作流提供自动令牌。

实际发布应在已提交的 `main` 工作流中执行：npm 使用 OIDC，后续 GitHub 作业使用限定权限的令牌。本地验证通过不能证明注册表权限、GitHub 发布权限、远程 API 权限、二进制资产质量或宿主运行时兼容性。参见[贡献者要求](../CONTRIBUTING.zh-CN.md)以及各提供方的验证边界。
