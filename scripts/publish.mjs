import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import {
  artifacts,
  packageDirectories,
  readRelease,
  registry,
  repository,
  sourceIdentity,
} from './release.mjs';

export const ALLOWED_VERSION_DIRTY_PATHS = new Set([
  'package.json',
  'package-lock.json',
  ...packageDirectories.map(name => `packages/${name}/package.json`),
  'packages/core/src/internal/executor.ts',
  'tests/integration.test.mjs',
]);

export function assertDirtyStatusAllowed(statusOutput, allowVersionDirty) {
  const lines = statusOutput
    .split('\n')
    .map(line => line.trimEnd())
    .filter(Boolean);
  if (lines.length === 0) {
    return;
  }
  assert(
    allowVersionDirty,
    `Commit all source changes and regenerate the release before publishing:\n${lines.join('\n')}`,
  );
  const disallowed = [];
  for (const line of lines) {
    const filePath = line.slice(3).trim();
    if (line.startsWith('??') || !ALLOWED_VERSION_DIRTY_PATHS.has(filePath)) {
      disallowed.push(line);
    }
  }
  assert.equal(
    disallowed.length,
    0,
    `Refusing to publish: working tree contains non-version changes:\n${disallowed.join('\n')}`,
  );
}

export function parsePublishOptions(argv = process.argv.slice(2)) {
  const { values } = parseArgs({
    args: argv,
    options: {
      'dry-run': { type: 'boolean', default: false },
      access: { type: 'string' },
      tag: { type: 'string', default: 'latest' },
      version: { type: 'string' },
      'expect-version': { type: 'string' },
      'allow-version-dirty': { type: 'boolean', default: false },
    },
  });
  const dryRun = Boolean(values['dry-run']);
  assert(
    dryRun || values.access,
    'Publishing requires an explicit --access restricted or --access public.',
  );
  const access = values.access ?? 'public';
  assert(['restricted', 'public'].includes(access), 'Invalid npm access level.');
  assert(/^[a-z][a-z0-9-]*$/u.test(values.tag), 'Use a dist-tag such as latest or next.');
  return {
    dryRun,
    access,
    tag: values.tag,
    version: values['expect-version'] ?? values.version,
    allowVersionDirty: Boolean(values['allow-version-dirty']),
  };
}

function defaultRunCommand(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repository,
    encoding: 'utf8',
    stdio: options.inherit ? 'inherit' : 'pipe',
    env: options.env ?? process.env,
  });
  if (result.error) throw result.error;
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

function viewCommandEnv(baseEnv = process.env) {
  const readToken = baseEnv.NPM_READ_TOKEN?.trim();
  if (!readToken) return { ...baseEnv };
  return {
    ...baseEnv,
    NODE_AUTH_TOKEN: readToken,
    NPM_TOKEN: readToken,
  };
}

function publishCommandEnv(baseEnv = process.env) {
  const env = { ...baseEnv };
  delete env.NPM_READ_TOKEN;
  delete env.NODE_AUTH_TOKEN;
  delete env.NPM_TOKEN;
  return env;
}

function isRegistryNotFound(stdout, stderr) {
  const combined = `${stdout}\n${stderr}`;
  if (/npm (?:error|ERR!) code E404\b/u.test(combined) || /\b404 Not Found\b/u.test(combined)) {
    return true;
  }
  try {
    const parsed = JSON.parse(stdout);
    return parsed?.error?.code === 'E404';
  } catch {
    return false;
  }
}

export async function publishReleasePackages(options, deps = {}) {
  const runCommand = deps.runCommand ?? defaultRunCommand;
  const log = deps.log ?? console.log;
  const loadRelease = deps.readRelease ?? readRelease;
  const getSourceIdentity = deps.sourceIdentity ?? sourceIdentity;

  // A scope-specific .npmrc mapping otherwise takes precedence over --registry.
  const registryArgs = ['--registry', registry, `--@sinestack:registry=${registry}`];
  const release = await loadRelease();
  const version = release.packages[0].version;
  if (options.version) {
    assert.equal(
      version,
      options.version,
      'The requested version differs from the checked-out packages.',
    );
  }
  assert(
    !version.includes('-') || options.tag !== 'latest',
    'Publish prereleases with --tag next (or another non-latest tag).',
  );

  if (!options.dryRun) {
    const gitStatus = runCommand('git', ['status', '--porcelain', '--untracked-files=all']);
    assert.equal(gitStatus.status, 0, 'Failed to inspect git status.');
    assertDirtyStatusAllowed(gitStatus.stdout, options.allowVersionDirty);
    const source = getSourceIdentity();
    if (!options.allowVersionDirty) {
      assert(
        !source.dirty && !release.source.dirty,
        'Commit all source changes and regenerate the release before publishing.',
      );
    }
    assert.equal(release.source.commit, source.commit, 'Tarballs were built from a different commit.');
    assert.equal(release.source.tree, source.tree, 'Tarballs were built from a different source tree.');
    const npmVersionRes = runCommand('npm', ['--version']);
    assert.equal(npmVersionRes.status, 0, 'Failed to check npm version.');
    const npmVersion = npmVersionRes.stdout.trim().split('.').map(Number);
    assert(
      npmVersion[0] > 11 ||
        (npmVersion[0] === 11 && (npmVersion[1] > 5 || (npmVersion[1] === 5 && npmVersion[2] >= 1))),
      'Publishing requires npm >=11.5.1 for trusted publishing.',
    );
  }

  // Check the whole set before writing anything on real releases. A retry may skip an
  // exact match, but must never silently replace a version published from different bytes.
  const pending = [];
  if (options.dryRun) {
    pending.push(...release.packages);
  } else {
    const viewEnv = viewCommandEnv(process.env);
    for (const pkg of release.packages) {
      const result = runCommand(
        'npm',
        ['view', `${pkg.name}@${pkg.version}`, 'dist.integrity', '--json', ...registryArgs],
        { env: viewEnv },
      );
      if (result.status === 0) {
        assert.equal(
          JSON.parse(result.stdout),
          pkg.integrity,
          `${pkg.name}@${pkg.version} already exists with different bytes; choose a new release version.`,
        );
        log(`Already published with matching integrity: ${pkg.name}@${pkg.version}`);
        continue;
      }
      assert(
        isRegistryNotFound(result.stdout, result.stderr),
        `Cannot check ${pkg.name}@${pkg.version}; verify npm registry connectivity and read access before retrying.`,
      );
      pending.push(pkg);
    }
  }

  const pubEnv = publishCommandEnv(process.env);
  const bootstrapToken = process.env.NPM_BOOTSTRAP_TOKEN?.trim();
  for (const pkg of pending) {
    const args = [
      'publish',
      join(artifacts, pkg.file),
      ...registryArgs,
      ...(bootstrapToken ? [`--//registry.npmjs.org/:_authToken=${bootstrapToken}`] : []),
      '--access',
      options.access,
      '--tag',
      options.tag,
      '--ignore-scripts',
    ];
    if (options.dryRun) args.push('--dry-run');
    const result = runCommand('npm', args, { env: pubEnv, inherit: true });
    assert.equal(result.status, 0, `npm publish failed for ${pkg.name}@${pkg.version}`);
  }
  log(
    `${options.dryRun ? 'Dry run checked' : 'Published or verified'} all six packages at ${version} (${options.access}, tag ${options.tag}).`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await publishReleasePackages(parsePublishOptions(process.argv.slice(2)));
}
