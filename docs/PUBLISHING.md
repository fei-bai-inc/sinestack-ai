# Publishing `@sinestack/ai-*`

SineStack AI publishes seven synchronized packages in topological dependency order:

1. `@sinestack/ai-provider` — versioned Asset/TaskDriver contracts, domain interfaces, results, operations, and optional mapping interfaces.
2. `@sinestack/ai-provider-utils` — shared JSON/URL validation, transport helpers, and default asset result mapping.
3. `@sinestack/ai-core` — shared task lifecycle, independent domain facades, legacy asset compatibility, resume, and explicit file materialization.
4. `@sinestack/ai-fal` — fal queue adapter.
5. `@sinestack/ai-wavespeed` — WaveSpeed prediction adapter.
6. `@sinestack/ai-replicate` — Replicate prediction adapter.
7. `@sinestack/ai-tripo` — Tripo v3 generation, model processing, rigging, animation, and resource APIs.

## Local Release Verification

Run the full release check before publishing:

```bash
npm run verify:release
```

This command runs:

- `npm run verify`: TypeScript project build, declaration and example typecheck, all unit/integration tests, offline verification of upstream `ai` / `@ai-sdk/*` versions and file hashes (`check:upstream`), and packing all seven workspaces into `artifacts/`.
- `npm run test:packages`: verifies tarball integrity, installs the `.tgz` archives into an isolated temporary consumer outside the workspace, runs runtime smoke tests across all seven packages, and typechecks the installed `.d.ts` declarations. Tripo smoke tests cover generation, processing, checks, rigging, animation and task resume without real API calls.
- `npm run release:dry-run`: validates version alignment, internal dependency specifiers, tarball contents, and runs `npm publish --dry-run` for all seven packages.

The npm CLI can reject a dry-run when that package version already exists. For verification of an
already published source version, use a disposable worktree/CI checkout, stamp a unique unused
prerelease with `npm run version:release -- <version>`, run `npm run verify` and `npm run test:packages`,
then `node scripts/publish.mjs --dry-run --tag next`. This does not publish, and the temporary version
must not be committed back as part of a rename-only change. Do not disable the real release integrity
checks or treat a published version as overwriteable.

## Version Bumping

All seven packages and `package-lock.json` must share the exact same version and internal `@sinestack/ai-*` dependency specifiers:

```bash
npm run version:release -- <new-unpublished-version>
```

The versioned User-Agent lives in `packages/core/src/internal/runtime.ts`. The version script and
publish dirty-file allowlist target that file, not the legacy Asset compatibility boundary.
Package and repository renames do not change the v1 persisted task discriminator `sine-ai-task`.

## GitHub Actions Trusted Publishing (OIDC)

The [`.github/workflows/release.yml`](../.github/workflows/release.yml) workflow publishes from `refs/heads/main` using npm Trusted Publishing (`id-token: write` in the `npm` GitHub environment):

- Each package on `https://www.npmjs.com` needs a GitHub Actions Trusted Publisher configured for:
  - **Organization / user**: `fei-bai-inc`
  - **Repository**: `sinestack-ai`
  - **Workflow filename**: `release.yml`
  - **Environment name**: `npm`
- The new `@sinestack/ai-tripo` package needs its own Trusted Publisher configuration before a real release; code changes do not create npm-side settings.
- No long-lived publish token (`NPM_TOKEN`) is required; `NODE_AUTH_TOKEN` and `NPM_TOKEN` are cleared for `npm publish` so npm CLI (`>= 11.5.1`) uses GitHub OIDC.
- If a multi-package release fails partway through and is re-triggered, `scripts/publish.mjs` compares the local tarball SHA-512 integrity against the registry (`dist.integrity`) and safely skips already-published packages with identical bytes while aborting on any integrity mismatch.

For validation without publication, dispatch the existing workflow on the feature branch with
`dry_run: true` and a new unpublished version. No npm credentials or production publication are
required for the dry-run itself; GitHub environment approval may still apply.
