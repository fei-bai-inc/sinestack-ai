# @sinestack/ai-viggle

English | [简体中文](https://github.com/fei-bai-inc/sinestack-ai/blob/main/packages/viggle/README.zh-CN.md)

Generate video and images with Viggle, animate characters, upscale videos, and create reusable Character/Motion resources, skeletal motion exports, and Gaussian-splat scenes.

## Install

```sh
npm install @sinestack/ai-viggle @sinestack/ai-core ai@7.0.155
```

Use Node.js 22 or newer with ESM (`.mjs` or `"type": "module"`). The `ai@7.0.155` peer dependency is required. Set `VIGGLE_API_KEY` on the server.

## Generate a video

Save this example as `example.mjs` and run `node example.mjs`. It submits one video generation job, which may use paid Viggle credits.

```js
import { generateAsset } from '@sinestack/ai-core';
import { createViggleProvider } from '@sinestack/ai-viggle';

const viggle = createViggleProvider();
const result = await generateAsset({
  model: viggle.textToVideo(),
  input: {
    prompt: 'A paper airplane glides through a sunlit studio',
    quality: 'high',
    duration_s: 5,
    resolution: '1080p',
    enhance: false,
    seed: 42,
  },
});
console.log(result.assets);
```

H3 requires both `prompt` and `quality`, including frame- and reference-conditioned generation. Set `enhance: false` to request the prompt unchanged. Results contain file references; download and store required files explicitly.

## Choose a workflow

| Goal | Viggle factories | Core helper |
| --- | --- | --- |
| Generate H3 video | `textToVideo()`, `firstFrameToVideo()`, `firstLastFrameToVideo()`, `referenceToVideo()` | `generateAsset` |
| Animate or render characters | `characterAnimation()`, `renderVideo()`, `renderDraft()` | `generateAsset` |
| Generate images | `image()` | `generateAsset` |
| Upscale video by 2x | `upscaleVideo()` | `startTask` / `waitForTask` |
| Create reusable resources | `createCharacter()`, `createMotionFromVideo()`, `createMotionFromText()`, `importMotion()` | `startTask` / `waitForTask` |
| Export standalone skeletal motion | `textToMotion({ format })`, `videoToMotion({ format })` | `generateAnimation3D` |
| Create and reconstruct scenes | `createScene()`, `createSceneFromPanorama()`, `generateSceneViews()`, `reconstructScene()` | `startTask` / `waitForTask` |

Character/Motion tasks return native reusable resource records. Read their exports after the requested processing is ready. The motion asset factories also obtain the selected GLB/FBX export and preserve all returned rigs. Character `.vsplat`, skeletal motion, and scene `.spz` files have distinct uses; a ready 3D Motion does not imply a render-ready 2D driving video.

## Inputs, resources, and files

Use native parameter names and `Blob` uploads or URL sources. `providerOptions.viggle` supplements input and rejects conflicting keys. Only endpoints with a documented `model` field accept model selection; H3, Animate, Image, and the fixed 2x upscaler use endpoint-selected backends.

Native outputs remain in `providerMetadata.viggle.output` or the task result, including alpha masks, batch images, and motion rig variants. Unsafe H3 integer seeds remain exact decimal strings; use a safe integer seed for numeric JavaScript handling.

Resource methods expose `videos`, `images`, `renders`, `characters`, `motions`, `scenes`, and `credits`. Lists return one native page. `renders.events(id, { lastEventId })` opens one SSE stream; the host manages reconnection. `renders.download(id)` returns the signed redirect URL without following it. Fetch that URL without the API key.

Draft preparation, each upload, and draft submission are explicit steps. `renders.upload(plan, blob)` sends one signed PUT using only the plan's required headers, preserves the quoted ETag, and rejects redirects. Let Fetch set multipart boundaries. Output URLs normally last one hour; refresh them through result/export reads. Generated images expire after 24 hours.

## Save and resume stages

Use `startAsset` / `waitForAsset` or `startTask` / `waitForTask` for background work. Persist each full `operation` or `task` receipt and restore it on the same authorized connection, base URL, and capability. A persistence or download failure should not cause another paid submission. Receipts contain no API key.

Generation, upscaling, reusable-resource creation, and scene stages are separate operations. Carry scene sessions and batch references forward explicitly. Ordinary submissions default to zero retries; draft and selected text/GLB Motion requests have specific idempotency contracts described in the guide. Local abort stops local work, not remote generation. Character/Motion deletion removes resources; Viggle publishes no client cancellation endpoint or submission webhook.

## Connection and Workers

`createViggleProvider` accepts `apiKey`, `baseURL`, `headers`, `fetch`, `name`, and `connectionId`. The default API root is `https://apis.viggle.ai/v1`; custom roots must include the intended API path. Per-call headers cannot replace the configured Bearer credential.

In Cloudflare Workers, pass the account binding explicitly: `createViggleProvider({ apiKey: env.VIGGLE_API_KEY })`. Use the host's durable scheduler and receipt storage for long-running work. Four local checks are recorded for workerd `1.20261029.1` with mocked HTTP; they are not live Viggle or cloud deployment acceptance.

## Guides

- [Viggle: native inputs, recovery, security, and retention](https://github.com/fei-bai-inc/sinestack-ai/blob/main/docs/VIGGLE.md)
- [Core: task lifecycle and file materialization](https://github.com/fei-bai-inc/sinestack-ai/blob/main/packages/core/README.md)
- [workerd reproduction and recorded evidence](https://github.com/fei-bai-inc/sinestack-ai/blob/main/tests/workerd/README.md)
