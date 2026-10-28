import type { AssetFile, AssetModelV1, AssetModelV1Result, AssetModelV1Status, AssetOperation, JSONValue } from '@sine-ai/provider';

export function milliseconds(value: number | undefined, name: string, allowZero = false): void {
  if (value !== undefined && (!Number.isSafeInteger(value) || value < (allowZero ? 0 : 1) || value > 2_147_483_647)) {
    throw new TypeError(`${name} must be a ${allowZero ? 'non-negative' : 'positive'} integer at most 2147483647`);
  }
}

export function assertJSONValue(value: unknown, seen = new Set<object>(), depth = 0): asserts value is JSONValue {
  if (depth > 64) throw new TypeError('Operation exceeds the maximum JSON nesting depth');
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number' && Number.isFinite(value)) return;
  if (typeof value !== 'object' || value === null) throw new TypeError('Operation must be losslessly JSON serializable');
  if (seen.has(value)) throw new TypeError('Operation must not contain circular references');
  const array = Array.isArray(value);
  if (array ? Object.getPrototypeOf(value) !== Array.prototype : Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
    throw new TypeError('Operation must contain only plain JSON objects and arrays');
  }
  if (Object.getOwnPropertySymbols(value).length) throw new TypeError('Operation must not contain symbol keys');
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (array && Object.keys(descriptors).length !== value.length + 1) throw new TypeError('Operation arrays must not contain holes or extra properties');
  seen.add(value);
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (array && key === 'length') continue;
    if (!('value' in descriptor) || !descriptor.enumerable) throw new TypeError('Operation must contain only enumerable JSON data properties');
    if (array && (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= value.length)) throw new TypeError('Operation arrays must not contain extra properties');
    assertJSONValue(descriptor.value, seen, depth + 1);
  }
  seen.delete(value);
}

/** Snapshot without invoking getters or toJSON; freeze every nested container. */
export function snapshotJSONValue(value: unknown): JSONValue {
  assertJSONValue(value);
  const clone = (item: JSONValue): JSONValue => {
    if (item === null || typeof item !== 'object') return item;
    if (Array.isArray(item)) return Object.freeze(item.map(clone)) as unknown as JSONValue;
    return Object.freeze(Object.fromEntries(Object.entries(Object.getOwnPropertyDescriptors(item)).map(
      ([key, descriptor]) => [key, clone(descriptor.value as JSONValue)],
    )));
  };
  return clone(value);
}

export function httpURL(value: string, name: string): URL {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new TypeError(`${name} must be an HTTP(S) URL without embedded credentials`);
  return url;
}

export function validateModel<INPUT, KIND extends string>(model: AssetModelV1<INPUT, KIND>): void {
  if (!model || typeof model !== 'object') throw new TypeError('An asset model must be an object');
  if (model.specificationVersion !== 'v1') throw new TypeError('Unsupported asset model specificationVersion');
  for (const name of ['provider', 'modelId', 'kind'] as const) {
    if (typeof model[name] !== 'string' || !model[name].trim()) throw new TypeError(`Asset model ${name} must not be empty`);
  }
  for (const name of ['doGenerate', 'doStart', 'doStatus', 'doCancel'] as const) {
    if (model[name] !== undefined && typeof model[name] !== 'function') throw new TypeError(`Asset model ${name} must be a function`);
  }
  if ((model.doStart === undefined) !== (model.doStatus === undefined)) throw new TypeError('Asset models must implement both doStart and doStatus');
  if (!model.doGenerate && !model.doStart) throw new TypeError('Asset model must implement doGenerate or doStart/doStatus');
  if (model.doCancel && !model.doStart) throw new TypeError('Remote cancellation requires doStart/doStatus');
  if (model.capabilities !== undefined) {
    if (!model.capabilities || typeof model.capabilities !== 'object' || Array.isArray(model.capabilities)) throw new TypeError('Asset model capabilities must be an object');
    for (const name of ['idempotentStart', 'idempotentGenerate', 'webhooks'] as const) {
      if (model.capabilities[name] !== undefined && typeof model.capabilities[name] !== 'boolean') throw new TypeError(`Asset model capability ${name} must be a boolean`);
    }
    if ((model.capabilities.idempotentStart || model.capabilities.webhooks) && !model.doStart) throw new TypeError('Async capabilities require doStart/doStatus');
    if (model.capabilities.idempotentGenerate && !model.doGenerate) throw new TypeError('idempotentGenerate requires doGenerate');
  }
}

export function validateOperation<INPUT, KIND extends string>(model: AssetModelV1<INPUT, KIND>, value: AssetOperation<KIND>): void {
  if (!value || value.specificationVersion !== 'v1' || value.provider !== model.provider || value.modelId !== model.modelId || value.kind !== model.kind) {
    throw new TypeError('Asset operation does not match the original provider, model, kind, or specification version');
  }
  assertJSONValue(value.operation);
}

export function snapshotOperation<INPUT, KIND extends string>(model: AssetModelV1<INPUT, KIND>, value: AssetOperation<KIND>): AssetOperation<KIND> {
  validateOperation(model, value);
  return Object.freeze({
    specificationVersion: 'v1', provider: model.provider, modelId: model.modelId,
    kind: model.kind, operation: snapshotJSONValue(value.operation),
  });
}

export function validateFile(value: AssetFile): void {
  if (!value || typeof value.mediaType !== 'string' || !value.mediaType.includes('/')) throw new TypeError('An asset must have a mediaType');
  switch (value.type) {
    case 'url':
      if (typeof value.url !== 'string') throw new TypeError('An asset URL must be a string');
      httpURL(value.url, 'Asset URL');
      return;
    case 'binary':
      if (!(value.data instanceof Uint8Array) || value.data.byteLength === 0) throw new TypeError('Binary assets must contain a nonempty Uint8Array');
      return;
    case 'base64':
      if (typeof value.data !== 'string' || !value.data.length || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}(?:==)?|[A-Za-z0-9+/]{3}=?|)$/.test(value.data)) throw new TypeError('Invalid base64 asset');
      return;
    default: throw new TypeError('Unsupported asset file type');
  }
}

export function validateResult(value: AssetModelV1Result): void {
  if (!value || !Array.isArray(value.assets) || value.assets.length === 0) throw new TypeError('An asset generation result must contain at least one asset');
  for (const asset of value.assets) validateFile(asset);
}

export function validateStatus(value: AssetModelV1Status): void {
  if (!value || typeof value !== 'object') throw new TypeError('Invalid asset operation status');
  switch (value.status) {
    case 'pending': case 'running':
      if (value.progress !== undefined && (!Number.isFinite(value.progress) || value.progress < 0 || value.progress > 1)) throw new TypeError('Asset progress must be between 0 and 1');
      return;
    case 'completed': validateResult(value.result); return;
    case 'failed':
      if (!value.error || typeof value.error.message !== 'string') throw new TypeError('A failed asset status must contain an error message');
      return;
    case 'cancelled': return;
    default: throw new TypeError('Unsupported asset operation status');
  }
}
