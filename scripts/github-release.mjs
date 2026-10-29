import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { artifacts, readRelease, repository, sourceIdentity, validateVersion } from './release.mjs';

const apiOrigin = 'https://api.github.com';
const uploadOrigin = 'https://uploads.github.com';
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

export function parseGitHubReleaseOptions(argv = process.argv.slice(2)) {
  const { values } = parseArgs({ args: argv, options: {
    'dry-run': { type: 'boolean', default: false },
    artifacts: { type: 'string', default: artifacts },
  } });
  return { dryRun: values['dry-run'], artifactsDir: resolve(values.artifacts) };
}

async function releasePlans(options, deps) {
  const directory = options.artifactsDir ?? artifacts;
  const receipt = JSON.parse(await readFile(join(directory, 'published.json'), 'utf8'));
  assert.equal(receipt.schemaVersion, 1, 'Unsupported npm publication receipt.');
  assert(Array.isArray(receipt.packages), 'Publication receipt must contain packages.');
  if (receipt.packages.length === 0) return [];

  const names = receipt.packages.map(pkg => pkg.name);
  assert.equal(new Set(names).size, names.length, 'Duplicate packages in publication receipt.');
  const release = await (deps.readRelease ?? readRelease)(repository, directory, names);
  assert.equal(receipt.repository, release.repository, 'Publication repository differs from release manifest.');
  const match = /^https:\/\/github\.com\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)$/u.exec(receipt.repository);
  assert(match, 'Publication receipt must name a GitHub repository.');
  const repo = match[1];
  assert.deepEqual(receipt.source, release.source, 'Publication source differs from release manifest.');
  assert.equal(receipt.source.dirty, false, 'Publication receipt contains uncommitted source.');
  assert(/^[a-f0-9]{40}$/u.test(receipt.source.commit), 'Publication commit must be a full Git SHA.');
  assert(/^[a-f0-9]{40}$/u.test(receipt.source.tree), 'Publication tree must be a full Git SHA.');
  const source = (deps.sourceIdentity ?? sourceIdentity)();
  assert.equal(source.commit, receipt.source.commit, 'Checkout commit differs from published source.');
  assert.equal(source.tree, receipt.source.tree, 'Checkout tree differs from published source.');
  if (!options.dryRun) assert.equal(source.dirty, false, 'Commit source changes before publishing a GitHub Release.');
  assert(['public', 'restricted'].includes(receipt.npm?.access), 'Invalid publication access.');
  assert(/^[a-z][a-z0-9-]*$/u.test(receipt.npm?.tag), 'Invalid publication dist-tag.');

  const packages = release.packages.filter(pkg => names.includes(pkg.name)).map(pkg => {
    const item = receipt.packages.find(value => value.name === pkg.name);
    const expected = { name: pkg.name, version: pkg.version, file: pkg.file, sha256: pkg.sha256, integrity: pkg.integrity, bytes: pkg.bytes };
    assert.deepEqual(item, expected, `Published package differs from verified archive: ${pkg.name}`);
    assert(/^@sinestack\/ai-[a-z0-9-]+$/u.test(pkg.name), 'Invalid SineStack package name for release tag.');
    assert.equal(pkg.file, basename(pkg.file), 'Package filenames must stay within artifacts.');
    assert(/^[A-Za-z0-9._-]+\.tgz$/u.test(pkg.file), 'Invalid package archive filename.');
    validateVersion(pkg.version);
    return expected;
  });
  assert.equal(packages.length, names.length, 'Publication receipt contains unknown packages.');
  const plans = [];
  const commit = receipt.source.commit;
  for (const pkg of packages) {
    const bytes = await readFile(join(directory, pkg.file));
    assert.equal(bytes.length, pkg.bytes, `Published archive size mismatch: ${pkg.file}`);
    assert.equal(sha256(bytes), pkg.sha256, `Published archive checksum mismatch: ${pkg.file}`);
    const manifest = { schemaVersion: 1, repository: receipt.repository, source: receipt.source, npm: receipt.npm, packages: [pkg] };
    const data = Buffer.from(JSON.stringify(manifest, null, 2) + '\n');
    const assets = [
      { name: pkg.file, bytes: pkg.bytes, sha256: pkg.sha256, path: join(directory, pkg.file), contentType: 'application/gzip' },
      { name: 'manifest.json', bytes: data.length, sha256: sha256(data), data, contentType: 'application/json' },
    ];
    const body = [
      `[${pkg.name}@${pkg.version}](https://www.npmjs.com/package/${pkg.name}/v/${pkg.version}) published to npm (dist-tag: \`${receipt.npm.tag}\`).`,
      '', `Source: [${commit.slice(0, 12)}](${receipt.repository}/commit/${commit}).`,
      '', 'Assets contain this package\'s exact npm tarball and a manifest with its SHA-256 and npm integrity values.', '',
    ].join('\n');
    plans.push({ repo, commit, tag: `${pkg.name.slice('@sinestack/'.length)}@${pkg.version}`, name: `${pkg.name}@${pkg.version}`,
      body, prerelease: receipt.npm.tag !== 'latest' || pkg.version.includes('-'), packages: [pkg], assets });
  }
  return plans;
}

export async function publishGitHubReleases(options, deps = {}) {
  const log = deps.log ?? console.log;
  // Validate the whole selected batch before creating any remote releases.
  const plans = await releasePlans(options, deps);
  if (plans.length === 0) { log('No published packages; no GitHub Releases needed.'); return []; }
  if (options.dryRun) {
    for (const plan of plans) log(`GitHub Release dry-run: ${plan.tag}; assets: ${plan.assets.map(asset => asset.name).join(', ')}`);
    return plans;
  }
  const releases = [];
  for (const plan of plans) releases.push(await publishPackageRelease(plan, deps));
  return releases;
}

async function publishPackageRelease(plan, deps) {
  const log = deps.log ?? console.log;
  const env = deps.env ?? process.env;
  if (env.GITHUB_REPOSITORY) assert.equal(env.GITHUB_REPOSITORY, plan.repo, 'Workflow repository differs from publication receipt.');
  if (env.GITHUB_SHA) assert.equal(env.GITHUB_SHA, plan.commit, 'Workflow commit differs from publication receipt.');
  const token = env.GH_TOKEN || env.GITHUB_TOKEN;
  assert(token, 'Set GH_TOKEN or GITHUB_TOKEN with contents:write to publish a GitHub Release.');
  const fetcher = deps.fetch ?? globalThis.fetch;
  const root = `${apiOrigin}/repos/${plan.repo}`;
  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2026-03-10', 'User-Agent': 'sinestack-ai-release' };

  async function request(url, { method = 'GET', body, binary, missing = false, accept } = {}) {
    const target = new URL(url);
    assert([apiOrigin, uploadOrigin].includes(target.origin), 'Refusing to send GitHub credentials to an unexpected origin.');
    assert(!target.username && !target.password, 'GitHub URLs must not contain credentials.');
    const response = await fetcher(target.href, { method, redirect: 'manual', signal: AbortSignal.timeout(120_000),
      headers: { ...headers, ...(accept ? { Accept: accept } : {}), ...(body === undefined ? {} : {
        'Content-Type': binary ?? 'application/json', ...(binary ? { 'Content-Length': String(body.length) } : {}),
      }) }, body: body === undefined ? undefined : binary ? body : JSON.stringify(body) });
    assert(!response.redirected, 'GitHub API request unexpectedly followed a redirect.');
    if (missing && response.status === 404) { await response.body?.cancel(); return null; }
    if (accept === 'application/octet-stream' && response.status === 302) return response;
    if (!response.ok) throw new Error(`GitHub ${method} ${target.pathname} failed (${response.status}): ${await response.text()}`);
    if (accept === 'application/octet-stream') return response;
    if (response.status === 204) return null;
    return response.json();
  }

  async function findRelease() {
    const published = await request(`${root}/releases/tags/${encodeURIComponent(plan.tag)}`, { missing: true });
    if (published) return published;
    // GitHub's tag lookup documents published releases; drafts require listing.
    for (let page = 1; ; page++) {
      const releases = await request(`${root}/releases?per_page=100&page=${page}`);
      assert(Array.isArray(releases), 'Invalid GitHub releases response.');
      const found = releases.find(release => release.tag_name === plan.tag);
      if (found) return found;
      if (releases.length < 100) return null;
    }
  }

  async function checkTag(required) {
    const tag = await request(`${root}/git/ref/tags/${encodeURIComponent(plan.tag)}`, { missing: true });
    assert(tag || !required, 'Published release tag is missing.');
    if (tag) assert(tag.object?.type === 'commit' && tag.object.sha === plan.commit,
      'Release tag points to a different commit or is not a lightweight commit tag.');
  }

  async function listAssets(id) {
    const assets = [];
    for (let page = 1; ; page++) {
      const batch = await request(`${root}/releases/${id}/assets?per_page=100&page=${page}`);
      assert(Array.isArray(batch), 'Invalid GitHub assets response.');
      assets.push(...batch);
      if (batch.length < 100) return assets;
    }
  }

  async function verifyAsset(remote, local) {
    assert.equal(remote.name, local.name, 'Uploaded asset name mismatch.');
    assert.equal(remote.state, 'uploaded', `Release asset is incomplete: ${local.name}`);
    assert.equal(remote.size, local.bytes, `Release asset size mismatch: ${local.name}`);
    if (remote.digest) {
      assert.equal(remote.digest, `sha256:${local.sha256}`, `Release asset checksum mismatch: ${local.name}`);
      return;
    }
    let response = await request(`${root}/releases/assets/${remote.id}`, { accept: 'application/octet-stream' });
    if (response.status === 302) {
      const location = new URL(response.headers.get('location'));
      assert(location.protocol === 'https:' && !location.username && !location.password, 'Invalid signed release asset URL.');
      await response.body?.cancel();
      // The storage request must never inherit the GitHub token.
      response = await fetcher(location.href, { redirect: 'error', signal: AbortSignal.timeout(120_000) });
      assert(response.ok && !response.redirected, 'Could not download the existing release asset for verification.');
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    assert.equal(bytes.length, local.bytes, `Release asset size mismatch: ${local.name}`);
    assert.equal(sha256(bytes), local.sha256, `Release asset checksum mismatch: ${local.name}`);
  }

  let release = await findRelease();
  await checkTag(Boolean(release && !release.draft));
  if (release) {
    assert.equal(release.tag_name, plan.tag, 'GitHub Release tag mismatch.');
    assert.equal(release.target_commitish, plan.commit, 'GitHub Release target differs from published source.');
    assert.equal(release.prerelease, plan.prerelease, 'GitHub Release prerelease status differs from npm publication.');
  } else {
    release = await request(`${root}/releases`, { method: 'POST', body: {
      tag_name: plan.tag, target_commitish: plan.commit, name: plan.name, body: plan.body,
      draft: true, prerelease: plan.prerelease, make_latest: 'false',
    } });
  }
  assert(Number.isSafeInteger(release.id) && release.id > 0, 'Invalid GitHub Release ID.');
  const remoteAssets = await listAssets(release.id);
  const expected = new Set(plan.assets.map(asset => asset.name));
  assert(remoteAssets.every(asset => expected.has(asset.name)), 'GitHub Release contains unexpected assets.');
  assert.equal(new Set(remoteAssets.map(asset => asset.name)).size, remoteAssets.length, 'GitHub Release contains duplicate asset names.');

  for (const local of plan.assets) {
    const remote = remoteAssets.find(asset => asset.name === local.name);
    if (remote?.state === 'uploaded') {
      await verifyAsset(remote, local);
      continue;
    }
    assert(release.draft, `Published release is missing a complete asset: ${local.name}`);
    if (remote) {
      assert(['starter', 'open'].includes(remote.state) && remote.size === 0, `Conflicting incomplete release asset: ${local.name}`);
      await request(`${root}/releases/assets/${remote.id}`, { method: 'DELETE' });
    }
    const upload = new URL(release.upload_url.replace(/\{.*$/u, ''));
    assert.equal(upload.origin, uploadOrigin, 'Unexpected GitHub upload origin.');
    assert.equal(upload.pathname, `/repos/${plan.repo}/releases/${release.id}/assets`, 'Unexpected GitHub upload path.');
    upload.searchParams.set('name', local.name);
    const bytes = local.data ?? await readFile(local.path);
    const uploaded = await request(upload.href, { method: 'POST', body: bytes, binary: local.contentType });
    await verifyAsset(uploaded, local);
  }
  if (release.draft) {
    // Recheck after upload before making the release visible.
    await checkTag(false);
    release = await request(`${root}/releases/${release.id}`, { method: 'PATCH', body: {
      name: plan.name, body: plan.body, draft: false, prerelease: plan.prerelease, make_latest: 'false',
    } });
    assert.equal(release.draft, false, 'GitHub Release remained a draft after publication.');
    await checkTag(true);
  }
  log(`GitHub Release published or verified: ${release.html_url ?? `${plan.repo} ${plan.tag}`}`);
  return release;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await publishGitHubReleases(parseGitHubReleaseOptions());
}
