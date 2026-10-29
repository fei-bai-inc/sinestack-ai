import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const toolsArgument = process.argv[2];
if (!toolsArgument) throw new Error('Usage: node tests/workerd/build.mjs <temporary-tools-directory>');
const toolsDirectory = resolve(toolsArgument);
const outputDirectory = join(toolsDirectory, 'viggle-smoke-output');
const repository = fileURLToPath(new URL('../../', import.meta.url));
const fixture = fileURLToPath(new URL('./viggle-worker.mjs', import.meta.url));
const { build } = await import(pathToFileURL(join(toolsDirectory, 'node_modules/esbuild/lib/main.js')).href);

await mkdir(outputDirectory, { recursive: true });
const result = await build({
  absWorkingDir: repository,
  entryPoints: [fixture],
  outfile: join(outputDirectory, 'bundle.mjs'),
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  conditions: ['workerd', 'worker', 'browser'],
  metafile: true,
  logLevel: 'info',
});
await writeFile(join(outputDirectory, 'metafile.json'), JSON.stringify(result.metafile, null, 2));
await writeFile(join(outputDirectory, 'config.capnp'), await readFile(new URL('./config.capnp', import.meta.url)));
const externalImports = Object.values(result.metafile.outputs).flatMap(output => output.imports);
if (externalImports.length !== 0) throw new Error(`Unexpected external bundle imports: ${JSON.stringify(externalImports)}`);
console.log(`Worker bundle and configuration: ${outputDirectory}`);
console.log('External bundle imports: none');
