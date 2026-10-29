/**
 * Legacy Asset API boundary. The shared runtime owns ALL execution and polling.
 * Copyright 2023 Vercel, Inc. Copyright 2026 Sine AI contributors.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { AssetModelV1, AssetModelV1Result, AssetOperation, SharedV4ProviderOptions, TaskCompletion, TaskDriver, TaskHandle } from '@sine-ai/provider';
import { AssetAbortError, AssetExecutionError, AssetTimeoutError } from '../errors.js';
import { TaskExecutionError } from '../task-errors.js';
import type { AssetAPI, AssetEvent, AssetExecutionOptions, AssetPhase, AssetPollOptions, GenerateAssetResult, StartAssetResult } from '../types.js';
import type { TaskEvent, TaskExecutionOptions, TaskPhase } from '../task-types.js';
import { snapshotOperation, validateModel, validateResult, validateStatus } from './validation.js';
import * as runtime from './runtime.js';

export { submissionHeaders } from './runtime.js';
export const observeWebhook = runtime.observeNotification;
const assetPhase = (phase?: TaskPhase): AssetPhase | undefined => phase === 'execute' ? 'generate' : phase === 'delete' ? undefined : phase;
const taskPhase = (phase?: AssetPhase): TaskPhase | undefined => phase === 'generate' ? 'execute' : phase;
const completion = (result: AssetModelV1Result): TaskCompletion<AssetModelV1Result> => ({
  result, warnings: result.warnings, providerMetadata: result.providerMetadata, response: result.response,
});

export interface ExecutionContext<I, K extends string> {
  model: AssetModelV1<I, K>;
  engine: runtime.RuntimeContext<I, AssetModelV1Result, K>;
  signal: AbortSignal;
  headers: Record<string, string>;
  phase?: AssetPhase;
  readonly operation?: AssetOperation<K>;
  warnings: runtime.RuntimeContext<I, AssetModelV1Result, K>['warnings'];
  responses: runtime.RuntimeContext<I, AssetModelV1Result, K>['responses'];
  toOperation(task: TaskHandle<K>): AssetOperation<K>;
}

export async function execute<I, K extends string, OUT>(api: AssetAPI, model: AssetModelV1<I, K>, options: AssetExecutionOptions,
  body: (ctx: ExecutionContext<I, K>) => Promise<OUT>, initialOperation?: AssetOperation<K>): Promise<OUT> {
  validateModel(model);
  const operations = new WeakMap<object, AssetOperation<K>>();
  const errors = new WeakMap<Error, Error>();
  const driver: TaskDriver<I, AssetModelV1Result, K> = {
    specificationVersion: 'v1', provider: model.provider, driverId: model.modelId, domain: model.kind,
    capabilities: { idempotentStart: model.capabilities?.idempotentStart,
      idempotentExecute: model.capabilities?.idempotentGenerate, webhooks: model.capabilities?.webhooks },
    ...(model.doGenerate ? { doExecute: async (call: import('@sine-ai/provider').TaskCallOptions<I>) => completion(await model.doGenerate!(call)) } : {}),
    ...(model.doStart ? { doStart: async (call: import('@sine-ai/provider').TaskCallOptions<I>) => {
      const { operation, ...rest } = await model.doStart!(call); return { ...rest, handle: operation };
    } } : {}),
    ...(model.doStatus ? { doStatus: async (call: import('@sine-ai/provider').TaskOperationOptions) => {
      const status = await model.doStatus!({ operation: call.handle, headers: call.headers, abortSignal: call.abortSignal });
      validateStatus(status);
      return status.status === 'completed' ? { ...status, ...completion(status.result) } : status;
    } } : {}),
    ...(model.doCancel ? { doCancel: (call: import('@sine-ai/provider').TaskOperationOptions) => model.doCancel!({
      operation: call.handle, headers: call.headers, abortSignal: call.abortSignal,
    }) } : {}),
  };
  function toOperation(task: TaskHandle<K>): AssetOperation<K> {
    let operation = operations.get(task);
    if (!operation) {
      operation = snapshotOperation(model, { specificationVersion: 'v1', provider: model.provider,
        modelId: model.modelId, kind: model.kind, operation: task.handle });
      operations.set(task, operation);
    }
    return operation;
  }
  function toEvent(event: TaskEvent): AssetEvent {
    return { callId: event.callId, api, provider: model.provider, modelId: model.modelId, kind: model.kind,
      timestamp: event.timestamp, ...(event.task ? { operation: toOperation(event.task as TaskHandle<K>) } : {}) };
  }
  function toError(error: Error): Error {
    if (!(error instanceof TaskExecutionError)) return error;
    const cached = errors.get(error); if (cached) return cached;
    const details = { cause: error.cause, phase: assetPhase(error.phase),
      ...(error.task ? { operation: toOperation(error.task as TaskHandle<K>) } : {}) };
    const code = error.cause instanceof AssetExecutionError ? error.cause.code : error.code.replace(/^TASK_/, 'ASSET_');
    const converted = error.name === 'TimeoutError' ? new AssetTimeoutError(error.message, details)
      : error.name === 'AbortError' ? new AssetAbortError(error.message, details)
      : new AssetExecutionError(error.message, { ...details, code });
    errors.set(error, converted); return converted;
  }
  const controls: TaskExecutionOptions = { ...options,
    retry: { execute: options.retry?.generate, start: options.retry?.start, status: options.retry?.status, cancel: options.retry?.cancel },
    hooks: {
      onStart: event => options.hooks?.onStart?.(toEvent(event)),
      onOperation: event => options.hooks?.onOperation?.({ ...toEvent(event), operation: toOperation(event.task as TaskHandle<K>) }),
      onProgress: event => options.hooks?.onProgress?.({ ...toEvent(event), status: event.status,
        ...(event.progress === undefined ? {} : { progress: event.progress }), ...(event.message === undefined ? {} : { message: event.message }) }),
      onFinish: event => options.hooks?.onFinish?.({ ...toEvent(event), result: event.result }),
      onError: event => options.hooks?.onError?.({ ...toEvent(event), error: toError(event.error), phase: assetPhase(event.phase) }),
    },
  };
  let restored: TaskHandle<K> | undefined;
  if (initialOperation !== undefined) {
    const saved = snapshotOperation(model, initialOperation);
    restored = { type: 'sine-ai-task', specificationVersion: 'v1', provider: saved.provider,
      driverId: saved.modelId, domain: saved.kind, handle: saved.operation };
  }
  try {
    return await runtime.execute(api, driver, controls, async engine => {
      const ctx: ExecutionContext<I, K> = {
        model, engine, toOperation,
        get signal() { return engine.signal; }, set signal(value) { engine.signal = value; },
        get phase() { return assetPhase(engine.phase); }, set phase(value) { engine.phase = taskPhase(value); },
        get operation() { return engine.task ? toOperation(engine.task) : undefined; },
        headers: engine.headers, warnings: engine.warnings, responses: engine.responses,
      };
      return await body(ctx);
    }, restored);
  } catch (error) { throw error instanceof Error ? toError(error) : error; }
}
export function attempt<I, K extends string, OUT>(ctx: ExecutionContext<I, K>, phase: 'generate' | 'start' | 'status' | 'cancel', signal: AbortSignal, action: () => OUT | PromiseLike<OUT>): Promise<OUT> {
  return runtime.attempt(ctx.engine, phase === 'generate' ? 'execute' : phase, signal, action);
}
export async function submit<I, K extends string>(ctx: ExecutionContext<I, K>, input: I, providerOptions: SharedV4ProviderOptions, webhookUrl?: string): Promise<StartAssetResult<K>> {
  const { task, ...rest } = await runtime.submit(ctx.engine, input, providerOptions, webhookUrl);
  return { ...rest, operation: ctx.toOperation(task) };
}
export async function query<I, K extends string>(ctx: ExecutionContext<I, K>, signal: AbortSignal) {
  const { task, ...status } = await runtime.query(ctx.engine, signal);
  const operation = ctx.toOperation(task);
  if (status.status === 'completed') return { status: 'completed' as const, result: status.result, operation };
  return { ...status, operation };
}
export function completed<I, K extends string>(ctx: ExecutionContext<I, K>, result: AssetModelV1Result): GenerateAssetResult<K> {
  validateResult(result);
  const { execution } = runtime.completed(ctx.engine, completion(result));
  return { ...result, assets: result.assets, asset: result.assets[0]!, warnings: execution.warnings,
    ...(ctx.operation ? { operation: ctx.operation } : {}), responses: execution.responses };
}
export async function wait<I, K extends string>(ctx: ExecutionContext<I, K>, poll: AssetPollOptions = {}, webhook?: Promise<unknown>): Promise<GenerateAssetResult<K>> {
  const value = await runtime.wait(ctx.engine, poll, webhook, true);
  return completed(ctx, value.result);
}
