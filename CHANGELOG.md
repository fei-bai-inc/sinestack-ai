# Changelog

English | [简体中文](CHANGELOG.zh-CN.md)

The npm packages in this repository are independently versioned. This file records actual changes; `Unreleased` does not mean published. See [PUBLISHING.md](docs/PUBLISHING.md) for the release procedure.

## Unreleased

### Package changes

- `@sinestack/ai-meshy` `0.1.2`: provide named provider/resource/response/start/delete contracts for portable declarations with independent dependency versions. Required headers, task IDs, and generic results are preserved without changing requests or billing behavior.
- `@sinestack/ai-core`, `@sinestack/ai-provider`, and `@sinestack/ai-provider-utils` `0.1.4`, plus `@sinestack/ai-tripo` `0.1.3`: document installation, API usage, recovery, and the latest error/transport interfaces. Core's request User-Agent version is synchronized.
- `@sinestack/ai-fal`, `@sinestack/ai-wavespeed`, and `@sinestack/ai-replicate` `0.1.1`: document npm-consumer usage, native parameters, and cancellation/deletion limits.
- `@sinestack/ai-viggle` `0.1.1`: add usage-oriented English/Chinese onboarding and a Chinese technical guide for video, images, character/motion resources, exports, and scenes.
- Meshy package documentation is also expanded. Exact internal dependencies retain their compatible versions instead of being upgraded just for documentation changes.
- English is the default for all nine package READMEs. Complete Chinese counterparts and npm-safe language links are provided; `README.zh-CN.md` is included in each tarball. These changes remain in the unreleased versions above.

### Repository quality and workflows

- Publish one GitHub Release per selected npm package version after the entire npm batch succeeds. Use the exact npm version, unscoped package-version tags such as `ai-core@0.1.4`, full npm-spec titles such as `@sinestack/ai-core@0.1.4`, and exactly two attachments: that package's tarball and a single-package `manifest.json` retaining the receipt's source/npm data. Distinct packages remain separate even when versions coincide; tags from one batch share its source commit. Disable repository-global Latest promotion with `make_latest: 'false'`; use npm dist-tags instead. Preserve npm receipt gating, separate npm OIDC and GitHub token permissions, and verify draft assets before publication. Process releases in dependency order: earlier releases remain public if a later package fails, and integrity-checked retries reuse matching published releases read-only, resume the failed draft, and create remaining releases without republishing npm. Add offline per-package release plans and bilingual recovery guidance; historical releases are not automatically converted or modified. This repository-only automation change does not bump package versions.
- Center the bilingual README on the general-purpose asynchronous generation/task model, public extension contracts, and a custom task's submission/persistence/recovery flow. Present provider integrations as implementations of this foundation; align core, provider, and architecture introductions.
- Add contribution/security guidance, a PR checklist, and a bug-report template while retaining independent versions and the existing automatic release workflow.
- Make root documents and technical guides English-first, with complete `*.zh-CN.md` counterparts and reciprocal language navigation. Contributor templates default to English with Chinese alternatives.
- Include local Markdown link/fence validation and the keyless example in `check`. Resolve links to this repository's GitHub `main` files locally. The external tarball smoke also runs the actual TypeScript example and verifies bilingual README inclusion.
- Add regressions for task identity on recovery, abort after acceptance, cancellation races, failing observers, idempotent retries, empty control responses, invalid request bodies, explicit file materialization, and Meshy independently installed types.
- Remove brittle assertions that only fixed branding, forwarding, or the current version. Version scripts no longer read or rewrite integration-test source.
- Synchronize with main commit `c82b640` (Viggle integration), preserving its native error diagnostics, extensible/raw transport, SSE, signed upload behavior, and nine-package consumer checks. Update bilingual guidance and include the workerd smoke instructions in both languages.

Provider requests in automated checks are mocked. The separate [Viggle workerd smoke](tests/workerd/README.md) exercises a real local Worker runtime; it does not establish live API, asset-content, or deployed Cloudflare behavior.
