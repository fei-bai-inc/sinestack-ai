// One-time branch migration. Removed after the generated lockfile is committed and verified.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';

async function replaceOnce(path, before, after) {
  const source = await readFile(path, 'utf8');
  assert.equal(source.split(before).length, 2, `Expected exactly one migration target in ${path}`);
  await writeFile(path, source.replace(before, after));
}
const readJSON = async path => JSON.parse(await readFile(path, 'utf8'));
const writeJSON = async (path, value) => writeFile(path, JSON.stringify(value, null, 2) + '\n');

await replaceOnce('scripts/release.mjs', "  'tripo',\n];", "  'tripo',\n  'meshy',\n];");
await replaceOnce('scripts/smoke-packages.mjs', "  run(process.execPath, ['tripo.mjs'], 120_000);", "  run(process.execPath, ['tripo.mjs'], 120_000);\n  run(process.execPath, ['meshy.mjs'], 120_000);");
await replaceOnce('tests/release.test.mjs', "  '@sinestack/ai-tripo',\n];", "  '@sinestack/ai-tripo',\n  '@sinestack/ai-meshy',\n];");
await replaceOnce('tests/release.test.mjs', "      'tripo',\n    ]);", "      'tripo',\n      'meshy',\n    ]);");
await replaceOnce('tests/release.test.mjs', 'declares all seven @sinestack/ai-* packages', 'declares all eight @sinestack/ai-* packages');
await replaceOnce('tests/version-policy.test.mjs', "const directories = ['provider', 'provider-utils', 'core', 'fal', 'wavespeed', 'replicate', 'tripo'];", "const directories = ['provider', 'provider-utils', 'core', 'fal', 'wavespeed', 'replicate', 'tripo', 'meshy'];");

await replaceOnce('scripts/version-policy.mjs',
  '    const base = baseJson(`packages/${directory}/package.json`);',
  [
    '    // Only an explicitly registered, entirely new directory has no base version.',
    '    // Do not catch Git/JSON errors: an existing directory with missing or corrupt',
    '    // metadata must still fail closed rather than masquerade as a new package.',
    "    const baseDirectory = git('ls-tree', '--name-only', baseRef, '--', `packages/${directory}`).trim();",
    '    if (!baseDirectory) {',
    '      compareStableVersions(manifest.version, manifest.version);',
    '      changed.push({ directory, name: manifest.name, version: manifest.version, previousVersion: null, isNew: true });',
    '      continue;',
    '    }',
    '    const base = baseJson(`packages/${directory}/package.json`);',
  ].join('\n'));
await replaceOnce('scripts/publish.mjs',
  '    for (const pkg of changed) {\n      assert(typeof pkg.previousVersion',
  [
    '    for (const pkg of changed) {',
    '      if (pkg.isNew === true) {',
    "        assert.equal(pkg.previousVersion, null, `New package ${pkg.name} must not invent a previous main version.`);",
    '        // The version policy proved the directory is absent from the base tree.',
    '        // Bootstrap npm versions are allowed; dependency, target integrity and',
    '        // latest-tag preflights below still run before any publication.',
    '        log(`New repository package ${pkg.name}; npm Trusted Publisher must be configured before publication.`);',
    '        continue;',
    '      }',
    '      assert(typeof pkg.previousVersion',
  ].join('\n'));

for (const directory of ['provider', 'provider-utils', 'core']) {
  execFileSync(process.execPath, ['scripts/version.mjs', directory, '0.1.2'], { stdio: 'inherit' });
}
const core = await readJSON('packages/core/package.json');
core.dependencies['@sinestack/ai-provider'] = '0.1.2';
await writeJSON('packages/core/package.json', core);
const meshy = await readJSON('packages/meshy/package.json');
assert.equal(meshy.version, '0.1.0');
meshy.dependencies['@sinestack/ai-provider'] = '0.1.2';
meshy.dependencies['@sinestack/ai-provider-utils'] = '0.1.2';
await writeJSON('packages/meshy/package.json', meshy);

await replaceOnce('README.md',
  '八个 `@sinestack/ai-*` 包使用同一发布版本。Tripo、Meshy 均已纳入打包和独立安装测试；提交代码不会自动发布 npm。完整流程见 [发布说明](docs/PUBLISHING.md)。',
  '八个 `@sinestack/ai-*` 包采用独立版本。PR 必须为变更包提交相应版本和锁文件；未变更包保留自己的版本及精确依赖。合入 main 后自动发布本次选中的变更包，分支提交不会发布。Tripo、Meshy 均纳入打包和独立安装测试，完整规则见 [发布说明](docs/PUBLISHING.md)。');
await replaceOnce('docs/PUBLISHING.md', 'The seven packages have **independent versions**.', 'The eight packages have **independent versions**.');
await replaceOnce('docs/PUBLISHING.md', 'and `@sinestack/ai-tripo`. An unchanged package', '`@sinestack/ai-tripo`, and `@sinestack/ai-meshy`. An unchanged package');
await replaceOnce('docs/PUBLISHING.md',
  'New package paths fail the check until their release order and publishing configuration are explicitly added.',
  'New package paths fail the check until their release order and publishing configuration are explicitly added. A registered package whose entire directory is absent from the base tree uses a committed stable initial version and is selected with `isNew: true` and `previousVersion: null`. An existing directory with missing or malformed base metadata still fails; it cannot be treated as a new package.');
await replaceOnce('docs/PUBLISHING.md',
  'For a new package, configure a Trusted Publisher before its first automatic release. npm requires the package to exist first; create a non-release bootstrap version and ensure the previous `main` version is available before merging. Do not use the intended release version as the bootstrap version. `@sinestack/ai-tripo@0.1.0` is the published baseline for the first automated Tripo release. OIDC failures must not fall back to a stored publish token.',
  'For a new package such as `@sinestack/ai-meshy`, configure a Trusted Publisher before its first automatic release. npm requires the package to exist first; create a non-release bootstrap version under a non-`latest` tag, never the intended release version. A genuinely new repository package has no previous `main` version; this is explicitly distinguished from an existing package whose previous release is missing. Existing packages still require their previous `main` version on npm. All selected packages, including new ones, still pass exact-dependency, target-integrity and latest-tag checks before any writes. This PR does not create npm-side settings or publish bootstrap packages. OIDC failures must not fall back to a stored publish token.');
await replaceOnce('docs/PUBLISHING.md', 'packs all seven workspaces', 'packs all eight workspaces');
await replaceOnce('docs/PUBLISHING.md', 'including Tripo. It does not publish.', 'including Tripo and Meshy. It does not publish.');
await writeFile('docs/MESHY.md', (await readFile('docs/MESHY.md', 'utf8')) + '\n\n## Independent package release\n\nThis provider starts at `@sinestack/ai-meshy@0.1.0` and pins `@sinestack/ai-provider@0.1.2`\n(the additive analyzer contract) and `@sinestack/ai-provider-utils@0.1.2` (DELETE/empty-response support).\nThe compatible core analyzer facade is released in `@sinestack/ai-core@0.1.2`. Under the repository\n0.x rules these additive changes use patch increments, not a shared workspace version bump.\nTripo, fal, WaveSpeed and Replicate keep their existing versions and dependency pins.\n\nThe new package is explicitly registered in release order, version-policy tests and isolated consumer\nvalidation. First publication also needs npm-side bootstrap/Trusted Publisher setup; source changes\ndo not perform it. See [PUBLISHING.md](PUBLISHING.md) for the merge and automatic release rules.\n');

const base = '4479f138c69ac83a747a8f37d76019ddea8bd961';
for (const directory of ['tripo', 'fal', 'wavespeed', 'replicate']) {
  const path = `packages/${directory}/package.json`;
  const original = JSON.parse(execFileSync('git', ['show', `${base}:${path}`], { encoding: 'utf8' }));
  assert.deepEqual(await readJSON(path), original, `${directory} must not receive a cascading version/pin change`);
}
assert.equal((await readJSON('package.json')).version, '0.1.0');
console.log('Prepared independent versions and new-package support without changing unrelated package pins.');
