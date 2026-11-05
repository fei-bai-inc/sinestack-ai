import type { JSONObject } from '@sinestack/ai-provider';

export interface WorldLabsProviderSettings {
  readonly apiKey?: string;
  readonly baseURL?: string;
  readonly fetch?: typeof globalThis.fetch;
  readonly headers?: Record<string, string>;
  readonly name?: string;
  readonly connectionId?: string;
}
export interface WorldLabsRequestOptions {
  readonly abortSignal?: AbortSignal;
  readonly headers?: Record<string, string>;
}
export type WorldLabsModelId = 'marble-1.0-draft' | 'marble-1.0' | 'marble-1.1' | 'marble-1.1-plus' | (string & {});
export type WorldLabsMediaReference =
  | { source: 'uri'; uri: string }
  | { source: 'media_asset'; media_asset_id: string }
  | { source: 'data_base64'; data_base64: string; extension?: string | null };
export type WorldLabsWorldPrompt =
  | { type: 'text'; text_prompt: string; disable_recaption?: boolean | null }
  | { type: 'image'; image_prompt: WorldLabsMediaReference; is_pano?: boolean | 'auto'; text_prompt?: string | null; disable_recaption?: boolean | null }
  | { type: 'multi-image'; multi_image_prompt: Array<{ content: WorldLabsMediaReference; azimuth?: number | null }>; reconstruct_images?: boolean; text_prompt?: string | null; disable_recaption?: boolean | null }
  | { type: 'video'; video_prompt: WorldLabsMediaReference; text_prompt?: string | null; disable_recaption?: boolean | null };
export interface WorldLabsPermission extends JSONObject {
  public?: boolean;
  allow_id_access?: boolean;
  allowed_readers?: string[];
  allowed_writers?: string[];
}
export interface WorldLabsWorldInput extends JSONObject {
  world_prompt: WorldLabsWorldPrompt;
  model?: WorldLabsModelId;
  display_name?: string | null;
  seed?: number | null;
  tags?: string[] | null;
  permission?: WorldLabsPermission;
}
export interface WorldLabsDepthToPanoramaInput extends JSONObject {
  depth_pano_image: WorldLabsMediaReference;
  text_prompt: string;
  z_min?: number | null;
  z_max?: number | null;
  seed?: number | null;
}
export type WorldLabsSplatResolution = 'full_res' | '500k' | '150k' | '100k';
export type WorldLabsMeshVariant = 'textured' | 'vertex_colored';
export interface WorldLabsExportSplatInput extends JSONObject {
  world_id: string;
  resolution?: WorldLabsSplatResolution;
}
export interface WorldLabsExportMeshInput extends JSONObject {
  world_id: string;
  mesh_variant?: WorldLabsMeshVariant;
}
export interface WorldLabsWorldAssets extends JSONObject {
  caption?: string | null;
  thumbnail_url?: string | null;
  imagery?: { pano_url?: string | null } | null;
  mesh?: { collider_mesh_url?: string | null; full_res_mesh_url?: string | null; hq_mesh_url?: string | null } | null;
  splats?: {
    spz_urls?: Record<string, string> | null;
    semantics_metadata?: { metric_scale_factor?: number | null; ground_plane_offset?: number | null } | null;
  } | null;
}
/** Operation snapshots can omit metadata. The quickstart also documents the id spelling. */
export type WorldLabsWorld = JSONObject & ({ world_id: string; id?: string } | { id: string; world_id?: string }) & {
  display_name?: string | null;
  world_marble_url?: string | null;
  model?: string | null;
  assets?: WorldLabsWorldAssets | null;
  tags?: string[] | null;
  permission?: WorldLabsPermission | null;
  world_prompt?: JSONObject | null;
  created_at?: string | null;
  updated_at?: string | null;
};
export interface WorldLabsOperation extends JSONObject {
  operation_id: string;
  done: boolean;
  error?: { code?: number | null; message?: string | null } | null;
  metadata?: JSONObject | null;
  response?: JSONObject | null;
  cost?: { total_credits: number; line_items?: Array<{ name: string; credits: number }> } | null;
  created_at?: string | null;
  updated_at?: string | null;
  expires_at?: string | null;
}
export interface WorldLabsListWorldsInput extends JSONObject {
  page_size?: number;
  page_token?: string | null;
  sort_by?: 'created_at' | 'updated_at';
  status?: 'SUCCEEDED' | 'PENDING' | 'FAILED' | 'RUNNING' | null;
  model?: WorldLabsModelId | null;
  tags?: string[] | null;
  is_public?: boolean | null;
  created_after?: string | null;
  created_before?: string | null;
}
export interface WorldLabsListWorldsResult {
  readonly worlds: WorldLabsWorld[];
  readonly next_page_token?: string | null;
}
export interface WorldLabsPrepareUploadInput extends JSONObject {
  file_name: string;
  kind: 'image' | 'video';
  extension?: string | null;
  metadata?: JSONObject | null;
}
export interface WorldLabsMediaAsset extends JSONObject {
  media_asset_id: string;
  file_name: string;
  kind: 'image' | 'video';
  extension?: string | null;
  metadata?: JSONObject | null;
  created_at?: string;
  updated_at?: string | null;
}
export interface WorldLabsPreparedUpload extends JSONObject {
  media_asset: WorldLabsMediaAsset;
  upload_info: {
    upload_url: string;
    upload_method: string;
    required_headers?: Record<string, string> | null;
    curl_example?: string | null;
  };
}

export interface WorldLabsResources {
  readonly operations: {
    get(id: string, options?: WorldLabsRequestOptions): Promise<WorldLabsOperation>;
  };
  readonly worlds: {
    get(id: string, options?: WorldLabsRequestOptions): Promise<WorldLabsWorld>;
    list(input?: WorldLabsListWorldsInput, options?: WorldLabsRequestOptions): Promise<WorldLabsListWorldsResult>;
    delete(id: string, options?: WorldLabsRequestOptions): Promise<{ world_id: string; deleted: boolean }>;
  };
  readonly credits: {
    get(options?: WorldLabsRequestOptions): Promise<{ remaining_credits: number }>;
  };
  readonly mediaAssets: {
    prepareUpload(input: WorldLabsPrepareUploadInput, options?: WorldLabsRequestOptions): Promise<WorldLabsPreparedUpload>;
    get(id: string, options?: WorldLabsRequestOptions): Promise<WorldLabsMediaAsset>;
    upload(prepared: WorldLabsPreparedUpload, body: Blob | Uint8Array, options?: Pick<WorldLabsRequestOptions, 'abortSignal'>): Promise<void>;
  };
}
