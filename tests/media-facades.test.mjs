import assert from 'node:assert/strict';
import test from 'node:test';
import { generateAnimation3D, generateMusic, materializeAsset } from '@sinestack/ai-core';

test('animation publishes the accepted operation before querying and finishes only after completion', async () => {
  const phases = [];
  const model = {
    specificationVersion: 'v1', provider: 'fixture', modelId: 'motion', kind: 'animation-3d',
    async doStart() {
      phases.push('submit');
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
    model, input: { prompt: 'Walk forward', durationSeconds: 3, seed: 42, format: 'json' },
    hooks: { onOperation() { phases.push('operation'); }, onFinish() { phases.push('finish'); } },
  });
  assert.deepEqual(phases, ['submit', 'operation', 'query', 'finish']);
  assert.equal(result.operation.kind, 'animation-3d');
});

test('domain facades reject a wrong kind before invoking a provider', async () => {
  let calls = 0;
  const wrongModel = { kind: 'model-3d', async doGenerate() { calls++; } };
  await assert.rejects(generateMusic({ model: wrongModel, prompt: 'Piano' }), /requires a music/);
  await assert.rejects(generateAnimation3D({ model: wrongModel, prompt: 'Walk' }), /requires an animation-3d/);
  assert.equal(calls, 0);
});

test('music generation leaves multiple outputs remote and materializes only the selected asset', async t => {
  const network = t.mock.method(globalThis, 'fetch', () => assert.fail('No implicit downloads are allowed'));
  let generations = 0;
  const files = [
    { type: 'url', url: 'https://media.example/song.wav', mediaType: 'audio/wav' },
    { type: 'url', url: 'https://media.example/stem.flac', mediaType: 'audio/flac' },
  ];
  const model = {
    specificationVersion: 'v1', provider: 'fixture', modelId: 'music', kind: 'music',
    async doGenerate() { generations++; return { assets: files }; },
  };
  const result = await generateMusic({ model, input: { description: 'Piano with separate stem' } });
  assert.deepEqual(result.assets, files);
  const downloads = [];
  const file = await materializeAsset(result.assets[1], {
    maxBytes: 3,
    async download({ url }) {
      downloads.push(url.href);
      return { data: new Uint8Array([1, 2, 3]) };
    },
  });
  assert.deepEqual(downloads, ['https://media.example/stem.flac']);
  assert.equal(file.mediaType, 'audio/flac');
  assert.deepEqual(file.uint8Array, new Uint8Array([1, 2, 3]));
  assert.equal(result.assets[1].type, 'url');
  assert.equal(generations, 1);
  assert.equal(network.mock.callCount(), 0);
});

test('materialization preserves abort reasons before dispatch and after an uncooperative download resolves', async () => {
  const asset = { type: 'url', url: 'https://media.example/song.wav', mediaType: 'audio/wav' };
  const controller = new AbortController();
  const reason = new Error('Stop fetching media');
  let downloads = 0;
  const download = async () => {
    downloads++;
    controller.abort(reason);
    return { data: new Uint8Array([1, 2, 3]) };
  };
  await assert.rejects(materializeAsset(asset, { abortSignal: controller.signal, download }), error => error === reason);
  assert.equal(downloads, 1);
  await assert.rejects(materializeAsset(asset, { abortSignal: controller.signal, download }), error => error === reason);
  assert.equal(downloads, 1, 'an already aborted materialization must not download again');
  assert.equal(asset.type, 'url');
});
