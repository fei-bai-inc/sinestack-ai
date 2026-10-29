# Contributing

English | [简体中文](CONTRIBUTING.zh-CN.md)

This repository uses npm workspaces, TypeScript, and Node's built-in test runner. Changes reach `main` through pull requests. Ordinary tests need no provider API keys and must not create billable tasks.

## Local development

Use Node.js 22 or 24 and npm 10 or later. CI runs the same checks on Node 22/24. The npm CLI requirement for actual publishing is documented in [PUBLISHING.md](docs/PUBLISHING.md).

For a TypeScript application using the SDK, use ESM and `NodeNext` module resolution. Install `@types/node` and include `node` in `compilerOptions.types` with TypeScript 6. Projects with `skipLibCheck: false` also need `@types/json-schema` for the current upstream declarations. The package compatibility target is Node 22/24. Four Viggle/core checks in real workerd with mocked HTTP are recorded in the [runtime fixture](tests/workerd/README.md); this is not Cloudflare deployment or all-provider verification. Browser, Deno, and Bun execution remain unverified.

```sh
npm ci
npm run check
```

`check` includes the build, public/example type checks, behavioral tests, local Markdown file links, and the keyless custom-provider example. It does not contact provider APIs. Dependency installation, installed tarball consumers, and npm dry-runs with a base ref need npm registry access.

Run an individual test for a scoped change:

```sh
npm run build
node --test tests/task-runtime.test.mjs
```

Before submitting, run the complete consumer checks and compare package versions with the latest `origin/main`:

```sh
npm run verify:release
npm run check:release-version -- origin/main
```

Run `git fetch origin main` first if that ref is missing or stale. `verify:release` verifies only; it never publishes. A publishing dry-run with `--base-ref` and actual publication are separate steps. See the [publishing workflow](docs/PUBLISHING.md).

## Changes and test requirements

- Reuse the [shared execution mechanism](docs/ARCHITECTURE.md). Providers perform single protocol operations, not separate polling/retry/abort engines.
- Bug fixes should include a behavioral regression that catches the original problem. New capabilities should cover input/result boundaries, terminal states, recovery identity, failure paths, and type constraints.
- Use explicit fake credentials and injected transports. Tests must not depend on real keys in the environment or call billable APIs. Do not describe mock contract verification as live provider acceptance.
- Assert consumer-visible results, errors, state transitions, and whether a task is resubmitted. Source strings, wording, package counts, and function-existence checks are not substitutes for behavior.
- Put positive/negative type cases in `tests/*.test-d.ts`; installed-consumer public type/runtime cases belong in `tests/package-consumer/`. Those consumers must import public package entry points, not workspace source paths.
- Keep example credentials server-side. Except for explicitly local examples, importing a module must not create billable tasks.

## Documentation and versions

Keep the existing documentation structure rather than establishing a parallel policy:

- [README](README.md): general-purpose generation/task model, extension contracts, lifecycle usage, and navigation. Introduce provider packages as implementations after explaining the shared model.
- `packages/*/README.md`: npm package entry points; use full URLs for links to the repository.
- `docs/TRIPO.md`, `docs/MESHY.md`, `docs/VIGGLE.md`, and `docs/MEDIA_PROVIDERS.md`: provider parameters and behavior boundaries.
- [ARCHITECTURE](docs/ARCHITECTURE.md): execution contracts; [UPSTREAM](docs/UPSTREAM.md): provenance and upgrade requirements.
- [PUBLISHING](docs/PUBLISHING.md): the authoritative version/release procedure; [MIGRATION](docs/MIGRATION.md): historical compatibility migrations.
- [CHANGELOG](CHANGELOG.md): unreleased changes by package; passing checks does not mean a version was published.

English is the default at existing filenames. Keep complete Simplified Chinese counterparts beside them as `*.zh-CN.md`, with reciprocal language links immediately below the title. Update both languages in the same PR, preserving API identifiers, commands, examples, and verification limits. Navigation should stay in the chosen language when a counterpart exists. Package README language links use absolute repository URLs, and `README.zh-CN.md` is included in each package tarball. LICENSE and NOTICE remain the authoritative legal texts rather than translations.

Update affected documentation with the code, or explain the specific absence of impact. Distinguish implemented behavior, mock verification, and live API verification; never record results that were not run. `check:docs` checks local file targets and code fences. GitHub links to this repository's `main` files are resolved against the checkout, so npm-facing language links are checked without a network request. It does not validate other external URLs, heading anchors, translation accuracy, or example semantics; examples still need type checks and execution.

Any change inside `packages/<name>/`, including either README language, follows the existing independent-version rules. Exact internal dependencies do not automatically follow newer versions; do not synchronize unrelated package versions. After `version:release`, update the lockfile as described in [PUBLISHING](docs/PUBLISHING.md). Test-only, root-documentation-only, and repository-process-only changes need no package bump.

## Issues and security reports

For ordinary problems, use [GitHub Issues](https://github.com/fei-bai-inc/sinestack-ai/issues). Include package and Node versions, a minimal reproduction, expected/actual results, and sanitized errors. Provider responses may contain signed URLs, input content, and account information; do not paste complete logs without redaction. The default issue form is English and links to a Chinese form.

Follow [SECURITY.md](SECURITY.md) for security issues. Never post credentials, exploit details, or private data publicly.
