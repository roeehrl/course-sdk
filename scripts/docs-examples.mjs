#!/usr/bin/env node
// Type-checks and runs the TypeScript examples in README.md and docs/*.md against the built
// package (run `npm run build` first), as an installed consumer would import it. A comment on
// the line before a ```ts fence changes how it is used:
//   <!-- docs-example: skip -->       a fragment that is not a whole program
//   <!-- docs-example: typecheck -->  type-check only (it declares values a host would supply)
//   <!-- docs-example: continue -->   append to the previous example of the same file
// Examples run offline in a temporary directory, without code generation from strings.
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('../', import.meta.url)));

/** The examples of one Markdown document: { line, code, mode }. */
export function extractExamples(markdown) {
  const examples = [];
  const lines = markdown.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (!/^```ts\s*$/.test(lines[i])) continue;
    const directive = /^<!-- docs-example: (skip|typecheck|continue) -->$/.exec(lines[i - 1]?.trim() ?? '')?.[1];
    const start = i + 1;
    let end = start;
    while (end < lines.length && !/^```\s*$/.test(lines[end])) end++;
    if (end === lines.length) throw new Error(`Unclosed code fence at line ${i + 1}.`);
    const code = lines.slice(start, end).join('\n');
    i = end;
    if (directive === 'skip') continue;
    if (directive === 'continue') {
      const previous = examples.at(-1);
      if (!previous) throw new Error(`"continue" at line ${start + 1} has no previous example.`);
      previous.code += `\n${code}`;
      continue;
    }
    examples.push({ line: start + 1, code, mode: directive === 'typecheck' ? 'typecheck' : 'run' });
  }
  return examples;
}

async function documents() {
  const docs = (await readdir(path.join(ROOT, 'docs'))).filter(name => name.endsWith('.md')).sort().map(name => `docs/${name}`);
  return ['README.md', ...docs];
}

async function main() {
  const temp = await mkdtemp(path.join(tmpdir(), 'sdk-docs-examples-'));
  try {
    await writeFile(path.join(temp, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
    await mkdir(path.join(temp, 'node_modules', '@course-core'), { recursive: true });
    await symlink(ROOT, path.join(temp, 'node_modules', '@course-core', 'sdk'), 'dir');
    const all = [];
    for (const document of await documents()) {
      for (const example of extractExamples(await readFile(path.join(ROOT, document), 'utf8'))) {
        const file = `${document.replace(/\W+/g, '-')}-${example.line}.mts`;
        await writeFile(path.join(temp, file), `${example.code}\nexport {};\n`);
        all.push({ ...example, document, file });
      }
    }
    await writeFile(path.join(temp, 'tsconfig.json'), JSON.stringify({ compilerOptions: {
      target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext', strict: true, noEmit: true, skipLibCheck: true,
      types: ['node'], typeRoots: [path.join(ROOT, 'node_modules/@types')], allowImportingTsExtensions: true,
    }, files: all.map(example => example.file) }));
    execFileSync(process.execPath, [path.join(ROOT, 'node_modules/typescript/bin/tsc'), '-p', path.join(temp, 'tsconfig.json')], { cwd: temp, stdio: 'inherit' });
    let ran = 0;
    for (const example of all.filter(e => e.mode === 'run')) {
      try {
        execFileSync(process.execPath, ['--disallow-code-generation-from-strings', '--no-warnings', example.file], { cwd: temp, stdio: ['ignore', 'pipe', 'pipe'], timeout: 30_000,
          env: { PATH: process.env.PATH ?? '', TZ: 'UTC' } });
        ran++;
      } catch (error) {
        throw new Error(`${example.document}:${example.line} failed:\n${error.stderr?.toString() ?? error.message}`);
      }
    }
    process.stdout.write(`docs examples: ${all.length} type-checked, ${ran} run\n`);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
