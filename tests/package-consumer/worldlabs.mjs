import assert from 'node:assert/strict';
import { generateAsset, startAsset, waitForAsset } from '@sinestack/ai-core';
import { createWorldLabsProvider } from '@sinestack/ai-worldlabs';

// Runs from installed tarballs outside the workspace; every request is local fake fetch.
const baseURL = 'https://worldlabs.example.test/marble/v1';
const splatURL = 'https://files.example.test/world.spz';
const panoURL = 'https://files.example.test/pano.png';
const worldId = 'consumer-world';
const nativeWorld = { world_id: worldId, display_name: 'Garden', world_marble_url: 'https://marble.example.test/garden', assets: { splats: { spz_urls: { full_res: splatURL }, semantics_metadata: { metric_scale_factor: 2, ground_plane_offset: 0 } } } };
const operations = new Map();
const calls = [];
const settings = {
  apiKey: 'consumer-key', baseURL, connectionId: 'consumer-account',
  async fetch(url, init) {
    const requestURL = String(url); const headers = new Headers(init.headers);
    calls.push({ method: init.method, url: requestURL });
    if (requestURL === 'https://storage.example.test/upload?signature=test') {
      assert.equal(init.method, 'PUT');
      assert.equal(init.credentials, 'omit');
      assert.equal(init.redirect, 'manual');
      assert.deepEqual(Object.fromEntries(headers), { 'content-type': 'image/png' });
      return new Response(null, { status: 204 });
    }
    assert.equal(new URL(url).origin, 'https://worldlabs.example.test');
    assert.equal(headers.get('wlt-api-key'), 'consumer-key');
    assert.equal(headers.has('authorization'), false);
    assert.equal(init.redirect, 'manual');
    const route = requestURL.slice(baseURL.length + 1);
    if (route === 'worlds:generate' || route === 'pano:depth_to_rgb') {
      assert.equal(init.method, 'POST');
      const input = JSON.parse(init.body);
      if (route === 'worlds:generate') {
        assert.equal(input.model, 'future-marble-model');
        assert.equal(input.world_prompt.type, 'text');
      } else assert.equal(input.depth_pano_image.source, 'uri');
      const id = `operation-${operations.size + 1}`;
      operations.set(id, route === 'worlds:generate' ? nativeWorld : { pano_url: panoURL });
      return Response.json({ operation_id: id, done: false });
    }
    if (route.startsWith('operations/')) {
      assert.equal(init.method, 'GET');
      const id = route.slice('operations/'.length);
      assert.ok(operations.has(id));
      return Response.json({ operation_id: id, done: true, response: operations.get(id), cost: { total_credits: 7 } });
    }
    if (route === `worlds/${worldId}:export`) {
      assert.equal(init.method, 'POST');
      const input = JSON.parse(init.body);
      assert.equal('world_id' in input, false);
      const splat = input.asset_type === 'splats';
      assert.equal(input.format, splat ? 'ply' : 'glb');
      return Response.json({ operation_id: `export-${input.format}`, done: true, response: { ...input, url: `https://files.example.test/export.${input.format}` } });
    }
    if (route === `worlds/${worldId}`) return Response.json(nativeWorld);
    if (route === 'credits') return Response.json({ remaining_credits: 100.5 });
    if (route === 'media-assets:prepare_upload') {
      assert.equal(init.method, 'POST');
      assert.deepEqual(JSON.parse(init.body), { file_name: 'image.png', kind: 'image' });
      return Response.json({ media_asset: { media_asset_id: 'media-one', file_name: 'image.png', kind: 'image' }, upload_info: { upload_url: 'https://storage.example.test/upload?signature=test', upload_method: 'PUT', required_headers: { 'Content-Type': 'image/png' } } });
    }
    assert.fail(`Unexpected ${init.method} ${route}`);
  },
};
const worldlabs = createWorldLabsProvider(settings);
const input = { world_prompt: { type: 'text', text_prompt: 'A garden' } };
const generated = await generateAsset({ model: worldlabs.world('future-marble-model'), input });
assert.equal(generated.asset.url, splatURL);
assert.equal(generated.usage.credits, 7);
assert.deepEqual(generated.providerMetadata.worldlabs.output, nativeWorld);
const { operation } = await startAsset({ model: worldlabs.world('future-marble-model'), input });
const submissions = calls.filter(call => call.method === 'POST').length;
const resumed = await waitForAsset({ model: createWorldLabsProvider(settings).world(operation.modelId), operation: JSON.parse(JSON.stringify(operation)) });
assert.equal(resumed.asset.url, splatURL);
assert.equal(calls.filter(call => call.method === 'POST').length, submissions);
const panorama = await generateAsset({ model: worldlabs.depthToPanorama(), input: { depth_pano_image: { source: 'uri', uri: 'https://files.example.test/depth.exr' }, text_prompt: 'Garden' } });
assert.equal(panorama.asset.url, panoURL);
for (const [factory, format] of [['exportSplat', 'ply'], ['exportMesh', 'glb']]) {
  const before = calls.length;
  const result = await generateAsset({ model: worldlabs[factory](), input: { world_id: worldId } });
  assert.equal(result.asset.url, `https://files.example.test/export.${format}`);
  assert.equal(calls.length, before + 1, 'Completed submissions need no poll request');
}
assert.deepEqual(await worldlabs.worlds.get(worldId), nativeWorld);
assert.equal((await worldlabs.credits.get()).remaining_credits, 100.5);
const prepared = await worldlabs.mediaAssets.prepareUpload({ file_name: 'image.png', kind: 'image' });
await worldlabs.mediaAssets.upload(prepared, new Uint8Array([1, 2, 3]));
console.log('Installed World Labs package verified generation, panorama, exports, receipt restore, resources and isolated storage uploads.');
