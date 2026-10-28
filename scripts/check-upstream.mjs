#!/usr/bin/env node
/**
 * Check the reviewed AI SDK source snapshot against installed npm packages.
 * This script only reads local files. It never downloads or rewrites a baseline.
 * Copyright 2026 Sine AI contributors.
 * SPDX-License-Identifier: Apache-2.0
 */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const requireFromWorkspace = createRequire(resolve(root, 'package.json'));
const manifestPath = resolve(root, 'upstream.json');

function validateManifest(manifest) {
  if (manifest?.schemaVersion !== 1 || !Array.isArray(manifest.packages) || manifest.packages.length === 0) {
    throw new Error('upstream.json must have schemaVersion 1 and a non-empty packages array.');
  }

  const packageNames = new Set();
  for (const entry of manifest.packages) {
    if (typeof entry?.name !== 'string' || !/^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/.test(entry.name)) {
      throw new Error('Invalid package name in upstream.json.');
    }
    if (packageNames.has(entry.name)) {
      throw new Error('Duplicate upstream package: ' + entry.name);
    }
    packageNames.add(entry.name);
    if (typeof entry.version !== 'string' || entry.version.length === 0 || typeof entry.license !== 'string') {
      throw new Error('Missing version or license for ' + entry.name + '.');
    }
    if (!Array.isArray(entry.files) || entry.files.length === 0) {
      throw new Error('No reviewed source files for ' + entry.name + '.');
    }

    const paths = new Set();
    for (const file of entry.files) {
      if (typeof file?.path !== 'string' || isAbsolute(file.path) || file.path.includes('\\') ||
          file.path.split('/').some(part => part === '' || part === '.' || part === '..')) {
        throw new Error('Source paths must be relative to their npm package: ' + entry.name);
      }
      if (paths.has(file.path)) {
        throw new Error('Duplicate source path: ' + entry.name + '/' + file.path);
      }
      paths.add(file.path);
      if (typeof file.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(file.sha256)) {
        throw new Error('Invalid SHA-256: ' + entry.name + '/' + file.path);
      }
    }
  }
}

async function main() {
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  validateManifest(manifest);
  const failures = [];
  let checkedFiles = 0;

  for (const entry of manifest.packages) {
    let packageJsonPath;
    let installed;
    try {
      packageJsonPath = requireFromWorkspace.resolve(entry.name + '/package.json');
      installed = JSON.parse(await readFile(packageJsonPath, 'utf8'));
    } catch (error) {
      failures.push(entry.name + ': cannot read the installed package. Run npm ci first. ' + error.message);
      continue;
    }

    if (installed.name !== entry.name) {
      failures.push(entry.name + ': resolved package name is ' + JSON.stringify(installed.name));
    }
    if (installed.version !== entry.version) {
      failures.push(entry.name + ': version drift; expected ' + entry.version + ', installed ' + installed.version);
    }
    if (installed.license !== entry.license) {
      failures.push(entry.name + ': license drift; expected ' + entry.license + ', installed ' + JSON.stringify(installed.license));
    }

    const packageRoot = dirname(packageJsonPath);
    for (const file of entry.files) {
      const sourcePath = resolve(packageRoot, file.path);
      const relativePath = relative(packageRoot, sourcePath);
      if (isAbsolute(relativePath) || relativePath === '..' || relativePath.startsWith('../') || relativePath.startsWith('..\\')) {
        failures.push(entry.name + '/' + file.path + ': path escapes the installed package.');
        continue;
      }
      try {
        const contents = await readFile(sourcePath);
        const actual = createHash('sha256').update(contents).digest('hex');
        checkedFiles += 1;
        if (actual !== file.sha256) {
          failures.push(entry.name + '/' + file.path + ': source drift\n  expected ' + file.sha256 + '\n  actual   ' + actual);
        }
      } catch (error) {
        failures.push(entry.name + '/' + file.path + ': cannot read reviewed source. ' + error.message);
      }
    }
  }

  if (failures.length > 0) {
    console.error('Upstream verification failed:\n\n' + failures.join('\n\n'));
    console.error('\nReview the upstream changes and docs/UPSTREAM.md before updating upstream.json.');
    process.exitCode = 1;
    return;
  }

  console.log('Upstream verified: ' + manifest.packages.length + ' exact package versions/licenses and ' + checkedFiles + ' SHA-256 source hashes.');
}

main().catch(error => {
  console.error('Upstream verification failed: ' + error.message);
  process.exitCode = 1;
});
