## Changes

English | [简体中文](https://github.com/fei-bai-inc/sinestack-ai/blob/main/.github/pull_request_template.zh-CN.md)

Describe the problem, scope, and compatibility impact. Link an issue if applicable.

## Verification

List commands actually run and their results. Explicitly identify anything unverified.

- [ ] Behavioral/boundary regressions and public type checks cover the change, or explain why no new test is needed.
- [ ] `npm run check` passes.
- [ ] `npm run verify:release` passes, including tarball consumers outside the workspace.
- [ ] `npm run check:release-version -- origin/main` passes; affected package versions and the lockfile match, without unnecessary internal dependency updates.
- [ ] Root docs, package READMEs, and relevant protocol/migration guides are updated in both English and Chinese, or a specific no-impact reason is provided.
- [ ] No real credentials, private inputs, or signed URLs are included. Mock verification is not presented as live billable-API verification.

## Risks and limitations

Describe breaking changes, recovery/billing impact, and unverified deployment/provider integration. Write “No new limitations” if none apply.
