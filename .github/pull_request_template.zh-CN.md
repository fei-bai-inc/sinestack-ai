## 改动

[English](https://github.com/fei-bai-inc/sinestack-ai/blob/main/.github/pull_request_template.md) | 简体中文

说明问题、修改范围和兼容性；关联 Issue（如有）。

## 验证

填写实际运行的命令与结果，未验证项明确注明。

- [ ] 行为/边界回归与公开类型检查覆盖本次改动；或说明无需新增测试的原因。
- [ ] `npm run check` 通过。
- [ ] `npm run verify:release` 通过，包含工作区外 tarball 消费者运行。
- [ ] `npm run check:release-version -- origin/main` 通过；受影响包版本及锁文件同步，未随意更新内部依赖。
- [ ] 根文档、包 README、相关协议/迁移文档的中英文版本已同步更新；或说明具体无影响原因。
- [ ] 未包含真实凭据、私人输入、签名 URL，未将 mock 验证描述为真实计费 API 验证。

## 风险与限制

说明破坏性变化、恢复/计费影响、部署或供应商联调的未验证范围；没有则填写“无新增限制”。
