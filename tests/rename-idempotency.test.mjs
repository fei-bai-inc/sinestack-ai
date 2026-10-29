import assert from 'node:assert/strict';
import test from 'node:test';
import { checkRigging, generateAsset } from '@sinestack/ai-core';

for (const api of ['asset', 'check']) {
  test(`${api}: caller-provided historical idempotency keys remain untouched`, async () => {
    const calls = [];
    const capture = options => {
      calls.push(options.idempotencyKey);
      assert.equal(new Headers(options.headers).get('idempotency-key'), options.idempotencyKey);
    };
    const model = api === 'asset' ? {
      specificationVersion: 'v1', provider: 'local', modelId: 'document', kind: 'document',
      async doGenerate(options) {
        capture(options);
        return { assets: [{ type: 'binary', data: new Uint8Array([1]), mediaType: 'application/octet-stream' }] };
      },
    } : {
      specificationVersion: 'v1', provider: 'local', driverId: 'check', domain: 'model3d.rig.check',
      async doExecute(options) { capture(options); return { result: { riggable: true } }; },
    };
    const invoke = headers => api === 'asset'
      ? generateAsset({ model, input: {}, headers })
      : checkRigging({ checker: model, input: {}, headers });
    const originalKey = 'sine_asset_saved-client-request';
    await invoke({ 'IDEMPOTENCY-KEY': originalKey });
    assert.deepEqual(calls, [originalKey]);
  });
}
