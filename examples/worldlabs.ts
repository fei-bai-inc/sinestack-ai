/// <reference types="node" />
// Server-only examples. Importing this module performs no network requests.
// Call generation/export functions explicitly: they may use paid World Labs credits.
import { generateAsset, getAssetStatus, startAsset, waitForAsset } from '@sinestack/ai-core';
import type { AssetOperation } from '@sinestack/ai-core';
import { createWorldLabsProvider } from '@sinestack/ai-worldlabs';
import type { WorldLabsDepthToPanoramaInput, WorldLabsMeshVariant, WorldLabsSplatResolution } from '@sinestack/ai-worldlabs';

export interface WorldOperationStore {
  put(jobId: string, operationJSON: string): Promise<void>;
  get(jobId: string): Promise<string | undefined>;
}

function connection(connectionId: string) {
  // Reads WORLDLABS_API_KEY. Resolve connectionId and credentials from trusted tenant routing.
  return createWorldLabsProvider({ connectionId });
}

export async function generateWorld(prompt: string, connectionId: string) {
  const worldlabs = connection(connectionId);
  return await generateAsset({
    model: worldlabs.world('marble-1.1'),
    input: { world_prompt: { type: 'text', text_prompt: prompt } },
  });
}

export async function submitWorld(
  jobId: string,
  prompt: string,
  modelId: string,
  connectionId: string,
  store: WorldOperationStore,
) {
  const { operation } = await startAsset({
    model: connection(connectionId).world(modelId),
    input: { world_prompt: { type: 'text', text_prompt: prompt } },
  });
  try {
    await store.put(jobId, JSON.stringify(operation));
  } catch (cause) {
    // Retain this accepted receipt and retry storage, not submission.
    throw Object.assign(new Error('World accepted but operation could not be saved', { cause }), { operation });
  }
  return operation;
}

async function loadOperation(jobId: string, store: WorldOperationStore): Promise<AssetOperation<'gaussian-splat'>> {
  const serialized = await store.get(jobId);
  if (serialized === undefined) throw new Error(`No saved world operation for ${jobId}`);
  // Core and provider validate the persisted receipt before requesting status.
  return JSON.parse(serialized) as AssetOperation<'gaussian-splat'>;
}

export async function resumeWorld(jobId: string, connectionId: string, store: WorldOperationStore, abortSignal?: AbortSignal) {
  const operation = await loadOperation(jobId, store);
  return await waitForAsset({
    model: connection(connectionId).world(operation.modelId),
    operation,
    abortSignal,
    poll: { intervalMs: 2_000, timeoutMs: 20 * 60_000 },
  });
}

export async function readWorldStatus(jobId: string, connectionId: string, store: WorldOperationStore, abortSignal?: AbortSignal) {
  const operation = await loadOperation(jobId, store);
  return await getAssetStatus({ model: connection(connectionId).world(operation.modelId), operation, abortSignal });
}

export async function generatePanorama(input: WorldLabsDepthToPanoramaInput, connectionId: string) {
  return await generateAsset({ model: connection(connectionId).depthToPanorama(), input });
}

export async function exportWorldSplat(worldId: string, connectionId: string, resolution: WorldLabsSplatResolution = 'full_res') {
  return await generateAsset({ model: connection(connectionId).exportSplat(), input: { world_id: worldId, resolution } });
}

export async function exportWorldMesh(worldId: string, connectionId: string, meshVariant: WorldLabsMeshVariant = 'textured') {
  return await generateAsset({ model: connection(connectionId).exportMesh(), input: { world_id: worldId, mesh_variant: meshVariant } });
}

export async function uploadPanorama(bytes: Blob | Uint8Array, connectionId: string, abortSignal?: AbortSignal) {
  const worldlabs = connection(connectionId);
  const prepared = await worldlabs.mediaAssets.prepareUpload({
    file_name: 'panorama.jpg', kind: 'image', extension: 'jpg',
  }, { abortSignal });
  await worldlabs.mediaAssets.upload(prepared, bytes, { abortSignal });
  return prepared.media_asset;
}

export async function generateFromUploadedPanorama(mediaAssetId: string, connectionId: string) {
  return await generateAsset({
    model: connection(connectionId).world('marble-1.1'),
    input: {
      world_prompt: {
        type: 'image',
        image_prompt: { source: 'media_asset', media_asset_id: mediaAssetId },
        is_pano: true,
      },
    },
  });
}

export async function readWorld(worldId: string, connectionId: string) {
  return await connection(connectionId).worlds.get(worldId);
}

export async function listWorlds(connectionId: string, pageToken?: string) {
  return await connection(connectionId).worlds.list({ page_size: 20, ...(pageToken === undefined ? {} : { page_token: pageToken }) });
}

export async function readOperation(operationId: string, connectionId: string) {
  return await connection(connectionId).operations.get(operationId);
}

export async function readMediaAsset(mediaAssetId: string, connectionId: string) {
  return await connection(connectionId).mediaAssets.get(mediaAssetId);
}

export async function readCredits(connectionId: string) {
  return await connection(connectionId).credits.get();
}

// Explicit resource deletion; local abort and world deletion do not cancel an operation.
export async function deleteWorld(worldId: string, connectionId: string) {
  return await connection(connectionId).worlds.delete(worldId);
}
