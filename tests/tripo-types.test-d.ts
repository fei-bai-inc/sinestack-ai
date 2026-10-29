import { generate3D, generateAsset, checkRigging, processModel3D, rigModel, animateModel, startTask, getTaskStatus, waitForTask } from '@sinestack/ai-core';
import type { DomainResult, GenerateAssetResult } from '@sinestack/ai-core';
import type { AssetFile, Model3DProcessor, RigChecker, TaskHandle } from '@sinestack/ai-provider';
import { createTripoProvider } from '@sinestack/ai-tripo';
import type { TripoRigCheckResult, TripoModelResult, TripoSegmentResult, TripoAnimationResult } from '@sinestack/ai-tripo';
declare function expectType<T>(value: T): void;
const tripo = createTripoProvider();
const text = tripo.textTo3D('future-native-version');
expectType<Promise<GenerateAssetResult<'model-3d'>>>(generate3D({ model: text, input: { prompt: 'robot', face_limit: 1000, new_field: { flag: true } } }));
// @ts-expect-error Native text generation requires prompt.
generate3D({ model: text, input: { face_limit: 1000 } });
// @ts-expect-error Known native fields keep their types despite extension fields.
generate3D({ model: text, input: { prompt: 'robot', face_limit: 'many' } });
// @ts-expect-error Generation factories never choose a model implicitly.
tripo.textTo3D();
expectType<Promise<DomainResult<TripoRigCheckResult, 'model3d.rig.check'>>>(checkRigging({ checker: tripo.rigCheck(), input: { input: 'source-task' } }));
expectType<Promise<DomainResult<TripoModelResult, 'model3d.process'>>>(processModel3D({ processor: tripo.texture(), input: { input: 'source-task', texture_prompt: { text: 'wood', style_image: { url: 'https://example.test/style.png' } } } }));
expectType<Promise<DomainResult<TripoSegmentResult, 'model3d.process'>>>(processModel3D({ processor: tripo.segment(), input: { input: 'source-task' } }));
expectType<Promise<DomainResult<TripoAnimationResult, 'model3d.animate'>>>(animateModel({ animator: tripo.retarget(), input: { input: 'rig-task', animations: ['preset:walk'] } }));
// @ts-expect-error A checker is not a generator.
generateAsset({ model: tripo.rigCheck(), input: { input: 'source-task' } });
// @ts-expect-error Same task machinery does not make rig and check interchangeable.
rigModel({ rigger: tripo.rigCheck(), input: { input: 'source-task' } });
// @ts-expect-error Processing entry cannot accept a rig capability.
processModel3D({ processor: tripo.rig(), input: { input: 'source-task' } });
// @ts-expect-error Native source is required.
checkRigging({ checker: tripo.rigCheck(), input: {} });
// @ts-expect-error Smart model segmentation requires transform.
processModel3D({ processor: tripo.smartSegment(), input: { seg_type: 'model', input: 'model.glb' } });
// @ts-expect-error Convert requires an output format.
processModel3D({ processor: tripo.convert(), input: { input: 'source-task' } });
// @ts-expect-error Retarget requires either animation or animations.
animateModel({ animator: tripo.retarget(), input: { input: 'rig-task' } });
// @ts-expect-error Retarget cannot contain both alternatives.
animateModel({ animator: tripo.retarget(), input: { input: 'rig-task', animation: 'a', animations: ['b'] } });
// @ts-expect-error Image editing cannot contain both image encodings.
generateAsset({ model: tripo.imageToImage('future-image'), input: { input: 'a', inputs: ['b'], prompt: 'edit' } });
// @ts-expect-error Texture prompts cannot contain both text and image guidance.
processModel3D({ processor: tripo.texture(), input: { input: 'source-task', texture_prompt: { text: 'wood', image: 'x' } } });

const mapped = tripo.textTo3D<{ description: string; detail: number }>('future-version', {
  mapInput: input => ({ prompt: input.description, face_limit: input.detail }),
});
generate3D({ model: mapped, input: { description: 'robot', detail: 1000 } });
// @ts-expect-error A mapped model keeps required custom fields.
generate3D({ model: mapped, input: { description: 'robot' } });

declare const customChecker: RigChecker<{ source: string; threshold: number }, { riggable: boolean; confidence: number }>;
const checked = checkRigging({ checker: customChecker, input: { source: 'one', threshold: 0.5 } });
expectType<Promise<DomainResult<{ riggable: boolean; confidence: number }, 'model3d.rig.check'>>>(checked);
// @ts-expect-error NoInfer prevents input from erasing custom required fields.
checkRigging({ checker: customChecker, input: { source: 'one' } });
declare const customProcessor: Model3DProcessor<{ source: string; split: boolean }, { parts: readonly AssetFile[] }>;
expectType<Promise<DomainResult<{ parts: readonly AssetFile[] }, 'model3d.process'>>>(processModel3D({ processor: customProcessor, input: { source: 'one', split: true } }));

declare const savedCheck: TaskHandle<'model3d.rig.check'>;
const status = getTaskStatus({ model: tripo.rigCheck(), task: savedCheck });
status.then(value => { if (value.status === 'completed') expectType<boolean>(value.result.riggable); });
waitForTask({ model: tripo.rigCheck(), task: savedCheck }).then(value => expectType<boolean>(value.result.riggable));
startTask({ model: tripo.rigCheck(), input: { input: 'one' } }).then(value => expectType<TaskHandle<'model3d.rig.check'>>(value.task));
// @ts-expect-error Restore cannot widen the selected domain to accept a different receipt.
getTaskStatus({ model: tripo.rig(), task: savedCheck });
