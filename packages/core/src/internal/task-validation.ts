import type { TaskDriver, TaskHandle, TaskStatus } from '@sine-ai/provider';
import type { AssetPollOptions } from '../types.js';
import { milliseconds, snapshotJSONValue } from './validation.js';

export function validatePoll(poll?: AssetPollOptions): void {
  milliseconds(poll?.intervalMs, 'poll.intervalMs', true);
  milliseconds(poll?.timeoutMs, 'poll.timeoutMs');
  if (poll?.delay !== undefined && typeof poll.delay !== 'function') throw new TypeError('poll.delay must be a function');
}
export function validateDriver<I, R, D extends string>(driver: TaskDriver<I, R, D>): void {
  if (!driver || typeof driver !== 'object' || driver.specificationVersion !== 'v1') throw new TypeError('Unsupported task driver');
  for (const key of ['provider', 'driverId', 'domain'] as const) {
    if (typeof driver[key] !== 'string' || !driver[key].trim()) throw new TypeError(`Task driver ${key} must not be empty`);
  }
  for (const key of ['modelId', 'connectionId'] as const) {
    if (driver[key] !== undefined && (typeof driver[key] !== 'string' || !driver[key].trim())) throw new TypeError(`Invalid task driver ${key}`);
  }
  for (const key of ['doExecute', 'doStart', 'doStatus', 'doCancel', 'doDelete', 'validateHandle'] as const) {
    if (driver[key] !== undefined && typeof driver[key] !== 'function') throw new TypeError(`${key} must be a function`);
  }
  if (!!driver.doStart !== !!driver.doStatus) throw new TypeError('Task drivers require both doStart and doStatus');
  if (!driver.doExecute && !driver.doStart) throw new TypeError('Task driver has no execution method');
  if ((driver.doCancel || driver.doDelete) && !driver.doStart) throw new TypeError('Remote task controls require start/status');
  if (driver.capabilities !== undefined) {
    if (!driver.capabilities || typeof driver.capabilities !== 'object' || Array.isArray(driver.capabilities)) throw new TypeError('Invalid task capabilities');
    for (const key of ['idempotentStart', 'idempotentExecute', 'webhooks'] as const) {
      if (driver.capabilities[key] !== undefined && typeof driver.capabilities[key] !== 'boolean') throw new TypeError(`${key} must be a boolean`);
    }
    if ((driver.capabilities.idempotentStart || driver.capabilities.webhooks) && !driver.doStart) throw new TypeError('Async capability requires start/status');
    if (driver.capabilities.idempotentExecute && !driver.doExecute) throw new TypeError('idempotentExecute requires doExecute');
  }
}
export function snapshotTask<I, R, D extends string>(driver: TaskDriver<I, R, D>, value: TaskHandle<D>): TaskHandle<D> {
  // Validate all descriptors before reading fields, including the outer persisted envelope.
  const task = snapshotJSONValue(value) as unknown as TaskHandle<D>;
  if (!task || task.type !== 'sine-ai-task' || task.specificationVersion !== 'v1' ||
      task.provider !== driver.provider || task.driverId !== driver.driverId || task.domain !== driver.domain ||
      task.modelId !== driver.modelId || task.connectionId !== driver.connectionId) {
    throw new TypeError('Task does not match the original provider, driver, domain, model, or connection');
  }
  if (task.submittedAt !== undefined && (!Number.isSafeInteger(task.submittedAt) || task.submittedAt < 0)) throw new TypeError('Invalid task submittedAt');
  snapshotJSONValue(task.handle);
  driver.validateHandle?.(task.handle);
  return task;
}
export function validateTaskStatus<R>(value: TaskStatus<R>): void {
  if (!value || typeof value !== 'object') throw new TypeError('Invalid task status');
  switch (value.status) {
    case 'pending': case 'running':
      if (value.progress !== undefined && (!Number.isFinite(value.progress) || value.progress < 0 || value.progress > 1)) throw new TypeError('Task progress must be between 0 and 1');
      return;
    case 'completed':
      if (!Object.hasOwn(value, 'result')) throw new TypeError('Completed task must contain a result');
      return;
    case 'failed':
      if (!value.error || typeof value.error.message !== 'string') throw new TypeError('Failed task requires an error message');
      return;
    case 'cancelled': return;
    default: throw new TypeError('Unknown task status');
  }
}
