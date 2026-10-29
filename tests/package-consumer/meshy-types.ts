import { generate3D, analyzeModel3D, processModel3D, rigModel, animateModel, startTask, waitForTask } from '@sinestack/ai-core';
import type { DomainResult } from '@sinestack/ai-core';
import { createMeshyProvider } from '@sinestack/ai-meshy';
import type { MeshyPrintAnalysisResult } from '@sinestack/ai-meshy';
import type { TaskHandle, Model3DAnalyzer } from '@sinestack/ai-provider';
declare function expectType<T>(value: T): void;
const meshy = createMeshyProvider();
export async function checkInstalledMeshyTypes(task: TaskHandle<'model3d.analyze'>) {
  await generate3D({ model: meshy.textTo3D('unseen-version'), input: { prompt: 'robot', future_parameter: true } });
  const processor = meshy.refine();
  const result = await processModel3D({ processor, input: { preview_task_id: 'preview' } });
  const rig = await rigModel({ rigger: meshy.rig(), input: { input_task_id: result.taskId } });
  await animateModel({ animator: meshy.animate(), input: { rig_task_id: rig.taskId, action_ids: [0, 1] } });
  const analyzer: Model3DAnalyzer<{ input_task_id: string }, MeshyPrintAnalysisResult> = meshy.analyzePrintability();
  expectType<Promise<DomainResult<MeshyPrintAnalysisResult, 'model3d.analyze'>>>(analyzeModel3D({ analyzer, input: { input_task_id: 'source' } }));
  const restored = await waitForTask({ model: analyzer, task });
  expectType<MeshyPrintAnalysisResult>(restored.result);
  await startTask({ model: analyzer, input: { input_task_id: 'source' } });
  // @ts-expect-error Missing source remains an error in installed declarations.
  await analyzeModel3D({ analyzer, input: {} });
  // @ts-expect-error Domain safety survives packaging.
  await rigModel({ rigger: meshy.analyzePrintability(), input: { input_task_id: 'source' } });
}
