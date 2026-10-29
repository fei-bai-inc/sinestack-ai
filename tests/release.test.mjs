import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  parsePublishOptions,
  publishReleasePackages,
} from '../scripts/publish.mjs';
import {
  packageDirectories,
  readPackages,
  validateVersion,
} from '../scripts/release.mjs';

const sampleIntegrity =
  'sha512-1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef12==';

const expectedPackageNames = [
  '@sinestack/ai-provider',
  '@sinestack/ai-provider-utils',
  '@sinestack/ai-core',
  '@sinestack/ai-fal',
  '@sinestack/ai-wavespeed',
  '@sinestack/ai-replicate',
  '@sinestack/ai-tripo',
];

function createSampleRelease(version = '0.1.0') {
  return {
    schemaVersion: 1,
    repository: 'https://github.com/fei-bai-inc/sinestack-ai',
    source: {
      commit: 'abc1234',
      tree: 'def5678',
      dirty: false,
    },
    packages: expectedPackageNames.map(name => ({
      name,
      version,
      file: `${name.slice(1).replace('/', '-')}-${version}.tgz`,
      sha256: '0123456789abcdef',
      integrity: sampleIntegrity,
      bytes: 1024,
    })),
    manifests: expectedPackageNames.map(name => ({ name, version, dependencies: {} })),
  };
}

function fakePublishDeps(options = {}) {
  const calls = [];
  const callEnvs = [];
  const logs = [];
  const version = options.version ?? '0.1.0';
  const release = options.release ?? createSampleRelease(version);
  const changed = (options.changed ?? release.packages).map(pkg => ({ ...pkg, previousVersion: pkg.previousVersion ?? '0.0.1' }));
  const viewResult =
    options.viewResult ??
    ((spec) => ({
      status: 1,
      stdout: JSON.stringify({ error: { code: 'E404' } }),
      stderr: `npm error code E404\nnpm error 404 '${spec}' is not in this registry.`,
    }));
  const latestResult = options.latestResult ?? ((spec) => ({
    status: 1,
    stdout: JSON.stringify({ error: { code: 'E404' } }),
    stderr: `npm error code E404\n npm error 404 '${spec}' is not in this registry.`,
  }));
  const publishResult =
    options.publishResult ?? (() => ({ status: 0, stdout: '', stderr: '' }));

  return {
    calls,
    callEnvs,
    logs,
    log: message => {
      logs.push(message);
    },
    readRelease: async () => release,
    checkReleaseVersion: async () => ({ changed }),
    sourceIdentity: () =>
      options.source ?? {
        commit: release.source.commit,
        tree: release.source.tree,
        dirty: false,
      },
    runCommand: (command, args, runOptions) => {
      calls.push([command, ...args]);
      callEnvs.push({ ...runOptions?.env });
      if (command === 'git' && args[0] === 'status') {
        return { status: 0, stdout: options.gitStatus ?? '', stderr: '' };
      }
      if (command === 'npm' && args[0] === '--version') {
        return { status: 0, stdout: options.npmVersion ?? '11.6.0\n', stderr: '' };
      }
      if (command === 'npm' && args[0] === 'view') {
        if (args[2] !== 'version') return viewResult(args[1]);
        if (args[1].endsWith('@0.0.1')) return (options.previousResult ?? (() => ({ status: 0, stdout: JSON.stringify('0.0.1'), stderr: '' })))(args[1]);
        return args[1].endsWith('@latest') ? latestResult(args[1]) : (options.dependencyResult ?? viewResult)(args[1]);
      }
      if (command === 'npm' && args[0] === 'publish') {
        return publishResult(args[1], args);
      }
      throw new Error(`unexpected command: ${command} ${args.join(' ')}`);
    },
  };
}

describe('release metadata and archive contract', () => {
  test('declares all seven @sinestack/ai-* packages in topological dependency order', async () => {
    assert.deepEqual(packageDirectories, [
      'provider',
      'provider-utils',
      'core',
      'fal',
      'wavespeed',
      'replicate',
      'tripo',
    ]);
    const packages = await readPackages();
    assert.deepEqual(
      packages.map(pkg => pkg.manifest.name),
      expectedPackageNames,
    );
  });

  test('validates release semver strings strictly', () => {
    validateVersion('0.1.0');
    validateVersion('0.2.0-rc.1');
    assert.throws(() => validateVersion('v0.1.0'));
    assert.throws(() => validateVersion('0.1.0-01'));
  });
});

describe('release publish script', () => {
  test('requires a base ref for real publishing', () => {
    assert.throws(() => parsePublishOptions(['--access', 'public']), /--base-ref/);
  });

  test('does nothing for an empty change set without loading artifacts or invoking commands', async () => {
    const deps = fakePublishDeps({ changed: [] });
    deps.readRelease = () => { throw new Error('unexpected artifact read'); };
    await publishReleasePackages(parsePublishOptions(['--base-ref', 'base', '--access', 'public']), deps);
    assert.deepEqual(deps.calls, []);
  });
  test('fails closed before publishing when an earlier release is missing or inaccessible', async () => {
    for (const result of [
      { status: 1, stdout: '', stderr: 'npm error code E404' },
      { status: 1, stdout: '', stderr: 'npm error code E401' },
      { status: 0, stdout: JSON.stringify('0.0.2'), stderr: '' },
    ]) {
      const deps = fakePublishDeps({ previousResult: () => result });
      await assert.rejects(() => publishReleasePackages(parsePublishOptions(['--base-ref', 'base', '--access', 'public']), deps), /retry the earlier release first/);
      assert.equal(deps.calls.some(call => call[1] === 'publish'), false);
    }
  });


  test('publishes only the changed package and checks its exact unchanged dependency', async () => {
    const release = createSampleRelease();
    release.packages[3].version = '0.2.0';
    release.manifests[3].dependencies[expectedPackageNames[2]] = '0.1.0';
    const deps = fakePublishDeps({
      release,
      changed: [release.packages[3]],
      dependencyResult: () => ({ status: 0, stdout: JSON.stringify('0.1.0'), stderr: '' }),
    });
    await publishReleasePackages(parsePublishOptions(['--base-ref', 'base', '--access', 'public']), deps);
    assert.deepEqual(deps.calls.filter(call => call[1] === 'view').map(call => call[2]), [
      '@sinestack/ai-fal@0.0.1', '@sinestack/ai-core@0.1.0', '@sinestack/ai-fal@latest', '@sinestack/ai-fal@0.2.0',
    ]);
    assert.equal(deps.calls.filter(call => call[1] === 'publish').length, 1);
  });
  test('accepts selected exact dependencies in release order and checks older pinned versions', async () => {
    const release = createSampleRelease();
    release.packages[0].version = '0.2.0';
    release.manifests[1].dependencies[expectedPackageNames[0]] = '0.2.0';
    release.manifests[3].dependencies[expectedPackageNames[0]] = '0.1.0';
    const deps = fakePublishDeps({
      release,
      changed: [release.packages[0], release.packages[1], release.packages[3]],
      dependencyResult: () => ({ status: 0, stdout: JSON.stringify('0.1.0'), stderr: '' }),
    });
    await publishReleasePackages(parsePublishOptions(['--base-ref', 'base', '--access', 'public']), deps);
    const views = deps.calls.filter(call => call[1] === 'view');
    assert.equal(views.filter(call => call[2] === '@sinestack/ai-provider@0.1.0').length, 1);
    assert.equal(views.filter(call => call[2] === '@sinestack/ai-provider@0.2.0' && call[3] === 'version').length, 0);
    assert.deepEqual(deps.calls.filter(call => call[1] === 'publish').map(call => call[2].split('/').at(-1)), [
      release.packages[0].file, release.packages[1].file, release.packages[3].file,
    ]);
  });


  test('fails closed when an unchanged exact dependency is missing or inaccessible', async () => {
    for (const result of [
      { status: 1, stdout: '', stderr: 'npm error code E404' },
      { status: 1, stdout: '', stderr: 'npm error code E401' },
      { status: 0, stdout: JSON.stringify('0.2.0'), stderr: '' },
    ]) {
      const release = createSampleRelease();
      release.manifests[3].dependencies[expectedPackageNames[2]] = '0.1.0';
      const deps = fakePublishDeps({ release, changed: [release.packages[3]], dependencyResult: () => result });
      await assert.rejects(() => publishReleasePackages(parsePublishOptions(['--base-ref', 'base', '--access', 'public']), deps), /Cannot verify required dependency/);
      assert.equal(deps.calls.some(call => call[1] === 'publish'), false);
    }
  });

  test('compares latest against each selected package own version', async () => {
    const release = createSampleRelease();
    release.packages[0].version = '0.3.0';
    release.packages[3].version = '0.1.0';
    const deps = fakePublishDeps({
      release,
      changed: [release.packages[0], release.packages[3]],
      latestResult: () => ({ status: 0, stdout: JSON.stringify('0.2.0'), stderr: '' }),
    });
    await assert.rejects(() => publishReleasePackages(parsePublishOptions(['--base-ref', 'base', '--access', 'public']), deps), /ai-fal@0\.1\.0: latest is newer/);
    assert.equal(deps.calls.some(call => call[1] === 'publish'), false);
  });

  test('validates all archives without npm calls in dry-run mode without a base', async () => {
    const deps = fakePublishDeps();
    let loaded = false;
    const load = deps.readRelease;
    deps.readRelease = async (...args) => { loaded = true; return load(...args); };
    await publishReleasePackages(parsePublishOptions(['--dry-run']), deps);
    assert.equal(loaded, true);
    assert.deepEqual(deps.calls, []);
  });

  test('dry-runs only selected unpublished packages after checking all selected integrities', async () => {
    const release = createSampleRelease();
    const deps = fakePublishDeps({ release, changed: [release.packages[1], release.packages[3]] });
    await publishReleasePackages(parsePublishOptions(['--dry-run', '--base-ref', 'base']), deps);
    const views = deps.calls.filter(call => call[1] === 'view');
    const publishes = deps.calls.filter(call => call[1] === 'publish');
    assert.equal(views.length, 2);
    assert.equal(publishes.length, 2);
    assert(publishes.every(call => call.includes('--dry-run')));
    assert(deps.calls.indexOf(views[1]) < deps.calls.indexOf(publishes[0]));
  });

  test('dry-run skips matching published versions and fails closed on mismatches or lookup errors', async () => {
    const release = createSampleRelease();
    for (const result of [
      { status: 0, stdout: JSON.stringify('sha512-different'), stderr: '' },
      { status: 1, stdout: '', stderr: 'npm error code E401' },
    ]) {
      const deps = fakePublishDeps({ release, changed: [release.packages[1]], viewResult: () => result });
      await assert.rejects(() => publishReleasePackages(parsePublishOptions(['--dry-run', '--base-ref', 'base']), deps));
      assert.equal(deps.calls.some(call => call[1] === 'publish'), false);
    }
    const deps = fakePublishDeps({ release, changed: [release.packages[1]], viewResult: () => ({ status: 0, stdout: JSON.stringify(sampleIntegrity), stderr: '' }) });
    await publishReleasePackages(parsePublishOptions(['--dry-run', '--base-ref', 'base']), deps);
    assert.equal(deps.calls.some(call => call[1] === 'publish'), false);
  });

  test('rejects an older release if any package has a newer latest, before publishing', async () => {
    const deps = fakePublishDeps({
      latestResult: spec => ({
        status: 0,
        stdout: JSON.stringify(spec === '@sinestack/ai-replicate@latest' ? '0.10.0' : '0.0.9'),
        stderr: '',
      }),
    });
    await assert.rejects(
      () => publishReleasePackages(parsePublishOptions(['--base-ref', 'base', '--access', 'public']), deps),
      /ai-replicate@0\.1\.0: latest is newer \(0\.10\.0\)/,
    );
    assert.equal(deps.calls.filter(call => call[1] === 'publish').length, 0);
  });

  test('fails closed on latest lookup errors or invalid registry versions', async () => {
    for (const result of [
      { status: 1, stdout: '', stderr: 'npm error code E401' },
      { status: 1, stdout: '', stderr: 'npm error code ECONNREFUSED' },
      { status: 0, stdout: JSON.stringify('not-a-version'), stderr: '' },
      { status: 0, stdout: JSON.stringify('0.2.0-rc.1'), stderr: '' },
    ]) {
      const deps = fakePublishDeps({ latestResult: () => result });
      await assert.rejects(() => publishReleasePackages(parsePublishOptions(['--base-ref', 'base', '--access', 'public']), deps));
      assert.equal(deps.calls.filter(call => call[1] === 'publish').length, 0);
    }
  });

  test('publishes a newer stable release after checking every latest tag', async () => {
    const deps = fakePublishDeps({
      version: '0.10.0',
      latestResult: () => ({ status: 0, stdout: JSON.stringify('0.9.0'), stderr: '' }),
    });
    await publishReleasePackages(parsePublishOptions(['--base-ref', 'base', '--access', 'public']), deps);
    assert.equal(deps.calls.filter(call => call[1] === 'view' && call[2].endsWith('@latest')).length, expectedPackageNames.length);
    assert.equal(deps.calls.filter(call => call[1] === 'publish').length, expectedPackageNames.length);
  });

  test('does not compare latest when publishing a prerelease to another tag', async () => {
    const deps = fakePublishDeps({
      version: '0.1.1-rc.1',
      latestResult: () => { throw new Error('unexpected latest lookup'); },
    });
    await publishReleasePackages(parsePublishOptions(['--base-ref', 'base', '--access', 'public', '--tag', 'next']), deps);
    assert.equal(deps.calls.filter(call => call[1] === 'publish').length, expectedPackageNames.length);
  });

  test('skips already published packages on retry when registry integrity matches local pack', async () => {
    const published = [];
    const deps = fakePublishDeps({
      latestResult: spec => ({
        status: 0,
        stdout: JSON.stringify(spec.includes('ai-provider') ? '0.1.0' : '0.0.9'),
        stderr: '',
      }),
      viewResult: spec =>
        spec.startsWith('@sinestack/ai-provider@') ||
        spec.startsWith('@sinestack/ai-provider-utils@')
          ? { status: 0, stdout: JSON.stringify(sampleIntegrity), stderr: '' }
          : {
              status: 1,
              stdout: JSON.stringify({ error: { code: 'E404' } }),
              stderr: `npm error code E404\nnpm error 404 '${spec}' is not in this registry.`,
            },
      publishResult: tarballPath => {
        published.push(tarballPath);
        return { status: 0, stdout: '', stderr: '' };
      },
    });

    await publishReleasePackages(
      parsePublishOptions(['--base-ref', 'base', '--access', 'public', '--tag', 'latest']),
      deps,
    );

    assert.equal(published.length, expectedPackageNames.length - 2);
    assert.equal(
      deps.logs.some(line =>
        line.includes('Already published with matching integrity: @sinestack/ai-provider@0.1.0'),
      ),
      true,
    );
  });

  test('fails before publishing if a matching retry has a moved latest tag', async () => {
    const deps = fakePublishDeps({
      latestResult: () => ({ status: 0, stdout: JSON.stringify('0.0.9'), stderr: '' }),
      viewResult: () => ({ status: 0, stdout: JSON.stringify(sampleIntegrity), stderr: '' }),
    });
    await assert.rejects(() => publishReleasePackages(parsePublishOptions(['--base-ref', 'base', '--access', 'public']), deps), /latest does not point to it/);
    assert.equal(deps.calls.some(call => call[1] === 'publish'), false);
  });

  test('aborts retry when an already published version has different tarball integrity', async () => {
    const deps = fakePublishDeps({
      latestResult: () => ({ status: 0, stdout: JSON.stringify('0.1.0'), stderr: '' }),
      viewResult: spec => ({
        status: 0,
        stdout: JSON.stringify(spec.startsWith('@sinestack/ai-replicate@') ? 'sha512-different==' : sampleIntegrity),
        stderr: '',
      }),
    });

    await assert.rejects(
      () => publishReleasePackages(parsePublishOptions(['--base-ref', 'base', '--access', 'public']), deps),
      /already exists with different bytes/,
    );
    assert.equal(deps.calls.filter(call => call[1] === 'publish').length, 0);
  });

  test('treats non-E404 npm view errors as failures instead of unpublished versions', async () => {
    for (const stderr of [
      'npm error code E401\nnpm error 401 Unauthorized - GET https://registry.npmjs.org/@sinestack%2fai-provider',
      'npm error code ECONNREFUSED\nnpm error request to https://registry.npmjs.org failed',
    ]) {
      const deps = fakePublishDeps({
        viewResult: () => ({ status: 1, stdout: '', stderr }),
      });

      await assert.rejects(
        () => publishReleasePackages(parsePublishOptions(['--base-ref', 'base', '--access', 'public']), deps),
        /Cannot check @sinestack\/ai-provider@0\.1\.0/,
      );
    }
  });

  test('passes read token only to npm view and strips it from npm publish', async () => {
    const previousReadToken = process.env.NPM_READ_TOKEN;
    const previousAuthToken = process.env.NODE_AUTH_TOKEN;
    const previousNpmToken = process.env.NPM_TOKEN;
    process.env.NPM_READ_TOKEN = 'read-only-token';
    process.env.NODE_AUTH_TOKEN = 'ambient-publish-token';
    process.env.NPM_TOKEN = 'ambient-npm-token';

    try {
      const deps = fakePublishDeps();
      await publishReleasePackages(parsePublishOptions(['--base-ref', 'base', '--access', 'public']), deps);

      const viewIndex = deps.calls.findIndex(
        call => call[0] === 'npm' && call[1] === 'view',
      );
      const publishIndex = deps.calls.findIndex(
        call => call[0] === 'npm' && call[1] === 'publish',
      );
      assert.equal(deps.callEnvs[viewIndex]?.NODE_AUTH_TOKEN, 'read-only-token');
      assert.equal(deps.callEnvs[viewIndex]?.NPM_TOKEN, 'read-only-token');
      for (let index = 0; index < deps.calls.length; index += 1) {
        const call = deps.calls[index];
        if (call[0] !== 'npm' || call[1] !== 'view') continue;
        assert.equal(deps.callEnvs[index]?.NODE_AUTH_TOKEN, 'read-only-token');
        assert.equal(deps.callEnvs[index]?.NPM_TOKEN, 'read-only-token');
        assert.equal(call.includes('--registry'), true);
        assert.equal(call.some(arg => arg.startsWith('--@sinestack:registry=')), true);
      }
      assert.equal(deps.callEnvs[publishIndex]?.NODE_AUTH_TOKEN, undefined);
      assert.equal(deps.callEnvs[publishIndex]?.NPM_TOKEN, undefined);
    } finally {
      if (previousReadToken === undefined) {
        delete process.env.NPM_READ_TOKEN;
      } else {
        process.env.NPM_READ_TOKEN = previousReadToken;
      }
      if (previousAuthToken === undefined) {
        delete process.env.NODE_AUTH_TOKEN;
      } else {
        process.env.NODE_AUTH_TOKEN = previousAuthToken;
      }
      if (previousNpmToken === undefined) {
        delete process.env.NPM_TOKEN;
      } else {
        process.env.NPM_TOKEN = previousNpmToken;
      }
    }
  });

  test('rejects publishing prerelease versions under the latest dist-tag', async () => {
    const deps = fakePublishDeps({ version: '0.1.1-rc.1' });
    await assert.rejects(
      () =>
        publishReleasePackages(
          parsePublishOptions(['--dry-run', '--expect-version', '0.1.1-rc.1', '--tag', 'latest']),
          deps,
        ),
      /Publish prereleases with --tag next/,
    );
  });

  test('rejects real publishing from an uncommitted version or source tree', async () => {
    for (const gitStatus of [' M package.json\n', ' M packages/core/src/index.ts\n']) {
      const deps = fakePublishDeps({ gitStatus });
      await assert.rejects(
        () => publishReleasePackages(parsePublishOptions(['--base-ref', 'base', '--access', 'public']), deps),
        /Commit all source changes/,
      );
      assert.equal(deps.calls.some(call => call[1] === 'publish'), false);
    }
  });
});
