# @sinestack/ai-viggle

Viggle V1 provider for SineStack AI. Typed H3 video, character animation, video remix,
image generation, upscaling, reusable Character/Motion resources, 3D exports and Gaussian-splat
scenes use the existing shared execution runtime. Resource APIs also expose rendering drafts,
SSE, downloads, lists, deletion and account balance.

## Install and connect

```sh
npm install @sinestack/ai-viggle @sinestack/ai-core ai@7.0.155
```

The current `@sinestack/ai-core` peer requirement is **`ai@7.0.155`**. The provider package uses
the same AI SDK provider contracts and helpers as the other SineStack providers. Node consumers
require Node 22 or newer.

```ts
import { createViggleProvider } from '@sinestack/ai-viggle';

const viggle = createViggleProvider({
  // Optional in Node: otherwise loaded from VIGGLE_API_KEY.
  apiKey: process.env.VIGGLE_API_KEY,
  connectionId: 'production-viggle-account',
  // The configured base URL includes /v1.
  // baseURL: 'https://apis.viggle.ai/v1',
  // fetch: customFetch,
  // headers: { 'X-Viggle-Source': 'my-app' },
});
```

## Generate and resume video

```ts
import { startAsset, waitForAsset } from '@sinestack/ai-core';

const model = viggle.firstFrameToVideo();
const started = await startAsset({
  model,
  input: {
    prompt: 'A character waves toward the camera',
    quality: 'high',
    first_frame_image_url: 'https://example.com/character.png',
    duration_s: 5,
    resolution: '1080p',
    seed: 42,
  },
});
await saveOperation(started.operation); // Application-owned persistence.

const result = await waitForAsset({ model, operation: started.operation });
console.log(result.assets); // File references; nothing is downloaded implicitly.
```

Other video factories are `textToVideo()`, `firstLastFrameToVideo()`, `referenceToVideo()`,
`characterAnimation()`, `renderVideo()` and `renderDraft()`. `image()` returns an image asset
model. `upscaleVideo()` returns a processing task driver for `startTask` / `waitForTask`.

Keep the returned receipt before waiting and reconstruct the same authorized connection on
resume. Status polling never creates a replacement job. Draft preparation, uploads, draft
submission and later upscaling remain explicit; there are no hidden paid chains.

## Characters, motion and scenes

```ts
import { generateAnimation3D, startTask, waitForTask } from '@sinestack/ai-core';

const characterCreator = viggle.createCharacter();
const characterStart = await startTask({
  model: characterCreator,
  input: { type: 'vsplat', enhance_prompt: 'A small knight in blue armor' },
});
const character = await waitForTask({ model: characterCreator, task: characterStart.task });
const exported = await viggle.characters.export(character.result.id, 'vsplat');
console.log(exported.vsplat_url);

const motion = await generateAnimation3D({
  model: viggle.textToMotion({ format: 'glb' }),
  input: { text: 'A person walks and turns left', duration_seconds: 5 },
});
console.log(motion.assets); // Mixamo, MetaHuman and MetaHuman-body variants.

const sceneCreator = viggle.createScene();
const sceneStart = await startTask({
  model: sceneCreator,
  input: { sessionId: 'courtyard-01', prompt: 'A quiet courtyard at sunrise' },
});
const { result: sceneTask } = await waitForTask({ model: sceneCreator, task: sceneStart.task });
console.log(sceneTask.result?.spz?.url);
```

Each creation in these examples is an explicit provider operation when executed. Character
and Motion creation return native reusable resources. Their exports are separate reads.
Scene creation, new views and reconstruction keep their session and image-batch identities;
the adapter does not silently compose them into one workflow. 3D splats and standalone motion
are not presented as textured meshes or rigged-character animation.

## Native contracts and runtime behavior

- Native parameter names and extra JSON fields are retained; `Blob` inputs use multipart.
  `providerOptions.viggle` supplements input and rejects conflicting keys.
- Factories follow Viggle's actual endpoint semantics. Only documented model-selector fields
  accept model versions; the SDK does not maintain a model whitelist or invent model selectors
  for endpoint-selected backends.
- `characterAnimation()` requires a driving video. H3 frame/reference generation and video
  remix have different inputs. Multi-character Animate prompts and mode-specific duration
  limits are documented in the full guide.
- Native outputs remain in `providerMetadata.viggle.output` or the task's native result.
  Foreground and alpha files, batch images and all returned motion rigs are preserved.
- Unsafe 63-bit H3 seeds are preserved as exact decimal strings. Provide a safe numeric seed
  when ordinary JavaScript number handling is preferred.
- Local abort stops local waiting. Viggle V1 does not publish client-triggered cancellation.
  Character/Motion deletion is resource removal, and no per-submission webhook is invented.
- `renders.events()` parses one SSE stream with optional `lastEventId`; reconnection belongs
  to the host. `renders.download()` exposes the signed HTTP redirect without forwarding the
  API key to the file host.
- `renders.upload(plan, blob)` performs one signed PUT with only the upload plan's headers,
  preserves the quoted ETag, and refuses redirects. Preparing, uploading and submitting a
  draft remain explicit steps.
- Output links are short-lived. Refresh them through the native result/export endpoint and
  store required files explicitly; completed image files are retained by Viggle for 24 hours.

The provider uses native Fetch, Blob, FormData and Web Streams. In Cloudflare Workers, pass
the binding explicitly with `createViggleProvider({ apiKey: env.VIGGLE_API_KEY })`; schedule
long-running work and persist receipts in the host's existing durable task system. The SDK
does not add a Worker-specific polling or persistence engine.

Full endpoint coverage, native parameters, examples, retention rules and protocol references:
[VIGGLE.md](https://github.com/fei-bai-inc/sinestack-ai/blob/main/docs/VIGGLE.md).

The automated verification uses mocked HTTP, not live paid Viggle calls. Adding this package
to the repository does not itself publish it to npm.
