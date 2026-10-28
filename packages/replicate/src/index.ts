import type { AssetFile, AssetModelV1, JSONObject, MusicInput, ThreeDInput } from '@sine-ai/provider';
import { httpURL, jsonObject } from '@sine-ai/provider-utils';
import { ReplicateAssetModel } from './replicate-asset-model.js';
import type { ReplicateAssetDefinition, ReplicateAssetProviderSettings } from './replicate-asset-model.js';

export { ReplicateAssetModel };
export type { ReplicateAssetDefinition, ReplicateAssetProviderSettings };

export const REPLICATE_MUSIC_MODEL = 'minimax/music-2.6';
export const REPLICATE_THREE_D_MODEL = 'tencent/hunyuan-3d-3.1';

export interface ReplicateAssetProvider {
  music(modelId?: typeof REPLICATE_MUSIC_MODEL): AssetModelV1<MusicInput, 'music'>;
  threeD(modelId?: typeof REPLICATE_THREE_D_MODEL): AssetModelV1<ThreeDInput, 'model-3d'>;
  asset<INPUT, KIND extends string>(modelId: string, definition: ReplicateAssetDefinition<INPUT, KIND>): AssetModelV1<INPUT, KIND>;
}

function onlyKeys(value: JSONObject, keys: readonly string[], label: string): void {
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

function oneOf(value: unknown, label: string, values: readonly (string | number)[]): void {
  if (!values.includes(value as string | number)) throw new TypeError(`${label} has an unsupported value.`);
}

function file(value: unknown, role: string): AssetFile {
  const url = httpURL(value, `Replicate ${role} output`);
  const format = url.pathname.split('.').at(-1)?.toLowerCase() ?? '';
  const mediaTypes: Record<string, string> = {
    mp3: 'audio/mpeg', wav: 'audio/wav', flac: 'audio/flac', ogg: 'audio/ogg',
    glb: 'model/gltf-binary', gltf: 'model/gltf+json', obj: 'model/obj',
    usdz: 'model/vnd.usdz+zip', fbx: 'application/octet-stream', pcm: 'application/octet-stream',
  };
  return {
    type: 'url', url: url.href, role,
    mediaType: mediaTypes[format] ?? 'application/octet-stream',
    ...(Object.hasOwn(mediaTypes, format) ? { metadata: { format } } : {}),
  };
}

// Native schemas: https://replicate.com/minimax/music-2.6/api/schema
const music: ReplicateAssetDefinition<MusicInput, 'music'> = {
  kind: 'music',
  mapInput(input) {
    const value = jsonObject(input, 'music input');
    onlyKeys(value, ['prompt', 'lyrics', 'instrumental'], 'music input');
    const mapped: JSONObject = {
      prompt: text(value.prompt, 'music input.prompt', 2000, true),
      lyrics: undefined,
      is_instrumental: undefined,
    };
    if (value.lyrics !== undefined) mapped.lyrics = text(value.lyrics, 'music input.lyrics', 3500, true);
    if (value.instrumental !== undefined) {
      boolean(value.instrumental, 'music input.instrumental');
      mapped.is_instrumental = value.instrumental;
    }
    return mapped;
  },
  mapResult(output) { return { assets: [file(output, 'audio')] }; },
};

function validateMusic(input: JSONObject): void {
  onlyKeys(input, ['prompt', 'lyrics', 'is_instrumental', 'lyrics_optimizer', 'sample_rate', 'bitrate', 'audio_format'], 'Replicate music input');
  if (input.is_instrumental !== undefined) boolean(input.is_instrumental, 'Replicate music input.is_instrumental');
  if (input.lyrics_optimizer !== undefined) boolean(input.lyrics_optimizer, 'providerOptions.replicate.lyrics_optimizer');
  if (input.sample_rate !== undefined) oneOf(input.sample_rate, 'providerOptions.replicate.sample_rate', [16000, 24000, 32000, 44100]);
  if (input.bitrate !== undefined) oneOf(input.bitrate, 'providerOptions.replicate.bitrate', [32000, 64000, 128000, 256000]);
  if (input.audio_format !== undefined) oneOf(input.audio_format, 'providerOptions.replicate.audio_format', ['mp3', 'wav', 'pcm']);
  if (input.is_instrumental === true || input.lyrics_optimizer === true) text(input.prompt, 'music input.prompt', 2000);
  if (input.is_instrumental !== true && input.lyrics_optimizer !== true) text(input.lyrics, 'music input.lyrics', 3500);
}

// Native schemas: https://replicate.com/tencent/hunyuan-3d-3.1/api/schema
const threeD: ReplicateAssetDefinition<ThreeDInput, 'model-3d'> = {
  kind: 'model-3d',
  mapInput(input) {
    const value = jsonObject(input, 'threeD input');
    onlyKeys(value, ['prompt'], 'threeD input');
    return { prompt: text(value.prompt, 'threeD input.prompt', 1024) };
  },
  mapResult(output) { return { assets: [file(output, 'model')] }; },
};

function validateThreeD(input: JSONObject): void {
  onlyKeys(input, ['prompt', 'enable_pbr', 'face_count', 'generate_type'], 'Replicate threeD input');
  if (input.enable_pbr !== undefined) boolean(input.enable_pbr, 'providerOptions.replicate.enable_pbr');
  if (input.face_count !== undefined && (typeof input.face_count !== 'number' ||
    !Number.isInteger(input.face_count) || input.face_count < 40_000 || input.face_count > 1_500_000)) {
    throw new TypeError('providerOptions.replicate.face_count must be an integer between 40000 and 1500000.');
  }
  if (input.generate_type !== undefined) oneOf(input.generate_type, 'providerOptions.replicate.generate_type', ['Normal', 'Geometry']);
}

function knownModel(actual: string, expected: string): void {
  if (actual !== expected) throw new TypeError(`This Replicate preset supports ${expected}; use .asset() with explicit mappings for another model.`);
}

export function createReplicateAssetProvider(settings: ReplicateAssetProviderSettings = {}): ReplicateAssetProvider {
  const config = { ...settings, headers: settings.headers === undefined ? undefined : { ...settings.headers } };
  return {
    music(modelId = REPLICATE_MUSIC_MODEL) {
      knownModel(modelId, REPLICATE_MUSIC_MODEL);
      return new ReplicateAssetModel(modelId, config, music, validateMusic);
    },
    threeD(modelId = REPLICATE_THREE_D_MODEL) {
      knownModel(modelId, REPLICATE_THREE_D_MODEL);
      return new ReplicateAssetModel(modelId, config, threeD, validateThreeD);
    },
    asset(modelId, definition) { return new ReplicateAssetModel(modelId, config, definition); },
  };
}
