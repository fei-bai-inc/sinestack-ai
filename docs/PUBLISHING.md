# Publishing `@sinestack/ai-*`

English | [简体中文](PUBLISHING.zh-CN.md)

The nine packages have **independent versions**. Only changed packages are published, in dependency order: `@sinestack/ai-provider`, `@sinestack/ai-provider-utils`, `@sinestack/ai-core`, `@sinestack/ai-fal`, `@sinestack/ai-wavespeed`, `@sinestack/ai-replicate`, `@sinestack/ai-tripo`, `@sinestack/ai-meshy`, and `@sinestack/ai-viggle`. An unchanged package keeps its own version and its existing exact dependency pins, even when a newer dependency exists.

## Pull request and version rules

1. Make all changes to `main` through a PR. The branch must include the current `main`, pass `Release version`, `Node 22` and `Node 24`, resolve review conversations, and use **Squash and merge**. Do not push directly, force-push, or delete `main`.
2. Any changed file under `packages/<name>/` requires **that package's** stable version to be strictly newer than the version on the PR base. A shared `tsconfig.base.json` or TypeScript compiler lock change affects all package builds and requires each package to be bumped. Repository-only changes outside those inputs do not require a package bump. New package paths fail the check until their release order and publishing configuration are explicitly added. A registered package whose entire directory is absent from the base tree uses a committed stable initial version and is selected with `isNew: true` and `previousVersion: null`. An existing directory with missing or malformed base metadata still fails; it cannot be treated as a new package. PR checks do not infer major/minor/patch from code; reviewers choose the semver appropriate for each package.

   **Version selection for `0.x`:** backward-compatible fixes, refactors, dependency changes, and additive features increase the patch (`0.1.0` → `0.1.1`); a confirmed incompatible public API, type, or documented behavior change increases the minor (`0.1.0` → `0.2.0`). Assess each package independently. For `1.x` and later, use normal SemVer: patch for compatible fixes, minor for compatible features, and major for breaking changes. If compatibility is uncertain, resolve it before choosing a version; CI only checks that the chosen version increases.
3. Bump only the affected package, for example:

   ```sh
   npm run version:release -- fal 0.1.1
   ```

   The command updates only that package and its workspace lockfile entry. Existing internal dependency pins are **not** automatically updated: an unchanged dependent can keep using the older published version. If a dependent needs the new dependency, update its exact pin, then bump that dependent because its manifest changed. Repeat only for dependents that need updating. After all bumps and pin edits, run `npm install --package-lock-only --ignore-scripts --no-audit --no-fund` and commit `package-lock.json`: npm needs nested lock entries for old pins when the workspace version has advanced. The `core` bump also updates its runtime user-agent; versioning does not rewrite tests. The root workspace version is independent.

4. After another PR merges, update the branch and repeat the check; each changed package's proposed version must still be newer than its own version on `main`. Commit all changed manifests, lockfile and source/test files; a version stamped only in CI is not accepted.
5. After merging, monitor **Publish npm packages**. No package changes means a successful no-op, not a release. A merge starts the workflow but does not guarantee npm publishing succeeded.

Repository checks are defined in [ci.yml](../.github/workflows/ci.yml); branch protection and approval settings are GitHub configuration, not enforced by checked-in files. Maintainers should require `Release version`, `Node 22`, `Node 24`, up-to-date branches, resolved conversations and squash merges, and block direct/force pushes and branch deletion. Require a reviewer when another maintainer is available. A PR targeting a branch other than `main` intentionally fails the release-version check so it cannot satisfy the `main` gate. Ordinary contributor checks use no publishing secrets or OIDC write permission.

## Automatic npm release

[`.github/workflows/release.yml`](../.github/workflows/release.yml) runs on each push to `main`, compares the committed merge tree with the previous commit, verifies package versions and pins, and runs `npm ci` and `npm run verify:release`. It packs all packages for isolated consumer verification, then runs `npm publish --dry-run` only for unpublished changed packages and publishes **only the selected changed packages**. The PR must include the version changes before merge. No version commit, tag, or GitHub Release is created automatically.

Releases are serialized with `queue: max`. GitHub can start queued runs out of merge order; the queue has a maximum of 100 pending runs. Preflight checks each selected package's npm `latest` and target integrity before writing, refusing to move `latest` backward; a prerelease such as npm's `0.0.0-stage` placeholder is compared by SemVer precedence against the stable target. A missing previous `main` version blocks publishing when the package already exists; the previous version can be absent only for an entirely new package. Exact internal dependencies not selected at that exact version must already exist on npm, or the release fails before publishing. Inspect failed and canceled runs: a later unrelated package release does **not** make a failed earlier package release unnecessary.

The `npm` GitHub environment and each package on npm need a Trusted Publisher configured with organization/user `fei-bai-inc`, repository `sinestack-ai`, workflow `release.yml`, and environment `npm`. The workflow grants `id-token: write`; npm CLI >= 11.5.1 is required. No long-lived publish token is used; `NPM_READ_TOKEN` is optional and only used for registry reads.

For a new package, configure a Trusted Publisher before its first automatic release. npm requires the package to exist first. One way to create it is to stage a distinct non-release bootstrap version under a non-`latest` tag, keeping that staged version until the first official version is published: rejecting the only staged version can delete npm's placeholder package and its Trusted Publisher configuration. Never stage the intended release version. npm may set the placeholder `0.0.0-stage` as `latest` until the first stable release is published. A genuinely new repository package has no previous `main` version; this is explicitly distinguished from an existing package whose previous release is missing. Existing packages still require their previous `main` version on npm. All selected packages, including new ones, still pass exact-dependency, target-integrity and latest-tag checks before any writes. OIDC failures must not fall back to a stored publish token.

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

The version check compares the current working tree (including untracked files) with fetched `origin/main`. Run `git fetch origin main` first when that ref is missing or stale. Package README changes count as package changes; root docs, tests and workflow-only changes do not require package bumps unless they change the shared compiler inputs described above.

| Command | Scope | Network / mutation |
| --- | --- | --- |
| `npm run check` | Build, public/example types, behavioral tests, local Markdown links/fences, and the no-key local example | No provider calls; build output only |
| `npm run check:upstream` | Installed dependency versions and registered source hashes | Offline; does not update the baseline |
| `npm run verify:release` | All checks, nine package tarballs, isolated consumer types/runtime/local example, then archive metadata/integrity validation | Consumer installation accesses npm; writes local build artifacts; never publishes |
| `npm run release:dry-run` | Validate existing local archives without a base ref | No registry calls and no `npm publish` invocation |
| `npm run release:dry-run -- --base-ref origin/main` | Select changed packages, compare registry integrity, and run `npm publish --dry-run` for unpublished selected versions | Reads npm; no registry writes; private packages may need read authentication |

Actual publishing is reserved for the committed `main` workflow and OIDC. Passing local verification does not prove registry permissions, remote API entitlements, binary asset quality, or hosting-runtime compatibility. See [contributor requirements](../CONTRIBUTING.md) and each provider's validation boundaries.
