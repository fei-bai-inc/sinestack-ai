import assert from 'node:assert/strict';
import {
  generate3D,
  generateAnimation3D,
  generateAsset,
  generateMusic,
  generateSoundEffect,
  materializeAsset,
} from '@sinestack/ai-core';
import { createFalAssetProvider } from '@sinestack/ai-fal';
import {
  httpURL,
  jsonObject,
  mapAssetResult,
  snapshotAssetMapping,
} from '@sinestack/ai-provider-utils';
import { createReplicateAssetProvider } from '@sinestack/ai-replicate';
import { createWaveSpeedAssetProvider } from '@sinestack/ai-wavespeed';

// Verify @sinestack/ai-provider-utils exports
assert.equal(httpURL('https://example.com/model.glb', 'asset url').href, 'https://example.com/model.glb');
assert.deepEqual(jsonObject({ ok: true }, 'payload'), { ok: true });
const mappedResult = mapAssetResult(
  { audio: { url: 'https://example.com/song.mp3', content_type: 'audio/mpeg', file_name: 'song.mp3' } },
);
assert.equal(mappedResult.assets.length, 1);
assert.equal(mappedResult.assets[0].type, 'url');
assert.equal(mappedResult.assets[0].url, 'https://example.com/song.mp3');
const snap = snapshotAssetMapping({
  mapInput: input => ({ text: input.prompt }),
});
assert.equal(typeof snap.mapInput, 'function');

// Verify @sinestack/ai-core local asset execution & materialization
const localDocumentModel = {
  specificationVersion: 'v1',
  provider: 'local',
  modelId: 'consumer-smoke-document',
  kind: 'document',
  capabilities: { idempotentGenerate: true },
  async doGenerate({ input }) {
    const bytes = new TextEncoder().encode(`${input.title}:${input.body}`);
    return {
      assets: [
        {
          type: 'binary',
          data: bytes,
          mediaType: 'text/plain; charset=utf-8',
          filename: 'smoke.txt',
          role: 'document',
        },
      ],
    };
  },
};

const docResult = await generateAsset({
  model: localDocumentModel,
  input: { title: 'SineStack AI', body: 'package consumer smoke test' },
});
const docFile = await materializeAsset(docResult.asset);
assert.equal(new TextDecoder().decode(docFile.uint8Array), 'SineStack AI:package consumer smoke test');

// Verify @sinestack/ai-fal with mock fetch
const fal = createFalAssetProvider({
  apiKey: 'fal-test-key',
  fetch: async (url) => {
    const u = String(url);
    if (u.endsWith('/owner/music-model')) {
      return new Response(
        JSON.stringify({
          request_id: 'fal-req-1',
          status_url: 'https://queue.fal.run/owner/music-model/requests/fal-req-1/status',
          response_url: 'https://queue.fal.run/owner/music-model/requests/fal-req-1',
          cancel_url: 'https://queue.fal.run/owner/music-model/requests/fal-req-1/cancel',
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
    if (u.endsWith('/status')) {
      return new Response(
        JSON.stringify({ status: 'COMPLETED' }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
    return new Response(
      JSON.stringify({
        audio: { url: 'https://example.com/fal-track.mp3', content_type: 'audio/mpeg' },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  },
});

const falMusic = await generateMusic({
  model: fal.music('owner/music-model'),
  input: { prompt: 'Ambient synth' },
  pollIntervalMs: 1,
});
assert.equal(falMusic.asset.type, 'url');
assert.equal(falMusic.asset.url, 'https://example.com/fal-track.mp3');

// Verify @sinestack/ai-wavespeed with mock fetch
const wavespeed = createWaveSpeedAssetProvider({
  apiKey: 'ws-test-key',
  fetch: async (url) => {
    const u = String(url);
    if (u.includes('/predictions/ws-req-1/result')) {
      return new Response(
        JSON.stringify({
          code: 200,
          data: {
            id: 'ws-req-1',
            status: 'completed',
            outputs: ['https://example.com/mesh.glb'],
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
    return new Response(
      JSON.stringify({
        code: 200,
        data: {
          id: 'ws-req-1',
          status: 'created',
          urls: { get: 'https://api.wavespeed.ai/api/v3/predictions/ws-req-1/result' },
        },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  },
});

const wsThreeD = await generate3D({
  model: wavespeed.threeD('owner/mesh-model'),
  input: { prompt: 'Low-poly chair' },
  pollIntervalMs: 1,
});
assert.equal(wsThreeD.asset.type, 'url');
assert.equal(wsThreeD.asset.url, 'https://example.com/mesh.glb');

// Verify @sinestack/ai-replicate with mock fetch
const replicate = createReplicateAssetProvider({
  apiKey: 'rep-test-key',
  fetch: async () =>
    new Response(
      JSON.stringify({
        id: 'rep-req-1',
        status: 'succeeded',
        output: 'https://example.com/motion.fbx',
        urls: {
          get: 'https://api.replicate.com/v1/predictions/rep-req-1',
          cancel: 'https://api.replicate.com/v1/predictions/rep-req-1/cancel',
        },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ),
});

const repAnim = await generateAnimation3D({
  model: replicate.animation3D('owner/motion-model'),
  input: { prompt: 'Walk forward' },
  pollIntervalMs: 1,
});
assert.equal(repAnim.asset.type, 'url');
assert.equal(repAnim.asset.url, 'https://example.com/motion.fbx');

assert.equal(typeof generateSoundEffect, 'function');
