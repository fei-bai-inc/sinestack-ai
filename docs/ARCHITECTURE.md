# Generation Models, Task Protocols, and Shared Execution

English | [简体中文](ARCHITECTURE.zh-CN.md)

SineStack AI provides a general-purpose asynchronous generation and task model. `TaskDriver<INPUT, RESULT, DOMAIN>` defines typed operations; `AssetModelV1<INPUT, KIND>` defines file-generation models. The core runtime executes these contracts and maintains the lifecycle from submission through status observation, completion, and recovery.

Adapters connect model APIs or job services by implementing their protocol operations. Domain interfaces describe tasks such as generation, processing, analysis, and animation with their own inputs and results. New adapters and domains reuse the same runtime. Retry policies, signal composition, and callback dispatch use AI SDK helpers.

## Implementation Layers

```text
Asset entry points generateAsset / generate3D / generateMusic / ...
    -> Asset compatibility boundary internal/executor.ts
          \
           -> Single execution mechanism internal/runtime.ts
          /
Domain entry points processModel3D / analyzeModel3D / checkRigging / rigModel / animateModel
    -> tasks.ts / domains.ts

runtime -> TaskDriver single-operation methods -> provider HTTP / native result decoding
```

`internal/executor.ts` retains conversions for legacy Asset semantics, errors, and receipts; it does not own a second polling loop. Provider packages neither depend on core nor implement waiting, retries, or callback scheduling. The shared runtime imposes no assets/riggable/parts/clips field requirements on the business `RESULT`.

| Layer | Responsibility |
|---|---|
| Application | Business policies, authorization for the original account/tenant, critical persistence, multistage composition, and long-term file storage. |
| Domain entry points | Purpose constraints, domain result validation, natural return structures, and type inference. |
| Single runtime | Submission, queries, waiting, stage retries, signals, cancellation/deletion, execution records, and hooks. |
| Provider contracts | AssetModelV1, TaskDriver, independent domain interfaces, and task credentials. |
| provider-utils | JSON/connection validation, file utilities, and single HTTP operations; no execution loop. |
| Provider adapters | Authentication, native routes, parameters, statuses, result decoding, and validation of their own handles. |

## Upstream Reuse

| Responsibility | Source |
|---|---|
| Retry error classification, Retry-After, backoff | AI SDK prepareRetries. |
| Merging user signals and timeouts | AI SDK mergeAbortSignals and native AbortSignal. |
| Awaiting callbacks and ignoring their errors | AI SDK mergeCallbacks. |
| Delay, IDs, HTTP/JSON handlers, byte conversion | Public @ai-sdk/provider-utils helpers. |
| Explicit downloads and in-memory files | ai createDownload and DefaultGeneratedFile. |
| Domain protocols, receipts, and task orchestration | SineStack AI's own code. |

The only entry point for internal dependencies is [internal/sdk.ts](../packages/core/src/internal/sdk.ts):

```ts
export { mergeAbortSignals, prepareRetries, mergeCallbacks } from 'ai/internal';
```

The dependency remains pinned exactly to ai@7.0.155; no second backoff, Retry-After, or generic abort engine has been introduced. Under the default redirect policy, GET, JSON POST, and multipart POST use public SDK helpers. PUT and DELETE use the destination-restricted, single-fetch path with SDK response handlers. Tripo and Viggle signed storage PUTs use separate requests without API credentials.

### Shared Transport Extensions

This section describes the current provider-utils source used by Viggle. fal/WaveSpeed/Replicate, Tripo, and Meshy retain older exact transport dependencies that use Fetch's `redirect: 'error'`; installing a newer top-level provider-utils does not replace those nested pins. The workerd evidence below is scoped accordingly.

`AssetProviderTransport.request(url, method, options, body?, allowEmpty?, handlers?)` returns `{ url, statusCode, value, response: { headers, body } }`. `options` requires `headers` and `abortSignal`. The fourth argument accepts a JSON object or, for POST only, `FormData`; DELETE rejects a request body. The fifth argument explicitly permits an empty HTTP 200/204 response, used for deletion endpoints. Without that opt-in, default generation decoding still requires valid JSON.

The sixth argument, `AssetProviderResponseHandlers`, can replace `successfulResponseHandler` and/or `failedResponseHandler` using the AI SDK `ResponseHandler` contract. Success handlers return a parsed `value` and optional `responseHeaders`; the wrapper retains that value as `response.body` and falls back to HTTP headers when the handler omits them. The empty-response opt-in bypasses success decoding. Failure handlers return an `APICallError`. Defaults remain the SDK JSON handlers; Viggle supplies lossless JSON and provider-specific error decoding without changing execution policy.

`requestRaw(url, method, options, rawOptions?)` returns the original unconsumed `Response` and accepts no body. `AssetProviderRawRequestOptions` supports `accept` (default `application/json`), `redirect` (default logical `'error'`), and `failedResponseHandler`. The caller owns body reading and cancellation, including SSE streams and discarded redirect bodies. Failed HTTP responses still pass through the selected error handler.

Before loading credentials, both methods validate the configured origin and path prefix. Connection authentication is applied after per-call headers. Every physical fetch uses `redirect: 'manual'` because workerd rejects Fetch's error mode. Default logical policy rejects non-success responses through the error handler; raw `'manual'` additionally returns only HTTP 301/302/303/307/308 without following `Location`. Already-followed responses or a changed response URL are rejected as non-retryable API errors. Custom fetch must honor manual mode; no adapter may follow redirects with API credentials.

Signed storage clients remain separate: Viggle uses physical manual mode, rejects redirects, and sends only upload-plan headers; Tripo uses `redirect: 'error'`. Both omit browser credentials and API connection headers. Viggle's authenticated download lookup returns the signed URL without following it; the application controls the subsequent uncredentialed download.

## Independent Semantics and Results

The existing `AssetModelV1<INPUT,KIND>` continues to support file generation, and `generateAsset` guarantees nonempty assets and a nonoptional asset. Facades for music, sound effects, 3D, and other capabilities constrain only kind and preserve native inputs. fal/WaveSpeed/Replicate still do not maintain a model catalog or force every model to use one parameter schema.

Domain contracts share execution capabilities by composing `TaskDriver<INPUT,RESULT,DOMAIN>`:

| Domain | Entry point and object | Result |
|---|---|---|
| Model processing | processModel3D / Model3DProcessor | The specific processor determines inferred models, parts, UVs, or reports. |
| Model analysis | analyzeModel3D / Model3DAnalyzer | Findings and reports; files are not required, and analysis does not imply modifying the model. |
| Rigging checks | checkRigging / RigChecker | Direct conclusions such as riggable, without empty assets. |
| Rigging | rigModel / ModelRigger | Models, rigs, and artifacts actually included. |
| Character animation | animateModel / ModelAnimator | Files and clip information explicitly reported by the provider. |

Capabilities with different purposes are not interchangeable merely because their lifecycles match. Interfaces use function properties and NoInfer to retain input constraints. Processing results do not use a large union containing optional fields from every endpoint; generation and checks do not share a mandatory `output + assets` envelope either.

Business fields of new domain results are at the top level, while common execution information is under `execution`. The advanced `waitForTask` returns `{ result, execution }`, with result retaining the specific driver's type. Domain result checks and final assembly happen inside the runtime's invocation body, so onFinish observes the same object returned to the caller; result validation failures go through onError.

Files themselves reuse AssetFile. Multiple files, multiple clips, different formats, and multiple parts are expressed separately, without inventing relationships to fit a uniform structure. When provider metadata is absent, information remains unknown rather than guessing clip counts from file counts.

## Driver Protocol

TaskDriver provides `doExecute`, a complete `doStart/doStatus` pair, or both. Optional `doCancel` and `doDelete` distinguish stopping remote work from deleting tasks/artifacts. `validateHandle` is a purely synchronous validation point before resumption.

Each method performs just one provider operation. Status returns pending/running/completed/failed/cancelled; completed carries the generic result. The runtime does not need to recognize Tripo, Meshy, or any business fields, and has no provider-specific branches.

Ordinary synchronous resource queries, such as motion catalogs and balances, call request utilities directly rather than manufacturing task IDs and pending statuses. Meshy's standalone motion uses the existing asset generation interface; print analysis defines independent analysis semantics and reuses the same execution mechanism. The SDK provides neither a generic DAG system nor a Meshy-specific execution loop.

## Submission, Resumption, and Identity

TaskHandle uses `type: 'sine-ai-task'` and a v1 marker, binds provider, driverId, domain, and optional modelId/connectionId, and retains the known submittedAt and opaque JSON handle. This persisted protocol marker intentionally remains stable across SineStack AI package-name and repository-URL changes; do not replace branding strings in stored task credentials. driverId supports stable routing and resumption, not a global catalog of business operations that callers must memorize.

The complete JSON envelope of a new receipt has its descriptors checked before fields are accessed; submission/resumption establishes deeply frozen snapshots. On resumption, driver.validateHandle runs before hooks and authenticated I/O. Tripo and Meshy validate the original baseURL, native route, model, connection, and safe task ID, and do not accept arbitrary response URLs as credential-bearing destinations. Meshy additionally binds the text preview/refine stage to prevent incorrectly resuming tasks that share the same HTTP path.

Legacy Asset receipts retain their specificationVersion/provider/modelId/kind/operation structure and enter the runtime through the compatibility boundary. Legacy providers still validate their inner connection in their single-operation methods before requests. Type distinctions are no substitute for runtime credential validation.

Neither receipt type stores API keys. Connection identifiers only help validate bindings; they do not replace the application's responsibility to restore the same account/tenant and perform authorization. Without a stable connectionId, the same baseURL alone cannot identify whether an API key now belongs to a different account.

After `startTask` or `startAsset` returns, explicitly await application persistence. If saving fails, keep trying to save the original handle rather than resubmitting. Failed resumption queries, webhook errors, remote failed states, and local aborts never enter a resubmission path.

## Retries, Timeouts, and Observation

Submission/direct execution/cancellation/deletion default to 0 retries; status reads default to 2. Positive submission or direct-execution retries require the provider to explicitly declare idempotency support. The idempotency key for a logical submission is created outside the retry closure; returned-credential validation also happens outside it, so local validation failures cannot recreate an already accepted task.

Actual retry classification and backoff are determined by prepareRetries. No onAttempt/onRetry hooks are added, and upstream network error policies are not reimplemented.

By default, polling queries immediately and then every 2 seconds; poll.timeoutMs defaults to 10 minutes, while timeoutMs constrains the current invocation's signal. Cancellation is cooperative: it does not forcibly terminate provider Promises that ignore the signal or hooks that never return. Local abort does not invoke remote cancel/delete. poll.delay replaces only sleep and does not provide durable replay.

The only hooks are onStart/onOperation/onProgress/onFinish/onError; mergeCallbacks awaits them and ignores their errors. Hooks are suitable for logging, not authorization or persistence that must succeed.

Ordinary Meshy DELETE removes the task and its artifacts; it does not cancel a running task. Domain drivers declare doDelete, while asset tasks use tasks.delete; no doCancel is fabricated. A 409 response does not indicate successful cancellation and does not trigger a new task. Tripo exposes neither cancellation nor deletion; fal/Replicate support asset cancellation, while WaveSpeed does not. None of these three aggregator adapters exposes deletion. A public entry point does not mean every provider implements that capability.

## Webhook Boundaries

The legacy Asset submission webhook factory and its error behavior when a task is still nonterminal after notification are preserved. New tasks can supply an already authenticated and correlated notification; on receipt, the same task is queried, and polling continues if it is not yet terminal. Lost notifications consume the waiting budget, so prefer ordinary polling when delivery is unreliable. Viggle's `renders.events` opens one SSE stream with optional `lastEventId`; the caller owns reconnection. Core has no generic SSE/watch scheduler.

Tripo uses account-level subscriptions and does not declare submission-level callback support. verifyTripoWebhook uses Web Crypto to verify raw bytes and the time window, and returns the signed event.id as the deduplication key. The host should resolve the connection from trusted routing, use a trusted endpoint ID, and atomically persist connection + event.id with an outbox. Unsigned delivery headers cannot serve as authenticated deduplication identities.

Meshy also uses account-level subscriptions, but its public documentation does not provide a verified signature protocol. parseMeshyWebhook explicitly returns authenticated:false; parsing is not signature verification, and eventKey is not an authenticated identity. The host is responsible for trusted connection and task correlation, authorization, rate limiting, durable deduplication, and an outbox. The Tripo signature algorithm must not be applied to Meshy.

Webhooks only wake authoritative queries for registered tasks. Their generated results are not accepted directly, and callbacks cannot choose credential-bearing request destinations.

## Legacy Asset Compatibility Requirements

Nonempty assets, nonoptional asset, legacy auto/direct/async routing, and dual-capability models are preserved. Query can return failed/cancelled; only wait/generate convert them to terminal exceptions. Legacy AssetExecutionError/AssetTimeoutError/AssetAbortError, ASSET_* codes, phase, and operation remain supported.

When a status read returns `failed` or `cancelled`, waiting/generation preserves its available `response` and `providerMetadata` in `TaskExecutionError` / `TaskAbortError`. The runtime wrapper adds the current `task` and `phase` while retaining diagnostics and cause; the Asset boundary preserves them in the corresponding Asset errors and `operation`. Failed jobs use `TASK_JOB_FAILED` / `ASSET_JOB_FAILED`. These fields are optional provider-supplied diagnostics, not a guarantee for every thrown network, validation, or local-abort error. Redact signed URLs and account/input data before logging.

Existing input inference, kind checks, hook fields and timing, idempotency gates, and credential snapshots are preserved. Task/Asset error and receipt conversions exist only at the compatibility boundary, without leaking into the generic runtime or providers.

## Files, Multiple Stages, and Verification

AssetFile can be URL, binary, or base64. URLs are not downloaded by default; materializeAsset is an explicit, independent stage. The application controls long-term file storage, download network policy, and byte limits. An expired URL must not trigger regeneration of a billable task.

Tripo import/check/rig/retarget and Meshy preview/refine are each saved and resumed as separate stages. A check reference is not inherently a model resource, and task IDs cannot be used directly across providers. If implicit workflows are offered in the future, they must have explicit stage states and persistence boundaries rather than masquerading as a single remote submission.

Node 22/24 CI checks cover legacy provider regressions, domain runtime and type tests, mock contracts for 20 Tripo operations, 18 Meshy capabilities and Viggle, resumption, and upload/notification security. Release verification installs all nine `@sinestack/ai-*` tarballs outside the workspace to check public declarations and runtime calls. Packages are independently versioned; core's version script updates the public runtime's User-Agent, not the compatibility executor. This describes repository check scope, not a new verification result.

The [workerd fixture](../tests/workerd/README.md) records four real-runtime checks with mocked HTTP for Viggle/core recovery and lossless seeds, multipart Blob handling, SSE parsing, and signed uploads. This is not Cloudflare deployment or all-provider acceptance. Tests do not prove live API permissions, all model-version combinations, binary asset contents, Meshy Creative Lab/SSE support, or a durable scheduler.

See [Tripo](TRIPO.md), [Meshy implementation and integration boundaries](MESHY.md), [Viggle](VIGGLE.md), [aggregator providers](MEDIA_PROVIDERS.md), [publishing](PUBLISHING.md), [the exact upstream baseline](UPSTREAM.md), and [historical migration](MIGRATION.md).
