# Historical Migration: API Reductions in the Unreleased Initial Version

English | [简体中文](MIGRATION.zh-CN.md)

This document records the API reductions during the early source-code stage and the subsequent Media provider expansion, for callers migrating from those interfaces. “Unreleased” describes that stage, not the current npm publication status; this document is not a new verification record. For current installation and API usage, refer to the [README](../README.md), [architecture](ARCHITECTURE.md), [Tripo](TRIPO.md), [Meshy](MESHY.md), and [Viggle](VIGGLE.md). See [PUBLISHING.md](PUBLISHING.md) for versions and the release process.

This historical adjustment centralized basic mechanisms in `internal/sdk.ts`, reusing the AI SDK's `prepareRetries`, `mergeAbortSignals`, and `mergeCallbacks`. See [UPSTREAM.md](UPSTREAM.md) for the current exact upstream baseline. SineStack AI still maintains asset orchestration and the domain task orchestration added later; upstream did not add a generic Asset executor.

## Removed or Changed Features

| Early interface or behavior | Behavior after the reduction |
|---|---|
| `retry.initialDelayMs`, `retry.maxDelayMs` | Removed. Backoff and Retry-After follow SDK policies; per-stage retry counts remain. |
| `hooks.onAttempt`, `hooks.onRetry` | Removed; there is no longer a separate asset retry callback protocol. |
| `hooks.onAbort` | Removed. Observe abort/timeout exits through `onError`. |
| `AssetHookError`, propagation of hook errors to callers | Removed. SDK `mergeCallbacks` awaits hooks and ignores their errors. |
| Recovery through an error's `result` after `onFinish` fails | No longer needed: thrown hook errors are ignored, and the call returns the original generation result. |
| An `onOperation` exception blocking subsequent execution | No longer applies. It is observation-only and cannot serve as a persistence step that must succeed. |
| Generic Promise races for providers/hooks and strict wall-clock deadlines | Removed. Cancellation uses cooperative signals and does not guarantee timely termination of arbitrary Promises that ignore signals. |
| Custom `abort.ts`, WeakMap deadlines, and terminal state machine | Removed in favor of SDK helpers; only the local race required for webhook notification waiting remains. |

These are deliberate reductions in behavioral guarantees. A hanging hook still blocks the call; providers, custom downloaders, and custom sleep implementations must respond to signals themselves. Do not treat `timeoutMs` as an upper bound that forcibly terminates arbitrary user code.

## Move Critical Steps out of Hooks

The five existing hooks are `onStart`, `onOperation`, `onProgress`, `onFinish`, and `onError`. They are suitable for logging, metrics, and noncritical progress displays.

To save a task, first obtain its handle, then explicitly await the application's persistence function:

```ts
// The application provides model, input, and saveOperation; saveOperation writes to a database.
const started = await startAsset({ model, input });
await saveOperation(started.operation);
```

If saving fails, `started.operation` is still the handle of the already-created task. Retry saving it or use it to resume; do not resubmit because persistence failed. Authorization and other business steps that must succeed likewise belong outside observation hooks.

## Retained Asset Constraints

Per-stage retry counts, submission idempotency capability checks, a stable idempotency key per logical submission, JSON operation validation and identity binding, no resubmission on query failures, no URL downloads by default, and explicit remote cancellation remain unchanged. Custom capabilities continue to use `AssetModelV1`, without requiring separate polling/retry implementations for each asset type.

After migrating repository source, run `npm run check` and `npm run check:upstream`; npm consumers should run their own type and behavior tests rather than assume dependency packages ship workspace scripts. Other AI SDK versions require prior review of the centralized internal interfaces and baseline.

## Changes after the Media Provider Expansion

Generic asset protocols were added for `@sinestack/ai-wavespeed` and `@sinestack/ai-replicate`, and fal likewise adopted generic model entry points; the `AssetModelV1` version stayed unchanged. All four capability facades support `{ model, input }`, only validate kind, and call `generateAsset`. See [MEDIA_PROVIDERS.md](MEDIA_PROVIDERS.md) for connection and mapping contracts.

fal HTTP moved to shared `@sinestack/ai-provider-utils`, reusing public AI SDK HTTP helpers alongside the new providers. This introduced the following explicit changes:

- HTTP 409 is retryable under the SDK's default classification. Whether a retry occurs still depends on core's per-stage retry counts; submission still defaults to 0.
- Custom fetch exceptions not recognized by the SDK are preserved as-is rather than all being wrapped as retryable network errors. Connection errors recognized by the SDK continue to use its classification.
- fal PUT cancellation uses one fetch with SDK response handlers; network exceptions are preserved as-is, and cancel retries default to 0.
- `mapInput` and `mapResult` became independently optional: native JSON input and shared file parsing are the defaults. When supplied, their function types are validated during construction. Completed results must still contain at least one asset.
- Completed results from these three Media adapters gained `providerMetadata.<provider>.output`, preserving a native output snapshot. This field and the real task ID are reserved by the adapter and cannot be overridden by custom mappers. Callers performing exact snapshot comparisons of the entire metadata object need to update their expectations.

Previously persisted fal queue operation structures are unchanged and can still be resumed using the original connection. Operations from the new providers are not interchangeable and cannot be resumed under a different baseURL.

## Removal of Default Models and Model Presets

The earlier unreleased implementation embedded specific model schemas in capability entry points, restricting access to other models on the same platform. This change removed model constants, default IDs, exact-model validation, parameter allowlists, and model-specific mappings from public provider source. All three providers offer `music / threeD / soundEffect / animation3D(modelId, mapping?)`; the generic `.asset(modelId, { kind })` no longer requires an identity mapper.

| Old usage | New usage |
|---|---|
| `fal.music()`, `wavespeed.threeD()` | Explicitly pass an application-selected modelId; a missing ID fails before any request. |
| Importing model constants such as `FAL_MUSIC_MODEL` | Model IDs come from application configuration; the SDK no longer provides a supported-model catalog. |
| `generateMusic({ model, prompt, instrumental })` with built-in mapping | `generateMusic({ model, input: { /* native fields of the target model */ } })`. |
| A preset schema rejecting a model change | Native input receives JSON validation only, with no model-specific parameter restrictions. |
| Having to write both mappers for every endpoint | Common file outputs need no mapper; inject specialized input/output mappings independently as needed. |
| WaveSpeed globally forbidding bare base64 | An explicit format is required up front when there is no mapResult; external mappers that can parse it correctly are allowed. |

Legacy flattened-parameter overloads are retained and marked deprecated for external mappers or custom models that explicitly accept those business inputs. Default native JSON models use `{ model, input }`. For example, if a model requires `is_instrumental`, pass that field unchanged; the SDK does not automatically translate `instrumental` into a service-specific field.

Models do not need preregistration. Whether a remote model supports a task, its input fields, and its output semantics are still determined by its actual API. For output outside common File conventions, inject mapResult without changing the protocol layer or executor.

## Subsequent Domain and Task APIs

Current core also provides entry points for model processing, analysis, rigging checks, rigging, and character animation, plus `startTask/getTaskStatus/waitForTask/cancelTask/deleteTask`. These are not a replacement migration that removes the legacy Asset API: file generation continues to use AssetModelV1 and AssetOperation, while file-free checks/analysis use independent domain results. Both Tripo and Meshy are implemented in the repository; the early “three providers” scope on this page must not be read as the current package inventory.

The new TaskHandle's v1 persistence marker remains `sine-ai-task`; branding/package-name changes do not require rewriting saved credentials. Resumption must reconstruct the original authorized connection; do not migrate database handles by resubmitting tasks. See [ARCHITECTURE.md](ARCHITECTURE.md) for the full lifecycle and cancellation/deletion capability boundaries.

## Viggle-era Additions

Viggle adds video/image generation, processing, reusable Character/Motion resources, exports and scenes using the existing Asset and Task contracts. Its Render events API opens a single SSE stream; reconnection remains explicit. Existing providers' task receipts and runtime markers remain unchanged.

Task/Asset execution errors now expose optional `response` and `providerMetadata`. Failed/cancelled status diagnostics survive waiting/generation and Asset compatibility conversion; callers inspecting exact error objects should account for these fields and redact sensitive values before logging.

Custom adapters can pass response handlers as the sixth `AssetProviderTransport.request` argument or use `requestRaw` for an unconsumed response. Current transport passes physical `redirect: 'manual'` to custom fetch while logically rejecting redirects by default. Honor manual mode without following `Location`; raw manual opt-in returns the original redirect response. Older exact provider transport pins still use Fetch error mode, and Tripo's separate signed storage PUT requires it. See [architecture](ARCHITECTURE.md#shared-transport-extensions) for full contracts.
