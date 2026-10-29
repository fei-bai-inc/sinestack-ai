# Publishing `@sinestack/ai-*`

SineStack AI publishes six synchronized packages in topological dependency order:

1. `@sinestack/ai-provider` — versioned `AssetModelV1` contracts, results, operations, and optional mapping interfaces.
2. `@sinestack/ai-provider-utils` — shared JSON/URL validation, transport helpers, and default asset result mapping.
3. `@sinestack/ai-core` — asset lifecycle orchestration, kind facades, resume, and explicit file materialization.
4. `@sinestack/ai-fal` — fal queue adapter.
5. `@sinestack/ai-wavespeed` — WaveSpeed prediction adapter.
6. `@sinestack/ai-replicate` — Replicate prediction adapter.

## Local Release Verification

Run the full release check before publishing:

```bash
npm run verify:release
```

This command runs:

- `npm run verify`: TypeScript project build, declaration and example typecheck, all unit/integration tests, and offline verification of upstream `ai` / `@ai-sdk/*` versions and file hashes (`check:upstream`).
- `npm run test:packages`: packs all six workspaces into `artifacts/`, verifies exact archive file manifests, installs the `.tgz` archives into an isolated temporary consumer outside the workspace, runs a runtime smoke test across all six packages, and typechecks the installed `.d.ts` declarations.
- `npm run release:dry-run`: validates version alignment, internal dependency specifiers, tarball contents, and runs `npm publish --dry-run` for all six packages.

## Version Bumping

All six packages and `package-lock.json` must share the exact same version and internal `@sinestack/ai-*` dependency specifiers:

```bash
npm run version:release -- 0.1.0
```

## GitHub Actions Trusted Publishing (OIDC)

The [`.github/workflows/release.yml`](../.github/workflows/release.yml) workflow publishes from `refs/heads/main` using npm Trusted Publishing (`id-token: write` in the `npm` GitHub environment):

- Each package on `https://www.npmjs.com` is configured with a GitHub Actions Trusted Publisher:
  - **Organization / user**: `fei-bai-inc`
  - **Repository**: `sinestack-ai`
  - **Workflow filename**: `release.yml`
  - **Environment name**: `npm`
- No long-lived publish token (`NPM_TOKEN`) is stored in GitHub Actions secrets; `NODE_AUTH_TOKEN` and `NPM_TOKEN` are cleared for `npm publish` so npm CLI (`>= 11.5.1`) exchanges the GitHub OIDC token directly.
- If a multi-package release fails partway through and is re-triggered, `scripts/publish.mjs` compares the local tarball SHA-512 integrity against the registry (`dist.integrity`) and safely skips already-published packages with identical bytes while aborting on any integrity mismatch.
