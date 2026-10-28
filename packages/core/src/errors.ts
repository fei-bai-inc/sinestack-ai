import type { AssetOperation } from '@sine-ai/provider';
import type { AssetPhase } from './types.js';

export class AssetExecutionError extends Error {
  readonly code: string;
  readonly phase?: AssetPhase;
  readonly operation?: AssetOperation;
  constructor(message: string, options: { code?: string; cause?: unknown; phase?: AssetPhase; operation?: AssetOperation } = {}) {
    super(message, { cause: options.cause });
    this.name = 'AssetExecutionError';
    this.code = options.code ?? 'ASSET_EXECUTION_ERROR';
    this.phase = options.phase;
    this.operation = options.operation;
  }
}

export class AssetTimeoutError extends AssetExecutionError {
  constructor(message: string, options: { cause?: unknown; phase?: AssetPhase; operation?: AssetOperation } = {}) {
    super(message, { ...options, code: 'ASSET_TIMEOUT' });
    this.name = 'TimeoutError';
  }
}

export class AssetAbortError extends AssetExecutionError {
  constructor(message: string, options: { cause?: unknown; phase?: AssetPhase; operation?: AssetOperation } = {}) {
    super(message, { ...options, code: 'ASSET_ABORTED' });
    this.name = 'AbortError';
  }
}
