import type { AssetFile, AssetModelV1, JSONObject, SoundEffectInput, ThreeDInput } from '@sine-ai/provider';
import { FalAssetModel, record } from './fal-asset-model.js';
import type { FalAssetDefinition, FalAssetProviderSettings } from './fal-asset-model.js';

export { FalAssetModel };
export type { FalAssetDefinition, FalAssetProviderSettings };

export const FAL_THREE_D_MODEL = 'fal-ai/hunyuan3d-v3/text-to-3d';
export const FAL_SOUND_EFFECT_MODEL = 'fal-ai/elevenlabs/sound-effects/v2';

export interface FalAssetProvider {
  threeD(modelId?: string): AssetModelV1<ThreeDInput, 'model-3d'>;
  soundEffect(modelId?: string): AssetModelV1<SoundEffectInput, 'sound-effect'>;
  asset<INPUT, KIND extends string>(modelId: string, definition: FalAssetDefinition<INPUT, KIND>): AssetModelV1<INPUT, KIND>;
}

function onlyKeys(value: Record<string, unknown>, keys: ReadonlyArray<string>, label: string): void {
  for (const key of Object.keys(value)) {
    if (!keys.includes(key)) throw new TypeError(`${label}.${key} is not supported by this model.`);
  }
}

function text(value: unknown, label: string, maxLength?: number): string {
  if (typeof value !== 'string' || !value.trim() || (maxLength !== undefined && [...value].length > maxLength)) {
    throw new TypeError(`${label} must be a nonempty string${maxLength === undefined ? '' : ` of at most ${maxLength} characters`}.`);
  }
  return value;
}

function range(value: unknown, label: string, min: number, max: number, integer = false): void {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) {
    throw new TypeError(`${label} must be ${integer ? 'an integer' : 'a number'} between ${min} and ${max}.`);
  }
}

function boolean(value: unknown, label: string): void {
  if (typeof value !== 'boolean') throw new TypeError(`${label} must be a boolean.`);
}

function oneOf(value: unknown, label: string, values: ReadonlyArray<string>): void {
  if (typeof value !== 'string' || !values.includes(value)) throw new TypeError(`${label} has an unsupported value.`);
}

function file(value: unknown, role: string, fallbackMediaType: string, format?: string): AssetFile {
  const data = record(value, `fal ${role} file`);
  const source = text(data.url, `fal ${role} URL`);
  const url = new URL(source);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) {
    throw new TypeError('fal asset URLs must use HTTP(S) without credentials.');
  }
  if (data.content_type !== undefined) text(data.content_type, 'fal file content_type');
  if (data.file_name !== undefined) text(data.file_name, 'fal file file_name');
  if (data.file_size !== undefined) range(data.file_size, 'fal file file_size', 0, Number.MAX_SAFE_INTEGER, true);
  const metadata: JSONObject = {};
  if (format !== undefined) metadata.format = format;
  if (typeof data.file_size === 'number') metadata.fileSize = data.file_size;
  return {
    type: 'url', url: source,
    mediaType: typeof data.content_type === 'string' ? data.content_type : fallbackMediaType,
    role, ...(typeof data.file_name === 'string' ? { filename: data.file_name } : {}),
    ...(Object.keys(metadata).length ? { metadata } : {}),
  };
}

const THREE_D_OPTIONS = ['enable_safety_checker', 'enable_pbr', 'face_count', 'generate_type', 'polygon_type'];
const SOUND_FORMATS = [
  'mp3_22050_32', 'mp3_44100_32', 'mp3_44100_64', 'mp3_44100_96', 'mp3_44100_128', 'mp3_44100_192',
  'pcm_8000', 'pcm_16000', 'pcm_22050', 'pcm_24000', 'pcm_44100', 'pcm_48000', 'ulaw_8000', 'alaw_8000',
  'opus_48000_32', 'opus_48000_64', 'opus_48000_96', 'opus_48000_128', 'opus_48000_192',
];

// Input/output mappings follow the two fal model schemas; queue execution remains shared.
// https://fal.ai/models/fal-ai/hunyuan3d-v3/text-to-3d/api
const threeD: FalAssetDefinition<ThreeDInput, 'model-3d'> = {
  kind: 'model-3d',
  mapInput(input) {
    const value = record(input, 'threeD input');
    onlyKeys(value, ['prompt'], 'threeD input');
    return { prompt: text(value.prompt, 'threeD input.prompt', 1024) };
  },
  mapResult(output) {
    const value = record(output, 'fal 3D output');
    const assets: AssetFile[] = [file(value.model_glb, 'model', 'model/gltf-binary', 'glb')];
    const seen = new Set(assets.map(asset => asset.type === 'url' ? asset.url : ''));
    if (value.model_urls != null) {
      const mediaTypes: Record<string, string> = { glb: 'model/gltf-binary', obj: 'model/obj', usdz: 'model/vnd.usdz+zip' };
      for (const [format, data] of Object.entries(record(value.model_urls, 'fal model_urls'))) {
        if (data == null) continue;
        const asset = file(data, 'model', mediaTypes[format] ?? 'application/octet-stream', format);
        if (asset.type === 'url' && !seen.has(asset.url)) {
          assets.push(asset);
          seen.add(asset.url);
        }
      }
    }
    if (value.thumbnail != null) assets.push(file(value.thumbnail, 'thumbnail', 'image/png'));
    return {
      assets,
      ...(typeof value.seed === 'number' && Number.isFinite(value.seed) ? { providerMetadata: { fal: { seed: value.seed } } } : {}),
    };
  },
};

// https://fal.ai/models/fal-ai/elevenlabs/sound-effects/v2/api
const soundEffect: FalAssetDefinition<SoundEffectInput, 'sound-effect'> = {
  kind: 'sound-effect',
  mapInput(input) {
    const value = record(input, 'soundEffect input');
    onlyKeys(value, ['prompt', 'durationSeconds', 'promptInfluence', 'loop'], 'soundEffect input');
    const body: JSONObject = { text: text(value.prompt, 'soundEffect input.prompt') };
    if (value.durationSeconds !== undefined) {
      range(value.durationSeconds, 'soundEffect input.durationSeconds', 0.5, 22);
      body.duration_seconds = value.durationSeconds as number;
    }
    if (value.promptInfluence !== undefined) {
      range(value.promptInfluence, 'soundEffect input.promptInfluence', 0, 1);
      body.prompt_influence = value.promptInfluence as number;
    }
    if (value.loop !== undefined) {
      boolean(value.loop, 'soundEffect input.loop');
      body.loop = value.loop as boolean;
    }
    return body;
  },
  mapResult(output) {
    const value = record(output, 'fal sound effect output');
    const audio = record(value.audio, 'fal audio');
    const url = new URL(text(audio.url, 'fal audio URL'));
    const extension = url.pathname.split('.').at(-1)?.toLowerCase();
    const mediaTypes: Record<string, string> = { mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', opus: 'audio/ogg', flac: 'audio/flac' };
    return { assets: [file(audio, 'audio', mediaTypes[extension ?? ''] ?? 'application/octet-stream')] };
  },
};

export function createFalAssetProvider(settings: FalAssetProviderSettings = {}): FalAssetProvider {
  // Copy caller-owned configuration so mutating it cannot retarget an existing connection.
  const config = { ...settings, headers: settings.headers === undefined ? undefined : { ...settings.headers } };
  return {
    threeD(modelId = FAL_THREE_D_MODEL) {
      return new FalAssetModel(modelId, config, threeD, options => {
        onlyKeys(options, THREE_D_OPTIONS, 'providerOptions.fal');
        for (const key of ['enable_safety_checker', 'enable_pbr']) {
          if (options[key] !== undefined) boolean(options[key], `providerOptions.fal.${key}`);
        }
        if (options.face_count !== undefined) range(options.face_count, 'providerOptions.fal.face_count', 40_000, 1_500_000, true);
        if (options.generate_type !== undefined) oneOf(options.generate_type, 'providerOptions.fal.generate_type', ['Normal', 'LowPoly', 'Geometry']);
        if (options.polygon_type !== undefined) oneOf(options.polygon_type, 'providerOptions.fal.polygon_type', ['triangle', 'quadrilateral']);
      });
    },
    soundEffect(modelId = FAL_SOUND_EFFECT_MODEL) {
      return new FalAssetModel(modelId, config, soundEffect, options => {
        onlyKeys(options, ['output_format'], 'providerOptions.fal');
        if (options.output_format !== undefined) oneOf(options.output_format, 'providerOptions.fal.output_format', SOUND_FORMATS);
      });
    },
    asset(modelId, definition) {
      return new FalAssetModel(modelId, config, definition);
    },
  };
}
