import { generateAnimation3D, startAsset, waitForAsset, startTask, waitForTask } from '@sinestack/ai-core';
import type { AssetOperation, TaskHandle } from '@sinestack/ai-provider';
import { createViggleProvider } from '@sinestack/ai-viggle';
import type { ViggleSceneGenerateInput, ViggleTextToVideoInput } from '@sinestack/ai-viggle';

// Importing this file starts no work. Calling a generation function creates a paid task.
export async function createViggleVideo(
  input: ViggleTextToVideoInput,
  connectionId: string,
  save: (operation: AssetOperation<'video'>) => Promise<void>,
) {
  const model = createViggleProvider({ connectionId }).textToVideo(); // Server-side VIGGLE_API_KEY.
  const started = await startAsset({ model, input });
  try { await save(started.operation); }
  catch (cause) { throw Object.assign(new Error('Persist the accepted video before continuing', { cause }), { operation: started.operation }); }
  return waitForAsset({ model, operation: started.operation, poll: { intervalMs: 3000 } });
}

/** Restore the same capability and authorized account; never repeat the original submission. */
export async function resumeViggleVideo(operation: AssetOperation<'video'>, connectionId: string) {
  return waitForAsset({ model: createViggleProvider({ connectionId }).textToVideo(), operation, poll: { intervalMs: 3000 } });
}

/** This produces standalone skeletal animations for all three returned rigs. */
export async function createViggleMotion(text: string) {
  return generateAnimation3D({
    model: createViggleProvider().textToMotion({ format: 'fbx' }),
    input: { text, duration_seconds: 5 },
    poll: { intervalMs: 3000 },
  });
}

/** A generated scene view batch is a separate durable stage from reconstruction. */
export async function createViggleSceneViews(
  input: ViggleSceneGenerateInput,
  connectionId: string,
  save: (task: TaskHandle<'scene.generate-views'>) => Promise<void>,
) {
  const model = createViggleProvider({ connectionId }).generateSceneViews();
  const started = await startTask({ model, input });
  try { await save(started.task); }
  catch (cause) { throw Object.assign(new Error('Persist the accepted scene stage before continuing', { cause }), { task: started.task }); }
  return waitForTask({ model, task: started.task, poll: { intervalMs: 3000 } });
}

/** Draft preparation and signed uploads are explicit; persist the draft before final submission. */
export async function prepareViggleRender(character: Blob, motionId: string) {
  const viggle = createViggleProvider();
  const draft = await viggle.renders.prepare({
    character: { kind: 'upload', filename: 'character.png', content_type: character.type || 'image/png', bytes: character.size },
    motion: { kind: 'asset', asset_id: motionId },
    output: { background_mode: 'transparent', aspect_ratio: 'source' },
  });
  const plan = draft.uploads?.find(upload => upload.slot === 'character');
  if (!plan) throw new Error('The preparation response did not contain a character upload plan');
  const completion = await viggle.renders.upload(plan, character);
  return { draft_id: draft.draft_id, upload_completions: [completion] };
}
