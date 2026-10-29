# Meshy provider

`@sinestack/ai-meshy` implements Meshy's public generation, processing, analysis, rigging,
animation and account APIs through the existing SineStack AI runtime. Protocol references
were reviewed on 2026-10-29. Contract tests use mocked HTTP; they are not live API acceptance.

## Capability and API coverage

The base URL is `https://api.meshy.ai/openapi`. Text to 3D uses v2; other implemented families
use v1. Do not configure a provider-wide `/v1` suffix.

| Factory | Caller API | Native route below /openapi |
|---|---|---|
| textTo3D(modelId) | generate3D / startAsset | v2/text-to-3d, mode=preview |
| refine(modelId?) | processModel3D / startTask | v2/text-to-3d, mode=refine |
| imageTo3D(modelId) | generate3D | v1/image-to-3d |
| multiImageTo3D(modelId) | generate3D | v1/multi-image-to-3d |
| textToImage(modelId) | generateAsset | v1/text-to-image |
| imageToImage(modelId) | generateAsset | v1/image-to-image |
| textToMotion(mode) | generateAnimation3D | v1/text-to-motion |
| retexture(modelId?) | processModel3D | v1/retexture |
| remesh() | processModel3D | v1/remesh |
| convert() | processModel3D | v1/convert |
| resize() | processModel3D | v1/resize |
| unwrapUV() | processModel3D | v1/uv-unwrap |
| rig() | rigModel | v1/rigging |
| animate() | animateModel | v1/animations |
| multiColorPrint() | processModel3D | v1/print/multi-color |
| analyzePrintability() | analyzeModel3D | v1/print/analyze |
| repairPrintability() | processModel3D | v1/print/repair |
| autoSplit() | processModel3D | v1/print/split |

These are 18 semantic capabilities over 17 task resource families. Every task family has an
explicit `tasks.get(family,id)`, `tasks.list(family,query)` and `tasks.delete(family,id)` resource
method. Lists return one native page, not an automatically drained collection. There is no fake
batch endpoint or server-side upload API. Meshy inputs accept their documented task IDs, URLs
and data URIs directly.

`animations.list(filters)` calls `v1/animations/library`, a non-task query returning the animation
catalog. Filters include search, category, sub_category and action_ids (CSV string or number array).
The SDK does not bundle a preset catalog or assume consecutive IDs. `account.balance()` and
`account.usage(query)` preserve native fields, zero/decimal credits, null reset time, pagination,
endpoint filters and timestamps. `X-Meshy-Metadata` can be supplied through ordinary call headers.

## Parameter contracts

Native fields are declared in `packages/meshy/src/types.ts`. Known model/format strings are editor
suggestions, not allowlists. New model IDs and additional JSON fields are accepted without a release.
No local resolution of `latest`, automatic model migration, inferred quality downgrade or face-count
clamping is performed. Required generation factories demand an explicit model; processing factories
preserve omission. In particular, `refine()` leaves `ai_model` absent so Meshy can inherit the preview's
version. A native model/phase conflicting with the factory selection is rejected before submission.

| Input family | Covered parameter groups |
|---|---|
| 3D geometry | ai_model, model_type, topology, target_polycount, should_remesh, geometry_resolution, pose_mode, seed, moderation, save_pre_remeshed_model, auto_size, origin_at, decimation_mode, target_formats, experimental, alpha_thumbnail; native deprecated fields remain explicit and unmodified |
| Text preview | prompt, negative_prompt, art_style, texture_richness, explicit preview phase |
| Single/multi-image | image_url/image_urls or input_task_id, should_texture, image_enhancement, multi_view_thumbnails where documented, texture_image_urls |
| Texture/refine | enable_pbr, texture_resolution, texture_prompt, texture_image_url, remove_lighting, hd_texture; preview_task_id for refine |
| Retexture | model source, text_style_prompt, image_style_url or multiview_image_urls, enable_original_uv, texture/PBR/format and preview controls |
| Remesh/Convert/Resize/UV | task/URL source, topology/count/decimation, output formats, sizing and origin; deprecated remesh sizing/conversion fields are preserved, not silently moved into extra jobs |
| Rig | task/URL source, height_meters, native animation_type, optional name, deprecated texture override |
| Animation | rig_task_id; action_id, action_ids or motion_task_id; post_process operation_type and fps; name |
| Motion | prompt, explicit prime/swift or future mode, duration |
| Images | prompt, ai_model, generate_multi_view, pose_mode, aspect_ratio, remove_background; reference_image_urls or upstream image task for edits |
| Printing | printer type/brand, intended millimeter dimensions, color/depth controls, alpha thumbnail, split mode/prompt/layout/connector settings and output formats |

Endpoint-level validation covers required sources, exclusive animation/resize/print-size forms,
image/action counts, motion duration steps and split connector ranges. Version-specific entitlements,
face limits, geometry/texture quality combinations and model-specific side effects remain Meshy's
contract, not a second local model registry. Arbitrary JSON alone is not considered typed coverage:
request fixtures explicitly include the declared native parameter groups and compare the full body.

Some human-readable endpoint pages allow both `input_task_id` and a direct source, with the task ID
taking precedence, while generic OpenAPI descriptions have used exclusive wording. The adapter follows
the endpoint page: both are preserved. Retexture likewise preserves text plus single-image guidance;
Meshy chooses its documented precedence. Multiview texture guidance remains mutually exclusive.

`mapInput` is optional on built-in factories and retains custom input inference. Asset factories also
accept `mapResult`. For Meshy, this mapper receives the complete native task record (some outputs are
top-level, others under result), not just task.result. Custom output contracts can implement/export a
`MeshyTaskDriver` with a decoder. Mappings cannot alter retained response/native snapshots.

`providerOptions.meshy` supplements native input; duplicate keys are rejected, never silently overwritten.
Only declared route/stage/model selectors are inserted. Unknown native JSON values are not pruned.

## Results and domain boundaries

Generation returns the existing nonempty asset/assets contract. Processing returns model/files/models,
textures and previews. Rigging adds animations and armatures. Character animation keeps files, animation
formats, armatures and clip metadata only when explicitly reported. Multiple actions may be inside one
GLB/FBX; the SDK never infers the number of clips from the number of URLs.

Printable-model analysis returns `printability` without fake files. A report with status `warning` or
`error` is a successful analysis task, distinct from the remote FAILED state. Repair and split have their
own results, including repair reports, intended dimensions, partCount and promptIgnored when reported.

Meshy has no independently verified Rig Check endpoint in this adapter. It does not manufacture
`riggable:true` from successful submission. Standalone Text to Motion produces a motion asset and can
later feed animate via motion_task_id; it is not a character rigging operation.

The adapter extracts only known output-file fields, preserving GLB/FBX/other model formats, MTL, PBR maps,
pre-remesh files, alpha and multi-view previews, basic rig animations, processed animation outputs and
motion files. It does not scan prompt/input/metadata URLs as files. Optional empty URLs are skipped.
Native output remains in providerMetadata.meshy.output and, for domain calls, raw. Domain records expose
taskId, reported credits and expiresAt. File metadata has a stable response-path assetId and reported
expiration. No file is downloaded automatically, and binary content is not asserted by URL parsing.

A past expires_at does not change an observed SUCCEEDED task into a new job. Raw history is accessible
with tasks.get even when its files are gone. A material-result call without its promised files fails;
it never recreates the job. Applications must save files explicitly while available.

## Explicit stages and persistence

Text generation is preview then optional refine; the provider does not hide both behind textTo3D.
Each POST has its own returned receipt and billing boundary. Example functions are in
[examples/meshy.ts](../examples/meshy.ts); importing the example does not start work.

```ts
const previewModel = meshy.textTo3D(chosenModelId);
const started = await startAsset({ model: previewModel, input: { prompt } });
await savePreview(started.operation);
const preview = await waitForAsset({ model: previewModel, operation: started.operation });

const processor = meshy.refine();
const next = await startTask({
  model: processor,
  input: { preview_task_id: preview.providerMetadata.meshy.taskId },
});
await saveRefine(next.task);
const refined = await waitForTask({ model: processor, task: next.task });
```

Host persistence methods are deliberately explicit. If storage fails after start returned, preserve that
receipt and retry storage, not POST. The model that restores a task must have the same authorized connection,
route, stage, domain and algorithm selection. Receipts carry neither API keys nor account authorization.
Cross-provider transfers require explicit files, not passing a Tripo task ID to Meshy.

MeshyTaskDriver performs one POST/GET/DELETE. The existing core owns submission/wait/status retry/signals/hooks;
its runtime and TaskHandle wire format are unchanged. Model3DAnalyzer and analyzeModel3D are just a separate
semantic facade over that runtime. Shared HTTP transport adds DELETE and optional empty HTTP 200 handling,
without making malformed/empty generation responses acceptable. Submission defaults to zero retries;
query retries read the same task. No verified remote idempotency guarantee is advertised.

## Delete, cancellation and notifications

Ordinary task DELETE removes the task/resources; it is not cancel. Domain drivers expose doDelete, not
doCancel. Asset tasks can be deleted explicitly through tasks.delete. An in-progress task can return 409;
that response is a failed delete, not proof the task stopped. Local abort only stops local waiting.

Meshy webhooks are configured at account level. This adapter does not send a fictitious callback URL in a
create request. The reviewed public webhook reference supplies no signature-verification protocol, so
parseMeshyWebhook explicitly returns authenticated:false. Its eventKey is only an untrusted deduplication
hint, not an authenticated delivery identity. Do not reuse Tripo's HMAC protocol.

Resolve connections and allowed task families from trusted server routing/storage. Authenticate/authorize
notifications at the host boundary, rate-limit them, and use them only to wake an already registered task's
authoritative GET. Never derive credentialed fetch destinations or accept output files from an untrusted
notification. Duplicate and out-of-order events must not regress stored task state. Default polling remains
available without callbacks. SSE/watch has not been implemented by this change.

## Important native behavior and unresolved documentation differences

- Resize uses meters; intended print dimensions use millimeters. The SDK does not equate either with a scale factor.
- UV Unwrap is not promised to preserve original textures, bones or animation. Follow the native operation's effects.
- Rigging's endpoint page supports textured humanoids; OpenAPI includes animation_type with biped/quadruped values.
  The native field is exposed, but non-humanoid support/entitlement is not claimed without live verification.
- Text to Motion is documented on its own endpoint page and is not included in the reviewed OpenAPI document.
- Animation post_process.operation_type may be omitted; omission is preserved and does not request an extra file.
- Deprecated model/parameter hints do not imply continued provider availability. No retired model is selected by default.

## Scope and verification

The main core APIs above are implemented; this is not a claim to wrap every Meshy API product. Creative Lab's
specialized product workflows (which have different cancellation semantics), SSE streaming, durable workers,
queues and automatic workflow composition are outside this change.

Node 22/24 CI exercises old-provider regressions, all 18 Meshy business capabilities, native request bodies,
results, invalid inputs, type inference, delete/cancel separation, credential routing, restore/no-resubmission,
notifications and account resources. Release verification includes all eight tarballs in an independent consumer.
No new dependencies, upstream hashes, permanent CI jobs or publish permissions are added.

Not yet verified: live account entitlements/credits, every version/parameter combination, actual Meshy webhook
delivery/authentication, binary model/UV/rig/animation contents and Cloudflare/workerd execution. No paid API call,
npm publish or gateway/cloud migration is performed by these tests.

## Protocol references

[OpenAPI](https://docs.meshy.ai/openapi.json), [Text to 3D](https://docs.meshy.ai/en/api/text-to-3d),
[Image to 3D](https://docs.meshy.ai/en/api/image-to-3d), [Multi Image](https://docs.meshy.ai/en/api/multi-image-to-3d),
[Retexture](https://docs.meshy.ai/en/api/retexture), [Remesh](https://docs.meshy.ai/en/api/remesh),
[Convert](https://docs.meshy.ai/en/api/convert), [Resize](https://docs.meshy.ai/en/api/resize),
[UV](https://docs.meshy.ai/en/api/uv-unwrap), [Rigging](https://docs.meshy.ai/en/api/rigging),
[Animation/catalog](https://docs.meshy.ai/en/api/animation), [Motion](https://docs.meshy.ai/en/api/text-to-motion),
[Images](https://docs.meshy.ai/en/api/text-to-image), [Analysis](https://docs.meshy.ai/en/api/analyze-printability),
[Repair](https://docs.meshy.ai/en/api/repair-printability), [Split](https://docs.meshy.ai/en/api/auto-split),
[Webhooks](https://docs.meshy.ai/en/api/webhooks), [Retention](https://docs.meshy.ai/en/api/asset-retention),
[Balance](https://docs.meshy.ai/en/api/balance), [Usage](https://docs.meshy.ai/en/api/usage).


## Independent package release

This provider starts at `@sinestack/ai-meshy@0.1.0` and pins `@sinestack/ai-provider@0.1.2`
(the additive analyzer contract) and `@sinestack/ai-provider-utils@0.1.2` (DELETE/empty-response support).
The compatible core analyzer facade is released in `@sinestack/ai-core@0.1.2`. Under the repository
0.x rules these additive changes use patch increments, not a shared workspace version bump.
Tripo also receives a compatible `0.1.2` patch for portable public declarations when older
exact dependencies are installed; its provider/provider-utils pins remain at `0.1.1`.
fal, WaveSpeed and Replicate keep both their existing versions and dependency pins.

The new package is explicitly registered in release order, version-policy tests and isolated consumer
validation. First publication also needs npm-side bootstrap/Trusted Publisher setup; source changes
do not perform it. See [PUBLISHING.md](PUBLISHING.md) for the merge and automatic release rules.
