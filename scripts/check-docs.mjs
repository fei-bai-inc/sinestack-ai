import { readdir, readFile, stat } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ignored = new Set(['.git', 'node_modules', 'dist', 'artifacts', 'coverage']);

async function markdownFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (ignored.has(entry.name) || (entry.name.startsWith('.') && entry.name !== '.github')) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await markdownFiles(path));
    else if (entry.isFile() && /\.md$/iu.test(entry.name)) files.push(path);
  }
  return files.sort();
}

/** Local file links and fenced blocks only; no remote requests or heading-slug checks. */
export async function checkDocumentation(root) {
  root = resolve(root);
  const files = await markdownFiles(root);
  const errors = [];
  for (const file of files) {
    const lines = (await readFile(file, 'utf8')).split(/\r?\n/u);
    let fence;
    const report = (line, message) => errors.push(`${relative(root, file)}:${line}: ${message}`);
    for (const [index, line] of lines.entries()) {
      const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/u.exec(line);
      if (fence) {
        if (marker && marker[1][0] === fence.character && marker[1].length >= fence.length && !marker[2].trim()) fence = undefined;
        continue;
      }
      if (marker) {
        fence = { character: marker[1][0], length: marker[1].length, line: index + 1 };
        continue;
      }
      // Inline code and indented code may contain illustrative, intentionally nonexistent paths.
      if (/^(?: {4}|\t)/u.test(line)) continue;
      const prose = line.replace(/(`+).*?\1/gu, '');
      const targets = [...prose.matchAll(/!?\[[^\]\n]*\]\(\s*(?:<([^>]+)>|([^\s)]+))(?:\s+[^)]*)?\)/gu)].map(match => match[1] ?? match[2]);
      const definition = /^ {0,3}\[[^\]]+\]:\s*(?:<([^>]+)>|(\S+))/u.exec(prose);
      if (definition) targets.push(definition[1] ?? definition[2]);
      for (const target of targets) {
        const localTarget = target.replace(/^https:\/\/github\.com\/fei-bai-inc\/sinestack-ai\/(?:blob|tree)\/main\//u, '/');
        if (/^(?:[a-z][a-z\d+.-]*:|\/\/|#)/iu.test(localTarget)) continue;
        const pathname = localTarget.split(/[?#]/u, 1)[0];
        if (!pathname) continue;
        let decoded;
        try { decoded = decodeURIComponent(pathname); }
        catch { report(index + 1, `Invalid URL encoding: ${target}`); continue; }
        const destination = decoded.startsWith('/') ? resolve(root, `.${decoded}`) : resolve(dirname(file), decoded);
        try { await stat(destination); }
        catch (error) {
          if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error;
          report(index + 1, `Missing local link target: ${target}`);
        }
      }
    }
    if (fence) report(fence.line, 'Unclosed fenced code block');
  }
  return { files: files.length, errors };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = process.argv[2] ?? fileURLToPath(new URL('..', import.meta.url));
  const result = await checkDocumentation(root);
  if (result.errors.length) {
    console.error(result.errors.join('\n'));
    process.exitCode = 1;
  } else {
    console.log(`Checked local file links and code fences in ${result.files} Markdown files.`);
  }
}
