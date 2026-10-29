import type { AssetFile, AssetModelMapping, AssetResponse, JSONObject, JSONValue } from '@sinestack/ai-provider';

export interface ViggleProviderSettings {
  readonly apiKey?: string;
  /** Includes the /v1 path. */
  readonly baseURL?: string;
  readonly headers?: Record<string, string>;
  readonly fetch?: typeof globalThis.fetch;
  readonly name?: string;
  readonly connectionId?: string;
}
export interface ViggleRequestOptions { readonly headers?: Record<string, string>; readonly abortSignal?: AbortSignal }
export type ViggleStatus = 'queued' | 'processing' | 'ready' | 'failed' | 'cancelled';
export interface ViggleError extends JSONObject {
  code: string;
  message: string;
  retryable?: boolean;
  request_id?: string | null;
  details?: JSONObject;
  remediation?: { action?: string; retry_after_ms?: number | null };
}
export interface ViggleJob extends JSONObject {
  id: string;
  status: ViggleStatus;
  progress?: number | null;
  error?: ViggleError | null;
  sessionId?: string;
}
export interface ViggleVideo extends ViggleJob {
  video_url?: string | null;
  alpha_url?: string | null;
  stage?: string | null;
  /** Unsafe JSON integers are decoded as exact decimal strings. */
  seed?: number | string;
  queue_position?: number | null;
  estimated_wait_seconds?: number | null;
  created_at?: string | null;
  completed_at?: string | null;
}
export interface ViggleImageOutput extends JSONObject { url: string | null; width?: number; height?: number; seed?: number }
export interface ViggleImageJob extends ViggleJob { images?: readonly ViggleImageOutput[]; created_at?: string | null; completed_at?: string | null }
export interface ViggleVideoList extends JSONObject { items: readonly ViggleVideo[]; next_cursor: string | null; has_more: boolean }
export interface ViggleVideoListOptions extends ViggleRequestOptions { status?: ViggleStatus; cursor?: string; limit?: number }
export type ViggleModelId = 'V3' | 'V4' | (string & {});
export type ViggleSeed = number | string;
export type ViggleFile = Blob;
export type ViggleOneOrMany<T> = T | readonly T[];
/** Native extension fields remain available without widening the known semantic fields. */
export interface ViggleInput { readonly [field: string]: JSONValue | Blob | readonly Blob[] | undefined }
export interface ViggleH3Options extends ViggleInput {
  prompt: string;
  quality: 'low' | 'high';
  duration_s?: number;
  resolution?: '480p' | '768p' | '1080p' | '2k' | '4k';
  aspect_ratio?: '16:9' | '9:16' | '1:1' | '4:3' | '3:4' | '21:9';
  seed?: ViggleSeed;
  watermark?: boolean;
  enhance?: boolean;
  priority?: 0 | 1000;
  driving_video?: never;
  driving_video_url?: never;
  character_image?: never;
  character_image_url?: never;
  character_image_urls?: never;
  enhance_mode?: never;
}
type NoReferences = { reference_video?: never; reference_video_url?: never; reference_image?: never; reference_image_url?: never };
type NoFrames = { first_frame_image?: never; first_frame_image_url?: never; last_frame_image?: never; last_frame_image_url?: never };
type FirstFrame = { first_frame_image: Blob; first_frame_image_url?: never } | { first_frame_image_url: string; first_frame_image?: never };
type LastFrame = { last_frame_image: Blob; last_frame_image_url?: never } | { last_frame_image_url: string; last_frame_image?: never };
export type ViggleTextToVideoInput = ViggleH3Options & NoFrames & NoReferences;
export type ViggleFirstFrameToVideoInput = ViggleH3Options & FirstFrame & NoReferences & { last_frame_image?: never; last_frame_image_url?: never };
export type ViggleFirstLastFrameToVideoInput = ViggleH3Options & FirstFrame & LastFrame & NoReferences;
interface References {
  reference_video?: ViggleOneOrMany<Blob>;
  reference_video_url?: ViggleOneOrMany<string>;
  reference_image?: ViggleOneOrMany<Blob>;
  reference_image_url?: ViggleOneOrMany<string>;
}
type AtLeastOneReference = { reference_video: ViggleOneOrMany<Blob> } | { reference_video_url: ViggleOneOrMany<string> } | { reference_image: ViggleOneOrMany<Blob> } | { reference_image_url: ViggleOneOrMany<string> };
export type ViggleReferenceToVideoInput = ViggleH3Options & NoFrames & References & AtLeastOneReference;
type DrivingVideo = { driving_video: Blob; driving_video_url?: never } | { driving_video_url: string; driving_video?: never };
type CharacterImages = { character_image: ViggleOneOrMany<Blob>; character_image_url?: never; character_image_urls?: never }
  | { character_image_url: ViggleOneOrMany<string>; character_image?: never; character_image_urls?: never }
  | { character_image_urls: readonly string[]; character_image?: never; character_image_url?: never };
export type ViggleCharacterAnimationInput = ViggleInput & DrivingVideo & CharacterImages & NoFrames & NoReferences & {
  prompt?: string;
  enhance_mode?: 'planner' | 'normal' | 'agent';
  watermark?: boolean;
  priority?: 0 | 1000;
  quality?: never;
  duration_s?: never;
  resolution?: never;
  aspect_ratio?: never;
  seed?: never;
  enhance?: never;
};
type RenderCharacter = { image: Blob; image_url?: never; character_id?: never } | { image_url: string; image?: never; character_id?: never } | { character_id: string; image?: never; image_url?: never };
type RenderMotion = { motion_video: Blob; motion_video_url?: never; motion_id?: never } | { motion_video_url: string; motion_video?: never; motion_id?: never } | { motion_id: string; motion_video?: never; motion_video_url?: never };
export type ViggleRenderVideoInput = ViggleInput & RenderCharacter & RenderMotion & {
  model?: ViggleModelId;
  mode?: string;
  background_mode?: 'original' | 'solid' | 'transparent' | 'inpaint';
  bg_color?: string;
  background_url?: string;
  character_mapping?: JSONObject | string;
  aspect_ratio?: 'source';
};
export type ViggleRenderSource = { kind: 'url'; url: string } | { kind: 'asset'; asset_id: string } | { kind: 'upload'; filename: string; content_type: string; bytes: number; sha256?: string };
export type ViggleRenderMotionSource = ViggleRenderSource | { kind: 'official_motion'; motion_id: string };
export interface VigglePrepareRenderInput extends JSONObject {
  character: ViggleRenderSource;
  motion: ViggleRenderMotionSource;
  output?: { background_mode?: 'original' | 'green' | 'white' | 'transparent'; aspect_ratio?: 'source' };
}
export interface ViggleUploadPlan extends JSONObject {
  upload_handle: string;
  url: string;
  method: 'PUT';
  required_headers?: Record<string, string>;
  expires_at?: string;
}
export interface ViggleRenderDraft extends JSONObject {
  draft_id: string;
  state?: string;
  uploads?: readonly ViggleUploadPlan[];
  expires_at?: string;
}
export interface ViggleRenderDraftInput extends JSONObject {
  draft_id: string;
  upload_completions?: readonly { upload_handle: string; etag?: string }[];
}
export interface ViggleImageInput extends ViggleInput {
  prompt: string;
  aspect_ratio?: '1:1' | '16:9' | '9:16' | '4:3' | '3:4' | '3:2' | '2:3';
  resolution?: '1K' | '2K' | '1k' | '2k';
  n?: number;
  seed?: number;
  reference_image?: ViggleOneOrMany<Blob>;
  reference_image_url?: ViggleOneOrMany<string>;
}
export type ViggleUpscaleVideoInput = ViggleInput & ({ video: Blob; video_url?: never } | { video_url: string; video?: never }) & { watermark?: boolean };
export interface ViggleUpscaleVideoResult { taskId: string; video: AssetFile; files: readonly AssetFile[]; raw: ViggleVideo }
export interface ViggleRenderEvent { event: string; id?: string; data?: JSONObject; retry?: number }
export interface ViggleRenderEventsOptions extends ViggleRequestOptions { lastEventId?: string }
export interface ViggleAssetMapping<I> extends AssetModelMapping<I> {}
export interface ViggleResourceResponse<T extends ViggleJob = ViggleJob> {
  data: T;
  response: AssetResponse;
  /** Protocol context for diagnosing malformed successful results. */
  url?: string;
  statusCode?: number;
}
