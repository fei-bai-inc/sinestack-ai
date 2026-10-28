import type { AssetFile, AssetModelV1, JSONObject, MusicInput, ThreeDInput } from '@sine-ai/provider';
import { httpURL, jsonObject, record } from '@sine-ai/provider-utils';
import { WaveSpeedAssetModel } from './wavespeed-asset-model.js';
import type { WaveSpeedAssetDefinition, WaveSpeedAssetProviderSettings } from './wavespeed-asset-model.js';

export { WaveSpeedAssetModel };
export type { WaveSpeedAssetDefinition, WaveSpeedAssetProviderSettings };

export const WAVESPEED_MUSIC_MODEL = 'minimax/music-2.6';
export const WAVESPEED_THREE_D_MODEL = 'tripo3d/h3.1/text-to-3d';

export interface WaveSpeedAssetProvider {
  music(modelId?: typeof WAVESPEED_MUSIC_MODEL): AssetModelV1<MusicInput, 'music'>;
  threeD(modelId?: typeof WAVESPEED_THREE_D_MODEL): AssetModelV1<ThreeDInput, 'model-3d'>;
  asset<INPUT, KIND extends string>(modelId: string, definition: WaveSpeedAssetDefinition<INPUT, KIND>): AssetModelV1<INPUT, KIND>;
}

function onlyKeys(value: Record<string, unknown>, keys: readonly string[], label: string): void {
  for (const key of Object.keys(value)) {
    if (!keys.includes(key)) throw new TypeError(`${label}.${key} is not supported by this model.`);
  }
}

function text(value: unknown, label: string, maxLength: number, allowEmpty = false): string {
  if (typeof value !== 'string' || (!allowEmpty && !value.trim()) || [...value].length > maxLength) {
    throw new TypeError(`${label} must be ${allowEmpty ? 'a' : 'a nonempty'} string of at most ${maxLength} characters.`);
  }
  return value;
}

function boolean(value: unknown, label: string): void {
  if (typeof value !== 'boolean') throw new TypeError(`${label} must be a boolean.`);
}

function integer(value: unknown, label: string, min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER): void {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) {
    throw new TypeError(`${label} must be an integer between ${min} and ${max}.`);
  }
}

function oneOf(value: unknown, label: string, values: readonly (string | number)[]): void {
  if ((typeof value !== 'string' && typeof value !== 'number') || !values.includes(value)) {
    throw new TypeError(`${label} has an unsupported value.`);
  }
}

const MEDIA_TYPES: Record<string, string> = {
  mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', opus: 'audio/ogg', flac: 'audio/flac',
  m4a: 'audio/mp4', aac: 'audio/aac', glb: 'model/gltf-binary', gltf: 'model/gltf+json',
  obj: 'model/obj', stl: 'model/stl', usdz: 'model/vnd.usdz+zip', fbx: 'application/octet-stream',
  zip: 'application/zip', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp',
};

/** Presets accept URL outputs or explicit file objects. Arbitrary structured output needs a custom mapResult. */
function files(output: unknown, role?: string): AssetFile[] {
  if (!Array.isArray(output) || output.length === 0) {
    throw new TypeError('WaveSpeed media output must be a nonempty array of file references.');
  }
  return output.map((item: unknown) => {
    const value = typeof item === 'string' ? { url: item } : record(item, 'WaveSpeed output file');
    const url = httpURL(value.url, 'WaveSpeed output file URL');
    const extension = url.pathname.split('.').at(-1)?.toLowerCase() ?? '';
    if (value.content_type !== undefined) text(value.content_type, 'WaveSpeed file content_type', 255);
    if (value.file_name !== undefined) text(value.file_name, 'WaveSpeed file file_name', 1024);
    if (value.file_size !== undefined) integer(value.file_size, 'WaveSpeed file file_size', 0);
    return {
      type: 'url' as const,
      url: url.href,
      mediaType: typeof value.content_type === 'string' ? value.content_type : MEDIA_TYPES[extension] ?? 'application/octet-stream',
      ...(role === undefined ? {} : { role }),
      ...(typeof value.file_name === 'string' ? { filename: value.file_name } : {}),
      ...(typeof value.file_size === 'number' ? { metadata: { fileSize: value.file_size } } : {}),
    };
  });
}

// https://wavespeed.ai/docs/docs-api/minimax/minimax-music-2.6
const music: WaveSpeedAssetDefinition<MusicInput, 'music'> = {
  kind: 'music',
  mapInput(input) {
    const value = jsonObject(input, 'music input');
    onlyKeys(value, ['prompt', 'lyrics', 'instrumental'], 'music input');
    const body: JSONObject = { prompt: text(value.prompt, 'music input.prompt', 2000) };
    if (value.lyrics !== undefined) {
      const lyrics = text(value.lyrics, 'music input.lyrics', 3000, true);
      if (lyrics.length > 0 && [...lyrics].length < 10) throw new TypeError('music input.lyrics must be empty or contain at least 10 characters.');
      body.lyrics = lyrics;
    }
    if (value.instrumental !== undefined) {
      boolean(value.instrumental, 'music input.instrumental');
      body.is_instrumental = value.instrumental as boolean;
    }
    return body;
  },
  mapResult(output) { return { assets: files(output, 'audio') }; },
};

// https://wavespeed.ai/docs/docs-api/tripo3d/tripo3d-h3.1-text-to-3d
const threeD: WaveSpeedAssetDefinition<ThreeDInput, 'model-3d'> = {
  kind: 'model-3d',
  mapInput(input) {
    const value = jsonObject(input, 'threeD input');
    onlyKeys(value, ['prompt'], 'threeD input');
    return { prompt: text(value.prompt, 'threeD input.prompt', 1024) };
  },
  mapResult(output) { return { assets: files(output) }; },
};

export function createWaveSpeedAssetProvider(settings: WaveSpeedAssetProviderSettings = {}): WaveSpeedAssetProvider {
  const config = { ...settings, headers: settings.headers === undefined ? undefined : { ...settings.headers } };
  return {
    music(modelId = WAVESPEED_MUSIC_MODEL) {
      if (modelId !== WAVESPEED_MUSIC_MODEL) throw new TypeError('Unsupported WaveSpeed music preset; use asset() with explicit mappings.');
      return new WaveSpeedAssetModel(modelId, config, music, options => {
        onlyKeys(options, ['bitrate', 'sample_rate', 'enable_sync_mode', 'enable_base64_output'], 'providerOptions.wavespeed');
        if (options.bitrate !== undefined) oneOf(options.bitrate, 'providerOptions.wavespeed.bitrate', [32000, 60000, 64000, 128000, 256000]);
        if (options.sample_rate !== undefined) oneOf(options.sample_rate, 'providerOptions.wavespeed.sample_rate', [16000, 24000, 32000, 44100]);
      });
    },
    threeD(modelId = WAVESPEED_THREE_D_MODEL) {
      if (modelId !== WAVESPEED_THREE_D_MODEL) throw new TypeError('Unsupported WaveSpeed 3D preset; use asset() with explicit mappings.');
      return new WaveSpeedAssetModel(modelId, config, threeD, options => {
        onlyKeys(options, [
          'negative_prompt', 'texture', 'pbr', 'texture_quality', 'geometry_quality', 'auto_size', 'quad',
          'face_limit', 'model_seed', 'image_seed', 'texture_seed', 'enable_sync_mode', 'enable_base64_output',
        ], 'providerOptions.wavespeed');
        if (options.negative_prompt !== undefined) text(options.negative_prompt, 'providerOptions.wavespeed.negative_prompt', 1024, true);
        for (const key of ['texture', 'pbr', 'auto_size', 'quad']) {
          if (options[key] !== undefined) boolean(options[key], `providerOptions.wavespeed.${key}`);
        }
        for (const key of ['texture_quality', 'geometry_quality']) {
          if (options[key] !== undefined) oneOf(options[key], `providerOptions.wavespeed.${key}`, ['standard', 'detailed']);
        }
        if (options.face_limit !== undefined) integer(options.face_limit, 'providerOptions.wavespeed.face_limit', 1000, 2_000_000);
        for (const key of ['model_seed', 'image_seed', 'texture_seed']) {
          if (options[key] !== undefined) integer(options[key], `providerOptions.wavespeed.${key}`);
        }
      });
    },
    asset(modelId, definition) { return new WaveSpeedAssetModel(modelId, config, definition); },
  };
}
