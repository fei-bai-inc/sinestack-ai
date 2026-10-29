/** Domain-neutral execution contracts. No asset, rigging, or processing semantics. */
import type { AssetResponse, JSONValue, SharedV4ProviderMetadata, SharedV4ProviderOptions, SharedV4Warning } from './index.js';

export interface TaskMetadata {
  readonly warnings?: readonly SharedV4Warning[];
  readonly providerMetadata?: SharedV4ProviderMetadata;
  readonly response?: AssetResponse;
}
export interface TaskCallOptions<INPUT> {
  readonly input: INPUT;
  readonly providerOptions: SharedV4ProviderOptions;
  readonly headers: Record<string, string>;
  readonly abortSignal: AbortSignal;
  readonly idempotencyKey: string;
  readonly webhookUrl?: string;
}
export interface TaskOperationOptions {
  readonly handle: JSONValue;
  readonly headers: Record<string, string>;
  readonly abortSignal: AbortSignal;
}
export interface TaskStartResult extends TaskMetadata { readonly handle: JSONValue }
export interface TaskCompletion<RESULT> extends TaskMetadata { readonly result: RESULT }
export type TaskStatus<RESULT> = TaskMetadata & (
  | { readonly status: 'pending' | 'running'; readonly progress?: number; readonly message?: string }
  | { readonly status: 'completed'; readonly result: RESULT }
  | { readonly status: 'failed'; readonly error: { readonly message: string; readonly code?: string } }
  | { readonly status: 'cancelled'; readonly message?: string }
);
export interface TaskCancelResult extends TaskMetadata { readonly status: 'requested' | 'cancelled' }
export interface TaskDeleteResult extends TaskMetadata { readonly status: 'deleted' }

/** Implement one direct call, or a complete start/status pair, or both. Never poll in a driver. */
export interface TaskDriver<INPUT, RESULT, DOMAIN extends string = string> {
  readonly specificationVersion: 'v1';
  readonly provider: string;
  /** Stable adapter routing identity, not a global operation catalog. */
  readonly driverId: string;
  readonly domain: DOMAIN;
  readonly modelId?: string;
  readonly connectionId?: string;
  readonly capabilities?: {
    readonly idempotentStart?: boolean;
    readonly idempotentExecute?: boolean;
    /** Submission-level callback URLs only; account subscriptions do not imply this capability. */
    readonly webhooks?: boolean;
  };
  readonly doExecute?: (options: TaskCallOptions<INPUT>) => PromiseLike<TaskCompletion<RESULT>>;
  readonly doStart?: (options: TaskCallOptions<INPUT>) => PromiseLike<TaskStartResult>;
  readonly doStatus?: (options: TaskOperationOptions) => PromiseLike<TaskStatus<RESULT>>;
  readonly doCancel?: (options: TaskOperationOptions) => PromiseLike<TaskCancelResult>;
  readonly doDelete?: (options: TaskOperationOptions) => PromiseLike<TaskDeleteResult>;
  /** Pure, synchronous validation before hooks and authenticated I/O on resume. */
  readonly validateHandle?: (handle: JSONValue) => void;
}

/** Persist the complete envelope and restore the original authorized connection. Never contains a key. */
export interface TaskHandle<DOMAIN extends string = string> {
  /** Stable v1 wire discriminator; retained across the SineStack AI package/repository rename. */
  readonly type: 'sine-ai-task';
  readonly specificationVersion: 'v1';
  readonly provider: string;
  readonly driverId: string;
  readonly domain: DOMAIN;
  readonly modelId?: string;
  readonly connectionId?: string;
  readonly submittedAt?: number;
  readonly handle: JSONValue;
}

/** Separate semantic contracts composed with the shared execution protocol. */
export interface Model3DProcessor<INPUT, RESULT extends object> extends TaskDriver<INPUT, RESULT, 'model3d.process'> {}
export interface RigChecker<INPUT, RESULT extends { readonly riggable: boolean }> extends TaskDriver<INPUT, RESULT, 'model3d.rig.check'> {}
export interface ModelRigger<INPUT, RESULT extends object> extends TaskDriver<INPUT, RESULT, 'model3d.rig'> {}
export interface ModelAnimator<INPUT, RESULT extends object> extends TaskDriver<INPUT, RESULT, 'model3d.animate'> {}
