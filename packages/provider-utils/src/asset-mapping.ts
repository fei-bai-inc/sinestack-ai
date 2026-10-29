import type { AssetModelMapping, JSONObject } from '@sinestack/ai-provider';

/** Capture callable methods without dropping prototype methods or their original receiver. */
export function snapshotAssetMapping<INPUT = JSONObject>(mapping?: AssetModelMapping<INPUT>): AssetModelMapping<INPUT> {
  if (mapping === undefined) return {};
  if (mapping === null || (typeof mapping !== 'object' && typeof mapping !== 'function')) {
    throw new TypeError('Asset mapping must be an object.');
  }
  const mapInput = mapping.mapInput;
  const mapResult = mapping.mapResult;
  if (mapInput !== undefined && typeof mapInput !== 'function') {
    throw new TypeError('mapInput must be a function when provided.');
  }
  if (mapResult !== undefined && typeof mapResult !== 'function') {
    throw new TypeError('mapResult must be a function when provided.');
  }
  return {
    ...(mapInput === undefined ? {} : { mapInput: mapInput.bind(mapping) }),
    ...(mapResult === undefined ? {} : { mapResult: mapResult.bind(mapping) }),
  };
}
