import { generate3D, generateAnimation3D, startAsset, waitForAsset, startTask, waitForTask, rigModel, animateModel, analyzeModel3D } from '@sinestack/ai-core';
import type { AssetOperation, TaskHandle } from '@sinestack/ai-provider';
import { createMeshyProvider } from '@sinestack/ai-meshy';

// Nothing starts merely by importing this file. Calling these functions creates paid tasks.
export async function generateMeshyPreview(modelId: string, prompt: string) {
  const meshy = createMeshyProvider(); // Server-side MESHY_API_KEY.
  return generate3D({ model: meshy.textTo3D(modelId), input: { prompt } });
}

/** The host saves every accepted stage; failed persistence must NOT repeat POST. */
export async function generateTexturedMeshyModel(
  modelId: string,
  prompt: string,
  connectionId: string,
  savePreview: (operation: AssetOperation<'model-3d'>) => Promise<void>,
  saveRefine: (task: TaskHandle<'model3d.process'>) => Promise<void>,
) {
  const meshy = createMeshyProvider({ connectionId });
  const model = meshy.textTo3D(modelId);
  const preview = await startAsset({ model, input: { prompt } });
  try { await savePreview(preview.operation); }
  catch (cause) { throw Object.assign(new Error('Persist the accepted preview before continuing', { cause }), { operation: preview.operation }); }
  const generated = await waitForAsset({ model, operation: preview.operation });
  const previewTaskId = generated.providerMetadata?.meshy?.taskId;
  if (typeof previewTaskId !== 'string') throw new Error('Missing preview task identity');
  const processor = meshy.refine(); // Do not overwrite the preview version with latest.
  const refine = await startTask({ model: processor, input: { preview_task_id: previewTaskId, enable_pbr: true } });
  try { await saveRefine(refine.task); }
  catch (cause) { throw Object.assign(new Error('Persist the accepted refine task before continuing', { cause }), { task: refine.task }); }
  return waitForTask({ model: processor, task: refine.task });
}

/** Explicit composition demo. Durable production code should persist each stage as above. */
export async function animateMeshyCharacter(modelTaskId: string, actionIds: readonly number[]) {
  const meshy = createMeshyProvider();
  const rigged = await rigModel({ rigger: meshy.rig(), input: { input_task_id: modelTaskId } });
  return animateModel({ animator: meshy.animate(), input: { rig_task_id: rigged.taskId, action_ids: actionIds } });
}
export async function generateMeshyMotion(prompt: string, duration: number) {
  return generateAnimation3D({ model: createMeshyProvider().textToMotion('prime'), input: { prompt, duration } });
}
export async function inspectMeshyPrintability(modelUrl: string) {
  return analyzeModel3D({ analyzer: createMeshyProvider().analyzePrintability(), input: { model_url: modelUrl, printer_type: 'fdm' } });
}
