import {
  generateAsset,
  generate3D,
  generateSoundEffect,
  generateMusic,
  generateAnimation3D,
  getAssetStatus,
  materializeAsset,
  startAsset,
  waitForAsset,
} from '@sine-ai/core';
import type {
  AssetHooks,
  AssetRetryOptions,
  GenerateAssetResult,
  GetAssetStatusResult,
  StartAssetResult,
} from '@sine-ai/core';
import type {
  AssetModelV1,
  AssetOperation,
  SoundEffectInput,
  ThreeDInput,
  MusicInput,
  Animation3DInput,
} from '@sine-ai/provider';
import type { GeneratedFile } from 'ai';
// @ts-expect-error Observation hook failures no longer have a custom exported error class.
import type { AssetHookError } from '@sine-ai/core';

declare function expectType<T>(value: T): void;

declare const threeD: AssetModelV1<ThreeDInput, 'model-3d'>;
declare const soundEffect: AssetModelV1<SoundEffectInput, 'sound-effect'>;
declare const music: AssetModelV1<MusicInput, 'music'>;
declare const motion: AssetModelV1<Animation3DInput, 'animation-3d'>;

expectType<Promise<GenerateAssetResult<'music'>>>(generateMusic({ model: music, prompt: 'Piano score', instrumental: true }));
expectType<Promise<GenerateAssetResult<'animation-3d'>>>(generateAnimation3D({ model: motion, prompt: 'Walk', durationSeconds: 3, seed: 42, format: 'json' }));
// @ts-expect-error Music and motion models are not interchangeable.
generateMusic({ model: motion, prompt: 'Piano score' });
// @ts-expect-error A motion model needs an animation-3d kind.
generateAnimation3D({ model: music, prompt: 'Walk' });
// @ts-expect-error The shared motion input uses json, which adapters map to native formats.
generateAnimation3D({ model: motion, prompt: 'Walk', format: 'dict' });
declare const customMusic: AssetModelV1<MusicInput & { voice: string }, 'music'>;
// @ts-expect-error A facade cannot erase additional required fields of a custom model.
generateMusic({ model: customMusic, prompt: 'Piano score' });

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

const observationHooks: AssetHooks = {
  async onStart(event) { expectType<string>(event.callId); },
  onOperation(event) { expectType<AssetOperation>(event.operation); },
  onProgress(event) { expectType<'pending' | 'running'>(event.status); },
  onFinish(event) { expectType<unknown>(event.result); },
  onError(event) { expectType<Error>(event.error); },
};
const retryCounts: AssetRetryOptions = { start: 0, generate: 0, status: 2, cancel: 0 };
generate3D({ model: threeD, prompt: 'Chair', hooks: observationHooks, retry: retryCounts });

// @ts-expect-error Per-attempt lifecycle hooks were removed in favor of SDK retry semantics.
const removedAttemptHook: AssetHooks = { onAttempt() {} };
// @ts-expect-error Per-retry lifecycle hooks were removed in favor of SDK retry semantics.
const removedRetryHook: AssetHooks = { onRetry() {} };
// @ts-expect-error Cancellation is observed through onError, not a separate terminal callback.
const removedAbortHook: AssetHooks = { onAbort() {} };
// @ts-expect-error AI SDK owns the initial backoff delay.
const removedInitialDelay: AssetRetryOptions = { initialDelayMs: 0 };
// @ts-expect-error AI SDK owns the maximum delay policy.
const removedMaximumDelay: AssetRetryOptions = { maxDelayMs: 1_000 };
