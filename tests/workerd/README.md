# Manual Viggle workerd smoke

This fixture runs four provider integration checks in the real Cloudflare `workerd` runtime.
It imports the compiled public package entry points with repository-relative paths and uses
an injected mock fetch for every API and storage response. It does not contact Viggle, spend
credits, deploy a Worker, open an HTTP listener, or require a Cloudflare account.

## Reproduce

Run from the repository root with the workspace dependencies already installed:

```sh
npm run build
viggle_worker_tools="$(mktemp -d /tmp/sinestack-viggle-workerd.XXXXXX)"
npm install --prefix "$viggle_worker_tools" --save-exact --no-audit --no-fund workerd@1.20261029.1 esbuild@0.28.2
node tests/workerd/build.mjs "$viggle_worker_tools"
"$viggle_worker_tools/node_modules/.bin/workerd" test "$viggle_worker_tools/viggle-smoke-output/config.capnp"
```

Both tools and generated bundle/configuration/metafile are written under the temporary
directory. No repository dependency or CI configuration is changed. The bundle uses esbuild's
browser platform, ESM output, ES2022 target and `workerd`/`worker`/`browser` conditions. The
build rejects external imports, so an unresolved Node module cannot silently escape into
the Worker runtime.

Verified on 2026-10-29 with:

| Setting | Value |
|---|---|
| `workerd` npm package | `1.20261029.1` |
| `workerd --version` | `workerd 2026-10-29` |
| esbuild | `0.28.2` |
| `compatibilityDate` | `2026-10-29` |
| `compatibilityFlags` | `[]` |
| Explicit `nodejs_compat` | Not enabled |
| `lossless-json` in the provider bundle | `4.3.3` |
| `eventsource-parser` in the provider bundle | `3.1.1` |

## What the four checks establish

| Entrypoint | Assertion |
|---|---|
| `textVideoSmoke` | Core `startAsset` and `waitForAsset` run; a serialized receipt restores through one GET; H3's unsafe integer seed survives as the exact decimal string. |
| `multipartBlobSmoke` | Native Blob bytes survive FormData serialization and `Request.formData()` parsing, with a generated multipart boundary. |
| `renderEventsSmoke` | `eventsource-parser` and native TextDecoderStream parse an SSE event split across byte chunks; the resume header is preserved and no reconnect occurs. |
| `signedUploadSmoke` | A signed PUT preserves binary data and the quoted ETag; API credentials stay off the storage request; native request handling uses manual redirects. |

Every mock first validates its request with workerd's native `Request`. This matters because
workerd rejects `redirect: 'error'`; the shared transport uses physical `manual` mode and
rejects unwanted redirects itself. The mock cannot hide that request-initialization error.

Expected result: four `[ PASS ]` entries and exit status 0. This is local runtime compatibility
verification with mocked HTTP, not live Viggle acceptance, Cloudflare deployment acceptance,
or a guarantee for every compatibility date and bundler configuration. Long-running task
scheduling and persistent receipt storage remain the application's responsibility.
