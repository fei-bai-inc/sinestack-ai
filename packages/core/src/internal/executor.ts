/**
 * Adapted from AI SDK 7.0.155's video start/status orchestration and retry policy.
 * Copyright 2023 Vercel, Inc. Copyright 2026 Sine AI contributors.
 * Changes: asset operation envelopes and result mapping; retry, signal and
 * callback policies are delegated to the pinned AI SDK implementation.
 * SPDX-License-Identifier: Apache-2.0
 */
import { delay, generateId, withUserAgentSuffix } from '@ai-sdk/provider-utils';
import type {
  AssetModelV1, AssetModelV1Result, AssetOperation, AssetResponse, SharedV4Warning,
} from '@sine-ai/provider';
import { AssetAbortError, AssetExecutionError, AssetTimeoutError } from '../errors.js';
import type {
  AssetAPI, AssetEvent, AssetExecutionOptions, AssetHooks, AssetPhase, AssetPollOptions,
  GenerateAssetResult, StartAssetResult,
} from '../types.js';
import { mergeAbortSignals, mergeCallbacks, prepareRetries } from './sdk.js';
import { milliseconds, snapshotOperation, validateModel, validateResult, validateStatus } from './validation.js';

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
): Promise<void> {
  const hook = ctx.options.hooks?.[name] as ((value: HookPayload<NAME>) => void | PromiseLike<void>) | undefined;
  await mergeCallbacks(hook)(payload);
}

function failure<INPUT, KIND extends string>(error: unknown, ctx: ExecutionContext<INPUT, KIND>): Error {
  const cause = ctx.signal.aborted ? ctx.signal.reason : error;
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
  // Validate all configured phases before any billable submission, using the
  // same validation as AI SDK. The SDK owns backoff and retryable-error policy.
  for (const phase of ['generate', 'start', 'status', 'cancel'] as const) {
    prepareRetries({ maxRetries: options.retry?.[phase], abortSignal: options.abortSignal, parameter: `retry.${phase}` });
  }
  milliseconds(options.timeoutMs, 'timeoutMs');
  // Detach a restored handle before the first await or user callback. A valid
  // handle must be available even when the signal is already aborted.
  const operation = initialOperation === undefined ? undefined : snapshotOperation(model, initialOperation);
  const ctx: ExecutionContext<INPUT, KIND> = {
    model, options, api, callId: `asset_${generateId()}`,
    signal: mergeAbortSignals(options.abortSignal, options.timeoutMs) ?? new AbortController().signal,
    headers: withUserAgentSuffix(options.headers ?? {}, 'sine-ai/0.1.0'), warnings: [], responses: [],
    ...(operation ? { operation } : {}),
  };
  try {
    ctx.signal.throwIfAborted();
    await notify(ctx, 'onStart', event(ctx));
    ctx.signal.throwIfAborted();
    const result = await body(ctx);
    ctx.signal.throwIfAborted();
    await notify(ctx, 'onFinish', { ...event(ctx), result });
    return result;
  } catch (error) {
    const resolved = failure(error, ctx);
    await notify(ctx, 'onError', { ...event(ctx), error: resolved, phase: ctx.phase });
    throw resolved;
  }
}

export async function attempt<INPUT, KIND extends string, RESULT>(
  ctx: ExecutionContext<INPUT, KIND>, phase: 'generate' | 'start' | 'status' | 'cancel',
  signal: AbortSignal, action: () => RESULT | PromiseLike<RESULT>,
): Promise<RESULT> {
  ctx.phase = phase;
  const { maxRetries, retry } = prepareRetries({
    maxRetries: ctx.options.retry?.[phase], abortSignal: signal,
    parameter: `retry.${phase}`, defaultMaxRetries: phase === 'status' ? 2 : 0,
  });
  if (maxRetries > 0 && ((phase === 'start' && ctx.model.capabilities?.idempotentStart !== true) || (phase === 'generate' && ctx.model.capabilities?.idempotentGenerate !== true))) {
    throw new AssetExecutionError(`retry.${phase} requires the model to declare idempotent ${phase} support`, { code: 'ASSET_UNSAFE_RETRY', phase, operation: ctx.operation });
  }
  return await retry(async () => {
    signal.throwIfAborted();
    return await action();
  });
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
  // Result validation is deliberately OUTSIDE retry: a provider may
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
    });
  }
  signal.throwIfAborted();
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
  const timeoutMs = poll.timeoutMs ?? 600_000;
  ctx.signal = mergeAbortSignals(ctx.signal, timeoutMs)!;
  if (webhook) {
    ctx.phase = 'webhook';
    // Like AI SDK's private video webhook flow, only the notification needs
    // a local race. Provider calls and callbacks use cooperative cancellation.
    const timer = new AbortController();
    try {
      await Promise.race([
        webhook,
        delay(timeoutMs, { abortSignal: mergeAbortSignals(ctx.signal, timer.signal) }).then(() => {
          throw new DOMException('Asset webhook timed out', 'TimeoutError');
        }),
      ]);
    } finally {
      timer.abort();
    }
  }
  for (;;) {
    const status = await query(ctx, ctx.signal);
    switch (status.status) {
      case 'completed': return completed(ctx, status.result);
      case 'failed': throw new AssetExecutionError(status.error.message, { code: 'ASSET_JOB_FAILED', phase: 'status', operation: ctx.operation });
      case 'cancelled': throw new AssetAbortError(status.message ?? 'Remote asset operation was cancelled', { operation: ctx.operation, phase: 'status' });
      default:
        if (webhook) throw new AssetExecutionError('Webhook resolved but the asset operation is not terminal', { code: 'ASSET_WEBHOOK_NOT_TERMINAL', phase: 'status', operation: ctx.operation });
    }
    ctx.phase = 'wait';
    await (poll.delay ?? delay)(intervalMs, { abortSignal: ctx.signal });
  }
}
