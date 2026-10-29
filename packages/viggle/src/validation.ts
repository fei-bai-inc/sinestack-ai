import type { JSONObject } from '@sinestack/ai-provider';
import { httpURL, jsonValue, record } from '@sinestack/ai-provider-utils';

export function nonempty(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${label} must be a nonempty string`);
}
export function opaqueId(value: unknown, prefixes?: readonly string[]): string {
  nonempty(value, 'Viggle resource ID');
  if (/[\/\\?#%\s\u0000-\u001f]/u.test(value) || value === '.' || value === '..') throw new TypeError('Unsafe Viggle resource ID');
  if (prefixes?.length && !prefixes.some(prefix => value.startsWith(prefix) && value.length > prefix.length)) throw new TypeError('Unexpected or incomplete Viggle resource ID prefix');
  return value;
}
export function bounded(value: unknown, label: string, min: number, max = Infinity, integer = false): void {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isSafeInteger(value))) throw new TypeError(`${label} must be ${integer ? 'an integer' : 'a number'} in [${min}, ${max}]`);
}
export function choice(value: unknown, label: string, values: readonly unknown[]): void {
  if (value !== undefined && !values.includes(value)) throw new TypeError(`Unsupported ${label}`);
}
export function present(input: Record<string, unknown>, key: string): boolean { return input[key] !== undefined && input[key] !== null; }
export function exactlyOne(input: Record<string, unknown>, keys: readonly string[], label = keys.join('/')): string {
  const selected = keys.filter(key => present(input, key));
  if (selected.length !== 1) throw new TypeError(`Provide exactly one ${label}`);
  return selected[0]!;
}
export function noFields(input: Record<string, unknown>, keys: readonly string[], label: string): void {
  if (keys.some(key => present(input, key))) throw new TypeError(`${label} cannot include ${keys.filter(key => present(input, key)).join(', ')}`);
}
export function values<T = unknown>(value: T | readonly T[] | undefined): readonly T[] { return value === undefined ? [] : Array.isArray(value) ? value : [value as T]; }
export function url(value: unknown, label: string, httpsOnly = false): string {
  const parsed = httpURL(value, label);
  if (httpsOnly && parsed.protocol !== 'https:') throw new TypeError(`${label} requires HTTPS`);
  return value as string;
}
export function blob(value: unknown, label: string, maxBytes: number): asserts value is Blob {
  if (!(value instanceof Blob) || value.size === 0 || value.size > maxBytes) throw new TypeError(`${label} must be a nonempty Blob no larger than ${maxBytes} bytes`);
}
export function seed(value: unknown, label = 'seed'): void {
  if (value === undefined) return;
  if (typeof value === 'number') { bounded(value, label, 0, Number.MAX_SAFE_INTEGER, true); return; }
  if (typeof value !== 'string' || !/^(0|[1-9]\d*)$/u.test(value) || BigInt(value) > 9223372036854775807n) throw new TypeError(`${label} must be a safe integer or exact nonnegative 63-bit decimal string`);
}
/** Preserve Blob input but reject accessors/prototypes; no getters or toJSON are invoked. */
export function inputObject(value: unknown, label = 'Viggle input'): Record<string, unknown> {
  record(value, label);
  const seen = new Set<object>();
  const clone = (item: unknown, depth = 0): unknown => {
    if (depth > 100) throw new TypeError(`${label} is too deeply nested`);
    if (item instanceof Blob) return item;
    if (item !== null && typeof item === 'object') {
      if (seen.has(item)) throw new TypeError(`${label} cannot contain cycles`);
      if (Object.getOwnPropertySymbols(item).length) throw new TypeError(`Invalid ${label} symbol property`);
      seen.add(item);
      try {
        if (Array.isArray(item)) {
          const descriptors = Object.getOwnPropertyDescriptors(item);
          if (Object.keys(descriptors).length !== item.length + 1) throw new TypeError(`Invalid ${label} array`);
          return Array.from({ length: item.length }, (_, index) => {
            const descriptor = descriptors[String(index)];
            if (!descriptor || !('value' in descriptor) || !descriptor.enumerable || descriptor.value === undefined) throw new TypeError(`Invalid ${label} array entry`);
            return clone(descriptor.value, depth + 1);
          });
        }
        record(item, label);
        const entries = Object.entries(Object.getOwnPropertyDescriptors(item));
        for (const [key, descriptor] of entries) if (!('value' in descriptor) || !descriptor.enumerable || ['__proto__', 'prototype', 'constructor'].includes(key)) throw new TypeError(`Invalid ${label} property`);
        return Object.fromEntries(entries.map(([key, descriptor]) => [key, clone(descriptor.value, depth + 1)]));
      } finally { seen.delete(item); }
    }
    if (item === undefined) return item;
    return jsonValue(item, label);
  };
  return clone(value) as Record<string, unknown>;
}
export function mergeInput(input: unknown, extra?: JSONObject): Record<string, unknown> {
  const native = inputObject(input);
  for (const [key, value] of Object.entries(extra ?? {})) {
    if (Object.hasOwn(native, key)) throw new TypeError(`providerOptions.viggle.${key} cannot override input`);
    native[key] = jsonValue(value, `providerOptions.viggle.${key}`);
  }
  return native;
}
