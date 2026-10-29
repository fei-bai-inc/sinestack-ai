import { generate3D, startTask, waitForTask, checkRigging, rigModel, animateModel } from '@sinestack/ai-core';
import type { TaskHandle } from '@sinestack/ai-provider';
import { createTripoProvider } from '@sinestack/ai-tripo';

/** Importing this module never creates a paid task. Call functions explicitly. */
export async function generateTripoModel(modelId: string, prompt: string) {
  const tripo = createTripoProvider(); // Server-only TRIPO_API_KEY; keep keys out of client bundles.
  return generate3D({ model: tripo.textTo3D(modelId), input: { prompt, texture: true, pbr: true } });
}

/** Application owns persistence and chooses exactly which billable stages to run. */
export async function textureAndSave(
  sourceTaskId: string,
  textureVersion: string,
  save: (task: TaskHandle<'model3d.process'>) => Promise<void>,
) {
  const processor = createTripoProvider({ connectionId: 'restore-this-account' }).texture(textureVersion);
  const started = await startTask({ model: processor, input: { input: sourceTaskId, texture_prompt: { text: 'painted wood' } } });
  // If save fails, retain started.task and retry persistence, NOT startTask.
  try { await save(started.task); }
  catch (cause) { throw Object.assign(new Error('Accepted task needs persistence', { cause }), { task: started.task }); }
  return waitForTask({ model: processor, task: started.task, poll: { timeoutMs: 60 * 60_000 } });
}

/** Convenient explicit composition; for durable production flows persist every stage via startTask. */
export async function animateCharacter(sourceTaskId: string, rigVersion: string, animationPreset: string) {
  const tripo = createTripoProvider();
  const report = await checkRigging({ checker: tripo.rigCheck(), input: { input: sourceTaskId } });
  if (!report.riggable) return { report };
  // Rig uses the ORIGINAL MODEL, not the rig-check task ID.
  const rigged = await rigModel({ rigger: tripo.rig(rigVersion), input: { input: sourceTaskId, rig_type: 'biped' } });
  const animated = await animateModel({ animator: tripo.retarget(), input: { input: rigged.taskId, animation: animationPreset } });
  return { report, rigged, animated };
}
