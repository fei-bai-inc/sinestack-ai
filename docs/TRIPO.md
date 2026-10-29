# Tripo v3 and domain execution

Implemented against the public HTTP v3 documentation and official Python SDK v1.0.0,
reviewed 2026-10-29. Mock contract coverage is not a claim of successful paid integration.
The package is `@sinestack/ai-tripo`; domain and task entry points come from `@sinestack/ai-core`.

## Coverage

| Domain | Factories | HTTP routes under /v3 |
|---|---|---|
| 3D generation | textTo3D, imageTo3D, multiviewTo3D | generation/text-to-model, image-to-model, multiview-to-model |
| Other generation | imageToSplat, textToImage, imageToImage, imageToMultiview, editMultiview, imageToDepth | generation/image-to-splat, text-to-image, image-to-image, image-to-multiview, edit-multiview, image-to-depth |
| Processing | texture, segment, smartSegment, complete, retopology, unwrapUV, convert, importModel | models/texture, mesh/segment, mesh/smartsegment, mesh/complete, mesh/decimate, mesh/uv, models/convert, models/import |
| Check / rig / animate | rigCheck, rig, retarget | animations/rig-check, animations/rig, animations/retarget |
| Resources | tasks.get, tasks.batch, files.upload, files.presign, account.balance, account.usage | tasks/{id}, tasks/list, files, files/presign, account/balance, account/usage |

`files.put` handles the separate storage PUT. Import is never hidden inside an upload or another task.
Retired v2 refine/stylize are intentionally excluded. Image-to-depth is source-confirmed in the
Python SDK, but remains experimental pending a real account check.

## Parameter coverage

`packages/tripo/src/types.ts` defines each endpoint's native fields. Known enums are completion hints
with extension strings. Unknown JSON fields remain available. Every endpoint is exercised by a
request/response fixture in `tests/tripo.test.mjs`; tests assert the entire transmitted body.

Geometry includes independent geometry/image/texture seeds and versions, face limits, geometry
quality, texture/PBR, parts, quad/low-poly, UV, orientation, compression, alignment and image autofix.
Texture supports text plus style image, single image, or multi-image guidance. Processing includes
segmentation granularity/reference image, model/image Smart Segmentation with transform, completion
mode, retopology bake/UV/parts, UV baking, and all 19 Convert fields. Rig preserves type/spec/version;
Retarget supports one preset or up to five presets and all export switches.

Validation enforces documented endpoint structure and mutually exclusive encodings, NOT a model
catalog. Model-version-dependent limits/side effects remain the provider's contract; the adapter does
not silently clamp face counts, change versions, force default settings, or translate incompatible
parameters. For example, geometry/texture versions are independent; an untextured generation may
require both `texture:false` and `pbr:false`. Applications should choose valid combinations from the
specific model documentation. No automatic version-specific capability matrix is implemented here.

Geometry multiview has three forms: named views, four string slots in front/left/back/right order
(empty strings skip), or one upstream task reference. Texture multiview supports named or positional
image references, including null skipped slots; it does not accept the upstream task-reference form.

## Domain calls and results

Generation keeps `generateAsset` / `generate3D` and nonempty `asset/assets`. Processing uses
`processModel3D({ processor, input })`, checks `checkRigging({ checker, input })`, rigs
`rigModel({ rigger, input })`, and animation `animateModel({ animator, input })`.

A check returns `riggable` directly, not an empty asset array. `false` is a successful check.
Processing returns `model`, `files`, optional preview/normalization and operation-specific fields.
Smart segmentation keeps `segmentationTaskId` and `modelTaskId`; completion can use the former.
UV results expose `uvPreview`. Animation returns actual files plus clips only when the provider
reports them. No inference assumes one file per action. Splat is not mislabeled as GLB.

Each domain result also includes complete native `raw`, `taskId`, decimal credits when present,
and an `execution` metadata object. Raw output and response body are independently retained.
Rig type accepts the documented `rig_type` and Python SDK `topology` alias; missing type stays
missing. Files are references and are never downloaded automatically. The application owns durable
storage and can explicitly use `materializeAsset` before temporary URLs expire.

## Shared execution and compatibility

`TaskDriver<INPUT, RESULT, DOMAIN>` is an adapter contract, not a mandatory business API. Domain
contracts are separate and compose this mechanism. `core/internal/runtime.ts` owns the only polling,
submit/status and error lifecycle. The old `internal/executor.ts` is an Asset compatibility boundary.
No fake AssetFile is used to run checks. Existing Asset receipts, results, errors, modes and hooks
remain supported. Retry/backoff, signal composition and observation callback handling still delegate
to the pinned AI SDK helpers; dependency versions and upstream hashes are unchanged.

The public advanced APIs are startTask/getTaskStatus/waitForTask/cancelTask/deleteTask. `startTask`
returns `{ task, ...metadata }`; `waitForTask` returns `{ result, execution }`, preserving the driver
result type. Each receipt has a distinct runtime marker, route/driver binding and optional connection
identity. Pure handle validation happens before resumed hooks and authenticated I/O.
The v1 wire discriminator `sine-ai-task` stays unchanged across the SineStack AI rename, so existing
persisted receipts remain usable without data migration or new submissions.

Submit defaults to zero retries; do not retry uncertain paid acceptance. Query retries only re-read
the same task. Local abort/timeout never issues remote cancel or delete. Tripo has no verified remote
cancel endpoint in this implementation, so it exposes no such driver method.

Polling is the implemented observation mechanism. An optional authenticated notification can be
awaited before querying; a nonterminal query then continues polling. Notification loss can consume
the configured waiting budget, so default polling is recommended when delivery is uncertain.
There is no SSE/watch implementation, durable worker, database, queue or workflow scheduler in this
SDK. Timeout is cooperative; it cannot force uncooperative provider promises/hooks to finish.

## Persistence and stages

```ts
const model = tripo.rig(selectedRigVersion);
const started = await startTask({ model, input: { input: originalModelTaskId } });
await saveTask(started.task); // Application-owned critical persistence; not an observation hook.
const completed = await waitForTask({ model, task: started.task });
```

Persist each stage separately. If persistence fails, keep the returned handle and retry storage,
not submission. Rig Check references the original model; Rig also references the original model;
Retarget references the rig task. Never pass a check task ID as a rigged model. Restoring requires the
same authorized account, base URL, route, version and connection. Receipts contain no API key and do
not replace application tenant authorization. Cross-provider use requires explicit file transfer,
not handing Tripo task IDs to Meshy.

Meshy-style no-file results, mixed rig artifacts, multiple clips in one file and two-stage recovery
are fixtures for the generic execution contract, NOT a shipped Meshy client or verified live Meshy
integration. A future Meshy adapter implements the relevant domain interfaces; no provider branch
is needed in the runtime.

## Upload and webhook security

Multipart uses the existing AI SDK transport helper. Signed storage PUT deliberately uses a separate
uncredentialed fetch with redirects disabled; it never receives API keys or connection headers.
Custom fetch must honor `redirect:'error'`.

Tripo subscriptions are configured at account level; do not send a fictitious callback URL with
create-task requests. `verifyTripoWebhook` checks HMAC-SHA256 over timestamp plus ORIGINAL body bytes,
replay tolerance, event shape and an optionally required endpoint ID using Web Crypto.

Pass the receiver's trusted `expectedEndpointId`. Resolve the connection from server routing, never
from untrusted request headers. The returned `deduplicationKey` is the SIGNED event.id; delivery headers
are not part of the HMAC. Prefix that event key with a trusted connection ID and insert it together
with an outbox notification in one application transaction. No in-memory dedup cache claims durable
exactly-once delivery. Use a verified task event to wake an already registered task and query its
status; do not accept webhook output as authoritative generation output.

## Validation boundaries

Local/CI contract tests use fake HTTP responses and no API keys. Still to validate with a real account:
all version/parameter combinations, image-to-depth, alternate four-view and batch-animation output
shapes, Image-to-Image inputs-only behavior, Smart UV compression/version inconsistencies, binary
model content/rig preservation, and Cloudflare/workerd deployment.

The Tripo package participates in the seven-package release manifest, version stamping, archive
validation and external consumer smoke tests. See [PUBLISHING.md](PUBLISHING.md). Release verification
and npm dry-run do not publish packages or migrate any consumer repository.

Sources: [Tripo SDK matrix](https://developers.tripo3d.ai/en/docs/sdk),
[Task query](https://developers.tripo3d.ai/en/docs/task-query),
[Texture](https://developers.tripo3d.ai/en/docs/models-texture),
[Convert](https://developers.tripo3d.ai/en/docs/models-convert),
[Rig](https://developers.tripo3d.ai/en/docs/animations-rig),
[Retarget](https://developers.tripo3d.ai/en/docs/animations-retarget),
[Files](https://developers.tripo3d.ai/en/docs/files),
[Presign](https://developers.tripo3d.ai/en/docs/files-presign),
[Webhooks](https://developers.tripo3d.ai/en/docs/webhooks),
[Python output aliases](https://github.com/Tripo-Developer/tripo-python-sdk/blob/v1.0.0/tripo3d/models.py),
[Meshy rig](https://docs.meshy.ai/en/api/rigging),
[Meshy animation](https://docs.meshy.ai/en/api/animation).
