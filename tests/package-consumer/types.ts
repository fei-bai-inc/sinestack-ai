import {
  generate3D,
  generateAnimation3D,
  generateAsset,
  generateMusic,
  generateSoundEffect,
  materializeAsset,
  checkRigging,
  processModel3D,
  rigModel,
  animateModel,
  startTask,
  waitForTask,
} from '@sinestack/ai-core';
import type { DomainResult, GenerateAssetResult } from '@sinestack/ai-core';
import { createFalAssetProvider } from '@sinestack/ai-fal';
import type { AssetModelMapping, AssetModelV1, JSONObject, TaskHandle } from '@sinestack/ai-provider';
import { AssetProviderTransport, mapAssetResult } from '@sinestack/ai-provider-utils';
import { createReplicateAssetProvider } from '@sinestack/ai-replicate';
import { createWaveSpeedAssetProvider } from '@sinestack/ai-wavespeed';
import { createTripoProvider } from '@sinestack/ai-tripo';
import type { TripoRigCheckResult } from '@sinestack/ai-tripo';
import { createViggleProvider } from '@sinestack/ai-viggle';
import type { ViggleCharacterInput, ViggleMotionTextInput, ViggleMotion3DVideoInput, ViggleSceneCreateInput, ViggleSceneGenerateInput, ViggleSceneTask, ViggleMatrix4 } from '@sinestack/ai-viggle';

const fal = createFalAssetProvider({ apiKey: 'test' });
const wavespeed = createWaveSpeedAssetProvider({ apiKey: 'test' });
const replicate = createReplicateAssetProvider({ apiKey: 'test' });

const musicModel: AssetModelV1<JSONObject, 'music'> = fal.music('owner/music-model');
const threeDModel: AssetModelV1<JSONObject, 'model-3d'> = wavespeed.threeD('owner/three-d-model');
const sfxModel: AssetModelV1<JSONObject, 'sound-effect'> = fal.soundEffect('owner/sfx-model');

interface MotionInput {
  readonly prompt: string;
  readonly frames: number;
}

const motionMapping: AssetModelMapping<MotionInput> = {
  mapInput(input) {
    return { text: input.prompt, num_frames: input.frames };
  },
  mapResult(output) {
    return mapAssetResult(output);
  },
};

const motionModel: AssetModelV1<MotionInput, 'animation-3d'> = replicate.animation3D(
  'owner/motion-model',
  motionMapping,
);

export async function typecheckConsumer(): Promise<GenerateAssetResult<'animation-3d'>> {
  void generateMusic({ model: musicModel, input: { prompt: 'Calm piano' } });
  void generate3D({ model: threeDModel, input: { prompt: 'Chair' } });
  void generateSoundEffect({ model: sfxModel, input: { prompt: 'Bell' } });
  void AssetProviderTransport;
  const result = await generateAnimation3D({
    model: motionModel,
    input: { prompt: 'Jump', frames: 60 },
  });
  void materializeAsset(result.asset);
  void generateAsset({
    model: fal.asset('owner/doc-model', { kind: 'document' }),
    input: { title: 'Doc' },
  });
  return result;
}

/** Typecheck only. No network requests run when this module is imported. */
export async function typecheckTripoConsumer(): Promise<DomainResult<TripoRigCheckResult, 'model3d.rig.check'>> {
  const tripo = createTripoProvider({ apiKey: 'test' });
  void generate3D({ model: tripo.textTo3D('explicit-version'), input: { prompt: 'Chair' } });
  void processModel3D({ processor: tripo.texture(), input: { input: 'source-task' } });
  void rigModel({ rigger: tripo.rig('explicit-rig-version'), input: { input: 'source-task' } });
  void animateModel({ animator: tripo.retarget(), input: { input: 'rig-task', animation: 'preset:walk' } });
  const model = tripo.rigCheck();
  const started = await startTask({ model, input: { input: 'source-task' } });
  const saved: TaskHandle<'model3d.rig.check'> = started.task;
  const completed = await waitForTask({ model, task: saved });
  const riggable: boolean = completed.result.riggable;
  void riggable;
  // @ts-expect-error Renamed declarations must still reject missing native inputs.
  void checkRigging({ checker: model, input: {} });
  // @ts-expect-error Sharing a runtime must not erase semantic domain boundaries.
  void rigModel({ rigger: model, input: { input: 'source-task' } });
  return checkRigging({ checker: model, input: { input: 'source-task' } });
}

/** Public Viggle declarations must work from an installed tarball, including Blob input. */
export async function typecheckViggleConsumer(): Promise<ViggleSceneTask> {
  const viggle = createViggleProvider({ apiKey: 'test', connectionId: 'installed-types' });
  const characterInput: ViggleCharacterInput = { type: 'vsplat', enhance_prompt: 'A dancer' };
  const character = await startTask({ model: viggle.createCharacter(), input: characterInput });
  const characterResult = await waitForTask({ model: viggle.createCharacter(), task: character.task });
  const characterId: string = characterResult.result.id;
  await viggle.characters.export(characterId, 'vsplat');
  await viggle.characters.create({ image: new Blob(['image']), type: 'all', model: 'future-model', joint_set: 'full', scale_parts: { arms: 1.1 } });

  const motionInput: ViggleMotionTextInput = { text: 'Walk', duration_seconds: 5, smooth: true };
  await generateAnimation3D({ model: viggle.textToMotion({ format: 'fbx' }), input: motionInput });
  const videoInput: ViggleMotion3DVideoInput = { motion_video: new Blob(['video']), target_fps: 30 };
  await generateAnimation3D({ model: viggle.videoToMotion(), input: videoInput });

  await generateAsset({ model: viggle.image(), input: { prompt: 'A poster', reference_image: new Blob(['image']) } });
  await generateAsset({ model: viggle.textToVideo(), input: { prompt: 'A forest', quality: 'low', seed: '9223372036854775807' } });
  const sceneInput: ViggleSceneCreateInput = { sessionId: 'room', prompt: 'A studio', referenceImageFiles: [new Blob(['image'])] };
  const sceneModel = viggle.createScene();
  const sceneStart = await startTask({ model: sceneModel, input: sceneInput });
  const saved: TaskHandle<'scene.create'> = sceneStart.task;
  const ready = await waitForTask({ model: sceneModel, task: saved });
  const scene: ViggleSceneTask = ready.result;
  const camera: ViggleMatrix4 = [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]];
  const next: ViggleSceneGenerateInput = { sessionId: 'room', referenceBatchIds: ['10000000-0000-0000-0000-000000000001'], targetC2w: camera };
  await startTask({ model: viggle.generateSceneViews(), input: next });
  await viggle.scenes.customPanorama({ sessionId: 'room', panorama: new Blob(['pano']), panoramaC2w: camera, metersPerUnit: 1 });
  // @ts-expect-error Character render requests still require an image source.
  await viggle.characters.create({ type: 'render' });
  // @ts-expect-error A motion file facade cannot silently request a combined all resource.
  await generateAnimation3D({ model: viggle.videoToMotion(), input: { motion_video_url: 'https://assets.example/video.mp4', type: 'all' } });
  // @ts-expect-error Scene operations cannot be substituted for model rigging.
  await rigModel({ rigger: sceneModel, input: sceneInput });
  return scene;
}
