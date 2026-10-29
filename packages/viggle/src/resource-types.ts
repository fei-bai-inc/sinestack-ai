import type { JSONObject, JSONValue } from '@sinestack/ai-provider';

/** Suggestions only: new server models never require an SDK catalogue update. */
export type VigglePreprocessingModel = 'V3' | 'V3_Preview' | 'V4' | 'V4_BaseSG' | 'V4_Preview' | (string & {});
export type ViggleResourceStatus = 'queued' | 'processing' | 'ready' | 'failed' | 'cancelled';

/** Native fields stay available, including future fields and browser/Worker Blob uploads. */
export interface ViggleResourceInput {
  readonly [field: string]: JSONValue | Blob | readonly Blob[] | undefined;
}
export interface ViggleResourceError extends JSONObject {
  code: string;
  message: string;
  request_id?: string | null;
  retryable?: boolean;
  details?: JSONObject;
  remediation?: { action?: string; retry_after_ms?: number | null };
}
export interface ViggleExtractionStatus extends JSONObject {
  status: ViggleResourceStatus;
  error?: ViggleResourceError | null;
  skeletons?: readonly string[];
}
export interface ViggleResource extends JSONObject {
  id: string;
  status: ViggleResourceStatus;
  name?: string;
  progress?: number | null;
  capabilities?: readonly string[];
  created_at?: string | null;
  completed_at?: string | null;
  /** Currently often null even when status is failed. Inspect status and extraction errors. */
  error?: ViggleResourceError | null;
}
export interface ViggleCharacter extends ViggleResource {
  type?: 'render' | 'vsplat' | 'all';
  vsplat?: ViggleExtractionStatus | null;
  glb?: null;
}
export interface ViggleMotion extends ViggleResource {
  type?: 'render' | 'glb' | 'all';
  glb?: ViggleExtractionStatus | null;
  vsplat?: null;
}
export interface ViggleResourceList<T extends ViggleResource> extends JSONObject {
  /** The upstream endpoint returns at most 100 recent resources and has no cursor. */
  data: readonly T[];
}
export interface ViggleDeleteAcknowledgement extends JSONObject { status: 'deleted' }

export type ViggleCharacterImage =
  | { readonly image: Blob; readonly image_url?: never; readonly ref_url?: never }
  | { readonly image_url: string; readonly image?: never; readonly ref_url?: never }
  | { readonly ref_url: string; readonly image?: never; readonly image_url?: never };
export interface ViggleCharacterOptions extends ViggleResourceInput {
  readonly name?: string;
  /** The 2D preprocessing model, not a selector for 3D extraction. */
  readonly model?: VigglePreprocessingModel;
  readonly type?: 'render' | 'vsplat' | 'all';
  readonly enhance?: boolean;
  readonly enhance_prompt?: string;
  readonly variant?: 'optimized' | 'original';
  readonly model_precision?: number;
  readonly quality?: number;
  readonly filter_low_quality?: boolean;
  readonly prune_preset?: 'geometric' | 'draft' | 'balanced' | 'quality' | 'compact' | 'compact_hq';
  readonly prune_budget?: number;
  /** body=86 joints; expression=119; full=441. The server defaults to body. */
  readonly joint_set?: 'body' | 'expression' | 'full';
  readonly use_sparse_W?: boolean;
  readonly scale_parts?: string | Readonly<Record<string, number>>;
  readonly render_thumbnail?: boolean;
  /** Upstream idempotency applies to a vsplat-only submission, not the whole all operation. */
  readonly task_id?: string;
}
export type ViggleCharacterInput = ViggleCharacterOptions & (
  | ViggleCharacterImage
  | { readonly type: 'vsplat'; readonly enhance_prompt: string; readonly enhance?: true; readonly image?: never; readonly image_url?: never; readonly ref_url?: never }
);
export interface ViggleCharacterExport extends ViggleResource {
  download_type?: 'vsplat' | null;
  vsplat_url?: string | null;
  thumbnail_url?: string | null;
  updated_at?: string | null;
}

export type ViggleMotionVideoSource =
  | { readonly motion_video: Blob; readonly motion_video_url?: never; readonly video_url?: never }
  | { readonly motion_video_url: string; readonly motion_video?: never; readonly video_url?: never }
  | { readonly video_url: string; readonly motion_video?: never; readonly motion_video_url?: never };
export interface ViggleMotionVideoOptions extends ViggleResourceInput {
  readonly name?: string;
  readonly type?: 'render' | 'glb' | 'all';
  readonly model?: VigglePreprocessingModel;
  readonly thumbnail_path?: string;
  readonly thumbnail_url?: string;
  readonly enable_smoothing?: boolean;
  readonly target_fps?: number;
  readonly smooth_velocity_threshold?: number;
  readonly apply_std_joints?: boolean;
  /** Upstream idempotency applies only to type=glb. */
  readonly task_id?: string;
}
export type ViggleMotionVideoInput = ViggleMotionVideoOptions & ViggleMotionVideoSource;
/** The file-generation facade requests only the standalone skeletal animation. */
export type ViggleMotion3DVideoInput = ViggleMotionVideoInput & { readonly type?: 'glb' };
export interface ViggleMotionTextInput extends JSONObject {
  readonly text: string;
  readonly duration_seconds?: number;
  readonly guidance_scale?: number;
  readonly smooth?: boolean;
  readonly name?: string;
  readonly task_id?: string;
}
export type ViggleMotionImportInput = JSONObject & {
  readonly name?: string;
  readonly model?: VigglePreprocessingModel;
} & (
  | { readonly template_id: string; readonly template_uuid?: never }
  | { readonly template_uuid: string; readonly template_id?: never }
);
export type ViggleMotionExportFormat = 'glb' | 'fbx';
export interface ViggleMotionExport extends ViggleResource {
  download_type?: ViggleMotionExportFormat | null;
  mixamo_url?: string | null;
  metahuman_url?: string | null;
  metahuman_body_url?: string | null;
  thumbnail_url?: null;
  updated_at?: string | null;
}
export interface ViggleMotionModelOptions {
  /** All three rig variants are returned for this pre-generated format. Defaults to glb. */
  readonly format?: ViggleMotionExportFormat;
}

export type ViggleMatrix4 = readonly [
  readonly [number, number, number, number],
  readonly [number, number, number, number],
  readonly [number, number, number, number],
  readonly [number, number, number, number],
];
export type ViggleVector3 = readonly [number, number, number];
export interface ViggleSceneInput extends ViggleResourceInput {
  /** An account-scoped scene session, distinct from an individual task or image batch ID. */
  readonly sessionId: string;
}
export type ViggleSceneCreateInput = ViggleSceneInput & (
  | { readonly prompt: string; readonly panoramaUri?: never; readonly panorama?: never;
      readonly quality?: 'low' | 'medium' | 'high'; readonly referenceImages?: readonly string[]; readonly referenceImageFiles?: never }
  | { readonly prompt: string; readonly panoramaUri?: never; readonly panorama?: never;
      readonly quality?: 'low' | 'medium' | 'high'; readonly referenceImageFiles: readonly Blob[]; readonly referenceImages?: never }
  | { readonly panoramaUri: string; readonly panorama?: never; readonly prompt?: never;
      readonly quality?: never; readonly referenceImages?: never; readonly referenceImageFiles?: never }
  | { readonly panorama: Blob; readonly panoramaUri?: never; readonly prompt?: never;
      readonly quality?: never; readonly referenceImages?: never; readonly referenceImageFiles?: never }
);
export type ViggleSceneCustomPanoramaInput = ViggleSceneInput & {
  readonly panoramaC2w: ViggleMatrix4;
  readonly metersPerUnit?: number;
} & (
  | { readonly panoramaUri: string; readonly panorama?: never }
  | { readonly panorama: Blob; readonly panoramaUri?: never }
);
export interface ViggleSceneTargetPosition extends JSONObject {
  readonly position: ViggleVector3;
  readonly yaw?: number | null;
  readonly pitch?: number | null;
}
export type ViggleSceneGenerateInput = ViggleSceneInput & {
  readonly referenceBatchIds: readonly string[];
  readonly projection?: 'perspective' | 'pano';
  readonly fov?: number;
  readonly seed?: number;
} & (
  | { readonly targetC2w: ViggleMatrix4; readonly targetPosition?: never }
  | { readonly targetPosition: ViggleSceneTargetPosition; readonly targetC2w?: never }
);
export interface ViggleSceneReconstructInput extends ViggleSceneInput {
  readonly referenceBatchIds: readonly string[];
}
export interface ViggleSceneFile extends JSONObject { url: string }
export interface ViggleSceneView extends JSONObject {
  index: number;
  url: string;
  c2w: ViggleMatrix4;
  intrinsic: readonly number[];
}
export interface ViggleSceneBatch extends JSONObject {
  batchId: string;
  createdAt?: number;
  manifest: ViggleSceneFile;
  /** Historical batches can omit kind/views; their manifest still identifies the full batch. */
  kind?: 'initial' | 'generated';
  views?: readonly ViggleSceneView[];
}
export interface ViggleSceneResult extends JSONObject {
  operation: 'pano' | 'generate' | 'reconstruct';
  sessionId: string;
  spz?: ViggleSceneFile | null;
  preview?: ViggleSceneFile | null;
  panorama?: ViggleSceneFile | null;
  outputBatch?: ViggleSceneBatch | null;
  referenceViewCount?: number;
  newViewCount?: number;
  seconds?: JSONObject;
}
export interface ViggleSceneTask extends JSONObject {
  id: string;
  sessionId: string;
  /** The custom-pano endpoint also reports pano. */
  operation: 'pano' | 'generate' | 'reconstruct';
  status: ViggleResourceStatus;
  credits?: number;
  createdAt?: number | null;
  completedAt?: number | null;
  result?: ViggleSceneResult | null;
  error?: ViggleResourceError | null;
  queuePosition?: number;
}
