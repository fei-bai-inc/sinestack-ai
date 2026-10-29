import { execFileSync } from 'node:child_process';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { artifacts, checksums, inspectArchive, readPackages, repository, sourceIdentity } from './release.mjs';

const packages = await readPackages();
await mkdir(artifacts, { recursive: true });
// A version bump must never leave old archives in the set selected for release.
for (const file of await readdir(artifacts)) {
  if (file.endsWith('.tgz') || file === 'manifest.json') await rm(join(artifacts, file));
}
const manifest = {
  schemaVersion: 1,
  repository: 'https://github.com/fei-bai-inc/sinestack-ai',
  source: sourceIdentity(),
  packages: [],
};
for (const pkg of packages) {
  execFileSync('npm', ['pack', `./packages/${pkg.directory}`, '--pack-destination', artifacts], { cwd: repository, stdio: 'inherit' });
  const file = `${pkg.manifest.name.slice(1).replace('/', '-')}-${pkg.manifest.version}.tgz`;
  const path = join(artifacts, file);
  inspectArchive(path, pkg.manifest);
  manifest.packages.push({
    name: pkg.manifest.name,
    version: pkg.manifest.version,
    file,
    ...checksums(await readFile(path)),
  });
}
await writeFile(join(artifacts, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
