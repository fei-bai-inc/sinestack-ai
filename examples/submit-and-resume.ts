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
  options: { modelId: string; webhookUrl?: string; abortSignal?: AbortSignal },
) {
  const result = await startAsset({
    model: falConnection().threeD(options.modelId),
    input: { prompt },
    abortSignal: options.abortSignal,
    webhookUrl: options.webhookUrl,
  });
  try {
    // Critical persistence is awaited explicitly, outside best-effort SDK callbacks.
    // The serializable operation contains no API key.
    await store.put(taskId, JSON.stringify(result.operation));
  } catch (cause) {
    // fal already accepted this job. The caller can retry storing this same operation.
    // Retrying submit3DTask would create another billable job.
    throw Object.assign(new Error(`Task ${taskId} was accepted by fal but its operation could not be stored.`, { cause }), {
      taskId,
      operation: result.operation,
    });
  }
  return result;
}

/** Use from a task worker or a status endpoint. One status observation; never submits. */
export async function read3DTaskStatus(taskId: string, store: OperationStore, abortSignal?: AbortSignal) {
  const operation = await loadOperation(store, taskId);
  return await getAssetStatus({
    model: falConnection().threeD(operation.modelId),
    operation,
    abortSignal,
    timeoutMs: 30_000,
    retry: { status: 2 },
  });
}

/** For a worker that can remain active while waiting; process restarts reuse the same stored JSON. */
export async function waitFor3DTask(taskId: string, store: OperationStore, abortSignal?: AbortSignal) {
  const operation = await loadOperation(store, taskId);
  return await waitForAsset({
    model: falConnection().threeD(operation.modelId),
    operation,
    abortSignal,
    timeoutMs: 20 * 60_000,
    poll: { intervalMs: 2_000, timeoutMs: 20 * 60_000 },
    retry: { status: 2 },
  });
}

/** Explicit remote cancellation. A local AbortSignal only ends the local SDK invocation. */
export async function cancel3DTask(taskId: string, store: OperationStore, abortSignal?: AbortSignal) {
  const operation = await loadOperation(store, taskId);
  const result = await cancelAsset({
    model: falConnection().threeD(operation.modelId),
    operation,
    abortSignal,
    timeoutMs: 30_000,
  });
  // result.status === 'requested' means fal acknowledged a request; the job may still finish.
  return result;
}
