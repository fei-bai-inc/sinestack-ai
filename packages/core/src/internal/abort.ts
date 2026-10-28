import { AssetTimeoutError } from '../errors.js';

export interface SignalScope {
  signal: AbortSignal;
  dispose(): void;
}

const deadlines = new WeakMap<AbortSignal, { at: number; controller: AbortController }>();

export function checkSignal(signal: AbortSignal): void {
  const deadline = deadlines.get(signal);
  if (deadline && Date.now() >= deadline.at && !signal.aborted) {
    deadline.controller.abort(new AssetTimeoutError('Asset execution deadline was exceeded'));
  }
  if (signal.aborted) throw abortReason(signal);
}

export function milliseconds(value: number | undefined, name: string, allowZero = false): void {
  if (value !== undefined && (!Number.isFinite(value) || value < (allowZero ? 0 : 1) || value > 2_147_483_647)) {
    throw new TypeError(`${name} must be a finite ${allowZero ? 'non-negative' : 'positive'} number at most 2147483647`);
  }
}

export function signalScope(signals: ReadonlyArray<AbortSignal | undefined>, timeoutMs?: number): SignalScope {
  milliseconds(timeoutMs, 'timeoutMs');
  const controller = new AbortController();
  const cleanups: Array<() => void> = [];
  const ownDeadline = timeoutMs === undefined ? Infinity : Date.now() + timeoutMs;
  const deadline = Math.min(ownDeadline, ...signals.map(signal => signal ? deadlines.get(signal)?.at ?? Infinity : Infinity));
  if (Number.isFinite(deadline)) deadlines.set(controller.signal, { at: deadline, controller });
  for (const signal of signals) {
    if (!signal) continue;
    if (signal.aborted) {
      controller.abort(signal.reason);
      break;
    }
    const onAbort = () => controller.abort(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
    cleanups.push(() => signal.removeEventListener('abort', onAbort));
  }
  const timer = !Number.isFinite(deadline) || controller.signal.aborted ? undefined : setTimeout(
    () => controller.abort(new AssetTimeoutError('Asset execution deadline was exceeded')), Math.max(0, deadline - Date.now()),
  );
  return {
    signal: controller.signal,
    dispose() {
      if (timer !== undefined) clearTimeout(timer);
      for (const cleanup of cleanups) cleanup();
    },
  };
}

export function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException('Asset execution was aborted', 'AbortError');
}

/** Race even adapters that do not forward the signal; always observe late settlement. */
export function withSignal<T>(execute: () => T | PromiseLike<T>, signal: AbortSignal): Promise<T> {
  try { checkSignal(signal); } catch (error) { return Promise.reject(error); }
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const complete = (fn: () => void) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', onAbort);
      fn();
    };
    const onAbort = () => complete(() => reject(abortReason(signal)));
    signal.addEventListener('abort', onAbort, { once: true });
    try {
      Promise.resolve(execute()).then(
        value => {
          try { checkSignal(signal); complete(() => resolve(value)); }
          catch (error) { complete(() => reject(error)); }
        },
        error => complete(() => reject(error)),
      );
    } catch (error) {
      complete(() => reject(error));
    }
  });
}
