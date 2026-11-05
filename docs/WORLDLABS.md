# World Labs provider

English | [简体中文](WORLDLABS.zh-CN.md)

`@sinestack/ai-worldlabs` connects the World Labs Marble World API to SineStack AI's existing asset lifecycle. Protocol references: [OpenAPI](https://docs.worldlabs.ai/api/reference/openapi.yaml), [quickstart](https://docs.worldlabs.ai/api/index.md), and [generation examples](https://docs.worldlabs.ai/api/world-generation-examples.md), reviewed on 2026-11-05. This document describes the adapter contract, not live API acceptance.

## Install and connect

```sh
npm install @sinestack/ai-worldlabs @sinestack/ai-core ai@7.0.155
```

Use Node >=22 and ESM. Keep API keys server-side. Obtain an API key and API credits through the [World Labs platform](https://platform.worldlabs.ai); account entitlements and charges are controlled by World Labs.

```ts
import { createWorldLabsProvider } from '@sinestack/ai-worldlabs';

const worldlabs = createWorldLabsProvider({
  // Omit apiKey to read WORLDLABS_API_KEY in a Node server environment.
  apiKey: process.env.WORLDLABS_API_KEY,
  connectionId: 'production-worldlabs-account',
  // baseURL: 'https://api.worldlabs.ai/marble/v1',
  // fetch: customFetch,
  // headers: { 'X-Application': 'world-editor' },
  // name: 'worldlabs',
});
```

Settings are `apiKey`, `baseURL`, `fetch`, `headers`, `name`, and `connectionId`. The default API root is `https://api.worldlabs.ai/marble/v1`. Authentication sends the raw key as `WLT-Api-Key`, without a Bearer prefix. The shared transport's `apiKeyHeader` option supplies this behavior; older providers retain their existing exact transport versions. A custom fetch is trusted to honor destination, signal, credential and redirect restrictions. In hosts with secret bindings, pass the key explicitly; environment fallback does not read arbitrary host bindings.

## Factories and native inputs

Every factory produces an `AssetModelV1` and works with `generateAsset`, `startAsset`, `getAssetStatus`, and `waitForAsset`.

| Factory | Output kind | Native request |
|---|---|---|
| `world(modelId, mapping?)` | `gaussian-splat` | `POST /worlds:generate`; factory supplies `model` |
| `depthToPanorama(mapping?)` | `image` | `POST /pano:depth_to_rgb` |
| `exportSplat(mapping?)` | `gaussian-splat` | `POST /worlds/{world_id}:export`; `asset_type: 'splats'`, `format: 'ply'` |
| `exportMesh(mapping?)` | `model-3d` | `POST /worlds/{world_id}:export`; `asset_type: 'mesh'`, `format: 'glb'` |

`world` requires an explicit model ID. `marble-1.1` is the quickstart model; future strings are accepted without a package release. This is not an availability guarantee. See [API models](https://docs.worldlabs.ai/api/models.md).

```ts
import { generateAsset } from '@sinestack/ai-core';

const generated = await generateAsset({
  model: worldlabs.world('marble-1.1'),
  input: {
    display_name: 'Sunlit greenhouse',
    world_prompt: {
      type: 'text',
      text_prompt: 'A sunlit greenhouse with winding stone paths',
    },
  },
});
```

`WorldLabsWorldInput` retains native field names and requires `world_prompt`. Optional top-level fields include `display_name`, `seed`, `tags`, `permission`, and `model`; a supplied `model` must agree with the factory. JSON extension fields allow new provider parameters without weakening known field types.

| `world_prompt.type` | Required source | Other native fields |
|---|---|---|
| `text` | `text_prompt` | Text prompt fields |
| `image` | `image_prompt` | `is_pano: boolean \| 'auto'`, optional `text_prompt`, `disable_recaption` |
| `multi-image` | `multi_image_prompt: { content, azimuth? }[]` | Optional `reconstruct_images`, `text_prompt`, `disable_recaption` |
| `video` | `video_prompt` | Optional `text_prompt`, `disable_recaption` |

Media references use a discriminated `source`: `{ source: 'uri', uri }`, `{ source: 'media_asset', media_asset_id }`, or `{ source: 'data_base64', data_base64, extension? }`. World Labs fetches URI inputs directly; they must be accessible to its servers without application cookies or credentials. This SDK does not fetch and re-upload URI inputs.

```ts
const fromPanorama = await generateAsset({
  model: worldlabs.world('marble-1.1'),
  input: {
    world_prompt: {
      type: 'image',
      image_prompt: { source: 'uri', uri: 'https://example.com/panorama.jpg' },
      is_pano: true,
    },
  },
});
```

Use `is_pano: true` only for a validated 360° equirectangular panorama, `false` for ordinary images, or `'auto'` for provider detection. Native media constraints remain service-owned.

`WorldLabsDepthToPanoramaInput` requires `depth_pano_image` (the same media-reference union) and `text_prompt`, with optional `z_min`, `z_max`, and `seed`. The [depth endpoint](https://docs.worldlabs.ai/api/reference/pano/depth_to_rgb.md) expects a full 360° 2:1 depth panorama. PNG depth requires both positive `z_min` and `z_max` with `z_max > z_min`; omit the limits for float-depth EXR. The service may crop non-2:1 inputs.

```ts
const panorama = await generateAsset({
  model: worldlabs.depthToPanorama(),
  input: {
    depth_pano_image: { source: 'uri', uri: 'https://example.com/depth.exr' },
    text_prompt: 'A warm wooden cabin with soft afternoon light',
  },
});

const splat = await generateAsset({
  model: worldlabs.exportSplat(),
  input: { world_id: worldId, resolution: '500k' },
});
const mesh = await generateAsset({
  model: worldlabs.exportMesh(),
  input: { world_id: worldId, mesh_variant: 'textured' },
});
```

Here `worldId` is an existing authorized world's ID. Export resolutions are `full_res`, `500k`, `150k`, or `100k`; mesh variants are `textured` or `vertex_colored`. Generation, depth conversion, and each export are separate service operations with their own receipts and possible charges.

`providerOptions.worldlabs` supplements native fields. Duplicate input keys and attempts to override the selected model, export family, or format are rejected. Each factory accepts an optional `AssetModelMapping<I>` to adapt application input and results. `mapResult` receives the original native `operation.response` snapshot, not a generic file wrapper or a later world lookup.

## Persist and resume operations

An operation ID identifies a job; a world ID identifies a persistent resource. Polling uses `GET /operations/{operation_id}`. `done: false` maps to `running`; `metadata.progress.description` may supply a progress message, but the adapter does not invent a numeric percentage. `done: true` with `error` maps to failure. Successful `response` data is decoded according to the factory.

A submission can already be complete, especially an export. Its completed native operation is retained inside the serializable receipt and reused without an extra GET. The completion snapshot is sufficient to produce the result; `worlds.get` is an explicit request for the latest resource.

```ts
import { startAsset, waitForAsset } from '@sinestack/ai-core';
import type { AssetOperation } from '@sinestack/ai-core';

async function submitWorld(save: (json: string) => Promise<void>) {
  const { operation } = await startAsset({
    model: worldlabs.world('marble-1.1'),
    input: { world_prompt: { type: 'text', text_prompt: 'A quiet stone courtyard' } },
  });
  try {
    await save(JSON.stringify(operation));
  } catch (cause) {
    throw Object.assign(new Error('World accepted but receipt was not saved', { cause }), { operation });
  }
  return operation;
}

async function resumeWorld(serialized: string) {
  const operation = JSON.parse(serialized) as AssetOperation<'gaussian-splat'>;
  return await waitForAsset({
    model: worldlabs.world(operation.modelId),
    operation,
    poll: { intervalMs: 2_000, timeoutMs: 20 * 60_000 },
  });
}
```

Use application-owned durable storage and scheduling. Save the full receipt explicitly after `startAsset`, rather than relying on best-effort observation hooks. Recover the same receipt after persistence, status, or download failures; another start can create another charge. A submission whose network response was lost cannot be assumed safe to repeat.

Resume with the original provider name, API root, connection ID, factory/route, model ID, and operation ID. The receipt does not contain the API key and is not an authorization token: the application must resolve the correct tenant/account before resuming. Runtime receipt checks do not replace authorization.

There is no declared idempotent start, submission webhook, SSE/watch, or remote cancellation support. Core defaults to zero submission retries. Local timeout or abort stops local work and cannot cancel an accepted operation. `worlds.delete` deletes a resource; it is not operation cancellation.

## Results, native output, and scale

World results require an actual splat asset. They list full-resolution SPZ first when present, then other SPZ resolutions, mesh assets, panorama, and thumbnail. The Marble viewer URL and caption are never mapped as downloadable assets. Depth conversion returns `pano_url`; exports return the native export URL. URL assets remain references until explicitly materialized; the adapter does not download, decode, render, transform or upload result files.

`providerMetadata.worldlabs` retains `operationId`, `output` (the original completion response), `operation` (the complete native operation), and `worldId` when available. Settled `cost.total_credits` becomes `usage.credits`; no price is inferred when cost is absent. Resource calls return native data, without a core result envelope.

The OpenAPI World schema uses `world_id`; the quickstart completion snapshot uses `id`. The adapter accepts either and rejects conflicting values. World GET responses may be a direct World or the quickstart's `{ world: World }` form; `worlds.get` returns the native World object from either representation without inventing missing fields.

Splat files retain `semantics_metadata` in file metadata and in native output. Following [World Labs rendering guidance](https://docs.worldlabs.ai/api/rendering-spz.md), multiply Gaussian centers and linear sizes by `metric_scale_factor`, then subtract `ground_plane_offset` from the scaled center's Y coordinate. Do not apply the ground offset to sizes. For log-scale sizes, add `log(metric_scale_factor)`. Renderer axis conversion is separate; the adapter does not silently transform SPZ data or assume scale values.

## Direct resources and uploads

| Method | Behavior |
|---|---|
| `worlds.get(id, options?)` | Read current native world data |
| `worlds.list(input = {}, options?)` | List worlds with native filters/pagination |
| `worlds.delete(id, options?)` | Explicitly delete an authorized world |
| `operations.get(id, options?)` | Read one native operation |
| `credits.get(options?)` | Read native API credit balance |
| `mediaAssets.prepareUpload(input, options?)` | Obtain a media asset and signed upload plan |
| `mediaAssets.get(id, options?)` | Read one native media asset |
| `mediaAssets.upload(prepared, body, { abortSignal }?)` | Perform one signed PUT; return void |

Upload preparation takes `{ file_name, kind: 'image' | 'video', extension?, metadata? }` and returns `{ media_asset, upload_info: { upload_url, upload_method, required_headers? } }`.

```ts
async function uploadImage(bytes: Blob | Uint8Array, abortSignal?: AbortSignal) {
  const prepared = await worldlabs.mediaAssets.prepareUpload({
    file_name: 'panorama.jpg', kind: 'image', extension: 'jpg',
  }, { abortSignal });
  await worldlabs.mediaAssets.upload(prepared, bytes, { abortSignal });
  return prepared.media_asset;
}
```

After uploading, use the returned media asset ID in a `source: 'media_asset'` reference for the next explicit generation call. Preparing/uploading media does not itself generate a world.

API requests remain inside the configured API origin/path boundary. Signed uploads are separate single PUT requests to the prepared URL, with only `required_headers`, `credentials: 'omit'`, and manual redirect rejection. They do not inherit API keys, provider headers or core request headers. Do not pass arbitrary untrusted upload plans; treat signed URLs as sensitive. Application download authorization remains necessary when materializing output URLs.

## Integration and verification boundary

The package participates in the normal TypeScript build, independent-version release registry, archive checks, and isolated npm-consumer runtime/type fixtures. See [publishing](PUBLISHING.md), [architecture](ARCHITECTURE.md), and [import-safe examples](../examples/worldlabs.ts). No dependency on an official World Labs SDK or separate retry/polling engine is introduced.

Mocked protocol fixtures can check serialization, operation recovery, native metadata, and credential routing. They do not prove live API entitlements, current pricing, world quality, actual asset decoding, all model/parameter combinations, or Cloudflare/workerd deployment. No live acceptance claim is made here.
