import type { JSONObject, JSONValue } from '@sine-ai/provider';

export function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${label} must be a plain object.`);
  }
  return value as Record<string, unknown>;
}

/** Detach JSON data without invoking getters, iterators, or toJSON. */
export function jsonValue(value: unknown, label: string): JSONValue {
  const seen = new Set<object>();
  function clone(item: unknown, depth = 0): JSONValue {
    if (depth > 64) throw new TypeError(`${label} exceeds the maximum JSON nesting depth.`);
    if (item === null || typeof item === 'string' || typeof item === 'boolean') return item;
    if (typeof item === 'number' && Number.isFinite(item)) return item;
    if (typeof item !== 'object' || item === null || seen.has(item)) {
      throw new TypeError(`${label} must contain finite, acyclic JSON values.`);
    }
    const array = Array.isArray(item);
    const prototype = Object.getPrototypeOf(item);
    if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) {
      throw new TypeError(`${label} must contain only plain JSON objects and arrays.`);
    }
    if (Object.getOwnPropertySymbols(item).length) throw new TypeError(`${label} must not contain symbol keys.`);
    const descriptors = Object.getOwnPropertyDescriptors(item);
    const length = array ? descriptors.length!.value as number : 0;
    if (array && Object.keys(descriptors).length !== length + 1) {
      throw new TypeError(`${label} arrays must not contain holes or extra properties.`);
    }
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (array && key === 'length') continue;
      if (!('value' in descriptor) || !descriptor.enumerable) {
        throw new TypeError(`${label} must contain only enumerable JSON data properties.`);
      }
      if (array && (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= length)) {
        throw new TypeError(`${label} arrays must not contain extra properties.`);
      }
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
        throw new TypeError(`${label} contains an unsupported key: ${key}.`);
      }
    }
    seen.add(item);
    const result = array
      ? Array.from({ length }, (_, index) => clone(descriptors[String(index)]!.value, depth + 1))
      : Object.fromEntries(Object.entries(descriptors).map(([key, descriptor]) => [
          key,
          // JSONObject permits undefined object values; JSON serialization omits them.
          descriptor.value === undefined ? undefined : clone(descriptor.value, depth + 1),
        ]));
    seen.delete(item);
    return result;
  }
  return clone(value);
}

export function jsonObject(value: unknown, label: string): JSONObject {
  record(value, label);
  return jsonValue(value, label) as JSONObject;
}

export function httpURL(value: unknown, label: string): URL {
  if (typeof value !== 'string') throw new TypeError(`${label} must be an absolute HTTP(S) URL.`);
  let url: URL;
  try { url = new URL(value); } catch {
    throw new TypeError(`${label} must be an absolute HTTP(S) URL.`);
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash) {
    throw new TypeError(`${label} must be an HTTP(S) URL without credentials or a fragment.`);
  }
  return url;
}

export function errorMessage(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (value !== null && typeof value === 'object') {
    const body = value as Record<string, unknown>;
    for (const candidate of [body.error, body.message, body.detail]) {
      if (typeof candidate === 'string' && candidate) return candidate;
    }
    if (body.error !== null && typeof body.error === 'object') return errorMessage(body.error);
  }
  return undefined;
}
