import assert from 'node:assert/strict';
import { generate3D, processModel3D, checkRigging, rigModel, animateModel, startTask, waitForTask } from '@sinestack/ai-core';
import { createTripoProvider } from '@sinestack/ai-tripo';

// Runs from installed tarballs, outside the workspace. All provider traffic is mocked.
const jobs = new Map();
let submissions = 0;
const baseURL = 'https://tripo.example.test/v3';
const modelURL = 'https://files.example.test/model.glb';
const tripo = createTripoProvider({
  apiKey: 'consumer-fixture', baseURL, connectionId: 'consumer',
  async fetch(url, init) {
    assert.equal(new URL(url).origin, 'https://tripo.example.test');
    assert.equal(init.redirect, 'error');
    const headers = new Headers(init.headers);
    assert.equal(headers.get('authorization'), 'Bearer consumer-fixture');
    assert.match(headers.get('user-agent'), /sinestack-ai\//);
    if (init.method === 'POST') {
      const id = `consumer-${++submissions}`;
      jobs.set(id, String(url).slice(baseURL.length + 1));
      return Response.json({ code: 0, data: { task_id: id } });
    }
    assert.equal(init.method, 'GET');
    const id = String(url).split('/').at(-1);
    const path = jobs.get(id);
    assert.ok(path, 'Queries must reuse a submitted task');
    const output = path === 'animations/rig-check' ? { riggable: false, rig_type: 'biped' }
      : { model_url: modelURL };
    return Response.json({ code: 0, data: { task_id: id, status: 'success', output } });
  },
});

const generated = await generate3D({ model: tripo.textTo3D('explicit-version'), input: { prompt: 'Chair' } });
assert.equal(generated.asset.url, modelURL);
const processed = await processModel3D({ processor: tripo.texture(), input: { input: 'source-model' } });
assert.equal(processed.model.url, modelURL);
const checked = await checkRigging({ checker: tripo.rigCheck(), input: { input: 'source-model' } });
assert.equal(checked.riggable, false);
assert.equal('assets' in checked, false);
const rigged = await rigModel({ rigger: tripo.rig('explicit-rig-version'), input: { input: 'source-model' } });
assert.equal(rigged.model.url, modelURL);
const animated = await animateModel({ animator: tripo.retarget(), input: { input: rigged.taskId, animation: 'preset:walk' } });
assert.equal(animated.files[0].url, modelURL);
const checker = tripo.rigCheck();
const started = await startTask({ model: checker, input: { input: 'source-model' } });
const beforeResume = submissions;
const resumed = await waitForTask({ model: checker, task: JSON.parse(JSON.stringify(started.task)) });
assert.equal(resumed.result.riggable, false);
assert.equal(submissions, beforeResume);
console.log('Installed Tripo package verified generation, processing, checks, rigging, animation and task resume.');
