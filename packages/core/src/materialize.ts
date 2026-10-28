import { createDownload, DefaultGeneratedFile, type GeneratedFile } from 'ai';
import { convertBase64ToUint8Array } from '@ai-sdk/provider-utils';
import type { AssetFile } from '@sine-ai/provider';
import { httpURL, validateFile } from './internal/validation.js';

export interface MaterializeAssetOptions {
  /** Applies to downloads and inline data. Defaults to 64 MiB. */
  maxBytes?: number;
  abortSignal?: AbortSignal;
  /** Supply host allowlists and network policy here when materializing untrusted URLs. */
  download?: (options: { url: URL; abortSignal?: AbortSignal }) => PromiseLike<{ data: Uint8Array; mediaType?: string }>;
}

/** Explicitly materialize ONE asset using AI SDK's public file/download APIs. */
export async function materializeAsset(asset: AssetFile, options: MaterializeAssetOptions = {}): Promise<GeneratedFile> {
  validateFile(asset);
  const maxBytes = options.maxBytes ?? 64 * 1024 * 1024;
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new TypeError('maxBytes must be a positive safe integer');
  const signal = options.abortSignal ?? new AbortController().signal;
  signal.throwIfAborted();
  let data: Uint8Array;
  if (asset.type === 'url') {
    const download = options.download ?? createDownload({ maxBytes });
    const result = await download({ url: httpURL(asset.url, 'Asset URL'), abortSignal: signal });
    signal.throwIfAborted();
    data = result.data;
  } else if (asset.type === 'binary') {
    data = asset.data;
  } else {
    // Check the encoded length before allocating the decoded bytes.
    const padding = asset.data.endsWith('==') ? 2 : asset.data.endsWith('=') ? 1 : 0;
    if (Math.floor(asset.data.length * 3 / 4) - padding > maxBytes) throw new RangeError('Asset exceeds maxBytes');
    data = convertBase64ToUint8Array(asset.data);
  }
  if (!(data instanceof Uint8Array) || data.byteLength > maxBytes) throw new RangeError('Asset exceeds maxBytes or download returned invalid data');
  return new DefaultGeneratedFile({ data, mediaType: asset.mediaType });
}
