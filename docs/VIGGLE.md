# Viggle provider

English | [简体中文](VIGGLE.zh-CN.md)

`@sinestack/ai-viggle` connects the public Viggle V1 API to the existing SineStack AI asset and
task runtime. It covers video generation, character animation, renders, image generation,
video upscaling, reusable characters and motions, 3D exports, scene operations and account
balance. The protocol references were reviewed on **2026-10-29**.

**Verification uses mocked HTTP contract tests. It is not live Viggle API acceptance.** The
tests verify request serialization, response interpretation and restoration without another
submission; they do not establish visual quality, current account entitlements or live uptime.

The repository records four local smoke tests of the same public provider and core in the actual **workerd
1.20261029.1** runtime, bundled with **esbuild 0.28.2**, compatibility date **2026-10-29**, and no
compatibility flags or Node polyfills. They exercise persisted restoration and exact seeds,
native multipart encoding, SSE and signed PUT. Every request passes through a native Worker
`Request` before the injected mock responds; no live Viggle calls or cloud deployment are
performed. Reproduction instructions are in [tests/workerd](../tests/workerd/README.md).

## Configuration and model selection

```ts
import { createViggleProvider } from '@sinestack/ai-viggle';

const viggle = createViggleProvider({
  // apiKey defaults to VIGGLE_API_KEY when omitted.
  apiKey: process.env.VIGGLE_API_KEY,
  // Optional: identifies the authorized connection used to restore operations.
  connectionId: 'production-viggle-account',
  // baseURL: 'https://apis.viggle.ai/v1',
  // fetch: customFetch,
  // headers: { 'X-Viggle-Source': 'my-integration' },
});
```

The default base URL **already includes `/v1`**. A proxy can supply another origin and path.
The provider uses Bearer authentication for the API; per-call headers cannot replace the
configured credential. Calls support ordinary request headers and AbortSignal. Neither task
handles nor asset operations contain the API key.

In Cloudflare Workers, pass the account binding explicitly as
`createViggleProvider({ apiKey: env.VIGGLE_API_KEY })`; the Node environment fallback does not
replace Worker bindings. Use the host's durable scheduler and persist each operation receipt.

Viggle does not expose a free model selector on every endpoint. H3, Animate, Image and the
fixed 2x upscaler use the backend selected by their native request. Factories do not invent
model names or inject an unsupported `model` field. Where Viggle documents `model`, notably
2D character/motion preprocessing and renders, the caller supplies its native string. These
fields do not select the 3D extraction backend. Known values are hints, not a bundled model
catalog or a promise that a future model is available to an account.

References: [authentication](https://docs.viggle.ai/v1/authentication),
[V1 overview](https://docs.viggle.ai/v1/api-reference/overview),
[migration](https://docs.viggle.ai/v1/production/migrate-from-legacy).

## Capability coverage

Generation factories return an `AssetModelV1`; processing and reusable-resource operations
return a `TaskDriver`. They share `start`/`status`/`wait` mechanics, while keeping their inputs
and results specific to the actual operation.

| Factory | Runtime API | Native endpoint below `/v1` |
|---|---|---|
| `textToVideo()` | `generateAsset` / `startAsset` | `POST videos`, no source fields |
| `firstFrameToVideo()` | `generateAsset` / `startAsset` | `POST videos`, first frame |
| `firstLastFrameToVideo()` | `generateAsset` / `startAsset` | `POST videos`, first and last frames |
| `referenceToVideo()` | `generateAsset` / `startAsset` | `POST videos`, reference video/images |
| `characterAnimation()` | `generateAsset` / `startAsset` | `POST videos`, driving video and characters |
| `renderVideo()` | `generateAsset` / `startAsset` | `POST renders`, multipart |
| `renderDraft()` | `generateAsset` / `startAsset` | `POST renders`, JSON draft submission |
| `image()` | `generateAsset` / `startAsset` | `POST images` |
| `upscaleVideo()` | `startTask` / `waitForTask` | `POST videos/super-resolution` |
| `createCharacter()` | `startTask` / `waitForTask` | `POST characters` |
| `createMotionFromVideo()` | `startTask` / `waitForTask` | `POST motions`, multipart |
| `createMotionFromText()` | `startTask` / `waitForTask` | `POST motions`, JSON |
| `importMotion()` | `startTask` / `waitForTask` | `POST motions/import` |
| `textToMotion({ format? })` | `generateAnimation3D` / `startAsset` | text Motion creation, then motion export |
| `videoToMotion({ format? })` | `generateAnimation3D` / `startAsset` | GLB Motion extraction, then motion export |
| `createScene()` | `startTask` / `waitForTask` | `POST scenes/pano` |
| `createSceneFromPanorama()` | `startTask` / `waitForTask` | `POST scenes/custom-pano` |
| `generateSceneViews()` | `startTask` / `waitForTask` | `POST scenes/generate` |
| `reconstructScene()` | `startTask` / `waitForTask` | `POST scenes/reconstruct` |

Direct resource methods perform one API operation. List methods return one native page;
they do not automatically drain a collection or start polling.

| Resource | Methods |
|---|---|
| `videos` | `get(id, options?)`, `list(options?)` |
| `images` | `get(id, options?)` |
| `renders` | `prepare(input, options?)`, `upload(plan, blob, options?)`, `events(id, options?)`, `download(id, options?)` |
| `characters` | `create`, `get`, `list`, `delete`, `export` |
| `motions` | `createFromVideo`, `createFromText`, `import`, `get`, `list`, `delete`, `export` |
| `scenes` | `create`, `customPanorama`, `generateViews`, `reconstruct`, `get` |
| `credits` | `get(options?)` |

Use the full returned public IDs without stripping their prefixes. `videos.get` accepts
`render_`, `vid_`, `anim_` and `vsr_`; images use `img_`, characters `char_`, motions `mot_`,
and scenes `scn_`. Video listing is documented to combine Render, H3 and Animate sources;
the documentation does not yet promise that upscales appear in that list.

The retired `GET /v1/renders/{id}` must not be used; it returns 405. All video task polling
uses `GET /v1/videos/{id}`. No legacy `/api/*`, `/v1/avatars`, `/v1/animations`, fabricated
template-list endpoint or arbitrary `/models` catalog is added.

References: [complete index](https://docs.viggle.ai/llms.txt),
[video detail](https://docs.viggle.ai/v1/api-reference/videos/get),
[video list](https://docs.viggle.ai/v1/api-reference/videos/list).

## Typed native inputs

Inputs retain Viggle's native field names. Files can be supplied as `Blob`; URL inputs stay
URLs so the caller does not need to download and re-upload them through the SDK. Known fields
retain their types and required-source relationships. Additional native fields can be passed
without a package release. `providerOptions.viggle` supplements the input; conflicting keys
are rejected instead of silently changing the request.

File and URL fields are serialized according to each endpoint. For example, H3 reference
images and Image reference images use repeated form fields; Animate's `character_image_urls`
is a JSON array encoded in its form field. The multipart boundary is left to `fetch`.

### H3 video modes

All four H3 modes require a nonempty `prompt` and explicit `quality: 'low' | 'high'`. First-frame
and reference-conditioned generation still require both. Common native controls include
`duration_s`, `resolution`, `aspect_ratio`, `seed`, `watermark`, `enhance` and `priority`.

```ts
import { generateAsset } from '@sinestack/ai-core';

const result = await generateAsset({
  model: viggle.firstLastFrameToVideo(),
  input: {
    prompt: 'The character turns toward the window',
    quality: 'high',
    first_frame_image_url: firstFrameUrl,
    last_frame_image_url: lastFrameUrl,
    duration_s: 8,
    resolution: '1080p',
    enhance: false,
    seed: 42,
  },
});
```

Viggle selects the mode from the supplied fields. Reference fields cannot be combined with
first/last frames, and a last frame requires a first. The semantic factories reject missing
or contradictory sources so a reference request cannot silently become text-only generation.
H3 currently accepts one reference video and four reference images. Output duration is 5–15
seconds, independently of the reference video's duration. Videos have native audio; this API
does not document a separate audio toggle. `enhance` defaults to a provider prompt-rewrite
pass; set it to `false` to request the prompt unchanged.

H3's returned random seed can exceed JavaScript's safe integer range. The adapter preserves
unsafe JSON integers as decimal strings in native data, instead of returning a rounded number.
Supply your own safe integer seed if the application needs ordinary numeric seed handling.

References: [text video](https://docs.viggle.ai/v1/api-reference/videos/create-from-text),
[first frame](https://docs.viggle.ai/v1/api-reference/videos/create-from-first-frame),
[first/last frames](https://docs.viggle.ai/v1/api-reference/videos/create-from-first-last-frame),
[reference video/image](https://docs.viggle.ai/v1/api-reference/videos/create-from-reference-video).

### Animate, Render and Image

| Capability | Relevant native contract |
|---|---|
| Animate | Requires a driving video. `planner`/`normal` use 1 image, or 2–3 with ordered target tags; `agent` accepts 1–10 ordered images. Character uploads cannot be mixed with character URLs. |
| Render | Exactly one character and one motion source, each selected from an upload, URL or saved asset ID. Explicit sources avoid Viggle's environment-specific empty-request fallback. |
| Render backgrounds | Multipart supports original/solid/transparent and the inpaint alias; solid uses `bg_color`. Transparent output contains a foreground video and a separate alpha mask. |
| Image | Always multipart, including text-only input. `n` is 1–6, with up to 8 reference images. The generation seed range is 0–2147483647. |
| Upscale | Exactly one video upload or URL. Scale is fixed at 2x; it has no target-resolution selector. |

For Animate's `planner`/`normal`, multi-character prompts must begin with consecutive
`<Character1>`, `<Character2>` and, when needed, `<Character3>` target descriptions. Without
these tags the native service can ignore all but the first image. `agent` reads the editing
instruction directly. H3 quality/frame/reference controls do not belong to Animate.

Use 5–16 second driving videos for `planner`/`normal` and 5–60 for `agent`. The API's broad
admission check can accept longer clips than the planner/normal worker supports, so acceptance
alone is not proof of eventual success. The SDK does not decode video bytes to infer duration.

Image `2K` output sizes depend on whether reference images were provided. For example, a
square text-only 2K output is 2048×2048, while square 2K with references is 1536×1536. Use the
returned dimensions instead of inferring them from the requested tier. An image job produces
all requested images or fails; it does not promise partial success.

References: [Animate](https://docs.viggle.ai/v1/api-reference/videos/create-from-character-animation),
[Render](https://docs.viggle.ai/v1/api-reference/renders/create),
[transparent output](https://docs.viggle.ai/v1/guides/transparent-output),
[Image](https://docs.viggle.ai/v1/api-reference/images/create),
[upscale](https://docs.viggle.ai/v1/api-reference/videos/super-resolution).

### Characters, skeletal motion and scenes

| Operation family | Typed parameter groups |
|---|---|
| Character creation | image/URL source, name, 2D model, render/vsplat/all type, enhance and enhance_prompt; variant, model_precision, quality, filtering/pruning controls, joint_set, use_sparse_W, scale_parts, render_thumbnail and task_id |
| Motion from video | video/URL source, name, 2D model, render/glb/all type, thumbnail path; enable_smoothing, target_fps, smooth_velocity_threshold, apply_std_joints and task_id |
| Motion from text | text, duration_seconds, guidance_scale, smooth, name and task_id |
| Official motion import | template_id or legacy template_uuid, name and preprocessing model |
| Scene creation | sessionId, prompt and optional references/quality, or a panorama URL/Blob |
| Custom panorama | sessionId, panorama URL/Blob, panoramaC2w and metersPerUnit |
| Scene views | sessionId, referenceBatchIds, targetC2w or targetPosition, projection, fov and seed |
| Scene reconstruction | sessionId and explicit referenceBatchIds |

A vsplat-only Character can be generated from `enhance_prompt` without an image when enhancement
is enabled. `type=all` still needs an image because it also creates the render-ready 2D Character.
Text-generated Motion is standalone skeletal motion; it does not require an existing rigged
character. Both operations keep the native parameters and do not borrow Tripo/Meshy semantics.

Character joint sets are body, expression or full. Motion exports provide Mixamo, MetaHuman
and MetaHuman-body variants; the API does not supply a dedicated Motion export matching the
Character's 119-joint expression set. The adapter preserves this difference. `format` selects
the requested pre-generated GLB/FBX export; it is not a new hidden conversion job.

Scene camera matrices, target positions, view batches and sessions remain explicit native
data. Panorama workflows may use multipart uploads; JSON is not the only supported scene
request encoding. A legacy Render `scene_id` alias denotes a Motion and must not be confused
with a new Scene task or its `sessionId`.

References: [Character creation](https://docs.viggle.ai/v1/api-reference/characters/create),
[Motion from video](https://docs.viggle.ai/v1/api-reference/motions/create),
[Motion from text](https://docs.viggle.ai/v1/api-reference/motions/create-from-text),
[Motion export](https://docs.viggle.ai/v1/api-reference/motions/export),
[scene creation](https://docs.viggle.ai/v1/api-reference/scenes/pano),
[scene views](https://docs.viggle.ai/v1/api-reference/scenes/generate).

## Explicit stages and durable restoration

```ts
import { startAsset, waitForAsset, startTask, waitForTask } from '@sinestack/ai-core';

const model = viggle.characterAnimation();
const started = await startAsset({
  model,
  input: { driving_video_url: drivingVideoUrl, character_image_urls: [characterUrl] },
});
await saveOperation(started.operation);

// Reconstruct the same authorized provider connection in another worker.
const finished = await waitForAsset({ model, operation: started.operation });
await copyOutputFiles(finished.assets);

if (finished.asset.type !== 'url') throw new Error('Expected Viggle video URL');
const upscaler = viggle.upscaleVideo();
const submitted = await startTask({ model: upscaler, input: { video_url: finished.asset.url } });
await saveTask(submitted.task);
const upscaled = await waitForTask({ model: upscaler, task: submitted.task });
await copyOutputFiles(upscaled.result.files);
```

The host supplies the persistence/copy functions. Each paid submission has its own receipt;
failure to save a receipt should trigger a storage retry, not another provider POST. Restoring
an operation only reads its existing resource. A different capability, base URL or connection
cannot adopt a saved handle. Task receipts and reusable resource IDs are not interchangeable.

Reusable Character/Motion creation returns native resource records through the task runtime.
Check requested 2D and 3D processing before reuse; `type=all` represents both. For 3D results,
request the corresponding export after readiness. A text-generated 3D Motion is not a saved
2D driving video and must not be presented as render-capable solely because it is ready.

`textToMotion` and `videoToMotion` provide an asset facade that also obtains the selected GLB
or FBX export. They retain all returned skeleton variants, including the separate MetaHuman
body rig. Character `.vsplat`, motion GLB/FBX and scene `.spz` remain distinct file semantics.
The SDK does not manufacture a mesh from a Gaussian splat or retarget skeletons implicitly.

Scene results preserve the native session, output-batch, panorama and SPZ data. Creating a
panorama, generating views and reconstructing are separate task boundaries; callers explicitly
carry `sessionId` and batch references forward. There is no automatic scene workflow that
hides extra model runs or billing.

## Draft upload and idempotency

Draft preparation is an explicit resource operation. It supports upload descriptors, public
HTTPS URLs, ready asset IDs and official motion references. `renders.upload(plan, blob)` makes
one PUT request to a returned signed upload URL using **only its required headers**. It keeps
the Viggle API key and configured API headers off the object-store request, refuses redirects,
and returns the `upload_handle` with the storage service's ETag unchanged. The application
explicitly uploads each declared slot before submitting the draft.

```ts
const draft = await viggle.renders.prepare({
  character: {
    kind: 'upload', filename: 'character.png', content_type: 'image/png', bytes: characterBlob.size,
  },
  motion: { kind: 'asset', asset_id: motionId },
  output: { background_mode: 'transparent', aspect_ratio: 'source' },
});

// This draft declares exactly one upload, for the character.
const [uploadPlan] = draft.uploads ?? [];
if (!uploadPlan || draft.uploads?.length !== 1) {
  throw new Error('Expected one character upload plan');
}
const completion = await viggle.renders.upload(uploadPlan, characterBlob);
const submitted = await startAsset({
  model: viggle.renderDraft(),
  input: { draft_id: draft.draft_id, upload_completions: [completion] },
  headers: { 'Idempotency-Key': stableSubmissionKey },
});
await saveOperation(submitted.operation);
```

Persist the draft and upload completions when this workflow crosses process boundaries.
Preserve the returned `upload_handle` and any quoted ETag. Draft submission does not re-prepare
or re-upload behind the caller's back. Its idempotency guarantee applies to the same key and
normalized draft body; changing inputs with an old key is an error. Expired upload URLs require
a new upload plan, not an unobserved retry of the full paid workflow.

Multipart Render submission ignores `Idempotency-Key`. Other ordinary generation submissions
do not gain a retry guarantee from that header. They default to zero submission retries. The
existing runtime owns all retry attempts; status retries read the same accepted ID. Individual
3D APIs document `task_id` separately, which is not a provider-wide idempotency mechanism.

`createMotionFromText()` and `textToMotion()` use the documented text-Motion `task_id`
guarantee. `videoToMotion()` forces standalone `type: 'glb'`, for which the API also documents
`task_id` retry safety. These factories supply the runtime's stable key when the caller omits
`task_id`. The general `createMotionFromVideo()` also allows render/all processing and does
not advertise that broader submission as idempotent.

Draft output backgrounds differ from multipart: original/green/white/transparent, and only
`aspect_ratio: 'source'` is currently served. Do not copy multipart's arbitrary solid color
configuration into the draft output shape or assume listed reframing ratios are implemented.

References: [prepare](https://docs.viggle.ai/v1/api-reference/renders/prepare),
[submit](https://docs.viggle.ai/v1/api-reference/renders/create),
[async recovery](https://docs.viggle.ai/v1/production/async-jobs).

## Observation, errors and result availability

Viggle's queued/processing/ready states map to pending/running/completed in the shared runtime.
Failed and cancelled tasks are terminal; HTTP 200 alone does not mean successful generation.
Native error data includes code, retryable, request_id, details and remediation. HTTP errors
preserve the native retryability hint; the core's existing retry logic performs any retry.
Terminal task and asset errors retain the response and provider metadata for diagnosis.
Unknown progress-stage labels do not invalidate a recognized lifecycle state.

`renders.events(id, { lastEventId })` opens one authenticated SSE connection and returns an
async iterable. It parses event frames; it does not start a polling loop, automatically reconnect,
or claim to stream generated video bytes. On a connection failure, the caller can reconnect with
the last fully handled event ID. If history is unavailable, use `videos.get` as the authoritative
snapshot. Other resource families are polled through their normal GET endpoints.

`renders.download(id)` returns `{ url, response }` from the native HTTP 302 without following
the redirect. Download the signed URL separately without the Viggle Bearer token. Generation
results also contain references; no large video/image/3D file is downloaded implicitly.

Viggle does not publish a client cancellation endpoint. Render may independently become
cancelled, but local abort only stops local work. Character/Motion delete is resource deletion,
not remote cancellation. No submission-level webhook capability is advertised.

Native output is retained as `providerMetadata.viggle.output` for assets and in the applicable
native task result. Video+alpha and all image outputs are preserved. Asset mapping does not
scan arbitrary prompt, input or metadata URLs and mistake them for generated files.

Signed output URLs normally last one hour and are refreshed by re-reading the result or export.
Generated images are deleted after 24 hours; their historical task can still be ready while
each `images[].url` is null. Direct resource GET keeps that history available, while an asset
completion without its promised files fails. It must never silently submit replacement work.
Store required outputs in application-owned storage before the provider's retention expires.

References: [async jobs](https://docs.viggle.ai/v1/production/async-jobs),
[errors](https://docs.viggle.ai/v1/production/errors),
[SSE](https://docs.viggle.ai/v1/api-reference/renders/events),
[download](https://docs.viggle.ai/v1/api-reference/renders/download),
[image status](https://docs.viggle.ai/v1/api-reference/images/get),
[retention](https://docs.viggle.ai/v1/pricing).

## Verification and documentation differences

The contract tests cover the semantic video/image requests, multipart file preservation,
native response retention, distinct alpha outputs, JSON draft idempotency, SSE chunks,
manual downloads, error recovery, unsafe-integer seeds and restoration without resubmission.
Type tests check required sources, known field types, mutually exclusive inputs and separation
between generation and processing. Domain-specific tests cover Character/Motion/Scene calls.

The official overview and generated schemas are not entirely synchronized. Examples include
the overview omitting the video upscaler, generic video schemas showing the wrong ID prefix
for upscaling, and automatic examples combining incompatible video-mode fields. Scene-specific
pages additionally document multipart forms that the overview's all-JSON wording does not.
Endpoint-specific parameter descriptions take precedence in the adapter's contract; the
remaining live behavior must be checked with an authorized Viggle account.

No claims are made that old product names such as Mix Turbo, Multi, Move or Mic are separately
callable V1 APIs. The provider implements the published resource contract, without a second
polling engine, persistent queue, automatic asset cleanup or hidden multi-stage composition.
