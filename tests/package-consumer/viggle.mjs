import assert from 'node:assert/strict';
import { generateAnimation3D, startAsset, waitForAsset, startTask, waitForTask } from '@sinestack/ai-core';
import { createViggleProvider } from '@sinestack/ai-viggle';

// Executes from installed npm tarballs, with no workspace source imports or live API charges.
const calls = [];
const OUTPUT_URL = 'https://assets.example/output';
const BATCH = '10000000-0000-0000-0000-000000000001';
const viggle = createViggleProvider({ apiKey: 'mock-only', connectionId: 'tarball-consumer', fetch: async (url, init) => {
  const path = new globalThis.URL(String(url)).pathname;
  calls.push({ path, method: init.method, body: init.body });
  if (path === '/v1/videos') return Response.json({ id: 'vid_consumer', status: 'queued' });
  if (path === '/v1/videos/vid_consumer') return Response.json({ id: 'vid_consumer', status: 'ready', video_url: `${OUTPUT_URL}.mp4`, seed: '9223372036854775807' });
  if (path === '/v1/images') return Response.json({ id: 'img_consumer', status: 'queued' });
  if (path === '/v1/images/img_consumer') return Response.json({ id: 'img_consumer', status: 'ready', images: [{ url: `${OUTPUT_URL}.png`, width: 1024, height: 1024 }] });
  if (path === '/v1/characters' || path === '/v1/characters/char_consumer') return Response.json({ id: 'char_consumer', status: init.method === 'POST' ? 'queued' : 'ready', type: 'render', name: 'Consumer character', capabilities: init.method === 'POST' ? [] : ['video_render'], error: null, vsplat: null, glb: null });
  if (path === '/v1/motions') return Response.json({ id: 'mot_consumer', status: 'queued', type: 'glb', glb: { status: 'queued', skeletons: [], error: null } });
  if (path === '/v1/motions/mot_consumer/export') return Response.json({ id: 'mot_consumer', status: 'ready', download_type: 'fbx',
    mixamo_url: `${OUTPUT_URL}-mixamo.fbx`, metahuman_url: `${OUTPUT_URL}-metahuman.fbx`, metahuman_body_url: `${OUTPUT_URL}-body.fbx`, thumbnail_url: null });
  if (path === '/v1/scenes/pano' || path === '/v1/scenes/scn_consumer.room') return Response.json({ id: 'scn_consumer.room', status: init.method === 'POST' ? 'queued' : 'ready', sessionId: 'room', operation: 'pano', credits: 6,
    result: init.method === 'POST' ? null : { sessionId: 'room', operation: 'pano', spz: { url: `${OUTPUT_URL}.spz` }, outputBatch: { batchId: BATCH, manifest: { url: `${OUTPUT_URL}-batch.json` } } } });
  throw new Error(`Unexpected installed Viggle request ${init.method} ${path}`);
} });

const videoModel = viggle.textToVideo();
const videoStart = await startAsset({ model: videoModel, input: { prompt: 'A cinematic forest', quality: 'low', seed: '9223372036854775807' } });
const beforeVideoResume = calls.length;
const video = await waitForAsset({ model: videoModel, operation: JSON.parse(JSON.stringify(videoStart.operation)) });
assert.equal(video.asset.url, `${OUTPUT_URL}.mp4`); assert.equal(calls.length, beforeVideoResume + 1);
assert.equal(calls.at(-1).method, 'GET');
assert.equal(video.providerMetadata.viggle.output.seed, '9223372036854775807');

const imageModel = viggle.image();
const imageStart = await startAsset({ model: imageModel, input: { prompt: 'A poster', n: 1 } });
const image = await waitForAsset({ model: imageModel, operation: JSON.parse(JSON.stringify(imageStart.operation)) });
assert.equal(image.asset.url, `${OUTPUT_URL}.png`); assert.ok(calls.find(call => call.path === '/v1/images').body instanceof FormData);

const characterDriver = viggle.createCharacter();
const characterStart = await startTask({ model: characterDriver, input: { image_url: 'https://assets.example/input.png', model: 'future-preprocessing-version' } });
const character = await waitForTask({ model: characterDriver, task: JSON.parse(JSON.stringify(characterStart.task)) });
assert.equal(character.result.id, 'char_consumer'); assert.deepEqual(character.result.capabilities, ['video_render']);
assert.equal('assets' in character.result, false);

const motion = await generateAnimation3D({ model: viggle.textToMotion({ format: 'fbx' }), input: { text: 'A character waves', duration_seconds: 5 } });
assert.equal(motion.assets.length, 3); assert.deepEqual(motion.assets.map(file => file.metadata.rig), ['mixamo', 'metahuman', 'metahuman_body']);
assert.ok(motion.assets.every(file => file.filename.endsWith('.fbx')));
assert.ok(JSON.parse(calls.find(call => call.path === '/v1/motions').body).task_id);

const sceneDriver = viggle.createScene();
const sceneStart = await startTask({ model: sceneDriver, input: { sessionId: 'room', prompt: 'A small studio' } });
assert.equal(sceneStart.task.handle.sessionId, 'room');
const scene = await waitForTask({ model: sceneDriver, task: JSON.parse(JSON.stringify(sceneStart.task)) });
assert.equal(scene.result.result.outputBatch.batchId, BATCH); assert.equal(scene.result.result.spz.url, `${OUTPUT_URL}.spz`);
assert.equal(calls.filter(call => call.method === 'POST').length, 5, 'Resuming or exporting must never submit another paid operation');
console.log('Installed Viggle package verified video/image resume, reusable resources, three motion rigs and scene session results.');
