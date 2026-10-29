import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  assertDirtyStatusAllowed,
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
  };
}

function fakePublishDeps(options = {}) {
  const calls = [];
  const callEnvs = [];
  const logs = [];
  const version = options.version ?? '0.1.0';
  const release = options.release ?? createSampleRelease(version);
  const viewResult =
    options.viewResult ??
    ((spec) => ({
      status: 1,
      stdout: JSON.stringify({ error: { code: 'E404' } }),
      stderr: `npm error code E404\nnpm error 404 '${spec}' is not in this registry.`,
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
        return viewResult(args[1]);
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
  test('publishes all release packages in dry-run mode without querying npm view', async () => {
    const deps = fakePublishDeps({
      viewResult: () => {
        throw new Error('dry-run must not query npm view');
      },
    });

    await publishReleasePackages(
      parsePublishOptions(['--dry-run', '--access', 'public', '--tag', 'latest']),
      deps,
    );

    const publishCalls = deps.calls.filter(
      call => call[0] === 'npm' && call[1] === 'publish',
    );
    assert.equal(publishCalls.length, expectedPackageNames.length);
    for (const call of publishCalls) {
      assert.equal(call.includes('--dry-run'), true);
    }
  });

  test('skips already published packages on retry when registry integrity matches local pack', async () => {
    const published = [];
    const deps = fakePublishDeps({
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
      parsePublishOptions(['--access', 'public', '--tag', 'latest']),
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

  test('aborts retry when an already published version has different tarball integrity', async () => {
    const deps = fakePublishDeps({
      viewResult: () => ({
        status: 0,
        stdout: JSON.stringify('sha512-different=='),
        stderr: '',
      }),
    });

    await assert.rejects(
      () => publishReleasePackages(parsePublishOptions(['--access', 'public']), deps),
      /already exists with different bytes/,
    );
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
        () => publishReleasePackages(parsePublishOptions(['--access', 'public']), deps),
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
      await publishReleasePackages(parsePublishOptions(['--access', 'public']), deps);

      const viewIndex = deps.calls.findIndex(
        call => call[0] === 'npm' && call[1] === 'view',
      );
      const publishIndex = deps.calls.findIndex(
        call => call[0] === 'npm' && call[1] === 'publish',
      );
      assert.equal(deps.callEnvs[viewIndex]?.NODE_AUTH_TOKEN, 'read-only-token');
      assert.equal(deps.callEnvs[viewIndex]?.NPM_TOKEN, 'read-only-token');
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

  test('allows only version.mjs manifest dirtiness when explicitly requested', () => {
    assert.throws(
      () => assertDirtyStatusAllowed(' M package.json\n', false),
      /Commit all source changes/,
    );
    assertDirtyStatusAllowed(
      [
        ' M package-lock.json',
        ' M package.json',
        ' M packages/provider/package.json',
        ' M packages/provider-utils/package.json',
        ' M packages/core/package.json',
        ' M packages/fal/package.json',
        ' M packages/wavespeed/package.json',
        ' M packages/replicate/package.json',
        ' M packages/tripo/package.json',
        ' M packages/core/src/internal/runtime.ts',
        ' M tests/integration.test.mjs',
      ].join('\n'),
      true,
    );
    assert.throws(
      () => assertDirtyStatusAllowed(' M packages/core/src/index.ts\n', true),
      /non-version changes/,
    );
    assert.throws(
      () => assertDirtyStatusAllowed(' M packages/core/src/internal/executor.ts\n', true),
      /non-version changes/,
    );
  });
});
