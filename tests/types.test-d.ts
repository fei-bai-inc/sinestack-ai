import {
  generateAsset,
  generate3D,
  generateSoundEffect,
  getAssetStatus,
  materializeAsset,
  startAsset,
  waitForAsset,
} from '@sine-ai/core';
import type {
  GenerateAssetResult,
  GetAssetStatusResult,
  StartAssetResult,
} from '@sine-ai/core';
import type {
  AssetModelV1,
  AssetOperation,
  SoundEffectInput,
  ThreeDInput,
} from '@sine-ai/provider';
import type { GeneratedFile } from 'ai';

declare function expectType<T>(value: T): void;

declare const threeD: AssetModelV1<ThreeDInput, 'model-3d'>;
declare const soundEffect: AssetModelV1<SoundEffectInput, 'sound-effect'>;

expectType<Promise<GenerateAssetResult<'model-3d'>>>(generate3D({ model: threeD, prompt: 'A wooden chair' }));
expectType<Promise<GenerateAssetResult<'sound-effect'>>>(generateSoundEffect({
  model: soundEffect,
  prompt: 'Rain on a tin roof',
  durationSeconds: 3,
  promptInfluence: 0.5,
  loop: true,
}));

// @ts-expect-error A sound-effect provider cannot satisfy the 3D facade.
generate3D({ model: soundEffect, prompt: 'A wooden chair' });
// @ts-expect-error A 3D provider cannot satisfy the sound-effect facade.
generateSoundEffect({ model: threeD, prompt: 'Rain' });
// @ts-expect-error The facade requires a prompt.
generate3D({ model: threeD });
// @ts-expect-error The sound-effect facade requires a prompt.
generateSoundEffect({ model: soundEffect });
// @ts-expect-error Duration is numeric.
generateSoundEffect({ model: soundEffect, prompt: 'Rain', durationSeconds: 'three' });

declare const styledThreeD: AssetModelV1<ThreeDInput & { style: 'low-poly' }, 'model-3d'>;
// @ts-expect-error A facade cannot supply extra required fields of a custom model.
generate3D({ model: styledThreeD, prompt: 'A wooden chair' });
generateAsset({ model: styledThreeD, input: { prompt: 'A wooden chair', style: 'low-poly' } });

interface ReportInput {
  title: string;
  pageCount: number;
  landscape?: boolean;
}

declare const report: AssetModelV1<ReportInput, 'document'>;
declare const savedReport: AssetOperation<'document'>;

expectType<Promise<GenerateAssetResult<'document'>>>(generateAsset({
  model: report,
  input: { title: 'Quarterly report', pageCount: 4, landscape: true },
}));
expectType<Promise<StartAssetResult<'document'>>>(startAsset({
  model: report,
  input: { title: 'Quarterly report', pageCount: 4 },
}));
expectType<Promise<GenerateAssetResult<'document'>>>(waitForAsset({ model: report, operation: savedReport }));
expectType<Promise<GetAssetStatusResult<'document'>>>(getAssetStatus({ model: report, operation: savedReport }));
// @ts-expect-error An operation kind must not widen the model's kind through inference.
getAssetStatus({ model: threeD, operation: savedReport });

// @ts-expect-error Custom required input fields must not disappear through generic inference.
generateAsset({ model: report, input: { title: 'Missing page count' } });
// @ts-expect-error Starting a custom job preserves the same required input contract.
startAsset({ model: report, input: { pageCount: 4 } });
// @ts-expect-error Custom input property types must remain checked.
generateAsset({ model: report, input: { title: 'Wrong page type', pageCount: 'four' } });

interface AnimationInput {
  prompt: string;
  skeleton: 'humanoid' | 'quadruped';
  frames: number;
}

const animation: AssetModelV1<AnimationInput, 'animation-3d'> = {
  specificationVersion: 'v1',
  provider: 'type-test',
  modelId: 'motion-1',
  kind: 'animation-3d',
  async doGenerate({ input }) {
    expectType<'humanoid' | 'quadruped'>(input.skeleton);
    expectType<number>(input.frames);
    return { assets: [{ type: 'binary', data: new Uint8Array([1, 2]), mediaType: 'application/octet-stream' }] };
  },
};

expectType<Promise<GenerateAssetResult<'animation-3d'>>>(generateAsset({
  model: animation,
  input: { prompt: 'Walk', skeleton: 'humanoid', frames: 60 },
}));
// @ts-expect-error The generic API retains literal constraints of custom adapters.
generateAsset({ model: animation, input: { prompt: 'Walk', skeleton: 'bird', frames: 60 } });

expectType<Promise<GeneratedFile>>(materializeAsset({
  type: 'binary',
  data: new Uint8Array([1, 2, 3]),
  mediaType: 'application/octet-stream',
}));
