/// <reference types="node" />
// Server-only Node.js example. Importing this file performs no network requests.
// Call submit3DTask explicitly to create a billable job; the other functions reuse its handle.
import process from 'node:process';
import { cancelAsset, getAssetStatus, startAsset, waitForAsset } from '@sine-ai/core';
import type { AssetOperation } from '@sine-ai/core';
import { createFalAssetProvider } from '@sine-ai/fal';

/** Implement these with your existing SQL/KV/task store. Values are plain JSON strings. */
export interface OperationStore {
  put(taskId: string, operationJSON: string): Promise<void>;
  get(taskId: string): Promise<string | undefined>;
}

function falConnection() {
  const apiKey = process.env.FAL_KEY;
  if (!apiKey) throw new Error('Set FAL_KEY in the server environment.');
  // Resume with the same fal account, provider name, baseURL, and model used for submission.
  return createFalAssetProvider({ apiKey });
}

async function loadOperation(store: OperationStore, taskId: string): Promise<AssetOperation<'model-3d'>> {
  const serialized = await store.get(taskId);
  if (serialized === undefined) throw new Error(`No saved asset operation for task ${taskId}.`);
  // The cast describes the stored type; the SDK validates the envelope and fal handle before I/O.
  return JSON.parse(serialized) as AssetOperation<'model-3d'>;
}

export async function submit3DTask(
  taskId: string,
  prompt: string,
  store: OperationStore,
  options: { webhookUrl?: string; abortSignal?: AbortSignal } = {},
) {
  return await startAsset({
    model: falConnection().threeD(),
    input: { prompt },
    abortSignal: options.abortSignal,
    webhookUrl: options.webhookUrl,
    hooks: {
      async onOperation({ operation }) {
        // This hook is awaited before startAsset returns. The handle contains no API key.
        // A storage failure exposes the accepted operation on the SDK error; do not resubmit.
        await store.put(taskId, JSON.stringify(operation));
      },
    },
  });
}

/** Use from a task worker or a status endpoint. One status observation; never submits. */
export async function read3DTaskStatus(taskId: string, store: OperationStore, abortSignal?: AbortSignal) {
  return await getAssetStatus({
    model: falConnection().threeD(),
    operation: await loadOperation(store, taskId),
    abortSignal,
    timeoutMs: 30_000,
    retry: { status: 2, initialDelayMs: 500, maxDelayMs: 5_000 },
  });
}

/** For a worker that can remain active while waiting; process restarts reuse the same stored JSON. */
export async function waitFor3DTask(taskId: string, store: OperationStore, abortSignal?: AbortSignal) {
  return await waitForAsset({
    model: falConnection().threeD(),
    operation: await loadOperation(store, taskId),
    abortSignal,
    timeoutMs: 20 * 60_000,
    poll: { intervalMs: 2_000, timeoutMs: 20 * 60_000 },
    retry: { status: 2, initialDelayMs: 500, maxDelayMs: 5_000 },
  });
}

/** Explicit remote cancellation. A local AbortSignal only ends the local SDK invocation. */
export async function cancel3DTask(taskId: string, store: OperationStore, abortSignal?: AbortSignal) {
  const result = await cancelAsset({
    model: falConnection().threeD(),
    operation: await loadOperation(store, taskId),
    abortSignal,
    timeoutMs: 30_000,
  });
  // result.status === 'requested' means fal acknowledged a request; the job may still finish.
  return result;
}
