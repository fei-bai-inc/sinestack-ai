import type { AssetOperation, AssetResponse, SharedV4ProviderMetadata } from '@sinestack/ai-provider';
import type { AssetPhase } from './types.js';

export interface AssetErrorOptions {
  code?: string;
  cause?: unknown;
  phase?: AssetPhase;
  operation?: AssetOperation;
  response?: AssetResponse;
  providerMetadata?: SharedV4ProviderMetadata;
}
export class AssetExecutionError extends Error {
  readonly code: string;
  readonly phase?: AssetPhase;
  readonly operation?: AssetOperation;
  readonly response?: AssetResponse;
  readonly providerMetadata?: SharedV4ProviderMetadata;
  constructor(message: string, options: AssetErrorOptions = {}) {
    super(message, { cause: options.cause });
    this.name = 'AssetExecutionError';
    this.code = options.code ?? 'ASSET_EXECUTION_ERROR';
    this.phase = options.phase;
    this.operation = options.operation;
    this.response = options.response;
    this.providerMetadata = options.providerMetadata;
  }
}

export class AssetTimeoutError extends AssetExecutionError {
  constructor(message: string, options: Omit<AssetErrorOptions, 'code'> = {}) {
    super(message, { ...options, code: 'ASSET_TIMEOUT' });
    this.name = 'TimeoutError';
  }
}

export class AssetAbortError extends AssetExecutionError {
  constructor(message: string, options: Omit<AssetErrorOptions, 'code'> = {}) {
    super(message, { ...options, code: 'ASSET_ABORTED' });
    this.name = 'AbortError';
  }
}
