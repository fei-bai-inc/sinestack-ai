import type { AssetFile, AssetModelMapping, JSONObject, JSONValue } from '@sinestack/ai-provider';

/** Suggestions, not model registration or a server-side entitlement promise. */
export type MeshyModelId = 'meshy-6' | 'meshy-6-lite' | 'meshy-7.1' | 'meshy-t2' | 'meshy-t2.5' | 'latest' | (string & {});
export type MeshyFormat = 'glb' | 'gltf' | 'fbx' | 'obj' | 'usdz' | 'stl' | 'blend' | '3mf' | (string & {});
export type MeshyMotionMode = 'prime' | 'swift' | (string & {});
export type MeshyStatus = 'PENDING' | 'IN_PROGRESS' | 'SUCCEEDED' | 'FAILED' | 'CANCELED';
export interface MeshyProviderSettings {
  readonly apiKey?: string;
  /** Includes /openapi, not a global /v1 suffix: text-to-3d uses v2. */
  readonly baseURL?: string;
  readonly headers?: Record<string, string>;
  readonly fetch?: typeof globalThis.fetch;
  readonly name?: string;
  readonly connectionId?: string;
}
export interface MeshyRequestOptions { readonly headers?: Record<string, string>; readonly abortSignal?: AbortSignal }
export interface MeshyInputMapping<I> { readonly mapInput?: (input: I) => JSONObject | PromiseLike<JSONObject> }
export interface MeshyAssetDefinition<I, K extends string> extends AssetModelMapping<I> {
  readonly kind: K;
  readonly modelId?: string;
}
export interface MeshyExperimentalOptions extends JSONObject {
  turbo?: boolean;
  enable_tsr?: boolean;
  optimize_texture_seams?: boolean | null;
}
export interface MeshyGeometryOptions extends JSONObject {
  ai_model?: MeshyModelId;
  name?: string;
  model_type?: 'standard' | 'smart-topology' | 'lowpoly' | (string & {});
  topology?: 'triangle' | 'quad' | (string & {});
  target_polycount?: number | null;
  should_remesh?: boolean | null;
  geometry_resolution?: 'standard' | '2k' | '4k' | (string & {});
  pose_mode?: 'a-pose' | 't-pose' | (string & {});
  seed?: number;
  moderation?: boolean;
  save_pre_remeshed_model?: boolean;
  auto_size?: boolean;
  origin_at?: 'bottom' | 'center';
  decimation_mode?: number;
  target_formats?: readonly MeshyFormat[];
  experimental?: MeshyExperimentalOptions;
  alpha_thumbnail?: boolean;
  /** @deprecated Use geometry_resolution. Preserved without translating it. */
  ultra_mode?: boolean | null;
  /** @deprecated Use pose_mode. */
  is_a_t_pose?: boolean;
  /** @deprecated No automatic rewrite is performed. */
  symmetry_mode?: string;
  /** @deprecated Use ai_model. */
  surface_mode?: string;
}
export interface MeshyTextureOptions extends JSONObject {
  enable_pbr?: boolean;
  texture_resolution?: '2k' | '4k' | '8k' | (string & {}) | null;
  texture_prompt?: string;
  texture_image_url?: string;
  remove_lighting?: boolean | null;
  /** @deprecated Use texture_resolution. */
  hd_texture?: boolean | null;
}
export interface MeshyTextTo3DInput extends MeshyGeometryOptions {
  prompt: string;
  mode?: 'preview';
  negative_prompt?: string;
  art_style?: string;
  texture_richness?: string;
}
export interface MeshyRefineInput extends MeshyTextureOptions {
  preview_task_id: string;
  mode?: 'refine';
  ai_model?: MeshyModelId;
  name?: string;
  target_formats?: readonly MeshyFormat[];
  auto_size?: boolean;
  alpha_thumbnail?: boolean;
  experimental?: MeshyExperimentalOptions;
}
/** The published endpoint pages allow both; input_task_id takes precedence. */
export type MeshyModelSource =
  | { input_task_id: string; model_url?: string }
  | { model_url: string; input_task_id?: string };
export type MeshyImageTo3DInput = MeshyGeometryOptions & MeshyTextureOptions & (
  { image_url: string; input_task_id?: string } | { input_task_id: string; image_url?: string }
) & { should_texture?: boolean | null; image_enhancement?: boolean | null; multi_view_thumbnails?: boolean };
export type MeshyMultiImageTo3DInput = MeshyGeometryOptions & MeshyTextureOptions & (
  { image_urls: readonly string[]; input_task_id?: string } | { input_task_id: string; image_urls?: readonly string[] }
) & { should_texture?: boolean | null; image_enhancement?: boolean | null; texture_image_urls?: readonly string[] };
export type MeshyRetextureInput = JSONObject & MeshyModelSource & {
  ai_model?: MeshyModelId;
  name?: string;
  art_style?: string;
  enable_original_uv?: boolean;
  enable_pbr?: boolean;
  remove_lighting?: boolean | null;
  texture_resolution?: string | null;
  hd_texture?: boolean | null;
  target_formats?: readonly MeshyFormat[];
  alpha_thumbnail?: boolean;
} & (
  | { text_style_prompt: string; image_style_url?: string; multiview_image_urls?: never }
  | { image_style_url: string; text_style_prompt?: string; multiview_image_urls?: never }
  | { multiview_image_urls: readonly string[]; text_style_prompt?: never; image_style_url?: never }
);
export type MeshyRemeshInput = JSONObject & MeshyModelSource & {
  target_formats?: readonly MeshyFormat[];
  topology?: 'quad' | 'triangle' | (string & {});
  target_polycount?: number;
  decimation_mode?: number;
  alpha_thumbnail?: boolean;
  /** @deprecated Prefer the separate Resize capability. */
  resize_height?: number;
  /** @deprecated Prefer the separate Resize capability. */
  resize_longest_side?: number;
  /** @deprecated Prefer the separate Resize capability. */
  auto_size?: boolean;
  origin_at?: 'bottom' | 'center';
  /** @deprecated Prefer the separate Convert capability. */
  convert_format_only?: boolean;
};
export type MeshyConvertInput = JSONObject & MeshyModelSource & { target_formats: readonly MeshyFormat[] };
export type MeshyResizeInput = JSONObject & MeshyModelSource & { origin_at?: 'bottom' | 'center' } & (
  | { resize_height: number; resize_longest_side?: never; auto_size?: never }
  | { resize_longest_side: number; resize_height?: never; auto_size?: never }
  | { auto_size: boolean; resize_height?: never; resize_longest_side?: never }
);
export type MeshyUVInput = JSONObject & MeshyModelSource;
export type MeshyRigInput = JSONObject & MeshyModelSource & {
  name?: string;
  height_meters?: number;
  /** OpenAPI advertises this selector; real non-biped entitlement requires live verification. */
  animation_type?: 'biped' | 'quadruped' | (string & {});
  /** @deprecated Overrides embedded textures and drops PBR maps. */
  texture_image_url?: string;
};
export interface MeshyAnimationPostProcess extends JSONObject {
  /** Omission is valid: Meshy makes no extra post-processed file. */
  operation_type?: 'change_fps' | 'fbx2usdz' | 'extract_armature' | (string & {});
  fps?: number;
}
export type MeshyAnimationInput = JSONObject & {
  rig_task_id: string;
  name?: string;
  post_process?: MeshyAnimationPostProcess | null;
} & (
  | { action_id: number; action_ids?: never; motion_task_id?: never }
  | { action_ids: readonly number[]; action_id?: never; motion_task_id?: never }
  | { motion_task_id: string; action_id?: never; action_ids?: never }
);
export interface MeshyTextToMotionInput extends JSONObject { prompt: string; duration: number; mode?: MeshyMotionMode }
export interface MeshyTextToImageInput extends JSONObject {
  prompt: string;
  ai_model?: string;
  generate_multi_view?: boolean | null;
  pose_mode?: string;
  aspect_ratio?: string;
  remove_background?: boolean;
}
export type MeshyImageToImageInput = MeshyTextToImageInput & (
  { reference_image_urls: readonly string[]; input_task_id?: string }
  | { input_task_id: string; reference_image_urls?: readonly string[] }
);
export type MeshyMultiColorPrintInput = JSONObject & MeshyModelSource & {
  style?: 'realistic' | 'cartoon';
  max_colors?: number;
  max_depth?: number;
  printer_brand?: string;
};
export type MeshyPrintSize =
  | { intended_print_height_mm?: number; intended_print_longest_side_mm?: never }
  | { intended_print_longest_side_mm?: number; intended_print_height_mm?: never };
export type MeshyPrintAnalysisInput = JSONObject & MeshyModelSource & MeshyPrintSize & { printer_type?: 'fdm' | 'sla' | 'full_color' | (string & {}) };
export type MeshyPrintRepairInput = MeshyPrintAnalysisInput & { alpha_thumbnail?: boolean };
export type MeshyAutoSplitInput = JSONObject & {
  input_task_id: string;
  target_formats?: readonly MeshyFormat[];
  layout?: 'assembled' | 'on_plate';
  connectors?: boolean;
  connector_type?: 'cube' | 'cylinder';
  connector_size?: number;
  connector_height?: number;
} & ({ mode?: 'auto'; prompt?: string } | { mode: 'by_parts' | 'by_color'; prompt: string });

export interface MeshyTaskRecord extends JSONObject {
  id: string;
  status: MeshyStatus;
  type?: string;
  mode?: string;
  progress?: number;
  created_at?: number;
  started_at?: number;
  finished_at?: number;
  expires_at?: number | null;
  consumed_credits?: number | null;
  task_error?: JSONObject | null;
  model_urls?: JSONObject | null;
  texture_urls?: readonly JSONObject[] | null;
  image_urls?: readonly string[] | null;
  result?: JSONObject | null;
  printability?: JSONObject | null;
}
export interface MeshyResultInfo {
  readonly taskId: string;
  /** Detached native task response. Results are top-level for some Meshy families. */
  readonly raw: MeshyTaskRecord;
  readonly creditsConsumed?: number;
  readonly expiresAt?: number;
}
export interface MeshyModelResult extends MeshyResultInfo {
  readonly model: AssetFile;
  readonly files: readonly AssetFile[];
  readonly models: Readonly<Record<string, AssetFile>>;
  readonly textures: readonly AssetFile[];
  readonly previews: readonly AssetFile[];
}
export interface MeshyRigResult extends MeshyModelResult {
  readonly animations: readonly AssetFile[];
  readonly armatures: readonly AssetFile[];
}
export interface MeshyAnimationResult extends MeshyResultInfo {
  readonly files: readonly AssetFile[];
  readonly animations: readonly AssetFile[];
  readonly armatures: readonly AssetFile[];
  /** Only if actually reported; never synthesize clips from file count or requested actions. */
  readonly clips?: JSONValue;
}
export interface MeshyPrintabilityReport extends JSONObject {
  status: string;
  _version?: string;
  issue_count?: number;
  error_count?: number;
  warning_count?: number;
  metrics?: JSONObject | null;
  intended_print?: JSONObject | null;
  thin_walls?: JSONObject | null;
  evaluated_at?: number;
}
export interface MeshyPrintAnalysisResult extends MeshyResultInfo { readonly printability: MeshyPrintabilityReport }
export interface MeshyPrintRepairResult extends MeshyModelResult {
  readonly intendedPrint?: JSONObject;
  readonly repairReport?: JSONObject;
}
export interface MeshyAutoSplitResult extends MeshyModelResult {
  readonly partCount?: number;
  readonly promptIgnored?: boolean;
}
export interface MeshyListOptions {
  readonly page_num?: number;
  readonly page_size?: number;
  readonly sort_by?: '+created_at' | '-created_at';
}
export interface MeshyAnimationFilters {
  readonly search?: string;
  readonly category?: string;
  readonly sub_category?: string;
  readonly action_ids?: string | readonly number[];
}
export interface MeshyUsageQuery extends MeshyListOptions {
  readonly start_time?: string;
  readonly end_time?: string;
  readonly endpoints?: string | readonly string[];
  readonly status?: 'SUCCEEDED' | 'FAILED';
}
export interface MeshyAnimationPreset extends JSONObject { action_id: number; name: string; key: string; category?: string; sub_category?: string; preview_url?: string }
export interface MeshyBalance extends JSONObject { balance: number; monthly_credits?: number; permanent_credits?: number; monthly_resets_at?: number | null }
export interface MeshyUsageRecord extends JSONObject { task_id: string; endpoint: string; status: 'SUCCEEDED' | 'FAILED'; consumed_credits: number }
