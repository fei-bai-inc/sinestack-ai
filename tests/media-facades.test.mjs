import assert from 'node:assert/strict';
import test from 'node:test';
import { generateAnimation3D, generateMusic, generate3D, generateSoundEffect } from '@sine-ai/core';

for (const [kind, generate] of [
  ['music', generateMusic], ['animation-3d', generateAnimation3D],
  ['model-3d', generate3D], ['sound-effect', generateSoundEffect],
]) {
  test(`${kind} facade preserves arbitrary native input without a modality schema`, async () => {
    const input = { description: 'Native model request', model_specific: { steps: 9999, enabled: false }, custom_array: ['one', 2] };
    let calls = 0;
    const model = {
      specificationVersion: 'v1', provider: 'external', modelId: 'unregistered/new-model', kind,
      async doGenerate(options) {
        calls++;
        assert.equal(options.input, input);
        return { assets: [{ type: 'url', url: 'https://assets.example/output', mediaType: 'application/octet-stream' }] };
      },
    };
    const result = await generate({ model, input });
    assert.equal(calls, 1);
    assert.equal(result.asset.url, 'https://assets.example/output');
  });
}

test('music facade delegates one typed input to the shared executor and preserves native metadata', async () => {
  const phases = [];
  const model = {
    specificationVersion: 'v1', provider: 'fixture', modelId: 'music', kind: 'music',
    async doGenerate({ input, providerOptions, abortSignal }) {
      phases.push('generate');
      assert.deepEqual(input, { prompt: 'A spacious piano score', lyrics: undefined, instrumental: true });
      assert.deepEqual(providerOptions, { fixture: { format: 'wav' } });
      assert.ok(abortSignal instanceof AbortSignal);
      return {
        assets: [{ type: 'url', url: 'https://media.example/song.wav', mediaType: 'audio/wav' }],
        providerMetadata: { fixture: { output: { audio: 'https://media.example/song.wav', seed: 7 } } },
      };
    },
  };
  const result = await generateMusic({
    model, prompt: 'A spacious piano score', instrumental: true,
    providerOptions: { fixture: { format: 'wav' } },
    hooks: { onStart() { phases.push('start'); }, onFinish() { phases.push('finish'); } },
  });
  assert.deepEqual(phases, ['start', 'generate', 'finish']);
  assert.equal(result.asset.mediaType, 'audio/wav');
  assert.equal(result.providerMetadata.fixture.output.seed, 7);
});

test('animation facade uses the same async operation and lifecycle path', async () => {
  const phases = [];
  const model = {
    specificationVersion: 'v1', provider: 'fixture', modelId: 'motion', kind: 'animation-3d',
    async doStart({ input }) {
      phases.push('submit');
      assert.deepEqual(input, { prompt: 'Walk forward', durationSeconds: 3, seed: 42, format: 'json' });
      return { operation: { id: 'motion-1' } };
    },
    async doStatus({ operation }) {
      phases.push('query');
      assert.deepEqual(operation, { id: 'motion-1' });
      return { status: 'completed', result: {
        assets: [{ type: 'url', url: 'https://media.example/motion.json', mediaType: 'application/json' }],
      } };
    },
  };
  const result = await generateAnimation3D({
    model, prompt: 'Walk forward', durationSeconds: 3, seed: 42, format: 'json',
    hooks: { onOperation() { phases.push('operation'); }, onFinish() { phases.push('finish'); } },
  });
  assert.deepEqual(phases, ['submit', 'operation', 'query', 'finish']);
  assert.equal(result.operation.kind, 'animation-3d');
  assert.equal(result.asset.mediaType, 'application/json');
});

test('domain facades reject a wrong kind before invoking a provider', async () => {
  let calls = 0;
  const wrongModel = { kind: 'model-3d', async doGenerate() { calls++; } };
  await assert.rejects(generateMusic({ model: wrongModel, prompt: 'Piano' }), /requires a music/);
  await assert.rejects(generateAnimation3D({ model: wrongModel, prompt: 'Walk' }), /requires an animation-3d/);
  assert.equal(calls, 0);
});
