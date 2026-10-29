# Security

English | [简体中文](SECURITY.zh-CN.md)

## Reporting

Do not put valid API keys, signed download URLs, account data, or exploit details for unpatched vulnerabilities in public issues, pull requests, or logs.

Prefer the repository's [private vulnerability reporting page](https://github.com/fei-bai-inc/sinestack-ai/security/advisories/new). Its availability depends on GitHub's private vulnerability reporting setting. If it is unavailable, use the [maintainer's public contact page](https://github.com/liziyu1209) to request a private channel. Until that channel is established, state only that you need a security contact; do not disclose vulnerability details.

Include affected packages and versions, the runtime environment, a minimal reproduction, impact, and evidence with no real credentials. This repository does not currently promise a fixed response SLA or long-term support for older versions. Fixes will identify affected and corrected versions.

## Usage boundaries

- Store provider keys only in server-side environments or secure storage. Keep them out of browser bundles, repositories, error logs, and persisted task receipts.
- `TaskHandle` / `AssetOperation` are not authorization tokens. The host application must verify tenant, account, connection, and task ownership. The same baseURL does not prove the same account.
- Current shared authenticated transport sends `redirect: 'manual'` and rejects redirects by default; raw manual mode only exposes the original redirect response. Older exact transport dependencies used by fal/WaveSpeed/Replicate/Tripo/Meshy still use `redirect: 'error'`. Custom `fetch` must honor the supplied mode and never follow redirects. Separate signed uploads omit API keys and connection headers: Viggle uses manual mode and rejects redirects; Tripo requires error mode.
- File URLs are not downloaded automatically. Set an appropriate `maxBytes` when using `materializeAsset`; the host must restrict untrusted download destinations to prevent SSRF and own permanent file storage.
- Webhooks are not authoritative generation results. Tripo verification requires original request bytes, a trusted endpoint, and replay protection. `parseMeshyWebhook` parses only and explicitly does not authenticate. The host owns authorized association, durable deduplication, and querying the existing task.
- Local abort / timeout does not mean remote billable work has stopped. Do not create replacement tasks because polling, downloading, or persistence failed.
- Task/Asset errors can retain `response` and `providerMetadata`, including signed URLs, submitted content, and account details. Redact diagnostics before logging or sharing them.

See [architecture](docs/ARCHITECTURE.md), [Tripo](docs/TRIPO.md), [Meshy](docs/MESHY.md), [Viggle](docs/VIGGLE.md), and [aggregate providers](docs/MEDIA_PROVIDERS.md) for protocol details.

## Repository checks and limitations

CI uses fake credentials to verify protocol/security boundaries and checks the exact upstream dependency baseline. This is not a complete security audit and does not prove the safety of provider services, arbitrary custom transports, or host applications. If real credentials are exposed, revoke or rotate them first. Deleting the current file cannot withdraw Git history, npm packages, or downloaded copies.
