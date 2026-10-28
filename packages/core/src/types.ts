import type {
  AssetFile, AssetModelV1, AssetModelV1Result, AssetModelV1Status,
  AssetOperation, AssetResponse, SharedV4ProviderOptions,
} from '@sine-ai/provider';

export type AssetPhase = 'generate' | 'start' | 'status' | 'cancel' | 'webhook' | 'wait';
export type AssetAPI = 'generateAsset' | 'startAsset' | 'getAssetStatus' | 'waitForAsset' | 'cancelAsset';

export interface AssetEvent {
  readonly callId: string;
  readonly api: AssetAPI;
  readonly provider: string;
  readonly modelId: string;
  readonly kind: string;
  readonly timestamp: number;
  readonly operation?: AssetOperation;
}

export interface AssetHooks {
  onStart?(event: AssetEvent): void | PromiseLike<void>;
  onAttempt?(event: AssetEvent & { phase: AssetPhase; attemptNumber: number }): void | PromiseLike<void>;
  onRetry?(event: AssetEvent & { phase: AssetPhase; attemptNumber: number; delayMs: number; error: unknown }): void | PromiseLike<void>;
  onOperation?(event: AssetEvent & { operation: AssetOperation }): void | PromiseLike<void>;
  onProgress?(event: AssetEvent & { status: 'pending' | 'running'; progress?: number; message?: string }): void | PromiseLike<void>;
  onFinish?(event: AssetEvent & { result: unknown }): void | PromiseLike<void>;
  onError?(event: AssetEvent & { error: Error; phase?: AssetPhase }): void | PromiseLike<void>;
  onAbort?(event: AssetEvent & { error: Error; phase?: AssetPhase }): void | PromiseLike<void>;
}

export interface AssetRetryOptions {
  /** Defaults to 0. A positive value requires model.capabilities.idempotentStart. */
  start?: number;
  /** Defaults to 0. A positive value requires model.capabilities.idempotentGenerate. */
  generate?: number;
  /** Defaults to 2. Retries query failures, never a remote failed status. */
  status?: number;
  /** Defaults to 0. The caller must know repeated cancellation is safe. */
  cancel?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
}

export interface AssetExecutionOptions {
  abortSignal?: AbortSignal;
  /** Deadline for this whole public invocation, including hooks and submission. */
  timeoutMs?: number;
  headers?: Record<string, string>;
  retry?: AssetRetryOptions;
  hooks?: AssetHooks;
}

export interface AssetPollOptions {
  /** Defaults to 2 seconds; the first status check is immediate. */
  intervalMs?: number;
  /** Defaults to 10 minutes; includes in-flight queries and webhook finalization. */
  timeoutMs?: number;
  /** Replaces polling sleeps only, not the host runtime or its deadlines. */
  delay?: (milliseconds: number, options: { abortSignal: AbortSignal }) => PromiseLike<void>;
}

export interface AssetWebhook {
  url: string;
  /** Resolve only after your receiver authenticates and correlates the webhook. */
  received: PromiseLike<unknown>;
}

export type AssetWebhookFactory = () => AssetWebhook | PromiseLike<AssetWebhook>;

export interface GenerateAssetOptions<INPUT, KIND extends string = string> extends AssetExecutionOptions {
  model: AssetModelV1<INPUT, KIND>;
  input: NoInfer<INPUT>;
  providerOptions?: SharedV4ProviderOptions;
  execution?: 'auto' | 'direct' | 'async';
  poll?: AssetPollOptions;
  webhook?: AssetWebhookFactory;
}

export interface StartAssetOptions<INPUT, KIND extends string = string> extends AssetExecutionOptions {
  model: AssetModelV1<INPUT, KIND>;
  input: NoInfer<INPUT>;
  providerOptions?: SharedV4ProviderOptions;
  webhookUrl?: string;
}

export interface AssetOperationOptions<INPUT = unknown, KIND extends string = string> extends AssetExecutionOptions {
  model: AssetModelV1<INPUT, KIND>;
  operation: AssetOperation<NoInfer<KIND>>;
}

export interface WaitForAssetOptions<INPUT = unknown, KIND extends string = string> extends AssetOperationOptions<INPUT, KIND> {
  poll?: AssetPollOptions;
  /** A receiver for an already submitted operation. No new job is created. */
  webhook?: PromiseLike<unknown>;
}

export interface GenerateAssetResult<KIND extends string = string> extends AssetModelV1Result {
  readonly asset: AssetFile;
  readonly operation?: AssetOperation<KIND>;
  readonly responses: ReadonlyArray<AssetResponse>;
}

export interface StartAssetResult<KIND extends string = string> {
  readonly operation: AssetOperation<KIND>;
  readonly warnings: NonNullable<AssetModelV1Result['warnings']>;
  readonly providerMetadata?: AssetModelV1Result['providerMetadata'];
  readonly response?: AssetResponse;
}

export type GetAssetStatusResult<KIND extends string = string> = AssetModelV1Status & {
  readonly operation: AssetOperation<KIND>;
};
