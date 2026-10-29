import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { gzipSync } from 'node:zlib';
import {
  parseGitHubReleaseOptions,
  publishGitHubReleases,
} from '../scripts/github-release.mjs';

const repository = 'https://github.com/fei-bai-inc/sinestack-ai';
const repositoryName = 'fei-bai-inc/sinestack-ai';
const commit = '1234567890abcdef1234567890abcdef12345678';
const tree = 'abcdef1234567890abcdef1234567890abcdef12';
const apiPath = `/repos/${repositoryName}`;
const packageTag = pkg => `${pkg.name.slice('@sinestack/'.length)}@${pkg.version}`;

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function packageTarball(name, version) {
  const contents = Buffer.from(JSON.stringify({ name, version }));
  const header = Buffer.alloc(512);
  header.write('package/package.json');
  header.write('0000644\0', 100);
  header.write('0000000\0', 108);
  header.write('0000000\0', 116);
  header.write(`${contents.length.toString(8).padStart(11, '0')}\0`, 124);
  header.write('00000000000\0', 136);
  header.fill(32, 148, 156);
  header.write('0', 156);
  header.write('ustar\0', 257);
  header.write('00', 263);
  const checksum = header.reduce((sum, value) => sum + value, 0);
  header.write(`${checksum.toString(8).padStart(6, '0')}\0 `, 148);
  const padding = Buffer.alloc((512 - contents.length % 512) % 512);
  return gzipSync(Buffer.concat([header, contents, padding, Buffer.alloc(1024)]));
}

async function fixture(t, {
  versions = ['0.3.0', '0.7.1', '0.2.4'],
  selected = [0, 2],
  npmTag = 'latest',
  remote = githubResponder(),
} = {}) {
  const artifactsDir = await mkdtemp(join(tmpdir(), 'sinestack-github-release-'));
  t.after(() => rm(artifactsDir, { recursive: true, force: true }));
  const payloads = new Map();
  const packages = ['@sinestack/ai-provider', '@sinestack/ai-core', '@sinestack/ai-fal'].map((name, index) => {
    const version = versions[index];
    const bytes = packageTarball(name, version);
    const file = `${name.slice(1).replace('/', '-')}-${version}.tgz`;
    payloads.set(file, bytes);
    return {
      name, version, file, sha256: sha256(bytes),
      integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}`,
      bytes: bytes.length,
    };
  });
  const release = {
    schemaVersion: 1,
    repository,
    source: { commit, tree, dirty: false },
    packages,
    manifests: packages.map(({ name, version }) => ({ name, version, dependencies: {} })),
  };
  const receipt = {
    schemaVersion: 1,
    repository,
    source: { ...release.source },
    npm: { access: 'public', tag: npmTag },
    packages: selected.map(index => ({ ...packages[index] })),
  };
  await Promise.all([...payloads].map(([file, bytes]) => writeFile(join(artifactsDir, file), bytes)));
  await writeFile(join(artifactsDir, 'manifest.json'), JSON.stringify(release));
  const saveReceipt = () => writeFile(join(artifactsDir, 'published.json'), JSON.stringify(receipt));
  await saveReceipt();
  const reads = [];
  const deps = {
    readRelease: async (...args) => {
      reads.push(args);
      return release;
    },
    sourceIdentity: () => ({ commit, tree, dirty: false }),
    fetch: remote.fetch,
    env: { GH_TOKEN: 'test-token', GITHUB_REPOSITORY: repositoryName, GITHUB_SHA: commit },
    log: () => {},
  };
  return {
    artifactsDir, release, receipt, payloads, saveReceipt, remote, deps, reads,
    run: options => publishGitHubReleases({ dryRun: false, artifactsDir, ...options }, deps),
  };
}

function githubResponder() {
  const state = {
    releases: new Map(),
    releasesById: new Map(),
    tags: new Map(),
    requests: [],
    mutations: [],
    uploads: [],
    deleted: [],
    binaries: new Map(),
    nextReleaseId: 42,
    nextAssetId: 100,
    hideDraft: true,
    precedingReleases: [],
    lookupStatus: null,
    failUpload: null,
    corruptUpload: null,
    redirectDownloads: false,
    omitDigest: false,
  };
  const json = (value, status = 200) => new Response(JSON.stringify(value), {
    status, headers: { 'content-type': 'application/json' },
  });
  const absent = () => json({ message: 'Not Found' }, 404);
  const seed = ({ tag_name, name, draft = true, ...fields }) => {
    assert.equal(state.releases.has(tag_name), false, 'a retry must not create a duplicate release');
    const id = state.nextReleaseId++;
    const release = {
      id,
      tag_name,
      name,
      target_commitish: commit,
      body: '',
      draft,
      prerelease: false,
      upload_url: `https://uploads.github.com${apiPath}/releases/${id}/assets{?name,label}`,
      url: `https://api.github.com${apiPath}/releases/${id}`,
      html_url: `${repository}/releases/tag/${encodeURIComponent(tag_name)}`,
      assets: [],
      ...fields,
    };
    state.releases.set(tag_name, release);
    state.releasesById.set(id, release);
    if (!draft) state.tags.set(tag_name, { type: 'commit', sha: commit });
    return release;
  };
  state.seedRelease = (pkg, options = {}) => seed({
    tag_name: packageTag(pkg), name: `${pkg.name}@${pkg.version}`, ...options,
  });
  state.seedAsset = (release, name, bytes, options = {}) => {
    assert.equal(state.releasesById.get(release.id), release, 'seed the release before its assets');
    const id = state.nextAssetId++;
    const asset = {
      id, name, size: bytes.length, state: 'uploaded',
      digest: `sha256:${sha256(bytes)}`,
      url: `https://api.github.com${apiPath}/releases/assets/${id}`,
      browser_download_url: `${repository}/releases/download/${encodeURIComponent(release.tag_name)}/${name}`,
      ...options,
    };
    release.assets.push(asset);
    state.binaries.set(id, Buffer.from(bytes));
    return asset;
  };
  state.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    const method = init.method ?? 'GET';
    const headers = new Headers(init.headers);
    const path = decodeURIComponent(url.pathname);
    state.requests.push({ method, url: url.href, headers });
    if (url.origin === 'https://release-assets.githubusercontent.com') {
      assert.equal(method, 'GET');
      assert.equal(headers.has('authorization'), false, 'signed asset redirects must not receive credentials');
      const bytes = state.binaries.get(Number(path.split('/').at(-1)));
      assert.ok(bytes, 'signed download must refer to a known asset');
      return new Response(bytes);
    }
    assert.ok(['https://api.github.com', 'https://uploads.github.com'].includes(url.origin), `Unexpected remote origin: ${url.origin}`);
    assert.match(headers.get('authorization') ?? '', /test-token/, 'GitHub API requests must use the injected token');
    if (method !== 'GET') state.mutations.push({ method, path, body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined });
    const releaseTagPrefix = `${apiPath}/releases/tags/`;
    if (method === 'GET' && path.startsWith(releaseTagPrefix)) {
      const tag = path.slice(releaseTagPrefix.length);
      assert.equal(url.pathname, `${releaseTagPrefix}${encodeURIComponent(tag)}`, 'release lookup must encode the package tag');
      if (state.lookupStatus) return json({ message: 'Lookup denied' }, state.lookupStatus);
      const release = state.releases.get(tag);
      if (!release || (release.draft && state.hideDraft)) return absent();
      return json(release);
    }
    if (method === 'GET' && path === `${apiPath}/releases`) {
      const releases = [...state.precedingReleases, ...state.releases.values()];
      const page = Number(url.searchParams.get('page') ?? 1);
      const count = Number(url.searchParams.get('per_page') ?? 30);
      const response = json(releases.slice((page - 1) * count, page * count));
      if (page * count < releases.length) {
        response.headers.set('link', `<https://api.github.com${apiPath}/releases?per_page=${count}&page=${page + 1}>; rel="next"`);
      }
      return response;
    }
    const gitTagPrefix = `${apiPath}/git/ref/tags/`;
    if (method === 'GET' && path.startsWith(gitTagPrefix)) {
      const tag = path.slice(gitTagPrefix.length);
      assert.equal(url.pathname, `${gitTagPrefix}${encodeURIComponent(tag)}`, 'Git tag lookup must encode the package tag');
      const object = state.tags.get(tag);
      return object ? json({ ref: `refs/tags/${tag}`, object }) : absent();
    }
    if (method === 'POST' && path === `${apiPath}/releases`) {
      const body = JSON.parse(init.body);
      assert.equal(body.draft, true, 'assets must be uploaded to a draft');
      assert.equal(body.target_commitish, commit);
      assert.equal(body.make_latest, 'false', 'independent packages must not compete for repository latest');
      assert.match(body.tag_name, /^ai-[a-z0-9-]+@\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.+-]+)?$/u);
      return json(seed(body), 201);
    }
    const releaseMatch = path.match(/\/releases\/(\d+)(\/assets)?$/u);
    if (releaseMatch) {
      const release = state.releasesById.get(Number(releaseMatch[1]));
      if (!release) return absent();
      if (method === 'GET') {
        if (!releaseMatch[2]) return json(release);
        const page = Number(url.searchParams.get('page') ?? 1);
        const count = Number(url.searchParams.get('per_page') ?? 30);
        return json(release.assets.slice((page - 1) * count, page * count));
      }
      if (method === 'POST' && releaseMatch[2] && url.origin === 'https://uploads.github.com') {
        assert.equal(release.draft, true, 'published releases cannot be repaired');
        const name = url.searchParams.get('name');
        assert.ok(name, 'uploads must name the asset');
        const bytes = Buffer.from(await new Response(init.body).arrayBuffer());
        if (state.failUpload?.tag === release.tag_name && state.failUpload.name === name) {
          state.failUpload = null;
          return json({ message: 'Temporary upload failure' }, 502);
        }
        if (state.corruptUpload?.tag === release.tag_name && state.corruptUpload.name === name) bytes[0] ^= 1;
        assert.equal(release.assets.some(asset => asset.name === name), false, 'upload must not overwrite an existing asset');
        state.uploads.push({ tag: release.tag_name, name });
        return json(state.seedAsset(release, name, bytes, state.omitDigest ? { digest: null } : {}), 201);
      }
      if (method === 'PATCH' && !releaseMatch[2]) {
        assert.equal(release.draft, true, 'already published releases must be immutable');
        const body = JSON.parse(init.body);
        if (body.draft === false) {
          assert.equal(body.make_latest, 'false', 'publishing must not claim repository latest');
          state.tags.set(release.tag_name, { type: 'commit', sha: commit });
        }
        Object.assign(release, body);
        return json(release);
      }
    }
    const assetMatch = path.match(/\/releases\/assets\/(\d+)$/u);
    if (assetMatch) {
      const id = Number(assetMatch[1]);
      const release = [...state.releases.values()].find(candidate => candidate.assets.some(asset => asset.id === id));
      if (!release) return absent();
      const asset = release.assets.find(candidate => candidate.id === id);
      if (method === 'GET') {
        if (!headers.get('accept')?.includes('application/octet-stream')) return json(asset);
        if (state.redirectDownloads) {
          assert.equal(init.redirect, 'manual', 'authenticated asset redirects must be handled explicitly');
          return new Response(null, { status: 302, headers: { location: `https://release-assets.githubusercontent.com/assets/${id}?signed=test` } });
        }
        return new Response(state.binaries.get(id));
      }
      if (method === 'DELETE') {
        assert.equal(release.draft, true, 'never remove published assets');
        state.deleted.push({ tag: release.tag_name, name: asset.name });
        release.assets = release.assets.filter(candidate => candidate.id !== id);
        state.binaries.delete(id);
        return new Response(null, { status: 204 });
      }
    }
    throw new Error(`Unexpected GitHub request: ${method} ${url.href}`);
  };
  return state;
}

function selectedPackages(f) {
  return f.release.packages.filter(pkg => f.receipt.packages.some(selected => selected.name === pkg.name));
}

function assertPublishedPackage(f, pkg) {
  const { remote, receipt, payloads } = f;
  const tag = packageTag(pkg);
  const release = remote.releases.get(tag);
  assert.ok(release, `missing release for ${tag}`);
  assert.equal(release.draft, false);
  assert.equal(release.tag_name, tag);
  assert.equal(release.name, `${pkg.name}@${pkg.version}`);
  assert.equal(release.target_commitish, commit);
  assert.equal(release.prerelease, pkg.version.includes('-') || receipt.npm.tag !== 'latest');
  assert.deepEqual(remote.tags.get(tag), { type: 'commit', sha: commit });
  assert.deepEqual(release.assets.map(asset => asset.name).sort(), [pkg.file, 'manifest.json'].sort());
  const asset = release.assets.find(candidate => candidate.name === pkg.file);
  assert.deepEqual(remote.binaries.get(asset.id), payloads.get(pkg.file));
  assert.equal(asset.size, pkg.bytes);
  const packageRow = release.body.split('\n').find(line => line.includes(pkg.name));
  assert.ok(packageRow?.includes(pkg.version), `release notes must identify ${pkg.name}@${pkg.version}`);
  assert.ok(release.body.includes(commit), 'release notes must retain the exact source commit');
  for (const other of f.release.packages) {
    if (other.name !== pkg.name) assert.equal(release.body.includes(other.name), false, 'notes must contain only this package');
  }
  const manifest = release.assets.find(candidate => candidate.name === 'manifest.json');
  assert.deepEqual(JSON.parse(remote.binaries.get(manifest.id).toString('utf8')), { ...receipt, packages: [pkg] });
}

function assertPublished(f) {
  for (const pkg of selectedPackages(f)) assertPublishedPackage(f, pkg);
}

describe('per-package GitHub release publication', () => {
  test('parses dry-run and a custom artifact directory', () => {
    const options = parseGitHubReleaseOptions(['--dry-run', '--artifacts', '/tmp/github-release-fixture']);
    assert.equal(options.dryRun, true);
    assert.equal(options.artifactsDir, '/tmp/github-release-fixture');
  });

  test('publishes one release per successful npm package with isolated notes, manifests, and exact archives', async t => {
    const f = await fixture(t);
    const releases = await f.run();
    const packages = selectedPackages(f);
    assertPublished(f);
    assert.deepEqual(releases.map(release => release.tag_name), packages.map(packageTag));
    assert.deepEqual(new Set(f.remote.releases.keys()), new Set(packages.map(packageTag)));
    assert.equal(f.remote.uploads.length, packages.length * 2);
    assert.equal(f.remote.mutations[0].method, 'POST');
    assert.equal(f.remote.mutations[0].path, `${apiPath}/releases`);
    assert.equal(f.remote.mutations.at(-1).method, 'PATCH');
    assert.equal(f.reads[0][1], f.artifactsDir);
    assert.deepEqual(new Set(f.reads[0][2]), new Set(packages.map(pkg => pkg.name)));
  });

  test('publishes in verified dependency order rather than receipt order', async t => {
    const f = await fixture(t, { selected: [2, 1, 0] });
    const releases = await f.run();
    assertPublished(f);
    assert.deepEqual(releases.map(release => release.tag_name), f.release.packages.map(packageTag));
    const creates = f.remote.mutations.filter(call => call.method === 'POST' && call.path === `${apiPath}/releases`);
    assert.deepEqual(creates.map(call => call.body.tag_name), f.release.packages.map(packageTag));
  });

  test('the same numeric version in distinct packages creates distinct releases and isolated manifests', async t => {
    const f = await fixture(t, { versions: ['0.1.4', '0.1.4', '0.1.4'], selected: [0, 1, 2] });
    const releases = await f.run();
    assertPublished(f);
    assert.deepEqual(releases.map(release => release.tag_name), ['ai-provider@0.1.4', 'ai-core@0.1.4', 'ai-fal@0.1.4']);
    assert.equal(new Set(releases.map(release => release.id)).size, 3);
    const manifestIds = releases.map(release => release.assets.find(asset => asset.name === 'manifest.json').id);
    assert.equal(new Set(manifestIds).size, 3);
  });

  test('advancing only one package version creates only its new release and leaves earlier versions immutable', async t => {
    const first = await fixture(t, { selected: [0, 1] });
    await first.run();
    const previous = structuredClone(first.remote.releases);
    const mutations = first.remote.mutations.length;
    const next = await fixture(t, { versions: ['0.3.0', '0.7.2', '0.2.4'], selected: [1], remote: first.remote });
    const releases = await next.run();
    assertPublished(next);
    assert.deepEqual(releases.map(release => release.tag_name), ['ai-core@0.7.2']);
    assert.equal(next.remote.releases.size, 3);
    for (const [tag, release] of previous) assert.deepEqual(next.remote.releases.get(tag), release);
    const creates = next.remote.mutations.slice(mutations).filter(call => call.method === 'POST' && call.path === `${apiPath}/releases`);
    assert.deepEqual(creates.map(call => call.body.tag_name), ['ai-core@0.7.2']);
  });

  test('retrying complete published releases is read-only without duplicate assets or releases', async t => {
    const f = await fixture(t);
    await f.run();
    const before = structuredClone(f.remote.releases);
    const mutations = f.remote.mutations.length;
    const uploads = [...f.remote.uploads];
    const releases = await f.run();
    assertPublished(f);
    assert.deepEqual(releases.map(release => release.tag_name), selectedPackages(f).map(packageTag));
    assert.deepEqual(f.remote.releases, before);
    assert.equal(f.remote.mutations.length, mutations);
    assert.deepEqual(f.remote.uploads, uploads);
  });

  test('failure on the second package leaves the first published and third untouched; retry resumes only unfinished work', async t => {
    const f = await fixture(t, { selected: [0, 1, 2] });
    const [first, second, third] = selectedPackages(f);
    f.remote.failUpload = { tag: packageTag(second), name: 'manifest.json' };
    await assert.rejects(() => f.run(), /502/u);
    assertPublishedPackage(f, first);
    const firstRelease = structuredClone(f.remote.releases.get(packageTag(first)));
    const draft = f.remote.releases.get(packageTag(second));
    assert.equal(draft.draft, true);
    assert.equal(f.remote.tags.has(packageTag(second)), false);
    assert.deepEqual(draft.assets.map(asset => asset.name), [second.file]);
    assert.equal(f.remote.releases.has(packageTag(third)), false);
    assert.equal(f.remote.tags.has(packageTag(third)), false);
    assert.equal(f.remote.requests.some(call => call.url.includes(encodeURIComponent(packageTag(third)))), false);
    const completed = [...f.remote.uploads];
    const mutations = f.remote.mutations.length;
    const releases = await f.run();
    assertPublished(f);
    assert.deepEqual(releases.map(release => release.tag_name), [first, second, third].map(packageTag));
    assert.deepEqual(f.remote.releases.get(packageTag(first)), firstRelease);
    assert.equal(f.remote.releases.get(packageTag(second)).id, draft.id);
    for (const completedAsset of completed) {
      assert.equal(f.remote.uploads.filter(upload => upload.tag === completedAsset.tag && upload.name === completedAsset.name).length, 1);
    }
    const resumed = f.remote.mutations.slice(mutations);
    assert.equal(resumed.some(call => call.path === `${apiPath}/releases/${firstRelease.id}` || call.path === `${apiPath}/releases/${firstRelease.id}/assets`), false);
    const creates = f.remote.mutations.filter(call => call.method === 'POST' && call.path === `${apiPath}/releases`);
    assert.deepEqual(creates.map(call => call.body.tag_name), [first, second, third].map(packageTag));
  });

  test('discovers hidden drafts through paginated release listing rather than creating duplicates', async t => {
    const f = await fixture(t);
    for (const pkg of selectedPackages(f)) f.remote.seedRelease(pkg);
    f.remote.precedingReleases = Array.from({ length: 100 }, (_, index) => ({
      id: 1000 + index, tag_name: `other-${index}`, draft: false,
    }));
    await f.run();
    assertPublished(f);
    assert.equal(f.remote.mutations.some(call => call.path === `${apiPath}/releases`), false);
    assert.ok(f.remote.requests.some(call => new URL(call.url).searchParams.get('page') === '2'));
  });

  for (const state of ['starter', 'open']) {
    test(`replaces an incomplete zero-byte ${state} asset only on its owning draft`, async t => {
      const f = await fixture(t);
      const pkg = f.receipt.packages[0];
      const release = f.remote.seedRelease(pkg);
      f.remote.seedAsset(release, pkg.file, Buffer.alloc(0), { state, digest: null });
      await f.run();
      assertPublished(f);
      assert.deepEqual(f.remote.deleted, [{ tag: packageTag(pkg), name: pkg.file }]);
      assert.equal(f.remote.uploads.filter(upload => upload.tag === packageTag(pkg) && upload.name === pkg.file).length, 1);
    });
  }

  test('never publishes a draft when uploaded bytes fail integrity verification', async t => {
    const f = await fixture(t);
    const pkg = f.receipt.packages[0];
    f.remote.corruptUpload = { tag: packageTag(pkg), name: pkg.file };
    await assert.rejects(() => f.run(), /checksum/i);
    assert.equal(f.remote.releases.get(packageTag(pkg)).draft, true);
    assert.equal(f.remote.tags.has(packageTag(pkg)), false);
    assert.equal(f.remote.mutations.some(call => call.method === 'PATCH'), false);
    const mutations = f.remote.mutations.length;
    await assert.rejects(() => f.run(), /checksum/i);
    assert.equal(f.remote.mutations.length, mutations, 'retry must not overwrite conflicting uploaded bytes');
  });

  test('does not discard nonempty incomplete assets as harmless upload starters', async t => {
    const f = await fixture(t);
    const pkg = f.receipt.packages[0];
    const release = f.remote.seedRelease(pkg);
    f.remote.seedAsset(release, pkg.file, f.payloads.get(pkg.file), { state: 'starter', digest: null });
    await assert.rejects(() => f.run());
    assert.equal(release.draft, true);
    assert.deepEqual(f.remote.mutations, []);
  });

  test('rejects a same-size remote binary mismatch without overwriting or publishing the draft', async t => {
    const f = await fixture(t);
    const pkg = f.receipt.packages[0];
    const release = f.remote.seedRelease(pkg);
    const wrong = Buffer.from(f.payloads.get(pkg.file));
    wrong[wrong.length - 1] ^= 1;
    const asset = f.remote.seedAsset(release, pkg.file, wrong);
    await assert.rejects(() => f.run(), /checksum/i);
    assert.equal(release.draft, true);
    assert.deepEqual(f.remote.binaries.get(asset.id), wrong);
    assert.deepEqual(f.remote.mutations, []);
  });

  test('rejects remote asset size disagreement without repairing the draft', async t => {
    const f = await fixture(t);
    const pkg = f.receipt.packages[0];
    const release = f.remote.seedRelease(pkg);
    f.remote.seedAsset(release, pkg.file, f.payloads.get(pkg.file), { size: pkg.bytes + 1 });
    await assert.rejects(() => f.run(), /size/i);
    assert.equal(release.draft, true);
    assert.deepEqual(f.remote.mutations, []);
  });

  test('hashes downloaded bytes when GitHub omits digests without leaking credentials to redirects', async t => {
    const f = await fixture(t);
    f.remote.omitDigest = true;
    f.remote.redirectDownloads = true;
    await f.run();
    assertPublished(f);
    const downloads = f.remote.requests.filter(call => new URL(call.url).origin === 'https://release-assets.githubusercontent.com');
    assert.ok(downloads.length >= f.receipt.packages.length * 2);
    const mutations = f.remote.mutations.length;
    await f.run();
    assert.equal(f.remote.mutations.length, mutations);
  });

  test('a missing digest does not let a corrupt binary pass verification', async t => {
    const f = await fixture(t);
    const pkg = f.receipt.packages[0];
    const release = f.remote.seedRelease(pkg);
    const wrong = Buffer.from(f.payloads.get(pkg.file));
    wrong[0] ^= 1;
    f.remote.seedAsset(release, pkg.file, wrong, { digest: null });
    f.remote.redirectDownloads = true;
    await assert.rejects(() => f.run(), /checksum/i);
    assert.equal(release.draft, true);
    assert.deepEqual(f.remote.mutations, []);
  });

  test('an existing package tag pointing to another commit blocks publication', async t => {
    const f = await fixture(t);
    f.remote.tags.set(packageTag(f.receipt.packages[0]), { type: 'commit', sha: 'f'.repeat(40) });
    await assert.rejects(() => f.run());
    assert.equal(f.remote.releases.size, 0);
    assert.deepEqual(f.remote.mutations, []);
  });

  test('an annotated tag is not accepted as a verified lightweight source tag', async t => {
    const f = await fixture(t);
    f.remote.tags.set(packageTag(f.receipt.packages[0]), { type: 'tag', sha: commit });
    await assert.rejects(() => f.run());
    assert.deepEqual(f.remote.mutations, []);
  });

  test('a release targeting the wrong source commit blocks publication without mutation', async t => {
    const f = await fixture(t);
    f.remote.seedRelease(f.receipt.packages[0], { target_commitish: 'f'.repeat(40) });
    await assert.rejects(() => f.run());
    assert.deepEqual(f.remote.mutations, []);
  });

  for (const status of [401, 403, 500]) {
    test(`release lookup HTTP ${status} is not mistaken for absence`, async t => {
      const f = await fixture(t);
      f.remote.lookupStatus = status;
      await assert.rejects(() => f.run());
      assert.equal(f.remote.releases.size, 0);
      assert.deepEqual(f.remote.mutations, []);
      assert.equal(f.remote.requests.some(call => new URL(call.url).pathname === `${apiPath}/releases`), false);
    });
  }

  test('does not repair a published release with missing assets', async t => {
    const f = await fixture(t);
    const release = f.remote.seedRelease(f.receipt.packages[0], { draft: false });
    await assert.rejects(() => f.run());
    assert.equal(release.draft, false);
    assert.deepEqual(f.remote.mutations, []);
  });

  test('a published release without its exact source tag is rejected without mutation', async t => {
    const f = await fixture(t);
    await f.run();
    f.remote.tags.delete(packageTag(f.receipt.packages[0]));
    const mutations = f.remote.mutations.length;
    await assert.rejects(() => f.run());
    assert.equal(f.remote.mutations.length, mutations);
  });

  test('never removes a starter asset from an already published release', async t => {
    const f = await fixture(t);
    const pkg = f.receipt.packages[0];
    const release = f.remote.seedRelease(pkg, { draft: false });
    f.remote.seedAsset(release, pkg.file, Buffer.alloc(0), { state: 'starter', digest: null });
    await assert.rejects(() => f.run());
    assert.deepEqual(f.remote.mutations, []);
    assert.deepEqual(f.remote.deleted, []);
  });

  for (const npmTag of ['latest', 'next']) {
    test(`maps ${npmTag} and each package version to independent prerelease flags`, async t => {
      const f = await fixture(t, { versions: ['0.3.0', '0.7.1-rc.1', '0.2.4'], selected: [0, 1, 2], npmTag });
      const plans = await f.run({ dryRun: true });
      const expected = npmTag === 'latest' ? [false, true, false] : [true, true, true];
      assert.deepEqual(plans.map(plan => plan.prerelease), expected);
      const releases = await f.run();
      assert.deepEqual(releases.map(release => release.prerelease), expected);
      assertPublished(f);
    });
  }

  test('empty publication receipts return [] without loading archives, source identity, or a token', async t => {
    const f = await fixture(t);
    await writeFile(join(f.artifactsDir, 'published.json'), JSON.stringify({ schemaVersion: 1, packages: [] }));
    f.deps.env = {};
    f.deps.readRelease = () => { throw new Error('unexpected artifact read'); };
    f.deps.sourceIdentity = () => { throw new Error('unexpected source check'); };
    assert.deepEqual(await f.run(), []);
    assert.deepEqual(await f.run({ dryRun: true }), []);
    assert.deepEqual(f.remote.requests, []);
  });

  test('dry-run validates and returns per-package plans without credentials or remote requests', async t => {
    const f = await fixture(t, { selected: [2, 0] });
    f.deps.env = {};
    const plans = await f.run({ dryRun: true });
    const packages = selectedPackages(f);
    assert.equal(plans.length, packages.length);
    for (const [index, plan] of plans.entries()) {
      const pkg = packages[index];
      assert.equal(plan.repo, repositoryName);
      assert.equal(plan.commit, commit);
      assert.equal(plan.tag, packageTag(pkg));
      assert.equal(plan.name, `${pkg.name}@${pkg.version}`);
      assert.deepEqual(plan.packages, [pkg]);
      assert.deepEqual(plan.assets.map(asset => asset.name), [pkg.file, 'manifest.json']);
      const manifest = plan.assets.find(asset => asset.name === 'manifest.json');
      assert.deepEqual(JSON.parse(manifest.data.toString('utf8')), { ...f.receipt, packages: [pkg] });
      assert.ok(plan.body.includes(`${pkg.name}`));
      assert.ok(plan.body.includes(pkg.version));
      for (const other of f.release.packages) {
        if (other.name !== pkg.name) assert.equal(plan.body.includes(other.name), false);
      }
    }
    assert.deepEqual(f.remote.requests, []);
    assert.ok(f.reads.length > 0);
  });

  test('a nonempty receipt requires credentials before any remote request', async t => {
    const f = await fixture(t);
    f.deps.env = {};
    await assert.rejects(() => f.run(), /GH_TOKEN|GITHUB_TOKEN/u);
    assert.deepEqual(f.remote.requests, []);
  });

  test('accepts GITHUB_TOKEN when GH_TOKEN is absent', async t => {
    const f = await fixture(t);
    delete f.deps.env.GH_TOKEN;
    f.deps.env.GITHUB_TOKEN = 'test-token';
    await f.run();
    assertPublished(f);
  });

  for (const [name, source] of [
    ['dirty checkout', { commit, tree, dirty: true }],
    ['stale checkout commit', { commit: 'e'.repeat(40), tree, dirty: false }],
    ['stale checkout tree', { commit, tree: 'e'.repeat(40), dirty: false }],
  ]) {
    test(`rejects ${name} before any GitHub request`, async t => {
      const f = await fixture(t);
      f.deps.sourceIdentity = () => source;
      await assert.rejects(() => f.run());
      assert.deepEqual(f.remote.requests, []);
    });
  }

  for (const [field, value] of [
    ['version', '9.9.9'], ['file', 'different.tgz'], ['sha256', '0'.repeat(64)],
    ['integrity', `sha512-${Buffer.alloc(64).toString('base64')}`], ['bytes', 1],
  ]) {
    test(`rejects receipt/manifest ${field} disagreement before remote work`, async t => {
      const f = await fixture(t);
      f.receipt.packages.at(-1)[field] = value;
      await f.saveReceipt();
      await assert.rejects(() => f.run());
      assert.deepEqual(f.remote.requests, []);
    });
  }

  test('rejects receipt source that differs from the artifact manifest', async t => {
    const f = await fixture(t);
    f.receipt.source.commit = 'e'.repeat(40);
    await f.saveReceipt();
    await assert.rejects(() => f.run());
    assert.deepEqual(f.remote.requests, []);
  });

  test('rejects a dirty publication receipt', async t => {
    const f = await fixture(t);
    f.receipt.source.dirty = true;
    await f.saveReceipt();
    await assert.rejects(() => f.run());
    assert.deepEqual(f.remote.requests, []);
  });

  for (const [variable, value] of [
    ['GITHUB_REPOSITORY', 'someone-else/repository'],
    ['GITHUB_SHA', 'f'.repeat(40)],
  ]) {
    test(`rejects a conflicting ${variable} rather than publishing in the wrong context`, async t => {
      const f = await fixture(t);
      f.deps.env[variable] = value;
      await assert.rejects(() => f.run());
      assert.deepEqual(f.remote.requests, []);
    });
  }

  test('missing publication receipt fails closed without a remote request', async t => {
    const f = await fixture(t);
    await rm(join(f.artifactsDir, 'published.json'));
    await assert.rejects(() => f.run());
    assert.deepEqual(f.remote.requests, []);
  });

  test('dry-run still rejects receipt/manifest mismatches', async t => {
    const f = await fixture(t);
    f.deps.env = {};
    f.receipt.packages[0].version = '9.9.9';
    await f.saveReceipt();
    await assert.rejects(() => f.run({ dryRun: true }));
    assert.deepEqual(f.remote.requests, []);
  });

  test('validates every selected local tarball before creating even the first release', async t => {
    const f = await fixture(t, { selected: [0, 1, 2] });
    const pkg = f.receipt.packages.at(-1);
    const bytes = Buffer.from(f.payloads.get(pkg.file));
    bytes[0] ^= 1;
    await writeFile(join(f.artifactsDir, pkg.file), bytes);
    await assert.rejects(() => f.run(), /checksum/i);
    assert.deepEqual(f.remote.requests, []);
    assert.equal(f.remote.releases.size, 0);
  });

  test('a missing final selected archive prevents all remote operations', async t => {
    const f = await fixture(t, { selected: [0, 1, 2] });
    await rm(join(f.artifactsDir, f.receipt.packages.at(-1).file));
    await assert.rejects(() => f.run());
    assert.deepEqual(f.remote.requests, []);
  });

  test('an artifact reader verification failure prevents every remote operation', async t => {
    const f = await fixture(t);
    const file = join(f.artifactsDir, f.receipt.packages[0].file);
    await writeFile(file, Buffer.from('corrupted artifact'));
    f.deps.readRelease = async () => {
      const actual = sha256(await readFile(file));
      assert.equal(actual, f.release.packages[0].sha256, 'artifact checksum mismatch');
      return f.release;
    };
    await assert.rejects(() => f.run(), /artifact checksum mismatch/);
    assert.deepEqual(f.remote.requests, []);
  });
});
