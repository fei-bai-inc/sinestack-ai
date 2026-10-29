import type { TaskCompletion, TaskDriver } from '@sine-ai/provider';
import type { StartTaskOptions, TaskExecutionInfo, TaskOptions, TaskRunOptions, WaitForTaskOptions } from './task-types.js';
import { TaskExecutionError } from './task-errors.js';
import { attempt, completed, execute, observeNotification, query, submissionHeaders, submit, wait } from './internal/runtime.js';
import { validatePoll } from './internal/task-validation.js';
import { httpURL } from './internal/validation.js';

export function startTask<I, R, D extends string>(options: StartTaskOptions<I, R, D>) {
  return execute('startTask', options.model, options, async ctx => {
    if (options.webhookUrl !== undefined) {
      httpURL(options.webhookUrl, 'webhookUrl');
      if (options.model.capabilities?.webhooks !== true) throw new TaskExecutionError('Submission-level webhook is unsupported', { code: 'TASK_UNSUPPORTED' });
    }
    return await submit(ctx, options.input, options.providerOptions ?? {}, options.webhookUrl);
  });
}
export function getTaskStatus<I, R, D extends string>(options: TaskOptions<I, R, D>) {
  return execute('getTaskStatus', options.model, options, ctx => query(ctx, ctx.signal), options.task);
}
export function waitForTask<I, R, D extends string>(options: WaitForTaskOptions<I, R, D>) {
  const notification = options.notification ? observeNotification(options.notification) : undefined;
  return execute('waitForTask', options.model, options, async ctx => {
    validatePoll(options.poll);
    return completed(ctx, await wait(ctx, options.poll, notification));
  }, options.task);
}
export function cancelTask<I, R, D extends string>(options: TaskOptions<I, R, D>) {
  return execute('cancelTask', options.model, options, async ctx => {
    if (!ctx.driver.doCancel) throw new TaskExecutionError('Remote cancellation is unsupported', { code: 'TASK_UNSUPPORTED' });
    const result = await attempt(ctx, 'cancel', ctx.signal, () => ctx.driver.doCancel!({ handle: ctx.task!.handle, headers: { ...ctx.headers }, abortSignal: ctx.signal }));
    if (!result || !['requested', 'cancelled'].includes(result.status)) throw new TypeError('Invalid cancellation acknowledgement');
    return { ...result, task: ctx.task! };
  }, options.task);
}
export function deleteTask<I, R, D extends string>(options: TaskOptions<I, R, D>) {
  return execute('deleteTask', options.model, options, async ctx => {
    if (!ctx.driver.doDelete) throw new TaskExecutionError('Remote deletion is unsupported', { code: 'TASK_UNSUPPORTED' });
    const result = await attempt(ctx, 'delete', ctx.signal, () => ctx.driver.doDelete!({ handle: ctx.task!.handle, headers: { ...ctx.headers }, abortSignal: ctx.signal }));
    if (!result || result.status !== 'deleted') throw new TypeError('Invalid deletion acknowledgement');
    return { ...result, task: ctx.task! };
  }, options.task);
}
/** Internal entry for domain facades, not a mandatory public Operation API. */
export function runTask<I, R, D extends string, OUT>(api: string, model: TaskDriver<I, R, D>, options: Omit<TaskRunOptions<I, R, D>, 'model'>, finalize: (value: { result: R; execution: TaskExecutionInfo<D> }) => OUT): Promise<OUT> {
  const notification = options.notification ? observeNotification(options.notification) : undefined;
  return execute(api, model, options, async ctx => {
    validatePoll(options.poll);
    if (options.execution !== undefined && !['auto', 'direct', 'async'].includes(options.execution)) throw new TypeError('Invalid execution mode');
    const asynchronous = options.execution === 'async' || (options.execution !== 'direct' && !!model.doStart &&
      (options.poll !== undefined || notification !== undefined || !model.doExecute));
    let result: TaskCompletion<R>;
    if (asynchronous) {
      await submit(ctx, options.input, options.providerOptions ?? {});
      result = await wait(ctx, options.poll, notification);
    } else {
      if (!model.doExecute) throw new TaskExecutionError('Direct execution is unsupported', { code: 'TASK_UNSUPPORTED' });
      if (notification || options.poll) ctx.warnings.push({ type: 'other', message: 'Polling and notifications are unavailable for direct execution.' });
      const submission = submissionHeaders(ctx.headers);
      result = await attempt(ctx, 'execute', ctx.signal, () => model.doExecute!({ input: options.input,
        providerOptions: options.providerOptions ?? {}, abortSignal: ctx.signal, ...submission, headers: { ...submission.headers } }));
    }
    return finalize(completed(ctx, result));
  });
}
