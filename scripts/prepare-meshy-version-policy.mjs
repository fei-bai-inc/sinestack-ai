// Second and final migration pass: fix declaration portability without cascading pins.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';

execFileSync(process.execPath, ['scripts/version.mjs', 'tripo', '0.1.2'], { stdio: 'inherit' });
const path = 'docs/MESHY.md';
const source = await readFile(path, 'utf8');
const before = 'Tripo, fal, WaveSpeed and Replicate keep their existing versions and dependency pins.';
assert.equal(source.split(before).length, 2);
await writeFile(path, source.replace(before, 'Tripo also receives a compatible `0.1.2` patch for portable public declarations when older\nexact dependencies are installed; its provider/provider-utils pins remain at `0.1.1`.\nfal, WaveSpeed and Replicate keep both their existing versions and dependency pins.'));
const tripo = JSON.parse(await readFile('packages/tripo/package.json', 'utf8'));
assert.equal(tripo.dependencies['@sinestack/ai-provider'], '0.1.1');
assert.equal(tripo.dependencies['@sinestack/ai-provider-utils'], '0.1.1');
console.log('Tripo declaration patch versioned without changing its exact dependency pins.');
