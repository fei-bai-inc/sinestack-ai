# Generic Media Provider Interfaces

English | [简体中文](MEDIA_PROVIDERS.zh-CN.md)

This guide covers the three generic asset adapters: fal, WaveSpeed, and Replicate. They integrate platform protocols without maintaining model catalogs, selecting default models, or treating one model's schema as the schema for an entire capability. For the native domain entry points of Tripo and Meshy, see [TRIPO.md](TRIPO.md) and [MESHY.md](MESHY.md), respectively.

## Install from npm

Use Node.js 22 or 24 with ESM (`.mjs` or `"type": "module"` in your project). Choose a provider as needed; core's AI SDK peer must be `ai@7.0.155`:

```sh
npm install @sinestack/ai-core ai@7.0.155 @sinestack/ai-fal
# Or replace fal with @sinestack/ai-wavespeed / @sinestack/ai-replicate.
```

Set the credentials from the connection table below on the server, choose an actually available model, and follow its native input schema. Running submissions may incur charges; installing the SDK does not provide accounts, credits, or model access. For examples you can save and run directly, see the [fal README](../packages/fal/README.md), [WaveSpeed README](../packages/wavespeed/README.md), and [Replicate README](../packages/replicate/README.md). The snippets below only demonstrate model/mapping composition.

## Arbitrary Models and Asset Kinds

fal, WaveSpeed, and Replicate all provide:

```ts
provider.music(modelId, mapping?);
provider.threeD(modelId, mapping?);
provider.soundEffect(modelId, mapping?);
provider.animation3D(modelId, mapping?);
provider.asset(modelId, { kind, mapInput?, mapResult? });
```

modelId is required and is checked only for the safe path or version format required by the platform; there is no built-in allowlist. Capability entry points only set kind; for example, `music(id)` and `asset(id, { kind: 'music' })` use the same protocol class. New kinds also use `.asset()` without extending the executor.

The caller is responsible for selecting a model that exists and accepts the intended task, and for providing native JSON matching its schema. Adapters support models using the same platform protocol but do not automatically infer each model's parameters, quotas, permissions, or output semantics.

## Native Input Is the Default

```ts
const model = fal.music('your-owner/your-music-model');
const result = await generateMusic({
  model,
  input: {
    text: 'Describe the requested music',
    duration: 120,
    custom_model_setting: { enabled: true },
  },
});
```

The application defines these fields according to the target model. The SDK does not trim or rename them, or impose another model's duration, prompt-length, polygon-count, or enum restrictions. `providerOptions.<provider>` can add fields but cannot override same-named keys already supplied by input or returned by mapInput.

The four core capability facades support the `{ model, input }` signature for arbitrary INPUT, preserve kind and input type checks, and ultimately only call `generateAsset`. Legacy flattened prompt / durationSeconds overloads are marked deprecated and exist only for compatibility with explicit input mappings or custom models; they are not a universal native schema for all remote models.

## Externally Supplied Mappings

`AssetModelMapping<INPUT>` contains two independently optional functions:

```ts
interface AssetModelMapping<INPUT> {
  mapInput?(input: INPUT): JSONObject | PromiseLike<JSONObject>;
  mapResult?(output: JSONValue): AssetModelV1Result | PromiseLike<AssetModelV1Result>;
}
```

Without mapInput, a safe native JSON snapshot is used; without mapResult, the public `@sinestack/ai-provider-utils.mapAssetResult` is used. You can replace either one independently. Supplied functions are validated before submission, and configuration and function references are snapshotted.

For example, an application can choose unified business fields and parse a special mesh field:

```ts
import type { AssetModelMapping } from '@sinestack/ai-provider';

interface GeometryRequest { description: string; detail: number }

const mapping: AssetModelMapping<GeometryRequest> = {
  mapInput: input => ({ text: input.description, steps: input.detail }),
  mapResult(output) {
    if (output === null || typeof output !== 'object' || Array.isArray(output) ||
        !('mesh_url' in output) || typeof output.mesh_url !== 'string') {
      throw new TypeError('Expected the endpoint-specific mesh_url');
    }
    return {
      assets: [{
        type: 'url', url: output.mesh_url, mediaType: 'model/gltf-binary',
      }],
    };
  },
};

const model = fal.threeD<GeometryRequest>('your-owner/your-geometry-model', mapping);
```

This mapping can come from any external package and be injected by the host. The SDK does not need to register the modelId. If the model outputs common File objects, a result mapper is usually unnecessary as well.

## Native Results and Files

| Provider | Native JSON passed to the mapper | Retained at |
|---|---|---|
| fal | Complete result endpoint body | `providerMetadata.fal.output` |
| WaveSpeed | Prediction's `data.outputs` | `providerMetadata.wavespeed.output` |
| Replicate | Prediction's `output` | `providerMetadata.replicate.output` |

The output snapshot, mapper argument, and original response body are isolated from one another. A mapper cannot override the real output or task ID. `name` changes the connection/operation identity, not the metadata namespaces above.

Default file parsing supports:

- Root HTTP(S) URLs and root arrays of URLs.
- Explicit `{ url, content_type?, file_name?, file_size? }` File objects and their nested arrays and objects.
- Common file-list containers such as `files / assets / output / outputs`.
- URL deduplication, preserving first-occurrence order and available explicit file metadata.

It does not scan prose for links or automatically interpret ordinary metadata strings or unknown private fields such as `mesh_url` as files. Inject mapResult for special schemas. MIME types prefer explicit provider values, then known filename extensions; unknown formats use application/octet-stream.

The asset result contract for these three adapters requires nonempty, real `assets` and still provides a nonoptional `result.asset`. Plain text, classification, and arbitrary JSON predictions without files are outside this contract; core's analysis/check domain APIs, by contrast, do not require files. Mapping failures preserve the original operation and do not resubmit the task. URLs are not downloaded automatically; explicitly call `materializeAsset` when bytes are needed.

## Connections and Resumption

| Provider | Default baseURL | Default environment variable | Authentication |
|---|---|---|---|
| fal | `https://queue.fal.run` | `FAL_KEY` | `Key` |
| WaveSpeed | `https://api.wavespeed.ai/api/v3` | `WAVESPEED_API_KEY` | `Bearer` |
| Replicate | `https://api.replicate.com/v1` | `REPLICATE_API_TOKEN` | `Bearer` |

Connections support explicit apiKey, baseURL, headers, fetch, and name. baseURL may include a proxy path prefix but must not contain credentials, a query, or a fragment. Authentication is locked by connection configuration; API requests reject redirects. These adapters retain older exact provider-utils dependencies that use `redirect: 'error'`; current provider-utils uses physical `'manual'` with logical rejection. Custom fetch must honor the supplied mode and never follow redirects.

After startAsset returns, the application must explicitly persist the entire operation and retain the original connection identity. Resumption requires the same platform, modelId, kind, API address, and original account, using getAssetStatus/waitForAsset to query the same task. An operation does not store secrets and cannot independently prove tenant/credential identity. On persistence failure, retain the credentials and retry saving them; download failures must not trigger new billable submissions either.

WaveSpeed and Replicate construct status and cancellation URLs from a fixed baseURL and validated prediction ID rather than arbitrary URLs in responses. fal validates the queue URL's origin, owner/app, request ID, and operation path.

## Protocol-Specific Behavior

### fal

POST to the full model path; GET status, then GET result on completion; PUT for cancellation. All kinds use the same queue model. Model-specific parameters are not part of protocol validation.

### WaveSpeed

Submit native JSON with POST `/{full modelId}` and retrieve status and outputs with GET `/predictions/{id}/result`. Multisegment model paths are supported. created/queued map to pending; other nonempty, nonterminal statuses map to running; failed/timeout/deleted map to failed, and cancelled maps to cancelled.

If a synchronous wait times out but returns an ID, processing, and data.code:5004, the task is retained and querying continues; data.error does not cause resubmission. enable_sync_mode and webhook cannot be used together.

Bare base64 does not provide reliable file-format information. Enabling enable_base64_output:true requires an explicit mapResult through which the application supplies the correct mediaType; external implementations capable of parsing the data themselves are not restricted. The platform's mutual exclusion of base64 and webhook is still validated.

WaveSpeed's deletion endpoint deletes task history, not running inference; this adapter exposes neither a deletion API nor doCancel, and cancelAsset reports unsupported. fal and Replicate support cancelAsset but likewise provide no deletion API.

### Replicate

owner/model uses POST `/models/{owner}/{model}/predictions`. Pinned versions support `owner/model:full-64-character-version` or the mapping's `version`, using POST `/predictions` with `{ version, input }`. If both forms specify a version, they must match.

GET prediction queries the original task, and POST `/predictions/{id}/cancel` cancels it. Only observing canceled returns cancelled; if execution is ongoing, the result is requested. When cancellation races with succeeded/failed, an error is reported and the original operation is retained; continue querying the original task to confirm its result.

## Retries, Cancellation, and Webhooks

None of the three adapters declares submission idempotency. Submission retries default to 0, and positive values are rejected by core's idempotency gate. Queries, polling, cancellation signals, and hooks remain orchestrated by the single core implementation using basic AI SDK mechanisms. Client timeouts and local aborts do not indicate remote failure and do not automatically cancel generation.

fal uses the fal_webhook query parameter; WaveSpeed uses an HTTPS standard_webhook query parameter; Replicate uses an HTTPS webhook and completed event filtering. Adapters send callback URLs; the host is responsible for signature verification, correlation, and deduplication. After notification, core queries the same operation.

## Reuse and Verification Boundaries

Shared provider-utils contains JSON/file mapping, destination validation, and single HTTP operations. Default-policy GET/POST use SDK getFromApi/postJsonToApi; fal PUT retains one fetch with SDK response handlers. Current per-request decoders and `requestRaw` support Viggle's lossless JSON and streams without adding polling/retry loops. These extensions do not replace these adapters' older pinned transport versions; see [transport contracts](ARCHITECTURE.md#shared-transport-extensions).

Tests use model IDs never registered with the SDK to verify arbitrary native fields, default file parsing, external mapping, resumption, cancellation, URL/configuration binding, and no submission retries. Node 22/24 are verification targets. The separate [Viggle/core workerd fixture](../tests/workerd/README.md) records mocked-network runtime checks, not workerd acceptance for these three adapters or live billable calls.

Protocol sources: [fal Queue](https://docs.fal.ai/model-apis/model-endpoints/queue), [WaveSpeed submit](https://wavespeed.ai/docs/submit-task), [result](https://wavespeed.ai/docs/get-result), [sync](https://wavespeed.ai/docs/sync-mode), [webhooks](https://wavespeed.ai/docs/how-to-use-webhooks), [base64](https://wavespeed.ai/docs/base64-output), [delete](https://wavespeed.ai/docs/delete-task), and [Replicate HTTP API](https://replicate.com/docs/reference/http).
