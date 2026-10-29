import type { AssetResponse, SharedV4ProviderOptions, SharedV4Warning, TaskDriver, TaskHandle, TaskMetadata } from '@sine-ai/provider';
import type { AssetPollOptions } from './types.js';

export type TaskPhase = 'execute' | 'start' | 'status' | 'cancel' | 'delete' | 'webhook' | 'wait';
export interface TaskEvent {
  readonly callId: string;
  readonly api: string;
  readonly provider: string;
  readonly driverId: string;
  readonly domain: string;
  readonly timestamp: number;
  readonly task?: TaskHandle;
}
/** Observations only: callbacks are awaited and failures are ignored by AI SDK. */
export interface TaskHooks {
  onStart?(event: TaskEvent): void | PromiseLike<void>;
  onOperation?(event: TaskEvent & { task: TaskHandle }): void | PromiseLike<void>;
  onProgress?(event: TaskEvent & { status: 'pending' | 'running'; progress?: number; message?: string }): void | PromiseLike<void>;
  onFinish?(event: TaskEvent & { result: unknown }): void | PromiseLike<void>;
  onError?(event: TaskEvent & { error: Error; phase?: TaskPhase }): void | PromiseLike<void>;
}
export interface TaskExecutionOptions {
  abortSignal?: AbortSignal;
  timeoutMs?: number;
  headers?: Record<string, string>;
  retry?: { execute?: number; start?: number; status?: number; cancel?: number; delete?: number };
  hooks?: TaskHooks;
}
export interface TaskRunOptions<I, R, D extends string = string> extends TaskExecutionOptions {
  model: TaskDriver<I, R, D>;
  input: NoInfer<I>;
  providerOptions?: SharedV4ProviderOptions;
  execution?: 'auto' | 'direct' | 'async';
  poll?: AssetPollOptions;
  /** Authenticated account-level notification for this task; does not send a callback URL. */
  notification?: PromiseLike<unknown>;
}
export interface StartTaskOptions<I, R, D extends string = string> extends TaskExecutionOptions {
  model: TaskDriver<I, R, D>;
  input: NoInfer<I>;
  providerOptions?: SharedV4ProviderOptions;
  webhookUrl?: string;
}
export interface TaskOptions<I, R, D extends string = string> extends TaskExecutionOptions {
  model: TaskDriver<I, R, D>;
  task: TaskHandle<NoInfer<D>>;
}
export interface WaitForTaskOptions<I, R, D extends string = string> extends TaskOptions<I, R, D> {
  poll?: AssetPollOptions;
  notification?: PromiseLike<unknown>;
}
export interface TaskExecutionInfo<D extends string = string> extends TaskMetadata {
  readonly task?: TaskHandle<D>;
  readonly warnings: readonly SharedV4Warning[];
  readonly responses: readonly AssetResponse[];
}
export type DomainResult<R, D extends string = string> = R & { readonly execution: TaskExecutionInfo<D> };
