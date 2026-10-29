# @sinestack/ai-provider-utils

English | [简体中文](https://github.com/fei-bai-inc/sinestack-ai/blob/main/packages/provider-utils/README.zh-CN.md)

Helpers for provider adapters: validate JSON, map native output to file references, and send authenticated HTTP requests. Use them when implementing a custom adapter or adapting a provider's response schema.

## Install

```sh
npm install @sinestack/ai-provider-utils
```

Use Node.js 22 or 24 with ESM (`.mjs`, or `"type": "module"`). The package requires Node >=22. If your application also executes tasks through core, install `@sinestack/ai-core ai@7.0.155`.

## Parse a file response

Save as `example.mjs` and run `node example.mjs`. This example parses local data; the example URL is a file reference and is never fetched.

```js
import { jsonObject, mapAssetResult } from '@sinestack/ai-provider-utils';

const output = jsonObject({
  files: [{
    url: 'https://example.com/model.glb',
    content_type: 'model/gltf-binary',
    file_name: 'model.glb',
  }],
}, 'provider output');

const result = mapAssetResult(output);
for (const asset of result.assets) {
  console.log(asset.type, asset.mediaType, asset.filename);
}
```

`mapAssetResult` recognizes root URLs, file lists, and nested file objects. It deduplicates URLs and infers media types from extensions when needed. For a provider-specific schema, supply your own `mapResult` through `AssetModelMapping`.

## Public helpers

| Export | Use |
|---|---|
| `jsonValue`, `jsonObject` | Copy finite, acyclic, plain JSON data; `jsonObject` requires an object root. |
| `record` | Validate a plain object before reading protocol fields. |
| `errorMessage` | Extract a message from common error response shapes. |
| `httpURL` | Parse an absolute HTTP(S) URL; reject embedded credentials and fragments. |
| `mapAssetResult` | Convert native file references into an `AssetModelV1Result` with a nonempty `assets` array. |
| `snapshotAssetMapping` | Capture and bind optional input/result mapping functions, including prototype methods. |
| `AssetProviderTransport` | Send one authenticated GET, JSON/multipart POST, PUT, or DELETE request; decode its response or return a raw stream. |
| `invalidResponse` | Convert a malformed protocol response into a non-retryable API error. |
| `AssetProviderTransportOptions`, `AssetProviderResponse` | Type transport configuration and returned response data. |
| `AssetProviderResponseHandlers`, `AssetProviderRawRequestOptions` | Customize per-request decoding or raw response handling. |

## Request provider JSON

This helper reads a status URL using your provider's API base URL and credentials. Pass the absolute status URL documented by the provider, within the configured base URL's origin and path prefix.

```js
import { AssetProviderTransport, jsonObject } from '@sinestack/ai-provider-utils';

export async function readStatus({ baseURL, statusURL, apiKey, signal }) {
  const transport = new AssetProviderTransport({
    provider: 'custom',
    baseURL,
    apiKey,
    environmentVariableName: 'CUSTOM_API_KEY',
  });
  const response = await transport.request(statusURL, 'GET', {
    headers: {},
    abortSignal: signal,
  });
  return jsonObject(response.value, 'task status');
}
```

Pass an `AbortSignal`, such as `new AbortController().signal`. The transport reads the supplied server-side `apiKey` or `CUSTOM_API_KEY` environment variable and uses Bearer authentication by default; set `authorizationScheme: 'Key'` for APIs that require it. Remote calls use the provider account and may incur charges.

For writes, pass a JSON object as the fourth `request` argument, or `FormData` for multipart POST. DELETE accepts an empty 200/204 response when the fifth argument is `true`; use it for deletion endpoints that document an empty response. Deletion and remote cancellation are separate operations.

The sixth `request` argument accepts `successfulResponseHandler` and `failedResponseHandler` using the AI SDK `ResponseHandler` contract. Use these for provider-specific decoding, such as lossless JSON, while retaining shared authentication and destination checks.

`requestRaw(url, method, options, { accept, redirect, failedResponseHandler })` returns an unconsumed `Response`; the caller must read or cancel its body. It accepts no request body. `redirect` defaults to logical rejection; explicit `'manual'` exposes a 301/302/303/307/308 response for inspection without following its `Location`.

All network calls use physical `redirect: 'manual'`, which workerd supports; the default policy still rejects redirects. Custom fetch must not follow them. Keep signed storage uploads separate from authenticated API requests. Apply your provider's schema and your application's download authorization policy as well.

## Guides

- [Media providers](https://github.com/fei-bai-inc/sinestack-ai/blob/main/docs/MEDIA_PROVIDERS.md): input and result mapping
- [Architecture](https://github.com/fei-bai-inc/sinestack-ai/blob/main/docs/ARCHITECTURE.md): adapter and lifecycle contracts
- [Security](https://github.com/fei-bai-inc/sinestack-ai/blob/main/SECURITY.md): credentials, custom fetch, and URL handling
- [Transport source](https://github.com/fei-bai-inc/sinestack-ai/blob/main/packages/provider-utils/src/transport.ts): request options and response handling
