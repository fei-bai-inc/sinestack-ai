import { generate3D, generateAsset, generateAnimation3D, processModel3D, analyzeModel3D, rigModel, animateModel, startTask, waitForTask, getTaskStatus } from '@sinestack/ai-core';
import type { DomainResult, GenerateAssetResult } from '@sinestack/ai-core';
import type { TaskHandle, Model3DAnalyzer } from '@sinestack/ai-provider';
import { createMeshyProvider } from '@sinestack/ai-meshy';
import type { MeshyModelResult, MeshyRigResult, MeshyAnimationResult, MeshyPrintAnalysisResult, MeshyAutoSplitResult, MeshyPrintRepairResult } from '@sinestack/ai-meshy';
declare function expectType<T>(value: T): void;
const meshy = createMeshyProvider();
const text = meshy.textTo3D('future-version');
expectType<Promise<GenerateAssetResult<'model-3d'>>>(generate3D({ model: text, input: { prompt: 'robot', geometry_resolution: 'future-quality', new_option: { enabled: true } } }));
// @ts-expect-error Explicit model selection is required.
meshy.textTo3D();
// @ts-expect-error Required prompt must not disappear through inference.
generate3D({ model: text, input: { seed: 1 } });
// @ts-expect-error Known native fields preserve their types with extension fields.
generate3D({ model: text, input: { prompt: 'robot', target_polycount: 'many' } });
// @ts-expect-error Preview cannot become a refine request.
generate3D({ model: text, input: { prompt: 'robot', mode: 'refine' } });
generate3D({ model: meshy.imageTo3D('latest'), input: { image_url: 'https://example.test/image.png', input_task_id: 'upstream' } });
generate3D({ model: meshy.multiImageTo3D('future'), input: { input_task_id: 'images' } });
// @ts-expect-error At least one image source is required.
generate3D({ model: meshy.imageTo3D('future'), input: {} });
// @ts-expect-error Multi-image input requires a source.
generate3D({ model: meshy.multiImageTo3D('future'), input: { enable_pbr: true } });
expectType<Promise<DomainResult<MeshyModelResult, 'model3d.process'>>>(processModel3D({ processor: meshy.refine(), input: { preview_task_id: 'preview' } }));
expectType<Promise<DomainResult<MeshyRigResult, 'model3d.rig'>>>(rigModel({ rigger: meshy.rig(), input: { input_task_id: 'task', model_url: 'https://example.test/mesh.glb' } }));
expectType<Promise<DomainResult<MeshyAnimationResult, 'model3d.animate'>>>(animateModel({ animator: meshy.animate(), input: { rig_task_id: 'rig', action_id: 0 } }));
expectType<Promise<DomainResult<MeshyPrintAnalysisResult, 'model3d.analyze'>>>(analyzeModel3D({ analyzer: meshy.analyzePrintability(), input: { model_url: 'https://example.test/model.glb' } }));
expectType<Promise<DomainResult<MeshyAutoSplitResult, 'model3d.process'>>>(processModel3D({ processor: meshy.autoSplit(), input: { input_task_id: 'source', mode: 'by_parts', prompt: 'legs' } }));
expectType<Promise<DomainResult<MeshyPrintRepairResult, 'model3d.process'>>>(processModel3D({ processor: meshy.repairPrintability(), input: { input_task_id: 'source' } }));
// @ts-expect-error Refine has a required preview dependency.
processModel3D({ processor: meshy.refine(), input: {} });
// @ts-expect-error Rigging is not analysis just because both share TaskDriver.
analyzeModel3D({ analyzer: meshy.rig(), input: { model_url: 'model.glb' } });
// @ts-expect-error Analysis does not promise asset files.
generateAsset({ model: meshy.analyzePrintability(), input: { model_url: 'model.glb' } });
// @ts-expect-error Analysis must not be used as a mutating processor.
processModel3D({ processor: meshy.analyzePrintability(), input: { model_url: 'model.glb' } });
// @ts-expect-error No verified independent Rig Check exists in Meshy.
meshy.rigCheck();
// @ts-expect-error A source model is required for rigging.
rigModel({ rigger: meshy.rig(), input: { height_meters: 1.7 } });
// @ts-expect-error A character animation requires exactly one action source.
animateModel({ animator: meshy.animate(), input: { rig_task_id: 'rig' } });
// @ts-expect-error Animation sources are mutually exclusive.
animateModel({ animator: meshy.animate(), input: { rig_task_id: 'rig', action_id: 0, motion_task_id: 'motion' } });
// @ts-expect-error Resize requires one mode.
processModel3D({ processor: meshy.resize(), input: { model_url: 'model.glb' } });
// @ts-expect-error Resize modes are mutually exclusive.
processModel3D({ processor: meshy.resize(), input: { model_url: 'model.glb', resize_height: 1, auto_size: true } });
// @ts-expect-error Convert requires target formats.
processModel3D({ processor: meshy.convert(), input: { input_task_id: 'source' } });
// @ts-expect-error Retexture requires guidance.
processModel3D({ processor: meshy.retexture(), input: { model_url: 'model.glb' } });
processModel3D({ processor: meshy.retexture(), input: { model_url: 'model.glb', text_style_prompt: 'wood', image_style_url: 'image.png' } });
// @ts-expect-error Multiview texture guidance is mutually exclusive with other forms.
processModel3D({ processor: meshy.retexture(), input: { model_url: 'model.glb', text_style_prompt: 'wood', multiview_image_urls: ['image.png'] } });
// @ts-expect-error Print size cannot provide both dimensions.
analyzeModel3D({ analyzer: meshy.analyzePrintability(), input: { model_url: 'model.glb', intended_print_height_mm: 50, intended_print_longest_side_mm: 50 } });
// @ts-expect-error Part-directed splitting requires a prompt.
processModel3D({ processor: meshy.autoSplit(), input: { input_task_id: 'source', mode: 'by_parts' } });
expectType<Promise<GenerateAssetResult<'animation-3d'>>>(generateAnimation3D({ model: meshy.textToMotion('prime'), input: { prompt: 'walk', duration: 3.5 } }));
// @ts-expect-error A standalone motion model is not a character animator.
animateModel({ animator: meshy.textToMotion('prime'), input: { prompt: 'walk', duration: 3 } });
// @ts-expect-error Motion duration is required.
generateAnimation3D({ model: meshy.textToMotion('swift'), input: { prompt: 'walk' } });
// @ts-expect-error Image edits require a reference or upstream image task.
generateAsset({ model: meshy.imageToImage('future'), input: { prompt: 'red robot' } });

const mapped = meshy.remesh<{ source: string; triangles: number }>({ mapInput: value => ({ input_task_id: value.source, target_polycount: value.triangles }) });
processModel3D({ processor: mapped, input: { source: 'source', triangles: 1000 } });
// @ts-expect-error Custom input required fields are retained by facade inference.
processModel3D({ processor: mapped, input: { source: 'source' } });
declare const analyzer: Model3DAnalyzer<{ source: string; threshold: number }, { score: number }>;
expectType<Promise<DomainResult<{ score: number }, 'model3d.analyze'>>>(analyzeModel3D({ analyzer, input: { source: 'source', threshold: 0.5 } }));
// @ts-expect-error Custom analysis required fields must not be erased.
analyzeModel3D({ analyzer, input: { source: 'source' } });
declare const analysisTask: TaskHandle<'model3d.analyze'>;
getTaskStatus({ model: meshy.analyzePrintability(), task: analysisTask }).then(value => { if (value.status === 'completed') expectType<string>(value.result.printability.status); });
waitForTask({ model: meshy.analyzePrintability(), task: analysisTask }).then(value => expectType<MeshyPrintAnalysisResult>(value.result));
startTask({ model: meshy.analyzePrintability(), input: { input_task_id: 'source' } }).then(value => expectType<TaskHandle<'model3d.analyze'>>(value.task));
// @ts-expect-error A saved analysis cannot widen a rigging domain on restore.
getTaskStatus({ model: meshy.rig(), task: analysisTask });
