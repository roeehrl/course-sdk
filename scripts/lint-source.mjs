#!/usr/bin/env node
// Repository source rules that the type checker cannot express. Runs on src, tests and scripts and
// prints every violation as file:line rule message; exits 1 when there is any. `--self-test` checks
// that each rule still fires on a small bad sample. It reads files only.
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
/** The portable main entry: browser and native consumers import it, so nothing it reaches may use Node. */
const PORTABLE_ENTRY = 'src/index.ts';

const RULES = [
  { id: 'no-eval', files: /^(src|scripts)\//, pattern: /(?<![\w.'"`])eval\s*\(|new\s+Function\s*\(/, message: 'Code generation from strings is not allowed.' },
  { id: 'no-debugger', files: /^(src|tests|scripts)\//, pattern: /^\s*debugger\s*;?\s*$/, message: 'Remove debugger statements.' },
  { id: 'no-focused-tests', files: /^tests\//, pattern: /\b(?:it|describe|test)\.only\s*\(/, message: 'Focused tests skip the rest of the suite.' },
  { id: 'no-ts-suppression', files: /^(src|tests)\//, pattern: /@ts-(?:ignore|nocheck)\b/, message: 'Fix the type error instead of suppressing it (@ts-expect-error documents an intended one).' },
  { id: 'no-console-in-library', files: /^src\/(?!cli\.ts$)/, pattern: /\bconsole\.(?:log|info|debug|warn|error|trace)\s*\(/, message: 'Library code returns data; only the CLI writes to the console.' },
  { id: 'no-attribution', files: /^(src|tests|scripts|docs|examples)\/|^README\.md$|^CHANGELOG\.md$/, pattern: /Co-Authored-By:|Generated with \[?Claude|🤖 Generated/i, message: 'Do not add model or agent attribution (AGENTS.md).' },
  { id: 'no-trailing-whitespace', files: /\.(?:ts|mjs|json|ya?ml)$/, pattern: /[ \t]+$/, message: 'Trailing whitespace.' },
];

async function files(directory, relative = '') {
  const out = [];
  for (const entry of await readdir(path.join(directory, relative), { withFileTypes: true })) {
    if (['node_modules', '.git', 'dist', 'generated'].includes(entry.name)) continue;
    const name = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...await files(directory, name));
    else if (entry.isFile() && /\.(?:ts|mjs|js|json|md|ya?ml)$/.test(entry.name)) out.push(name);
  }
  return out;
}

export function lintText(name, text) {
  const problems = [];
  const lines = text.split('\n');
  for (const rule of RULES) {
    if (!rule.files.test(name)) continue;
    lines.forEach((line, i) => { if (rule.pattern.test(line)) problems.push(`${name}:${i + 1} ${rule.id} ${rule.message}`); });
  }
  return problems;
}

/** Relative imports reachable from the portable entry, and any node: or Node-only module they use. */
export async function portableImportProblems(root, entry = PORTABLE_ENTRY) {
  const problems = [], seen = new Set(), queue = [entry];
  while (queue.length) {
    const file = queue.shift();
    if (seen.has(file)) continue;
    seen.add(file);
    const text = await readFile(path.join(root, file), 'utf8');
    for (const match of text.matchAll(/^(?:import|export)\s(?:(type)\s)?[^'";]*?from\s+'([^']+)'/gm)) {
      const [, typeOnly, specifier] = match;
      if (typeOnly) continue; // erased at build time
      const line = text.slice(0, match.index).split('\n').length;
      if (specifier.startsWith('node:') || ['fs', 'path', 'crypto', 'child_process', 'http', 'net', 'os', 'zlib', 'url'].includes(specifier))
        problems.push(`${file}:${line} portable-entry ${PORTABLE_ENTRY} reaches the Node module ${specifier}; move it to the compiler entry.`);
      else if (specifier.startsWith('.')) {
        const target = path.posix.normalize(path.posix.join(path.posix.dirname(file), specifier.replace(/\.js$/, '.ts')));
        if (!target.startsWith('src/generated/')) queue.push(target);
      }
    }
  }
  return problems;
}

async function selfTest() {
  const samples = [
    ['src/a.ts', 'const x = eval("1");', 'no-eval'], ['src/a.ts', 'const f = new Function("return 1");', 'no-eval'],
    ['tests/a.test.ts', "it.only('x', () => {});", 'no-focused-tests'], ['src/a.ts', '// @ts-ignore', 'no-ts-suppression'],
    ['src/a.ts', 'console.log(1);', 'no-console-in-library'], ['src/a.ts', '  debugger;', 'no-debugger'],
    ['README.md', 'Co-Authored-By: someone', 'no-attribution'], ['src/a.ts', 'const x = 1; ', 'no-trailing-whitespace'],
  ];
  for (const [name, text, rule] of samples) if (!lintText(name, text).some(p => p.includes(` ${rule} `))) throw new Error(`Rule ${rule} did not fire on ${name}.`);
  for (const [name, text] of [['src/cli.ts', 'console.log(1);'], ['src/a.ts', 'const medieval = retrieval(1);'], ['tests/a.test.ts', "it('only', () => {});"]])
    if (lintText(name, text).length) throw new Error(`False positive on ${name}: ${text}`);
  process.stdout.write('lint-source self-test passed\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--self-test')) await selfTest();
  else {
    const problems = [];
    for (const name of await files(ROOT)) {
      if (!/^(src|tests|scripts|docs|examples)\/|^(README|CHANGELOG)\.md$|^\.github\//.test(name)) continue;
      if (name === 'scripts/lint-source.mjs') continue; // its rule patterns and samples would match themselves
      problems.push(...lintText(name, await readFile(path.join(ROOT, name), 'utf8')));
    }
    problems.push(...await portableImportProblems(ROOT));
    for (const problem of problems) process.stderr.write(`${problem}\n`);
    process.stdout.write(problems.length ? `${problems.length} lint problem(s)\n` : 'lint-source: no problems\n');
    process.exitCode = problems.length ? 1 : 0;
  }
}
