/// <reference types="node" />
// Server-only Node.js example. Keep FAL_KEY and this module out of browser bundles.
// Importing this module performs no generation. Calling generateGameAssets starts billable jobs.
import process from 'node:process';
import { generate3D, generateSoundEffect } from '@sine-ai/core';
import type { AssetHooks } from '@sine-ai/core';
import { createFalAssetProvider } from '@sine-ai/fal';

export interface GenerateGameAssetsOptions {
  abortSignal?: AbortSignal;
  /** Observation only: callback errors are ignored. event.kind identifies each asset. */
  hooks?: AssetHooks;
}

export async function generateGameAssets(options: GenerateGameAssetsOptions = {}) {
  const apiKey = process.env.FAL_KEY;
  if (!apiKey) throw new Error('Set FAL_KEY in the server environment before generating assets.');
  const fal = createFalAssetProvider({ apiKey });
  const shared = {
    abortSignal: options.abortSignal,
    hooks: options.hooks,
    // Failed status reads can be retried. fal submissions are not retried by default.
    retry: { status: 2 },
  };

  const [threeD, soundEffect] = await Promise.all([
    generate3D({
      ...shared,
      // This example selects a model explicitly. The SDK has no built-in model list.
      model: fal.threeD('fal-ai/hunyuan3d-v3/text-to-3d'),
      input: {
        prompt: 'A low-poly wooden treasure chest with iron bands, ready for a game scene',
        face_count: 100_000, enable_pbr: true,
      },
      timeoutMs: 20 * 60_000,
      poll: { intervalMs: 2_000, timeoutMs: 20 * 60_000 },
    }),
    generateSoundEffect({
      ...shared,
      model: fal.soundEffect('fal-ai/elevenlabs/sound-effects/v2'),
      input: {
        text: 'A heavy wooden treasure chest creaks open, followed by a soft metallic latch click',
        duration_seconds: 3, prompt_influence: 0.6, loop: false, output_format: 'mp3_44100_128',
      },
      timeoutMs: 2 * 60_000,
      poll: { intervalMs: 1_000, timeoutMs: 2 * 60_000 },
    }),
  ]);

  // Each result exposes asset + assets as URL references; no file is downloaded implicitly.
  // threeD.assets also contains alternate model formats and a thumbnail when fal returns them.
  return { threeD, soundEffect };
}
