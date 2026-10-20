#!/usr/bin/env node
// Compares the public TypeScript API of the built package (dist/*.d.ts) with the
// last released SDK tarball named in scripts/api-baseline.json. The baseline bytes
// are checked against their pinned SHA-512 before use. Removed exports, a value
// that became type-only, a changed kind, or a type/signature that is no longer
// compatible (checked by tsc itself) are breaking. Breaking changes need a major
// bump (a minor bump while the major is 0); any API change needs a version bump.
// It never publishes, installs or modifies the package.
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath, pathToFileURL } from 'node:url';

const exec = promisify(execFile);
const ROOT = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
function check(condition, message) { if (!condition) throw new Error(message); }
const IDENT = '[A-Za-z_$][A-Za-z0-9_$]*';

/** Top-level export forms tsc emits in declaration files. */
export function parseDeclarations(text) {
  const declared = new Map(), reexports = [], stars = [];
  const add = (name, entry) => {
    const old = declared.get(name);
    declared.set(name, old ? { ...old, value: old.value || entry.value, type: old.type || entry.type, arity: old.arity ?? entry.arity } : entry);
  };
  for (const m of text.matchAll(new RegExp(`^export declare (?:abstract )?(function|const|let|var|class|enum|namespace) (${IDENT})(<)?`, 'gm'))) {
    add(m[2], { value: true, type: m[1] === 'class' || m[1] === 'enum', arity: m[1] === 'class' && m[3] ? typeArity(text, m.index + m[0].length - 1) : undefined });
  }
  for (const m of text.matchAll(new RegExp(`^export (?:declare )?(interface|type) (${IDENT})(<)?`, 'gm'))) {
    add(m[2], { value: false, type: true, arity: m[3] ? typeArity(text, m.index + m[0].length - 1) : undefined });
  }
  for (const m of text.matchAll(/^export (type )?\{([^}]*)\}(?: from '([^']+)')?;/gm)) {
    const names = m[2].split(',').map((s) => s.trim()).filter(Boolean).map((s) => {
      const part = /^(type )?(\S+)(?: as (\S+))?$/.exec(s);
      check(part, `Unrecognised export specifier: ${s}`);
      return { name: part[2], as: part[3] ?? part[2], typeOnly: Boolean(m[1] || part[1]) };
    });
    reexports.push({ from: m[3], names });
  }
  for (const m of text.matchAll(/^export (type )?\* from '([^']+)';/gm)) stars.push({ from: m[2], typeOnly: Boolean(m[1]) });
  check(!/^export \* as /m.test(text) && !/^export default /m.test(text), 'Namespace and default exports are not supported by this checker');
  return { declared, reexports, stars };
}

/** Required type parameters: those without a default, counted at bracket depth 1. */
function typeArity(text, open) {
  let depth = 0, params = [''];
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if ('<([{'.includes(c)) { depth++; if (depth === 1 && c === '<') continue; }
    if ('>)]}'.includes(c) && text[i - 1] !== '=') { depth--; if (depth === 0) break; }
    if (depth === 1 && c === ',') params.push(''); else params[params.length - 1] += c;
  }
  return params.filter((p) => p.trim() && !/=/.test(p.replace(/=>/g, ''))).length;
}

/** Every name an entry point exports, resolved through re-exports. */
export async function entryExports(directory, entry, seen = new Set()) {
  const file = path.join(directory, entry);
  check(!seen.has(file), `Export cycle through ${entry}`);
  const parsed = parseDeclarations(await readFile(file, 'utf8')), result = new Map();
  const resolve = (from) => from.replace(/\.js$/, '.d.ts');
  for (const [name, entryInfo] of parsed.declared) result.set(name, { ...entryInfo, typeOnly: false });
  for (const star of parsed.stars) {
    for (const [name, info] of await entryExports(directory, resolve(star.from), new Set([...seen, file]))) {
      if (!result.has(name)) result.set(name, { ...info, typeOnly: info.typeOnly || star.typeOnly });
    }
  }
  for (const group of parsed.reexports) {
    const source = group.from ? await entryExports(directory, resolve(group.from), new Set([...seen, file])) : result;
    for (const spec of group.names) {
      const info = source.get(spec.name);
      check(info, `${entry} re-exports unknown ${spec.name}`);
      result.set(spec.as, { ...info, typeOnly: info.typeOnly || spec.typeOnly });
    }
  }
  return result;
}

const typeArgs = (arity) => (arity ? `<${Array(arity).fill('any').join(', ')}>` : '');
/** A tsc program in which each line asserts one export stays compatible. */
export function compatibilityProgram(entry, before, after, exempt = new Set()) {
  const lines = [`import type * as Old from './old/${entry.replace(/\.d\.ts$/, '.js')}';`, `import type * as New from './new/${entry.replace(/\.d\.ts$/, '.js')}';`,
    'type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;'];
  const checks = new Map();
  for (const [name, old] of [...before].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const next = after.get(name);
    if (!next || exempt.has(name)) continue;
    if (old.value && next.value) {
      checks.set(lines.length + 1, `${name} (value signature)`);
      lines.push(`export const value_${name}: typeof Old.${name} = null as unknown as typeof New.${name};`);
    }
    if (old.type && next.type && old.arity === next.arity) {
      checks.set(lines.length + 1, `${name} (type)`);
      lines.push(`export const type_${name}: Same<Old.${name}${typeArgs(old.arity)}, New.${name}${typeArgs(next.arity)}> = true;`);
    }
  }
  return { source: `${lines.join('\n')}\n`, checks };
}

/** Removed exports, kind changes and additions, before tsc checks the shared names. */
export function surfaceChanges(before, after) {
  const removed = [], changed = [], added = [];
  for (const [name, old] of before) {
    const next = after.get(name);
    if (!next) { removed.push(name); continue; }
    if (old.value && !old.typeOnly && (!next.value || next.typeOnly)) changed.push(`${name}: runtime value is no longer exported`);
    if (old.type && !next.type) changed.push(`${name}: type is no longer exported`);
    if (old.arity !== next.arity) changed.push(`${name}: required type parameters ${old.arity ?? 0} -> ${next.arity ?? 0}`);
  }
  for (const name of after.keys()) if (!before.has(name)) added.push(name);
  return { removed: removed.sort(), changed: changed.sort(), added: added.sort() };
}

/** Whether a version change permits breaking changes or additions (semver; 0.x treats minor as major). */
export function versionPolicy(baseline, current) {
  const parse = (v) => { const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(v); check(m, `Unsupported version ${v}`); return m.slice(1).map(Number); };
  const [a, b] = [parse(baseline), parse(current)];
  const order = a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
  check(order <= 0, `Package version ${current} is older than the API baseline ${baseline}`);
  return { breakingAllowed: b[0] > a[0] || (a[0] === 0 && b[0] === 0 && b[1] > a[1]), changeAllowed: order < 0 };
}

export function decide(report, policy) {
  const breaking = report.removed.length + report.changed.length > 0, any = breaking || report.added.length > 0;
  if (any && !policy.changeAllowed) return { ok: false, reason: 'The public API changed without a version bump' };
  // An additive release keeps every export, its runtime value and its type-parameter count, even
  // when the version bump would permit more. Types and signatures may still widen.
  const surface = report.removed.length + report.changed.filter((c) => !/ is not compatible with /.test(c)).length;
  if (policy.additiveOnly && surface > 0) return { ok: false, reason: 'This release is declared additive: exports cannot be removed, lose their runtime value or change type-parameter counts' };
  if (breaking && !policy.breakingAllowed) return { ok: false, reason: 'Breaking API changes need a major version bump (a minor bump while the major version is 0)' };
  if (breaking && policy.additiveOnly) return { ok: true, reason: 'Additive release: no export was removed; changed types and signatures are allowed by this version bump' };
  return { ok: true, reason: breaking ? 'Breaking changes are allowed by this version bump' : 'Compatible' };
}

/** Regular files under package/dist ending in .d.ts, from a gzip'd ustar archive. */
export function declarationFiles(tarball) {
  const tar = gunzipSync(tarball, { maxOutputLength: 256 * 1024 * 1024 }), files = new Map();
  for (let offset = 0; offset + 512 <= tar.length;) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((b) => b === 0)) break;
    const field = (s, l) => header.subarray(s, s + l).toString('utf8').replace(/\0.*$/s, '');
    const name = (field(345, 155) ? `${field(345, 155)}/` : '') + field(0, 100), size = Number.parseInt(field(124, 12).trim() || '0', 8), type = field(156, 1) || '0';
    check(Number.isSafeInteger(size) && size >= 0 && (type === '0' || type === '5'), 'Baseline tarball has an unsupported entry');
    const relative = name.startsWith('package/dist/') ? name.slice('package/dist/'.length) : '';
    if (type === '0' && /^[A-Za-z0-9_.-]+\.d\.ts$/.test(relative)) files.set(relative, tar.subarray(offset + 512, offset + 512 + size));
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  return files;
}

/** @param {{ version: string, url: string, integrity: string, exempt?: Record<string, string>, additive?: { version: string, reason: string } }} config
 *  @param {{ tarball?: string, fetchImpl?: typeof fetch }} [options] */
export async function loadBaseline(config, options = {}) {
  const { tarball: localTarball, fetchImpl = fetch } = options;
  check(/^\d+\.\d+\.\d+$/.test(config.version) && /^sha512-[A-Za-z0-9+/]{86}==$/.test(config.integrity), 'Invalid API baseline configuration');
  check(config.exempt === undefined || (typeof config.exempt === 'object' && Object.values(config.exempt).every((why) => typeof why === 'string' && why.length >= 10)), 'Each API exemption needs a stated reason');
  check(config.additive === undefined || (/^\d+\.\d+\.\d+$/.test(config.additive.version ?? '') && typeof config.additive.reason === 'string' && config.additive.reason.length >= 10),
    'An additive release declaration needs a version and a stated reason');
  check(config.url === `https://github.com/roeehrl/course-sdk/releases/download/v${config.version}/course-core-sdk-${config.version}.tgz`, 'API baseline must be a course-sdk release asset');
  let bytes;
  if (localTarball) bytes = await readFile(localTarball);
  else {
    const response = await fetchImpl(config.url, { redirect: 'follow' });
    check(response.ok, `Baseline download failed with HTTP ${response.status}`);
    bytes = Buffer.from(await response.arrayBuffer());
  }
  check(`sha512-${createHash('sha512').update(bytes).digest('base64')}` === config.integrity, 'Baseline tarball does not match its pinned SHA-512');
  return declarationFiles(bytes);
}

/** Runs the whole comparison. `oldFiles` maps .d.ts names to bytes; `newDirectory` holds the built dist. */
export async function compareApi({ oldFiles, newDirectory, entries, baselineVersion, currentVersion, exempt = {}, additiveOnly = false, tsc = path.join(ROOT, 'node_modules/typescript/bin/tsc') }) {
  const scratch = await mkdtemp(path.join(tmpdir(), 'sdk-api-compat-'));
  try {
    await mkdir(path.join(scratch, 'old')); await mkdir(path.join(scratch, 'new'));
    for (const [name, bytes] of oldFiles) await writeFile(path.join(scratch, 'old', name), bytes);
    for (const name of (await readdir(newDirectory)).filter((n) => n.endsWith('.d.ts'))) await writeFile(path.join(scratch, 'new', name), await readFile(path.join(newDirectory, name)));
    const report = { removed: [], changed: [], added: [], incompatible: [] }, programs = [];
    for (const entry of entries) {
      const before = await entryExports(path.join(scratch, 'old'), entry), after = await entryExports(path.join(scratch, 'new'), entry);
      const changes = surfaceChanges(before, after), label = entry === 'index.d.ts' ? '' : `${entry.replace(/\.d\.ts$/, '')}:`;
      for (const key of ['removed', 'changed', 'added']) report[key].push(...changes[key].map((n) => label + n));
      const program = compatibilityProgram(entry, before, after, new Set(Object.keys(exempt))), file = `check-${entry.replace(/\.d\.ts$/, '')}.ts`;
      await writeFile(path.join(scratch, file), program.source);
      programs.push({ file, label, checks: program.checks });
    }
    await writeFile(path.join(scratch, 'tsconfig.json'), JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext', strict: true,
      exactOptionalPropertyTypes: true, noEmit: true, skipLibCheck: true, types: [], typeRoots: [], paths: { '*': [`${path.join(ROOT, 'node_modules')}/*`] } },
      files: programs.map((p) => p.file) }));
    let output = '';
    try { await exec(process.execPath, [tsc, '-p', path.join(scratch, 'tsconfig.json'), '--pretty', 'false'], { cwd: scratch, maxBuffer: 16 * 1024 * 1024 }); }
    catch (error) { output = `${error.stdout ?? ''}${error.stderr ?? ''}`; check(output, 'tsc failed without diagnostics'); }
    for (const line of output.split('\n')) {
      const m = /^(?:\S*\/)?(check-[A-Za-z0-9_-]+\.ts)\((\d+),\d+\): error/.exec(line);
      if (!m) { check(!/error TS/.test(line), `tsc could not load the API declarations: ${line.slice(0, 300)}`); continue; }
      const program = programs.find((p) => p.file === m[1]), name = program?.checks.get(Number(m[2]));
      check(name, `tsc reported an error outside an API assertion: ${line.slice(0, 300)}`);
      if (!report.incompatible.includes(program.label + name)) report.incompatible.push(program.label + name);
    }
    report.changed.push(...report.incompatible.map((n) => `${n} is not compatible with ${baselineVersion}`));
    report.changed.sort();
    return { ...report, ...decide(report, { ...versionPolicy(baselineVersion, currentVersion), additiveOnly }), baseline: baselineVersion, current: currentVersion };
  } finally { await rm(scratch, { recursive: true, force: true }); }
}

export async function main(args = process.argv.slice(2)) {
  check(args.length === 0 || (args.length === 2 && args[0] === '--baseline-tarball'), 'Use: api-compat.mjs [--baseline-tarball <path>]');
  const config = JSON.parse(await readFile(path.join(ROOT, 'scripts/api-baseline.json'), 'utf8'));
  const manifest = JSON.parse(await readFile(path.join(ROOT, 'package.json'), 'utf8'));
  const entries = Object.values(manifest.exports).filter((e) => typeof e === 'object' && e.types).map((e) => path.basename(e.types));
  check(entries.length > 0, 'No typed package entry points');
  const result = await compareApi({ oldFiles: await loadBaseline(config, { tarball: args[1] }), newDirectory: path.join(ROOT, 'dist'), entries, baselineVersion: config.version, currentVersion: manifest.version, exempt: config.exempt ?? {},
    additiveOnly: config.additive?.version === manifest.version });
  for (const key of ['removed', 'changed', 'added']) console.log(`${key} (${result[key].length})${result[key].length ? `:\n  ${result[key].join('\n  ')}` : ''}`);
  console.log(`API ${result.baseline} -> ${result.current}: ${result.reason}.`);
  check(result.ok, result.reason);
  return result;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => { console.error(`API compatibility check failed: ${error.message}`); process.exitCode = 1; });
}
