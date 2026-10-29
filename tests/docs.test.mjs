import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { checkDocumentation } from '../scripts/check-docs.mjs';

async function fixture(t, files) {
  const root = await mkdtemp(join(tmpdir(), 'sinestack-docs-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const [name, content] of Object.entries(files)) {
    const path = join(root, name);
    await mkdir(join(path, '..'), { recursive: true });
    await writeFile(path, content);
  }
  return root;
}

test('documentation links resolve relative to their document, with encoded names and fragments', async t => {
  const root = await fixture(t, {
    'README.md': '[guide](docs/guide.md#usage)\n[reference][setup]\n[setup]: <docs/setup guide.md> "Setup"\n',
    'docs/guide.md': '[home](../README.md)\n[setup](setup%20guide.md?view=raw#install)\n[missing](gone.md)\n',
    'docs/setup guide.md': '# Setup\n',
  });
  assert.deepEqual((await checkDocumentation(root)).errors, ['docs/guide.md:3: Missing local link target: gone.md']);
});

test('documentation checks ignore external targets, code examples and generated dependencies', async t => {
  const root = await fixture(t, {
    'README.md': '[web](https://example.invalid/missing)\n[mail](mailto:maintainer@example.invalid)\n[anchor](#missing)\n`[example](not-a-file)`\n    [code](also-not-a-file)\n```md\n[example](missing.md)\n```\n',
    'node_modules/dependency/README.md': '[generated](missing.md)\n',
    'dist/README.md': '```\n',
    '.github/pull_request_template.md': '[contributing](../CONTRIBUTING.md)\n',
    'CONTRIBUTING.md': '# Contributing\n',
  });
  assert.deepEqual(await checkDocumentation(root), { files: 3, errors: [] });
});

test('documentation checks report broken image/reference targets, malformed encoding and unclosed fences', async t => {
  const root = await fixture(t, {
    'README.md': '![diagram](missing.svg)\n[guide]: missing.md\n[bad](bad%ZZ.md)\n~~~ts\n[ignored](not-a-link.md)\n```\n',
  });
  assert.deepEqual((await checkDocumentation(root)).errors, [
    'README.md:1: Missing local link target: missing.svg',
    'README.md:2: Missing local link target: missing.md',
    'README.md:3: Invalid URL encoding: bad%ZZ.md',
    'README.md:4: Unclosed fenced code block',
  ]);
});

test('documentation command fails for broken links and succeeds after the target is supplied', async t => {
  const root = await fixture(t, { 'README.md': '[guide](guide.md)\n' });
  const script = fileURLToPath(new URL('../scripts/check-docs.mjs', import.meta.url));
  const run = () => spawnSync(process.execPath, [script, root], { encoding: 'utf8' });
  const broken = run();
  assert.equal(broken.status, 1);
  assert.match(broken.stderr, /README\.md:1: Missing local link target/);
  await writeFile(join(root, 'guide.md'), '# Guide\n');
  assert.equal(run().status, 0);
});

test('npm-facing repository links resolve from the checkout root and catch missing translations', async t => {
  const root = await fixture(t, {
    'README.md': '# Home\n',
    'packages/core/README.md': '[中文](https://github.com/fei-bai-inc/sinestack-ai/blob/main/packages/core/README.zh-CN.md)\n[guide](https://github.com/fei-bai-inc/sinestack-ai/blob/main/docs/setup%20guide.md?raw=1#usage)\n[source](https://github.com/fei-bai-inc/sinestack-ai/tree/main/packages/core)\n',
    'docs/setup guide.md': '# Guide\n',
  });
  assert.deepEqual((await checkDocumentation(root)).errors, [
    'packages/core/README.md:1: Missing local link target: https://github.com/fei-bai-inc/sinestack-ai/blob/main/packages/core/README.zh-CN.md',
  ]);
  await writeFile(join(root, 'packages/core/README.zh-CN.md'), '[English](https://github.com/fei-bai-inc/sinestack-ai/blob/main/packages/core/README.md)\n');
  assert.deepEqual((await checkDocumentation(root)).errors, []);
});

test('repository link checks leave other hosts, repositories and historical refs external', async t => {
  const root = await fixture(t, {
    'README.md': '[other repo](https://github.com/another/project/blob/main/missing.md)\n[history](https://github.com/fei-bai-inc/sinestack-ai/blob/v0.1.0/missing.md)\n[other host](https://github.com.example/fei-bai-inc/sinestack-ai/blob/main/missing.md)\n',
  });
  assert.deepEqual((await checkDocumentation(root)).errors, []);
});
