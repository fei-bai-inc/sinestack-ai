import type { AssetFile, AssetModelV1Result, JSONObject, JSONValue } from '@sinestack/ai-provider';
import { httpURL, jsonValue } from './json.js';

// File formats, not a model catalog. Unknown formats remain opaque file references.
const MEDIA_TYPES: Record<string, string> = {
  mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', opus: 'audio/ogg', flac: 'audio/flac',
  m4a: 'audio/mp4', aac: 'audio/aac', mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', avif: 'image/avif',
  glb: 'model/gltf-binary', gltf: 'model/gltf+json', obj: 'model/obj', stl: 'model/stl',
  usdz: 'model/vnd.usdz+zip', pdf: 'application/pdf', json: 'application/json',
  zip: 'application/zip', txt: 'text/plain', csv: 'text/csv',
};

function optionalText(value: JSONValue | undefined, field: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string' || !value.trim()) throw new TypeError(`Asset file ${field} must be a nonempty string.`);
  return value;
}

function inferMediaType(url: URL, filename?: string): string {
  const extension = (value: string) => value.split('/').at(-1)?.split('.').at(-1)?.toLowerCase() ?? '';
  const lookup = (value: string) => Object.hasOwn(MEDIA_TYPES, value) ? MEDIA_TYPES[value] : undefined;
  return lookup(extension(url.pathname)) ?? lookup(extension(filename ?? '')) ?? 'application/octet-stream';
}

/**
 * Default projection for file-generating endpoints: root URL(s), explicit File
 * objects ({ url, content_type?, file_name?, file_size? }), and nested File objects.
 * Unrecognized schemas can replace this function through an injected mapResult.
 */
export function mapAssetResult(value: JSONValue): AssetModelV1Result {
  const output = jsonValue(value, 'Asset output');
  const files = new Map<string, { file: AssetFile; explicitMediaType: boolean }>();

  function add(value: string, info?: JSONObject): void {
    const url = httpURL(value, 'Asset file URL');
    const filename = optionalText(info?.file_name ?? info?.filename, 'filename');
    const suppliedMediaType = optionalText(info?.content_type ?? info?.mediaType ?? info?.mime_type, 'mediaType');
    if (suppliedMediaType !== undefined && !/^[^\s/;]+\/[^\s;]+(?:\s*;[^\r\n]+)?$/.test(suppliedMediaType)) {
      throw new TypeError('Asset file mediaType must be a MIME type.');
    }
    const role = optionalText(info?.role, 'role');
    const size = info?.file_size;
    if (size !== undefined && size !== null && (typeof size !== 'number' || !Number.isSafeInteger(size) || size < 0)) {
      throw new TypeError('Asset file file_size must be a nonnegative integer.');
    }
    const file: AssetFile = {
      type: 'url', url: url.href, mediaType: suppliedMediaType ?? inferMediaType(url, filename),
      ...(filename === undefined ? {} : { filename }),
      ...(role === undefined ? {} : { role }),
      ...(typeof size === 'number' ? { metadata: { fileSize: size } } : {}),
    };
    const previous = files.get(url.href);
    if (!previous) files.set(url.href, { file, explicitMediaType: suppliedMediaType !== undefined });
    else files.set(url.href, {
      file: {
        ...previous.file,
        ...(suppliedMediaType !== undefined && !previous.explicitMediaType ? { mediaType: suppliedMediaType } : {}),
        ...(previous.file.filename === undefined && filename !== undefined ? { filename } : {}),
        ...(previous.file.role === undefined && role !== undefined ? { role } : {}),
        ...(previous.file.metadata === undefined && file.metadata !== undefined ? { metadata: file.metadata } : {}),
      },
      explicitMediaType: previous.explicitMediaType || suppliedMediaType !== undefined,
    });
  }

  function visit(item: JSONValue | undefined, stringFiles: boolean): void {
    if (typeof item === 'string') {
      // Never scan prose or arbitrary metadata string properties for embedded URLs.
      if (stringFiles && /^https?:\/\//i.test(item)) add(item);
      return;
    }
    if (item === null || typeof item !== 'object') return;
    if (Array.isArray(item)) {
      for (const child of item) visit(child, stringFiles);
      return;
    }
    const object = item as JSONObject; // Array.isArray does not narrow readonly JSON arrays in TypeScript.
    if (Object.hasOwn(object, 'url')) {
      if (typeof object.url !== 'string') throw new TypeError('Asset file url must be a string.');
      add(object.url, object);
      return;
    }
    for (const [key, child] of Object.entries(object)) {
      // These are generic file-list envelopes, never per-model field maps.
      visit(child, ['assets', 'files', 'outputs', 'output'].includes(key));
    }
  }

  visit(output, true);
  if (files.size === 0) {
    throw new TypeError('No file references were found in the native output. Provide mapResult for this endpoint\'s output schema.');
  }
  return { assets: [...files.values()].map(entry => entry.file) };
}
