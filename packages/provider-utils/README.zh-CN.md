# @sinestack/ai-provider-utils

[English](https://github.com/fei-bai-inc/sinestack-ai/blob/main/packages/provider-utils/README.md) | 简体中文

面向 provider adapter 的辅助工具：校验 JSON、将原生输出映射为文件引用，以及发送带认证的 HTTP 请求。编写自定义 adapter 或适配供应商响应结构时，可以使用这些工具。

## 安装

```sh
npm install @sinestack/ai-provider-utils
```

使用 Node.js 22 或 24 与 ESM（`.mjs`，或设置 `"type": "module"`）。包要求 Node >=22。应用还需通过 core 执行任务时，安装 `@sinestack/ai-core ai@7.0.155`。

## 解析文件响应

保存为 `example.mjs`，运行 `node example.mjs`。示例解析本地数据；示例 URL 作为文件引用保留，不会被请求。

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

`mapAssetResult` 识别根 URL、文件列表和嵌套文件对象。它会按 URL 去重，并在需要时根据扩展名推断媒体类型。遇到供应商专属结构时，通过 `AssetModelMapping` 提供自己的 `mapResult`。

## 公开工具

| 导出 | 用途 |
|---|---|
| `jsonValue`、`jsonObject` | 复制有限、无环的普通 JSON 数据；`jsonObject` 要求根节点为对象。 |
| `record` | 读取协议字段前校验普通对象。 |
| `errorMessage` | 从常见错误响应结构中提取消息。 |
| `httpURL` | 解析绝对 HTTP(S) URL，拒绝内嵌凭据和 fragment。 |
| `mapAssetResult` | 将原生文件引用转为包含非空 `assets` 数组的 `AssetModelV1Result`。 |
| `snapshotAssetMapping` | 保存并绑定可选的输入/结果映射函数，包括原型方法。 |
| `AssetProviderTransport` | 发送单次带认证的 GET、JSON/multipart POST、PUT 或 DELETE 请求；解码响应或返回原始流。 |
| `invalidResponse` | 将无效协议响应转为不可重试的 API 错误。 |
| `AssetProviderTransportOptions`、`AssetProviderResponse` | 为 transport 配置和返回的响应数据提供类型。 |
| `AssetProviderResponseHandlers`、`AssetProviderRawRequestOptions` | 定制单次请求的解码或原始响应处理。 |

## 请求供应商 JSON

下面的函数使用供应商 API base URL 和凭据读取状态 URL。传入供应商文档中规定的绝对状态 URL，其 origin 和路径前缀应位于配置的 base URL 范围内。

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

传入 `AbortSignal`，例如 `new AbortController().signal`。transport 读取传入的服务端 `apiKey` 或 `CUSTOM_API_KEY` 环境变量，默认使用 Bearer 认证；需要 Key 认证的 API 可设置 `authorizationScheme: 'Key'`。远端调用使用供应商账号，可能计费。

写入时，将 JSON 对象作为 `request` 的第四个参数传入；multipart POST 则传入 `FormData`。第五个参数为 `true` 时，DELETE 接受空的 200/204 响应，适用于文档明确返回空响应的删除接口。删除和远端取消是不同操作。

`request` 的第六个参数接受遵循 AI SDK `ResponseHandler` 契约的 `successfulResponseHandler` 和 `failedResponseHandler`。可用于无损 JSON 等供应商专用解码，同时保留共享认证与目的地校验。

`requestRaw(url, method, options, { accept, redirect, failedResponseHandler })` 返回尚未消费的 `Response`，调用方必须读取或取消其 body；该方法不接受请求体。`redirect` 默认在逻辑上拒绝重定向；显式设为 `'manual'` 时可检查 301/302/303/307/308 响应，但不会跟随 `Location`。

所有网络调用在物理层使用 workerd 支持的 `redirect: 'manual'`，默认策略仍拒绝重定向。自定义 fetch 不得跟随重定向。签名存储上传应与带认证 API 请求分离；还需应用供应商的数据结构校验与应用自身的下载授权策略。

## 指南

- [聚合 provider](https://github.com/fei-bai-inc/sinestack-ai/blob/main/docs/MEDIA_PROVIDERS.zh-CN.md)：输入与结果映射
- [架构](https://github.com/fei-bai-inc/sinestack-ai/blob/main/docs/ARCHITECTURE.zh-CN.md)：adapter 与生命周期契约
- [安全](https://github.com/fei-bai-inc/sinestack-ai/blob/main/SECURITY.zh-CN.md)：凭据、自定义 fetch 与 URL 处理
- [Transport 源码](https://github.com/fei-bai-inc/sinestack-ai/blob/main/packages/provider-utils/src/transport.ts)：请求选项与响应处理
