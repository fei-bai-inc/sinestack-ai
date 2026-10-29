# Upstream Sources and Upgrade Process

English | [简体中文](UPSTREAM.zh-CN.md)

SineStack AI's asset protocol and necessary orchestration draw on the video generation implementation in Vercel AI SDK 7. Basic retries, AbortSignal merging, and callback dispatch call upstream helpers directly and adopt their behavioral contracts. This project still maintains the submit/status/poll/result/cancel/delete orchestration shared by assets and domain tasks; upstream provides no generic executor that `AssetModelV1` or `TaskDriver` can use directly. See [ARCHITECTURE.md](ARCHITECTURE.md) for domain APIs and resumption boundaries.

This project and the relevant upstream packages all use **Apache-2.0**. The upstream `Copyright 2023 Vercel, Inc.`, attribution of SineStack AI modifications, complete `LICENSE`, each package's `NOTICE`, and derived-source notices are retained.

## Exact Baseline and Internal Boundary

| npm package | Version | Purpose |
|---|---|---|
| `ai` | `7.0.155` | Direct reuse of internal helpers; video generation, submission, and queries are orchestration sources. |
| `@ai-sdk/provider` | `4.0.34` | Protocol source and public JSON, warning, and metadata types. |
| `@ai-sdk/provider-utils` | `5.0.70` | Upstream retry primitives, delay, HTTP/schema utilities, and data conversion. |

The `ai` peer dependency of `@sinestack/ai-core` is pinned exactly to `7.0.155`, without `^` or `~`. Although internal interfaces can be imported through package exports, they still require review during version upgrades.

The three internal imports are centralized in [`internal/sdk.ts`](../packages/core/src/internal/sdk.ts):

```ts
export { mergeAbortSignals, prepareRetries, mergeCallbacks } from 'ai/internal';
```

Other files use them through this local entry point. The asset layer neither copies these helpers nor retains its own Retry-After algorithm, generic abort-race utility, or callback error protocol.

The baseline comes from **original files in the npm release packages** listed above, not the current contents of GitHub `main`. Exact paths, purposes, and SHA-256 hashes are recorded in [`upstream.json`](../upstream.json); the initial verification date was 2026-10-28. Unverified release commits are not entered in the manifest.

Upstream references: [official repository](https://github.com/vercel/ai), [ai 7.0.155](https://www.npmjs.com/package/ai/v/7.0.155), [@ai-sdk/provider 4.0.34](https://www.npmjs.com/package/@ai-sdk/provider/v/4.0.34), and [@ai-sdk/provider-utils 5.0.70](https://www.npmjs.com/package/@ai-sdk/provider-utils/v/5.0.70).

## Meaning of Tracked Files

| File or protocol | Purpose |
|---|---|
| `ai/src/util/prepare-retries.ts` and `retry-with-exponential-backoff.ts` | Directly adopted retry configuration, error classification, Retry-After, and backoff policies. |
| `ai/src/util/merge-abort-signals.ts` | Directly adopted signal/timeout merging. |
| `ai/src/util/merge-callbacks.ts` | Directly adopted semantics of awaiting callbacks and ignoring their errors. |
| `ai/src/generate-video/{generate-video,start-video,get-video-status}.ts` | Derivation references for submit/status separation, webhook/polling, and idempotency keys. |
| `@ai-sdk/provider/src/video-model/v4/*` entries in the manifest | Sources for the Asset protocol, operation, and discriminated status. |
| `@ai-sdk/provider-utils/src/{retry-with-exponential-backoff,delay}.ts` | Public underlying utilities used by SDK helpers. |
| `@ai-sdk/provider-utils/src/{get-from-api,post-to-api,response-handler}.ts` | Public HTTP and JSON response helpers used by providers through shared transport. |
| `@ai-sdk/provider/src/errors/api-call-error.ts` | Default retry classification for HTTP errors, including 408, 409, 429, and 5xx. |
| `@ai-sdk/provider-utils/src/handle-fetch-error.ts` | Network error handling used indirectly through public GET/POST helpers; not directly deep-imported. |
| `ai/LICENSE` | Source of upstream attribution and licensing. |

“Tracked” includes direct dependencies, indirect dependencies, and derivation references; it does not mean every file was copied. Private video functions such as `executeStartStatusFlow` and `waitForWebhook` are not package exports, so deep imports cannot be treated as available extension interfaces. The current implementation also does not wrap 3D data as video to bypass protocol restrictions.

## Adopted and Retained Semantics

| Aspect | Current contract |
|---|---|
| Basic retries | Uses `prepareRetries` directly; the asset layer no longer provides initial/max delay or retry callbacks. |
| HTTP | Default-policy GET and JSON/multipart POST use public SDK helpers; PUT/DELETE and raw manual requests use a guarded single fetch with SDK-compatible handlers. Current `request` accepts per-call decoders; `requestRaw` leaves body ownership to its caller. Current transport uses physical manual redirects and logical rejection by default; older pinned transport versions use Fetch error mode. Tripo/Viggle signed uploads stay separate from API credentials. |
| Stage selection | Submission/direct execution/cancellation/deletion default to 0 retries, status to 2; positive submission or direct-execution retries require provider idempotency support. |
| Signals | Uses cooperative cancellation through `mergeAbortSignals`; it does not guarantee forcible termination of providers or hooks that ignore signals. |
| Callbacks | Uses `mergeCallbacks`: await callbacks and ignore their errors. Observation only; critical persistence must be explicitly awaited after `startAsset` / `startTask` returns. |
| Operation / TaskHandle | Validates and freezes JSON credentials bound to the corresponding provider/model/kind or driver/domain/connection; failed queries never resubmit. |
| Artifacts | URLs remain references; fetch bytes explicitly with `materializeAsset`. |
| Webhooks | Retains the local wait race between notifications and SDK delay; the final status request still relies on cooperative signal cancellation. |
| Remote cancellation and deletion | `cancelAsset` / `cancelTask` and `deleteTask` express cancellation and deletion respectively; support depends on driver capabilities, and local abort is not treated as either. |
| Custom sleep | `poll.delay` replaces only polling sleep and does not introduce durable scheduling or replay. |

Viggle uses the transport extensions for lossless JSON, provider-specific errors, a single SSE stream, and signed-download redirect lookup. These are provider protocol operations, not another retry/polling engine. See [shared transport contracts](ARCHITECTURE.md#shared-transport-extensions) for handler precedence, raw response ownership, and redirect policies.

These differences and boundaries are deliberate choices and must not be mechanically overwritten during upgrades. See [MIGRATION.md](MIGRATION.md) for the historical record of early API reductions; it is not a statement of current npm publication status.

## Offline Verification

```sh
npm ci
npm run check:upstream
```

[`scripts/check-upstream.mjs`](../scripts/check-upstream.mjs) reads only the local manifest and installed packages. It checks package names, exact versions, and licenses for 3 packages, plus **SHA-256 hashes of 19 original files**. A missing package, missing file, or any mismatch produces a nonzero exit code.

The script does not access the network, install dependencies, or update the baseline. CI runs `npm ci` and `npm run verify:release` on Node.js 22/24. The publish dry-run at the end of the latter only validates local archives; it is not `npm publish --dry-run` and does not check npm publishing permissions. Only a publishing dry-run with an explicit `--base-ref` performs registry queries and npm dry-runs for selected packages. See [PUBLISHING.md](PUBLISHING.md) for the automatic release workflow after merging into `main` and the specific commands.

A passing check proves only that installed contents still match the reviewed snapshot. It does not prove asset orchestration is bug-free or automatically discover new upstream fixes. This project's protocol tests verify the necessary runtime invariants.

## Upgrade Steps

1. Update candidate package versions, core's exact peer constraint, and the lockfile in one reviewable change; initially retain the old manifest to observe differences.
2. Review the signatures and behavior of the three internal helpers and their retry/delay dependencies; also review the public HTTP helpers and error handling used by shared transport. Prefer adjustments to the centralized entry point over spreading compatibility code into providers and facades.
3. Compare relevant fixes in the video sources and determine which apply to the asset orchestration still owned by this project; preserve the explicit differences in the table above.
4. Update necessary implementation and relevant regression cases before recording new versions, hashes, dates, and sources; do not merely recompute hashes to clear warnings.
5. Synchronize affected migration notes and `NOTICE`, and run `npm run check` and `npm run check:upstream`.

If upstream stops shipping a source file or exporting an internal interface, a new verification or integration strategy must be defined explicitly; missing entries cannot be ignored and treated as a pass.
