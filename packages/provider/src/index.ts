/**
 * Asset contracts derived from the structure of AI SDK 7's VideoModelV4.
 * Copyright 2023 Vercel, Inc. Copyright 2026 Sine AI contributors.
 * Modified for arbitrary typed inputs, asset references, and explicit lifecycle capabilities.
 * SPDX-License-Identifier: Apache-2.0
 */
import type {
  JSONObject,
  JSONValue,
  SharedV4ProviderMetadata,
  SharedV4ProviderOptions,
  SharedV4Warning,
} from '@ai-sdk/provider';

export type { JSONObject, JSONValue, SharedV4Warning, SharedV4ProviderOptions, SharedV4ProviderMetadata };

export type AssetKind = 'model-3d' | 'sound-effect' | 'music' | 'animation-3d' | 'document' | (string & {});

interface AssetFileBase {
  readonly mediaType: string;
  readonly filename?: string;
  readonly role?: string;
  readonly metadata?: JSONObject;
}

/** URL files are references. The executor never downloads them implicitly. */
export type AssetFile = AssetFileBase & (
  | { readonly type: 'url'; readonly url: string }
  | { readonly type: 'binary'; readonly data: Uint8Array }
  | { readonly type: 'base64'; readonly data: string }
);

export interface AssetResponse {
  readonly headers?: Record<string, string>;
  readonly body?: unknown;
}

export interface AssetModelV1Result {
  readonly assets: ReadonlyArray<AssetFile>;
  readonly warnings?: ReadonlyArray<SharedV4Warning>;
  readonly usage?: JSONObject;
  /** Built-in adapters retain native output at providerMetadata.<provider>.output. */
  readonly providerMetadata?: SharedV4ProviderMetadata;
  readonly response?: AssetResponse;
}

/** Optional application-owned mappings. Without these, adapters use native JSON and common file references. */
export interface AssetModelMapping<INPUT = JSONObject> {
  readonly mapInput?: (input: INPUT) => JSONObject | PromiseLike<JSONObject>;
  readonly mapResult?: (output: JSONValue) => AssetModelV1Result | PromiseLike<AssetModelV1Result>;
}

export interface AssetModelV1CallOptions<INPUT> {
  readonly input: INPUT;
  readonly providerOptions: SharedV4ProviderOptions;
  readonly headers: Record<string, string>;
  readonly abortSignal: AbortSignal;
  /** Stable across retries of this logical submission. The provider must actually honor it. */
  readonly idempotencyKey: string;
  readonly webhookUrl?: string;
}

export interface AssetModelV1OperationOptions {
  readonly operation: JSONValue;
  readonly headers: Record<string, string>;
  readonly abortSignal: AbortSignal;
}

export interface AssetModelV1StartResult {
  readonly operation: JSONValue;
  readonly warnings?: ReadonlyArray<SharedV4Warning>;
  readonly providerMetadata?: SharedV4ProviderMetadata;
  readonly response?: AssetResponse;
}

export type AssetModelV1Status =
  | { readonly status: 'pending' | 'running'; readonly progress?: number; readonly message?: string; readonly providerMetadata?: SharedV4ProviderMetadata }
  | { readonly status: 'completed'; readonly result: AssetModelV1Result }
  | { readonly status: 'failed'; readonly error: { readonly message: string; readonly code?: string } }
  | { readonly status: 'cancelled'; readonly message?: string };

export interface AssetModelV1CancelResult {
  /** An acknowledged cancellation request is not proof that remote work has stopped. */
  readonly status: 'requested' | 'cancelled';
  readonly response?: AssetResponse;
}

/**
 * Implement doGenerate, or both doStart and doStatus. Methods perform ONE
 * provider operation: no polling, no SDK retry loop, and no lifecycle hooks.
 */
export interface AssetModelV1<INPUT = JSONObject, KIND extends string = string> {
  readonly specificationVersion: 'v1';
  readonly provider: string;
  readonly modelId: string;
  readonly kind: KIND;
  readonly capabilities?: {
    readonly idempotentStart?: boolean;
    readonly idempotentGenerate?: boolean;
    readonly webhooks?: boolean;
  };
  // Function properties keep INPUT contravariant under strictFunctionTypes:
  // a model requiring extra fields cannot be passed to a prompt-only facade.
  readonly doGenerate?: (options: AssetModelV1CallOptions<INPUT>) => PromiseLike<AssetModelV1Result>;
  readonly doStart?: (options: AssetModelV1CallOptions<INPUT>) => PromiseLike<AssetModelV1StartResult>;
  readonly doStatus?: (options: AssetModelV1OperationOptions) => PromiseLike<AssetModelV1Status>;
  readonly doCancel?: (options: AssetModelV1OperationOptions) => PromiseLike<AssetModelV1CancelResult>;
}

/** Persist this envelope and reconstruct the SAME provider connection to resume. */
export interface AssetOperation<KIND extends string = string> {
  readonly specificationVersion: 'v1';
  readonly provider: string;
  readonly modelId: string;
  readonly kind: KIND;
  readonly operation: JSONValue;
}

export interface ThreeDInput {
  readonly prompt: string;
}

export interface SoundEffectInput {
  readonly prompt: string;
  readonly durationSeconds?: number;
  readonly promptInfluence?: number;
  readonly loop?: boolean;
}

export interface MusicInput {
  readonly prompt: string;
  readonly lyrics?: string;
  readonly instrumental?: boolean;
}

export interface Animation3DInput {
  readonly prompt: string;
  readonly durationSeconds?: number;
  readonly seed?: number;
  readonly format?: 'fbx' | 'json';
}
