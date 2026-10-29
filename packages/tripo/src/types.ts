import type { AssetFile, AssetModelMapping, JSONObject, JSONValue } from '@sine-ai/provider';

/** Known values provide completion hints, not a model/version allowlist. */
export type OpenString<T extends string> = T | (string & {});
export type TripoView = 'front' | 'left' | 'back' | 'right';
export type TripoModelVersion = OpenString<'v3.1-20260211' | 'v3.0-20250812' | 'v2.5-20250123' | 'P1-20260311' | 'P2-20260801'>;
export type TripoRigType = OpenString<'biped' | 'quadruped' | 'hexapod' | 'octopod' | 'avian' | 'serpentine' | 'aquatic' | 'others'>;
export type TripoTextureQuality = OpenString<'fast' | 'standard' | 'detailed' | 'extreme'>;
export type TripoOrientation = OpenString<'+x' | '-x' | '+y' | '-y'>;
export type TripoImageSource = string | { readonly url: string } | { readonly file_token: string } | { readonly object: { readonly bucket: string; readonly key: string } };
/** Fixed slots are FRONT, LEFT, BACK, RIGHT. Missing geometry slots use an empty string. */
export type TripoTextureViews = readonly [TripoImageSource, TripoImageSource | null, TripoImageSource | null, TripoImageSource | null]
  | readonly Partial<Record<TripoView, TripoImageSource>>[];
export type TripoMultiviewSources = readonly [string, string, string, string]
  | readonly Partial<Record<TripoView, TripoImageSource>>[] | readonly [{ readonly task_id: string }];

export interface TripoGeometryOptions extends JSONObject {
  model?: TripoModelVersion;
  model_seed?: number;
  face_limit?: number;
  texture?: boolean;
  pbr?: boolean;
  texture_seed?: number;
  texture_quality?: TripoTextureQuality;
  texture_version?: string;
  delight?: boolean;
  auto_size?: boolean;
  export_uv?: boolean;
  export_orientation?: TripoOrientation;
  geometry_quality?: OpenString<'standard' | 'detailed'>;
  quad?: boolean;
  smart_low_poly?: boolean;
  generate_parts?: boolean;
  compress?: OpenString<'geometry'>;
}
export interface TripoTextTo3DInput extends TripoGeometryOptions { prompt: string; negative_prompt?: string; image_seed?: number }
export interface TripoImageTo3DInput extends TripoGeometryOptions {
  input: string;
  enable_image_autofix?: boolean;
  texture_alignment?: OpenString<'original_image' | 'geometry'>;
  orientation?: OpenString<'default' | 'align_image'>;
}
export interface TripoMultiviewTo3DInput extends TripoGeometryOptions {
  inputs: TripoMultiviewSources;
  texture_alignment?: OpenString<'original_image' | 'geometry'>;
  orientation?: OpenString<'default' | 'align_image'>;
}
export interface TripoSplatInput extends JSONObject { input: string; model_seed?: number }
export interface TripoImageOptions extends JSONObject {
  model?: string; size?: string; quality?: string; background?: string; aspect_ratio?: string; output_format?: string;
}
export interface TripoTextToImageInput extends TripoImageOptions { prompt: string; template?: string; watermark?: boolean }
export type TripoImageToImageInput = TripoImageOptions & (
  { input: string; inputs?: never } | { inputs: readonly string[]; input?: never }
) & ({ prompt: string; template?: string } | { template: string; prompt?: string });
export interface TripoImageToMultiviewInput extends JSONObject { input: string }
export interface TripoEditMultiviewInput extends JSONObject { input: string; prompts: readonly { readonly prompt: string; readonly view: TripoView }[] }
export interface TripoDepthInput extends JSONObject { input: string; kind?: OpenString<'gray' | 'color'>; process_res?: number }
export interface TripoModelInput extends JSONObject { input: string; model?: string }
export type TripoTexturePrompt =
  | { readonly text: string; readonly style_image?: TripoImageSource; readonly image?: never; readonly images?: never }
  | { readonly image: TripoImageSource; readonly text?: never; readonly style_image?: never; readonly images?: never }
  | { readonly images: TripoTextureViews; readonly image?: never; readonly text?: never; readonly style_image?: never };
export interface TripoTextureInput extends TripoModelInput {
  texture_prompt?: TripoTexturePrompt;
  pbr?: boolean; texture_seed?: number; texture_alignment?: OpenString<'original_image' | 'geometry'>;
  texture_quality?: TripoTextureQuality; part_names?: readonly string[]; compress?: string; bake?: boolean; delight?: boolean;
}
export interface TripoSegmentInput extends TripoModelInput {
  segmentation_granularity?: OpenString<'simple' | 'balanced' | 'detailed'>;
  split_by_connectivity?: boolean; ref_image?: string;
}
export type TripoSmartSegmentInput = JSONObject & { input: string; granularity?: OpenString<'coarse' | 'medium' | 'fine'>; hint?: string } & (
  { seg_type: 'image'; transform?: readonly number[] } | { seg_type: 'model'; transform: readonly number[] }
);
export interface TripoCompleteInput extends TripoModelInput { part_names?: readonly string[]; completion_mode?: OpenString<'ai_completion' | 'quick_cap'> }
export interface TripoRetopologyInput extends TripoModelInput {
  face_limit?: number; quad?: boolean; smart_uv?: boolean; bake?: boolean; part_names?: readonly string[];
}
export interface TripoUVInput extends TripoModelInput { bake?: boolean; export_orientation?: TripoOrientation; compress?: string }
export interface TripoConvertInput extends JSONObject {
  input: string;
  format: OpenString<'GLTF' | 'FBX' | 'USDZ' | 'OBJ' | 'STL' | '3MF'>;
  quad?: boolean; force_symmetry?: boolean; face_limit?: number;
  flatten_bottom?: boolean; flatten_bottom_threshold?: number;
  texture_size?: number; texture_format?: string; bake?: boolean; pack_uv?: boolean; export_vertex_colors?: boolean;
  pivot_to_center_bottom?: boolean; scale_factor?: number; export_orientation?: TripoOrientation;
  with_animation?: boolean; animate_in_place?: boolean; part_names?: readonly string[];
  fbx_preset?: OpenString<'blender' | '3dsmax' | 'mixamo' | 'bake_scale'>;
}
export interface TripoImportInput extends JSONObject { input: string }
export interface TripoRigCheckInput extends JSONObject { input: string }
export interface TripoRigInput extends TripoModelInput {
  rig_type?: TripoRigType;
  spec?: OpenString<'tripo' | 'mixamo' | 'actorcore' | 'unity' | 'unreal' | 'vrm'>;
  out_format?: OpenString<'glb' | 'fbx'>;
}
export type TripoRetargetInput = JSONObject & {
  input: string; out_format?: OpenString<'glb' | 'fbx'>; export_with_geometry?: boolean; animate_in_place?: boolean;
} & ({ animation: string; animations?: never } | { animations: readonly string[]; animation?: never });

export interface TripoOutputInfo {
  readonly taskId: string;
  /** Detached, complete native output. Never edited by an injected mapper. */
  readonly raw: JSONObject;
  readonly creditsConsumed?: number;
}
export interface TripoModelResult extends TripoOutputInfo {
  readonly model: AssetFile;
  readonly files: readonly AssetFile[];
  readonly preview?: AssetFile;
  readonly normalizeScale?: number;
  readonly normalizeTranslation?: readonly [number, number, number];
}
export interface TripoSegmentResult extends TripoModelResult { readonly parts?: JSONValue }
export interface TripoSmartSegmentResult extends TripoModelResult {
  readonly segmentationTaskId?: string; readonly modelTaskId?: string; readonly mask?: AssetFile; readonly prompt?: string;
}
export interface TripoUVResult extends TripoModelResult { readonly uvPreview?: AssetFile }
export interface TripoRigCheckResult extends TripoOutputInfo { readonly riggable: boolean; readonly rigType?: TripoRigType }
export interface TripoRigResult extends TripoModelResult { readonly rigType?: TripoRigType; readonly skeletonSpec?: string }
export interface TripoAnimationResult extends TripoOutputInfo {
  readonly files: readonly AssetFile[];
  /** Only present when the provider reports clip metadata; never inferred from file count. */
  readonly clips?: JSONValue;
}
export interface TripoTaskRecord extends JSONObject {
  task_id: string; status: string; type?: string; output?: JSONObject; progress?: number;
  error_code?: number | string; error_message?: string; credits_consumed?: number; created_at?: string; completed_at?: string;
}
export interface TripoProviderSettings {
  readonly apiKey?: string;
  readonly baseURL?: string;
  readonly fetch?: typeof globalThis.fetch;
  readonly headers?: Record<string, string>;
  readonly name?: string;
  readonly connectionId?: string;
}
export interface TripoAssetDefinition<I, K extends string> extends AssetModelMapping<I> { readonly kind: K; readonly modelId?: string }
