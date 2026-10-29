/**
 * Shared execution mechanism extracted from the original asset executor.
 * Adapted from AI SDK 7.0.155 video orchestration. Copyright 2023 Vercel, Inc.
 * Copyright 2026 SineStack AI contributors. SPDX-License-Identifier: Apache-2.0
 * Domain results are opaque; retry, signals and callbacks delegate to AI SDK.
 */
import { delay, generateId, withUserAgentSuffix } from '@ai-sdk/provider-utils';
import type { AssetResponse, SharedV4ProviderOptions, SharedV4Warning, TaskCompletion, TaskDriver, TaskHandle, TaskStatus } from '@sinestack/ai-provider';
import type { AssetPollOptions } from '../types.js';
import type { TaskEvent, TaskExecutionInfo, TaskExecutionOptions, TaskHooks, TaskPhase } from '../task-types.js';
import { TaskAbortError, TaskExecutionError, TaskTimeoutError } from '../task-errors.js';
import { mergeAbortSignals, mergeCallbacks, prepareRetries } from './sdk.js';
import { milliseconds } from './validation.js';
import { snapshotTask, validateDriver, validateTaskStatus } from './task-validation.js';

export interface RuntimeContext<I, R, D extends string = string> {
  driver: TaskDriver<I, R, D>;
  options: TaskExecutionOptions;
  api: string;
  callId: string;
  signal: AbortSignal;
  headers: Record<string, string>;
  phase?: TaskPhase;
  task?: TaskHandle<D>;
  warnings: SharedV4Warning[];
  responses: AssetResponse[];
}
type HookName = keyof TaskHooks;
type HookPayload<N extends HookName> = Parameters<NonNullable<TaskHooks[N]>>[0];
export function event<I, R, D extends string>(ctx: RuntimeContext<I, R, D>): TaskEvent {
  return { callId: ctx.callId, api: ctx.api, provider: ctx.driver.provider, driverId: ctx.driver.driverId,
    domain: ctx.driver.domain, timestamp: Date.now(), ...(ctx.task ? { task: ctx.task } : {}) };
}
export async function notify<I, R, D extends string, N extends HookName>(ctx: RuntimeContext<I, R, D>, name: N, payload: HookPayload<N>): Promise<void> {
  const hook = ctx.options.hooks?.[name] as ((event: HookPayload<N>) => void | PromiseLike<void>) | undefined;
  await mergeCallbacks(hook)(payload);
}
function failure<I, R, D extends string>(error: unknown, ctx: RuntimeContext<I, R, D>): Error {
  const cause = ctx.signal.aborted ? ctx.signal.reason : error;
  const name = cause instanceof Error ? cause.name : undefined;
  const message = cause instanceof Error ? cause.message : String(cause);
  const details = { cause, phase: ctx.phase, task: ctx.task };
  if (name === 'TimeoutError') return new TaskTimeoutError(message, details);
  if (ctx.signal.aborted || name === 'AbortError') return new TaskAbortError(message, details);
  return new TaskExecutionError(message, { ...details, code: cause instanceof TaskExecutionError ? cause.code : undefined });
}
export async function execute<I, R, D extends string, OUT>(
  api: string, driver: TaskDriver<I, R, D>, options: TaskExecutionOptions,
  body: (ctx: RuntimeContext<I, R, D>) => Promise<OUT>, initialTask?: TaskHandle<D>,
): Promise<OUT> {
  validateDriver(driver);
  for (const phase of ['execute', 'start', 'status', 'cancel', 'delete'] as const) {
    prepareRetries({ maxRetries: options.retry?.[phase], abortSignal: options.abortSignal, parameter: `retry.${phase}` });
  }
  milliseconds(options.timeoutMs, 'timeoutMs');
  const task = initialTask === undefined ? undefined : snapshotTask(driver, initialTask);
  const ctx: RuntimeContext<I, R, D> = {
    driver, options, api, callId: `task_${generateId()}`,
    signal: mergeAbortSignals(options.abortSignal, options.timeoutMs) ?? new AbortController().signal,
    headers: withUserAgentSuffix(options.headers ?? {}, 'sinestack-ai/0.2.0'), warnings: [], responses: [],
    ...(task ? { task } : {}),
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
export async function attempt<I, R, D extends string, OUT>(ctx: RuntimeContext<I, R, D>, phase: 'execute' | 'start' | 'status' | 'cancel' | 'delete', signal: AbortSignal, action: () => OUT | PromiseLike<OUT>): Promise<OUT> {
  ctx.phase = phase;
  const { maxRetries, retry } = prepareRetries({ maxRetries: ctx.options.retry?.[phase], abortSignal: signal,
    parameter: `retry.${phase}`, defaultMaxRetries: phase === 'status' ? 2 : 0 });
  if (maxRetries > 0 && ((phase === 'start' && ctx.driver.capabilities?.idempotentStart !== true) ||
      (phase === 'execute' && ctx.driver.capabilities?.idempotentExecute !== true))) {
    throw new TaskExecutionError(`retry.${phase} requires the driver to declare idempotent ${phase} support`, { code: 'TASK_UNSAFE_RETRY' });
  }
  return await retry(async () => { signal.throwIfAborted(); return await action(); });
}
export function submissionHeaders(headers: Record<string, string>) {
  const normalized = new Headers(headers);
  const existing = normalized.get('idempotency-key');
  if (existing !== null && !existing.trim()) throw new TypeError('idempotency-key must not be empty');
  const idempotencyKey = existing ?? `sinestack_asset_${generateId()}`;
  normalized.set('idempotency-key', idempotencyKey);
  return { headers: Object.fromEntries(normalized.entries()), idempotencyKey };
}
export async function submit<I, R, D extends string>(ctx: RuntimeContext<I, R, D>, input: I, providerOptions: SharedV4ProviderOptions, webhookUrl?: string) {
  if (!ctx.driver.doStart || !ctx.driver.doStatus) throw new TaskExecutionError('This driver does not support asynchronous submission', { code: 'TASK_UNSUPPORTED' });
  const submittedAt = Date.now();
  const submission = submissionHeaders(ctx.headers);
  const result = await attempt(ctx, 'start', ctx.signal, () => ctx.driver.doStart!({ input, providerOptions,
    abortSignal: ctx.signal, ...submission, headers: { ...submission.headers }, ...(webhookUrl ? { webhookUrl } : {}) }));
  const task = snapshotTask(ctx.driver, {
    type: 'sine-ai-task', specificationVersion: 'v1', provider: ctx.driver.provider,
    driverId: ctx.driver.driverId, domain: ctx.driver.domain, submittedAt,
    ...(ctx.driver.modelId === undefined ? {} : { modelId: ctx.driver.modelId }),
    ...(ctx.driver.connectionId === undefined ? {} : { connectionId: ctx.driver.connectionId }),
    handle: result.handle,
  });
  ctx.task = task;
  ctx.warnings.push(...(result.warnings ?? []));
  if (result.response) ctx.responses.push(result.response);
  await notify(ctx, 'onOperation', { ...event(ctx), task });
  const { handle: _handle, ...metadata } = result;
  return { ...metadata, task, warnings: result.warnings ?? [] };
}
export async function query<I, R, D extends string>(ctx: RuntimeContext<I, R, D>, signal: AbortSignal): Promise<TaskStatus<R> & { task: TaskHandle<D> }> {
  if (!ctx.driver.doStatus || !ctx.task) throw new TaskExecutionError('This driver does not support status queries', { code: 'TASK_UNSUPPORTED' });
  const task = ctx.task;
  const status = await attempt(ctx, 'status', signal, () => ctx.driver.doStatus!({ handle: task.handle, headers: { ...ctx.headers }, abortSignal: signal }));
  validateTaskStatus(status);
  if (status.status === 'pending' || status.status === 'running') {
    await notify(ctx, 'onProgress', { ...event(ctx), status: status.status,
      ...(status.progress === undefined ? {} : { progress: status.progress }),
      ...(status.message === undefined ? {} : { message: status.message }) });
  }
  signal.throwIfAborted();
  return { ...status, task };
}
export function completed<I, R, D extends string>(ctx: RuntimeContext<I, R, D>, completion: TaskCompletion<R>): { result: R; execution: TaskExecutionInfo<D> } {
  if (!completion || !Object.hasOwn(completion, 'result')) throw new TypeError('Completion must contain a result');
  return { result: completion.result, execution: {
    warnings: [...ctx.warnings, ...(completion.warnings ?? [])],
    responses: [...ctx.responses, ...(completion.response ? [completion.response] : [])],
    ...(completion.providerMetadata ? { providerMetadata: completion.providerMetadata } : {}),
    ...(completion.response ? { response: completion.response } : {}),
    ...(ctx.task ? { task: ctx.task } : {}),
  } };
}
export function observeNotification(received: PromiseLike<unknown>): Promise<unknown> {
  const promise = Promise.resolve(received); void promise.catch(() => {}); return promise;
}
export async function wait<I, R, D extends string>(ctx: RuntimeContext<I, R, D>, poll: AssetPollOptions = {}, notification?: Promise<unknown>, strictNotification = false): Promise<TaskCompletion<R>> {
  const intervalMs = poll.intervalMs ?? 2000;
  const timeoutMs = poll.timeoutMs ?? 600_000;
  ctx.signal = mergeAbortSignals(ctx.signal, timeoutMs)!;
  if (notification) {
    ctx.phase = 'webhook';
    const timer = new AbortController();
    try {
      await Promise.race([notification, delay(timeoutMs, { abortSignal: mergeAbortSignals(ctx.signal, timer.signal) }).then(() => {
        throw new DOMException('Task notification timed out', 'TimeoutError');
      })]);
    } finally { timer.abort(); }
  }
  for (;;) {
    const status = await query(ctx, ctx.signal);
    switch (status.status) {
      case 'completed': return status;
      case 'failed': throw new TaskExecutionError(status.error.message, { code: 'TASK_JOB_FAILED', cause: status.error });
      case 'cancelled': throw new TaskAbortError(status.message ?? 'Remote task was cancelled');
      default:
        if (notification && strictNotification) throw new TaskExecutionError('Webhook resolved but the asset operation is not terminal', { code: 'TASK_WEBHOOK_NOT_TERMINAL' });
    }
    ctx.phase = 'wait';
    await (poll.delay ?? delay)(intervalMs, { abortSignal: ctx.signal });
  }
}
