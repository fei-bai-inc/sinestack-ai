/**
 * Adapted from AI SDK 7.0.155's video start/status orchestration and retry policy.
 * Copyright 2023 Vercel, Inc. Copyright 2026 Sine AI contributors.
 * Changes: one shared lifecycle for all asset kinds, phase-safe retries, resumable
 * operation envelopes, hook isolation from retries, and bounded completion waits.
 * SPDX-License-Identifier: Apache-2.0
 */
import { APICallError } from '@ai-sdk/provider';
import { delay, generateId, retryWithExponentialBackoff, withUserAgentSuffix } from '@ai-sdk/provider-utils';
import { RetryError } from 'ai';
import type {
  AssetModelV1, AssetModelV1Result, AssetOperation, AssetResponse, SharedV4Warning,
} from '@sine-ai/provider';
import { AssetAbortError, AssetExecutionError, AssetHookError, AssetTimeoutError } from '../errors.js';
import type {
  AssetAPI, AssetEvent, AssetExecutionOptions, AssetHooks, AssetPhase, AssetPollOptions,
  GenerateAssetResult, StartAssetResult,
} from '../types.js';
import { abortReason, checkSignal, milliseconds, signalScope, withSignal } from './abort.js';
import { snapshotOperation, validateModel, validateResult, validateStatus } from './validation.js';

export interface ExecutionContext<INPUT, KIND extends string> {
  model: AssetModelV1<INPUT, KIND>;
  options: AssetExecutionOptions;
  api: AssetAPI;
  callId: string;
  signal: AbortSignal;
  headers: Record<string, string>;
  phase?: AssetPhase;
  operation?: AssetOperation<KIND>;
  warnings: Array<SharedV4Warning>;
  responses: Array<AssetResponse>;
}

type HookName = keyof AssetHooks;
type HookPayload<NAME extends HookName> = Parameters<NonNullable<AssetHooks[NAME]>>[0];

export function event<INPUT, KIND extends string>(ctx: ExecutionContext<INPUT, KIND>): AssetEvent {
  return {
    callId: ctx.callId, api: ctx.api, provider: ctx.model.provider,
    modelId: ctx.model.modelId, kind: ctx.model.kind, timestamp: Date.now(),
    ...(ctx.operation ? { operation: ctx.operation } : {}),
  };
}

export async function notify<INPUT, KIND extends string, NAME extends HookName>(
  ctx: ExecutionContext<INPUT, KIND>, name: NAME, payload: HookPayload<NAME>,
  signal: AbortSignal | null = ctx.signal,
): Promise<void> {
  const hook = ctx.options.hooks?.[name] as ((value: HookPayload<NAME>) => void | PromiseLike<void>) | undefined;
  if (!hook) return;
  try {
    if (signal) await withSignal(() => hook(payload), signal);
    else await hook(payload);
  } catch (cause) {
    if (signal?.aborted && name !== 'onFinish') throw abortReason(signal);
    throw new AssetHookError(name, cause, {
      phase: ctx.phase, operation: ctx.operation,
      result: name === 'onFinish' ? (payload as AssetEvent & { result: unknown }).result : undefined,
      executionError: name === 'onError' || name === 'onAbort' ? (payload as AssetEvent & { error: unknown }).error : undefined,
    });
  }
}

function failure<INPUT, KIND extends string>(error: unknown, ctx: ExecutionContext<INPUT, KIND>): Error {
  if (error instanceof AssetHookError) return error;
  const cause = ctx.signal.aborted ? abortReason(ctx.signal) : error;
  const name = cause instanceof Error ? cause.name : undefined;
  const message = cause instanceof Error ? cause.message : String(cause);
  const details = { cause, phase: ctx.phase, operation: ctx.operation };
  if (name === 'TimeoutError') return new AssetTimeoutError(message, details);
  if (ctx.signal.aborted || name === 'AbortError') return new AssetAbortError(message, details);
  return new AssetExecutionError(message, { ...details, code: cause instanceof AssetExecutionError ? cause.code : undefined });
}

export async function execute<INPUT, KIND extends string, RESULT>(
  api: AssetAPI, model: AssetModelV1<INPUT, KIND>, options: AssetExecutionOptions,
  body: (ctx: ExecutionContext<INPUT, KIND>) => Promise<RESULT>,
  initialOperation?: AssetOperation<KIND>,
): Promise<RESULT> {
  validateModel(model);
  validateRetryOptions(options);
  // Detach a restored handle before the first await or user callback. A valid
  // handle must be available even when onStart fails or the signal is aborted.
  const operation = initialOperation === undefined ? undefined : snapshotOperation(model, initialOperation);
  const scope = signalScope([options.abortSignal], options.timeoutMs);
  const ctx: ExecutionContext<INPUT, KIND> = {
    model, options, api, callId: `asset_${generateId()}`, signal: scope.signal,
    headers: withUserAgentSuffix(options.headers ?? {}, 'sine-ai/0.1.0'), warnings: [], responses: [],
    ...(operation ? { operation } : {}),
  };
  let terminal = false;
  try {
    checkSignal(ctx.signal);
    await notify(ctx, 'onStart', event(ctx));
    const result = await body(ctx);
    checkSignal(ctx.signal);
    // Select the terminal BEFORE invoking user code, so a failed onFinish
    // cannot trigger onError or repeat provider work.
    terminal = true;
    await notify(ctx, 'onFinish', { ...event(ctx), result });
    return result;
  } catch (error) {
    const resolved = failure(error, ctx);
    if (!terminal) {
      terminal = true;
      const hook = resolved.name === 'AbortError' || resolved.name === 'TimeoutError' ? 'onAbort' : 'onError';
      // Terminal cleanup notifications remain callable after cancellation.
      // They are awaited; callers must ensure cleanup hooks settle promptly.
      await notify(ctx, hook, { ...event(ctx), error: resolved, phase: ctx.phase }, null);
    }
    throw resolved;
  } finally {
    scope.dispose();
  }
}

function validateRetryOptions(options: AssetExecutionOptions): void {
  for (const phase of ['generate', 'start', 'status', 'cancel'] as const) {
    const value = options.retry?.[phase];
    if (value !== undefined && (!Number.isInteger(value) || value < 0 || value > 100)) throw new TypeError(`retry.${phase} must be an integer between 0 and 100`);
  }
  milliseconds(options.retry?.initialDelayMs, 'retry.initialDelayMs', true);
  milliseconds(options.retry?.maxDelayMs, 'retry.maxDelayMs', true);
}

function retryDelay(error: unknown, fallback: number, maxDelay: number): number {
  const headers = APICallError.isInstance(error) ? error.responseHeaders : undefined;
  let proposed: number | undefined;
  if (headers) {
    const normalized = new Headers(headers);
    const millisecondsHeader = normalized.get('retry-after-ms');
    const secondsHeader = normalized.get('retry-after');
    if (millisecondsHeader?.trim()) proposed = Number(millisecondsHeader);
    if (!Number.isFinite(proposed) && secondsHeader?.trim()) {
      const seconds = Number(secondsHeader);
      proposed = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(secondsHeader) - Date.now();
    }
  }
  return proposed !== undefined && Number.isFinite(proposed) && proposed >= 0 && proposed <= maxDelay
    ? proposed : Math.min(fallback, maxDelay);
}

export async function attempt<INPUT, KIND extends string, RESULT>(
  ctx: ExecutionContext<INPUT, KIND>, phase: 'generate' | 'start' | 'status' | 'cancel',
  signal: AbortSignal, action: () => RESULT | PromiseLike<RESULT>,
): Promise<RESULT> {
  ctx.phase = phase;
  const retries = ctx.options.retry?.[phase] ?? (phase === 'status' ? 2 : 0);
  if (retries > 0 && ((phase === 'start' && ctx.model.capabilities?.idempotentStart !== true) || (phase === 'generate' && ctx.model.capabilities?.idempotentGenerate !== true))) {
    throw new AssetExecutionError(`retry.${phase} requires the model to declare idempotent ${phase} support`, { code: 'ASSET_UNSAFE_RETRY', phase, operation: ctx.operation });
  }
  let attemptNumber = 0;
  const initialDelay = ctx.options.retry?.initialDelayMs ?? 2000;
  const maxDelay = ctx.options.retry?.maxDelayMs ?? 60_000;
  const retry = retryWithExponentialBackoff({
    maxRetries: retries, initialDelayInMs: initialDelay, abortSignal: signal,
    shouldRetry: async error => {
      if (signal.aborted || !APICallError.isInstance(error) || !error.isRetryable) return false;
      const delayMs = retryDelay(error, initialDelay * 2 ** (attemptNumber - 1), maxDelay);
      await notify(ctx, 'onRetry', { ...event(ctx), phase, attemptNumber, delayMs, error }, signal);
      return true;
    },
    getDelayInMs: ({ error, exponentialBackoffDelay }) => retryDelay(error, exponentialBackoffDelay, maxDelay),
    createRetryError: options => {
      const lastError = options.errors.at(-1);
      return lastError instanceof AssetHookError ? lastError : new RetryError(options);
    },
  });
  return await withSignal(() => retry(async () => {
    checkSignal(signal);
    attemptNumber++;
    await notify(ctx, 'onAttempt', { ...event(ctx), phase, attemptNumber }, signal);
    return await withSignal(action, signal);
  }), signal);
}

/** One key per logical provider invocation, outside the retry closure. */
export function submissionHeaders(headers: Record<string, string>): { headers: Record<string, string>; idempotencyKey: string } {
  const normalized = new Headers(headers);
  const existing = normalized.get('idempotency-key');
  if (existing !== null && !existing.trim()) throw new TypeError('idempotency-key must not be empty');
  const idempotencyKey = existing ?? `sine_asset_${generateId()}`;
  normalized.set('idempotency-key', idempotencyKey);
  return { headers: Object.fromEntries(normalized.entries()), idempotencyKey };
}

export async function submit<INPUT, KIND extends string>(
  ctx: ExecutionContext<INPUT, KIND>, input: INPUT,
  providerOptions: import('@sine-ai/provider').SharedV4ProviderOptions, webhookUrl?: string,
): Promise<StartAssetResult<KIND>> {
  if (!ctx.model.doStart || !ctx.model.doStatus) throw new AssetExecutionError('This asset model does not support asynchronous submission', { code: 'ASSET_UNSUPPORTED' });
  const submission = submissionHeaders(ctx.headers);
  const result = await attempt(ctx, 'start', ctx.signal, () => ctx.model.doStart!({
    input, providerOptions, abortSignal: ctx.signal, ...submission,
    headers: { ...submission.headers }, ...(webhookUrl ? { webhookUrl } : {}),
  }));
  // Validation and hooks are deliberately OUTSIDE retry: a provider may
  // already have accepted a billable job even when its response is malformed.
  const operation = snapshotOperation(ctx.model, {
    specificationVersion: 'v1', provider: ctx.model.provider,
    modelId: ctx.model.modelId, kind: ctx.model.kind,
    operation: result.operation,
  });
  ctx.operation = operation;
  ctx.warnings.push(...(result.warnings ?? []));
  if (result.response) ctx.responses.push(result.response);
  await notify(ctx, 'onOperation', { ...event(ctx), operation });
  return { ...result, operation, warnings: result.warnings ?? [] };
}

export async function query<INPUT, KIND extends string>(ctx: ExecutionContext<INPUT, KIND>, signal: AbortSignal) {
  if (!ctx.model.doStatus || !ctx.operation) throw new AssetExecutionError('This asset model does not support status queries', { code: 'ASSET_UNSUPPORTED' });
  const operation = ctx.operation;
  const status = await attempt(ctx, 'status', signal, () => ctx.model.doStatus!({
    operation: operation.operation, headers: { ...ctx.headers }, abortSignal: signal,
  }));
  validateStatus(status);
  if (status.status === 'pending' || status.status === 'running') {
    await notify(ctx, 'onProgress', {
      ...event(ctx), status: status.status,
      ...(status.progress !== undefined ? { progress: status.progress } : {}),
      ...(status.message !== undefined ? { message: status.message } : {}),
    }, signal);
  }
  checkSignal(signal);
  return { ...status, operation };
}

export function completed<INPUT, KIND extends string>(ctx: ExecutionContext<INPUT, KIND>, result: AssetModelV1Result): GenerateAssetResult<KIND> {
  validateResult(result);
  if (result.response) ctx.responses.push(result.response);
  return {
    ...result, assets: result.assets, asset: result.assets[0]!,
    warnings: [...ctx.warnings, ...(result.warnings ?? [])],
    ...(ctx.operation ? { operation: ctx.operation } : {}), responses: [...ctx.responses],
  };
}

/** Observe immediately so an early webhook rejection cannot become unhandled. */
export function observeWebhook(received: PromiseLike<unknown>): Promise<unknown> {
  const promise = Promise.resolve(received);
  void promise.catch(() => {});
  return promise;
}

export async function wait<INPUT, KIND extends string>(
  ctx: ExecutionContext<INPUT, KIND>, poll: AssetPollOptions = {}, webhook?: Promise<unknown>,
): Promise<GenerateAssetResult<KIND>> {
  const intervalMs = poll.intervalMs ?? 2000;
  milliseconds(intervalMs, 'poll.intervalMs', true);
  const scope = signalScope([ctx.signal], poll.timeoutMs ?? 600_000);
  try {
    if (webhook) {
      ctx.phase = 'webhook';
      await withSignal(() => webhook, scope.signal);
    }
    for (;;) {
      const status = await query(ctx, scope.signal);
      switch (status.status) {
        case 'completed': {
          const result = completed(ctx, status.result);
          checkSignal(scope.signal);
          return result;
        }
        case 'failed': throw new AssetExecutionError(status.error.message, { code: 'ASSET_JOB_FAILED', phase: 'status', operation: ctx.operation });
        case 'cancelled': throw new AssetAbortError(status.message ?? 'Remote asset operation was cancelled', { operation: ctx.operation, phase: 'status' });
        default:
          if (webhook) throw new AssetExecutionError('Webhook resolved but the asset operation is not terminal', { code: 'ASSET_WEBHOOK_NOT_TERMINAL', phase: 'status', operation: ctx.operation });
      }
      ctx.phase = 'wait';
      await withSignal(() => (poll.delay ?? delay)(intervalMs, { abortSignal: scope.signal }), scope.signal);
    }
  } finally {
    scope.dispose();
  }
}
