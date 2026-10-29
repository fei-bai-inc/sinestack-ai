import type { AssetFile, AssetModelV1Result, JSONObject } from '@sinestack/ai-provider';
import { httpURL, jsonObject } from '@sinestack/ai-provider-utils';
import type { ViggleJob } from './types.js';

/** Explicit output fields only. Source URLs and arbitrary metadata never become generated files. */
export function file(value: unknown, mediaType: string, role: string, metadata?: JSONObject): AssetFile {
  const url = httpURL(value, `Viggle ${role} output URL`).href;
  return {
    type: 'url', url, mediaType, role,
    ...(metadata === undefined ? {} : { metadata: jsonObject(metadata, 'Viggle file metadata') }),
  };
}

/** A video and its alpha mask are distinct files, even when they share one Render receipt. */
export function videoFiles(data: ViggleJob): AssetFile[] {
  const native = jsonObject(data, 'Viggle video result');
  const assets = [file(native.video_url, 'video/mp4', 'video')];
  if (native.alpha_url !== undefined && native.alpha_url !== null) {
    assets.push(file(native.alpha_url, 'video/mp4', 'alpha'));
  }
  return assets;
}

/** Preserve native JSON independently of the projected file list. Never estimate billing. */
export function assetResult(data: ViggleJob, assets: readonly AssetFile[]): AssetModelV1Result {
  if (assets.length === 0) throw new TypeError('Viggle generation returned no output files');
  const output = jsonObject(data, 'Viggle native result');
  let usage: JSONObject | undefined;
  if (output.credits !== undefined && output.credits !== null) {
    if (typeof output.credits !== 'number' || !Number.isFinite(output.credits) || output.credits < 0) {
      throw new TypeError('Viggle reported invalid credits');
    }
    usage = { credits: output.credits };
  }
  return {
    assets: assets.map(asset => ({
      ...asset,
      ...(asset.metadata === undefined ? {} : { metadata: jsonObject(asset.metadata, 'Viggle file metadata') }),
    })),
    providerMetadata: { viggle: { taskId: data.id, output } },
    ...(usage === undefined ? {} : { usage }),
  };
}

export function videoResult(data: ViggleJob): AssetModelV1Result {
  return assetResult(data, videoFiles(data));
}

/** Image jobs are atomic: an expired or malformed member cannot become a partial success. */
export function imageResult(data: ViggleJob): AssetModelV1Result {
  const native = jsonObject(data, 'Viggle image result');
  if (!Array.isArray(native.images) || native.images.length === 0) {
    throw new TypeError('Viggle image task is ready but has no image files');
  }
  const assets = native.images.map((value, index) => {
    const image = jsonObject(value, `Viggle image ${index}`);
    const metadata: JSONObject = {};
    for (const field of ['width', 'height', 'seed'] as const) {
      const value = image[field];
      if (value === undefined) continue;
      const minimum = field === 'seed' ? 0 : 1;
      const maximum = field === 'seed' ? 2147483647 : Number.MAX_SAFE_INTEGER;
      if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum || value > maximum) {
        throw new TypeError(`Viggle image ${index} has invalid ${field}`);
      }
      metadata[field] = value;
    }
    return file(image.url, 'image/png', 'image', metadata);
  });
  return assetResult(data, assets);
}
