import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import {
  artifacts,
  readRelease,
  registry,
  repository,
  sourceIdentity,
} from './release.mjs';
import { checkReleaseVersion, compareStableVersions } from './version-policy.mjs';

function assertDirtyStatusAllowed(statusOutput) {
  assert(
    !statusOutput.trim(),
    `Commit all source changes and regenerate the release before publishing:\n${statusOutput.trimEnd()}`,
  );
}

export function parsePublishOptions(argv = process.argv.slice(2)) {
  const { values } = parseArgs({
    args: argv,
    options: {
      'dry-run': { type: 'boolean', default: false },
      access: { type: 'string' },
      tag: { type: 'string', default: 'latest' },
      'expect-version': { type: 'string' },
      'base-ref': { type: 'string' },
    },
  });
  const dryRun = Boolean(values['dry-run']);
  assert(
    dryRun || values.access,
    'Publishing requires an explicit --access restricted or --access public.',
  );
  assert(dryRun || values['base-ref'], 'Publishing requires an explicit --base-ref.');
  const access = values.access ?? 'public';
  assert(['restricted', 'public'].includes(access), 'Invalid npm access level.');
  assert(/^[a-z][a-z0-9-]*$/u.test(values.tag), 'Use a dist-tag such as latest or next.');
  return {
    dryRun,
    access,
    tag: values.tag,
    version: values['expect-version'],
    baseRef: values['base-ref'],
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

  assert(options.dryRun || options.baseRef, 'Publishing requires an explicit --base-ref.');
  const changed = options.baseRef
    ? (await (deps.checkReleaseVersion ?? checkReleaseVersion)(options.baseRef)).changed
    : null;
  if (changed && changed.length === 0) {
    log('No changed packages to publish.');
    return;
  }
  // A scope-specific .npmrc mapping otherwise takes precedence over --registry.
  const registryArgs = ['--registry', registry, `--@sinestack:registry=${registry}`];
  const release = await loadRelease(undefined, undefined, changed?.map(pkg => pkg.name));
  const changedByName = changed && new Map(changed.map(pkg => [pkg.name, pkg.version]));
  const selected = changedByName
    ? release.packages.filter(pkg => changedByName.has(pkg.name))
    : release.packages;
  if (changedByName) {
    assert.equal(selected.length, changedByName.size, 'Changed packages do not match release artifacts.');
    for (const pkg of selected) {
      assert.equal(pkg.version, changedByName.get(pkg.name), `Version mismatch for ${pkg.name}.`);
    }
  }
  for (const pkg of selected) {
    if (options.version) {
      assert.equal(pkg.version, options.version, 'The requested version differs from the checked-out packages.');
    }
    assert(
      !pkg.version.includes('-') || options.tag !== 'latest',
      'Publish prereleases with --tag next (or another non-latest tag).',
    );
    if (options.tag === 'latest') compareStableVersions(pkg.version, pkg.version);
  }
  if (options.dryRun && !options.baseRef) {
    log(`Dry run validated ${selected.length} package archive(s).`);
    return;
  }

  if (!options.dryRun) {
    const gitStatus = runCommand('git', ['status', '--porcelain', '--untracked-files=all']);
    assert.equal(gitStatus.status, 0, 'Failed to inspect git status.');
    assertDirtyStatusAllowed(gitStatus.stdout);
    const source = getSourceIdentity();
    assert(
      !source.dirty && !release.source.dirty,
      'Commit all source changes and regenerate the release before publishing.',
    );
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

  // Preflight the selected set before writing anything. Matching integrity makes retries safe.
  const pending = [];
  if (options.dryRun) {
    const viewEnv = viewCommandEnv(process.env);
    for (const pkg of selected) {
      const result = runCommand('npm', ['view', `${pkg.name}@${pkg.version}`, 'dist.integrity', '--json', ...registryArgs], { env: viewEnv });
      if (result.status === 0) {
        assert.equal(JSON.parse(result.stdout), pkg.integrity, `${pkg.name}@${pkg.version} already exists with different bytes; choose a new release version.`);
        log(`Already published with matching integrity: ${pkg.name}@${pkg.version}`);
      } else {
        assert(isRegistryNotFound(result.stdout, result.stderr), `Cannot check ${pkg.name}@${pkg.version}; verify npm registry connectivity and read access before retrying.`);
        pending.push(pkg);
      }
    }
  } else {
    const viewEnv = viewCommandEnv(process.env);
    const selectedVersions = new Map(selected.map(pkg => [pkg.name, pkg.version]));
    const workspaceNames = new Set(release.packages.map(pkg => pkg.name));
    const checkedDependencies = new Set();
    for (const pkg of changed) {
      assert(typeof pkg.previousVersion === 'string' && pkg.previousVersion, `Missing base version for ${pkg.name}.`);
      const spec = `${pkg.name}@${pkg.previousVersion}`;
      const previous = runCommand('npm', ['view', spec, 'version', '--json', ...registryArgs], { env: viewEnv });
      assert.equal(previous.status, 0, `Cannot verify previous release ${spec} on npm; retry the earlier release first.`);
      assert.equal(JSON.parse(previous.stdout), pkg.previousVersion, `Cannot verify previous release ${spec} on npm; retry the earlier release first.`);
      checkedDependencies.add(spec);
    }
    for (const pkg of selected) {
      const manifest = release.manifests.find(item => item.name === pkg.name);
      assert(manifest, `Missing manifest for ${pkg.name}.`);
      for (const dependencies of [manifest.dependencies, manifest.optionalDependencies, manifest.peerDependencies]) {
        for (const [name, version] of Object.entries(dependencies ?? {})) {
          if (!workspaceNames.has(name)) continue;
          if (selectedVersions.get(name) === version) continue;
          const spec = `${name}@${version}`;
          if (checkedDependencies.has(spec)) continue;
          const dependency = runCommand('npm', ['view', spec, 'version', '--json', ...registryArgs], { env: viewEnv });
          assert.equal(dependency.status, 0, `Cannot verify required dependency ${spec} on npm.`);
          assert.equal(JSON.parse(dependency.stdout), version, `Cannot verify required dependency ${spec} on npm.`);
          checkedDependencies.add(spec);
        }
      }
    }
    for (const pkg of selected) {
      let latestVersion;
      if (options.tag === 'latest') {
        const latest = runCommand(
          'npm',
          ['view', `${pkg.name}@latest`, 'version', '--json', ...registryArgs],
          { env: viewEnv },
        );
        if (latest.status === 0) {
          latestVersion = JSON.parse(latest.stdout);
          assert(
            compareStableVersions(latestVersion, pkg.version) <= 0,
            `Cannot publish ${pkg.name}@${pkg.version}: latest is newer (${latestVersion}).`,
          );
        } else {
          assert(
            isRegistryNotFound(latest.stdout, latest.stderr),
            `Cannot check ${pkg.name}@latest; verify npm registry connectivity and read access before retrying.`,
          );
        }
      }
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
        assert(
          options.tag !== 'latest' || latestVersion === pkg.version,
          `${pkg.name}@${pkg.version} is already published, but latest does not point to it; restore the dist-tag before retrying.`,
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
  for (const pkg of pending) {
    const args = [
      'publish',
      join(artifacts, pkg.file),
      ...registryArgs,
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
  log(`${options.dryRun ? 'Dry run checked' : 'Published or verified'} ${selected.length} package(s) (${options.access}, tag ${options.tag}).`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await publishReleasePackages(parsePublishOptions(process.argv.slice(2)));
}
