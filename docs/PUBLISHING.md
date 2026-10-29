# Publishing `@sinestack/ai-*`

The seven packages have **independent versions**. Only changed packages are published, in dependency order: `@sinestack/ai-provider`, `@sinestack/ai-provider-utils`, `@sinestack/ai-core`, `@sinestack/ai-fal`, `@sinestack/ai-wavespeed`, `@sinestack/ai-replicate`, and `@sinestack/ai-tripo`. An unchanged package keeps its own version and its existing exact dependency pins, even when a newer dependency exists.

## Pull request and version rules

1. Make all changes to `main` through a PR. The branch must include the current `main`, pass `Release version`, `Node 22` and `Node 24`, resolve review conversations, and use **Squash and merge**. Do not push directly, force-push, or delete `main`.
2. Any changed file under `packages/<name>/` requires **that package's** stable version to be strictly newer than the version on the PR base. A shared `tsconfig.base.json` or TypeScript compiler lock change affects all package builds and requires each package to be bumped. Repository-only changes outside those inputs do not require a package bump. New package paths fail the check until their release order and publishing configuration are explicitly added. PR checks do not infer major/minor/patch from code; reviewers choose the semver appropriate for each package.

   **Version selection for `0.x`:** backward-compatible fixes, refactors, dependency changes, and additive features increase the patch (`0.1.0` → `0.1.1`); a confirmed incompatible public API, type, or documented behavior change increases the minor (`0.1.0` → `0.2.0`). Assess each package independently. For `1.x` and later, use normal SemVer: patch for compatible fixes, minor for compatible features, and major for breaking changes. If compatibility is uncertain, resolve it before choosing a version; CI only checks that the chosen version increases.
3. Bump only the affected package, for example:

   ```sh
   npm run version:release -- fal 0.1.1
   ```

   The command updates only that package and its workspace lockfile entry. Existing internal dependency pins are **not** automatically updated: an unchanged dependent can keep using the older published version. If a dependent needs the new dependency, update its exact pin, then bump that dependent because its manifest changed. Repeat only for dependents that need updating. After all bumps and pin edits, run `npm install --package-lock-only --ignore-scripts --no-audit --no-fund` and commit `package-lock.json`: npm needs nested lock entries for old pins when the workspace version has advanced. The `core` bump also updates its user-agent and integration assertion. The root workspace version is independent.

4. After another PR merges, update the branch and repeat the check; each changed package's proposed version must still be newer than its own version on `main`. Commit all changed manifests, lockfile and source/test files; a version stamped only in CI is not accepted.
5. After merging, monitor **Publish npm packages**. No package changes means a successful no-op, not a release. A merge starts the workflow but does not guarantee npm publishing succeeded.

The active `protect main` ruleset requires PRs and all three checks from GitHub Actions, with strict up-to-date status, resolved conversations, no bypass actors, and squash merge. It blocks deletion and force pushes. Only one collaborator was available when this was configured, so approval is a team practice rather than an enforced review count; enable at least one approval when another reviewer is available. `Release version` is already required during bootstrap: existing PRs must merge or rebase the bootstrap commit. A PR targeting a different branch fails this check intentionally so an earlier check cannot satisfy the `main` gate.

## Automatic npm release

[`.github/workflows/release.yml`](../.github/workflows/release.yml) runs on each push to `main`, compares the committed merge tree with the previous commit, verifies package versions and pins, and runs `npm ci` and `npm run verify:release`. It packs all packages for isolated consumer verification, then runs `npm publish --dry-run` only for unpublished changed packages and publishes **only the selected changed packages**. The PR must include the version changes before merge. No version commit, tag, or GitHub Release is created automatically.

Releases are serialized with `queue: max`. GitHub can start queued runs out of merge order; the queue has a maximum of 100 pending runs. Preflight checks each selected package's npm `latest` and target integrity before writing, refusing to move `latest` backward. A missing previous `main` version blocks publishing when the package already exists; the previous version can be absent only for an entirely new package. Exact internal dependencies not selected at that exact version must already exist on npm, or the release fails before publishing. Inspect failed and canceled runs: a later unrelated package release does **not** make a failed earlier package release unnecessary.

The `npm` GitHub environment and each package on npm need a Trusted Publisher configured with organization/user `fei-bai-inc`, repository `sinestack-ai`, workflow `release.yml`, and environment `npm`. The workflow grants `id-token: write`; npm CLI >= 11.5.1 is required. No long-lived publish token is used; `NPM_READ_TOKEN` is optional and only used for registry reads.

For a new package, configure a Trusted Publisher before its first automatic release. npm requires the package to exist first; create a non-release bootstrap version and ensure the previous `main` version is available before merging. Do not use the intended release version as the bootstrap version. `@sinestack/ai-tripo@0.1.0` is the published baseline for the first automated Tripo release. OIDC failures must not fall back to a stored publish token.

### Failure and recovery

- Retry the failed **main push run** with **Re-run failed jobs**. The same commit and selected versions are used. A package already on npm is skipped only if its tarball integrity matches; a mismatch aborts before any writes and requires a new version in a new PR.
- If a selected package now has a newer `latest`, its older run fails rather than rolling back the tag. Verify that the newer package release contains the earlier changes. Other selected packages may still need a new versioned PR; do not assume an unrelated later run published them.
- If a selected package's exact internal dependency is missing from npm, first fix and retry the earlier failed dependency release, then retry the dependent release. If the queue is full, a canceled run also needs attention.

## Local verification

```sh
npm ci
npm run check:release-version -- origin/main
npm run verify:release
```

The first check compares the current tree with fetched `origin/main`. `verify:release` builds and typechecks, runs tests and upstream checks, packs all seven workspaces, installs them into an isolated consumer and executes that consumer, including Tripo. It does not publish. To dry-run unpublished changed packages, use `npm run release:dry-run -- --base-ref origin/main` after `verify:release`; it queries npm and may require authentication for private packages. Actual publish uses the committed `main` tree and OIDC.
