import type { TaskHandle } from '@sine-ai/provider';
import type { TaskPhase } from './task-types.js';

export interface TaskErrorOptions { code?: string; cause?: unknown; phase?: TaskPhase; task?: TaskHandle }
export class TaskExecutionError extends Error {
  readonly code: string;
  readonly phase?: TaskPhase;
  readonly task?: TaskHandle;
  constructor(message: string, options: TaskErrorOptions = {}) {
    super(message, { cause: options.cause });
    this.name = 'TaskExecutionError';
    this.code = options.code ?? 'TASK_EXECUTION_ERROR';
    this.phase = options.phase;
    this.task = options.task;
  }
}
export class TaskTimeoutError extends TaskExecutionError {
  constructor(message: string, options: TaskErrorOptions = {}) {
    super(message, { ...options, code: 'TASK_TIMEOUT' }); this.name = 'TimeoutError';
  }
}
export class TaskAbortError extends TaskExecutionError {
  constructor(message: string, options: TaskErrorOptions = {}) {
    super(message, { ...options, code: 'TASK_ABORTED' }); this.name = 'AbortError';
  }
}
