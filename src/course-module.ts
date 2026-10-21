import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { lstat } from 'node:fs/promises';
import path from 'node:path';

/**
 * 0.6: TypeScript (and JavaScript) course modules. A course module is an ES module whose default
 * export (or `course` export) is the course data, typically built with defineCourse/assembleCourse.
 * `loadCourseModule` evaluates it in a separate, bounded Node process and returns plain JSON data,
 * which the CLI then validates and compiles like a course.json file.
 *
 * The child process runs under Node's permission model: it may read files only inside the course
 * project, and cannot write files, start processes or workers, load native addons or open network
 * connections. Network APIs, randomness and the current time are also replaced with functions that
 * throw, so the same source always gives the same course. It has a time limit, a heap limit and an
 * output limit, and an empty environment (TZ=UTC).
 */
export const COURSE_MODULE_EXTENSIONS: readonly string[] = Object.freeze(['.ts', '.mts', '.js', '.mjs']);
export const COURSE_MODULE_LIMITS = Object.freeze({ timeoutMs: 20_000, outputBytes: 16 * 1024 * 1024, heapMb: 256, logBytes: 8 * 1024 });

export type CourseModuleErrorCode = 'MODULE_UNSUPPORTED' | 'MODULE_FAILED' | 'MODULE_ACCESS_DENIED' | 'MODULE_NONDETERMINISTIC' | 'MODULE_TIMEOUT'
  | 'MODULE_OUTPUT_LIMIT' | 'MODULE_NO_COURSE' | 'MODULE_NOT_JSON';
export class CourseModuleError extends Error {
  constructor(public readonly code: CourseModuleErrorCode, message: string, public readonly logs = '') {
    super(message);
    this.name = 'CourseModuleError';
  }
}

export interface CourseModuleOptions {
  /** Directory the module may read (default: the nearest ancestor with a package.json, else the module's directory). */
  root?: string;
  timeoutMs?: number;
}
export interface LoadedCourseModule {
  /** The exported course data, as plain JSON (not yet validated). */
  course: unknown;
  /** The module's console output (bounded). */
  logs: string;
  root: string;
}

export const isCourseModulePath = (file: string) => COURSE_MODULE_EXTENSIONS.includes(path.extname(file).toLowerCase());

// Runs inside the child. Kept as source text so a bundled CLI needs no extra file on disk.
const RUNNER = String.raw`
const [file, sentinel] = process.argv.slice(1);
const { pathToFileURL } = await import('node:url');
const { syncBuiltinESMExports } = await import('node:module');
const out = process.stdout.write.bind(process.stdout);
const deny = (code, what) => function denied() { const e = new Error('Course modules cannot use ' + what + ' while compiling.'); e.code = code; throw e; };
const lock = (target, key, value) => { try { Object.defineProperty(target, key, { value, writable: false, configurable: false, enumerable: false }); } catch {} };
const network = deny('MODULE_ACCESS_DENIED', 'the network');
const networkApis = { 'node:net': ['connect', 'createConnection', 'createServer'], 'node:tls': ['connect', 'createServer', 'createSecureContext'],
  'node:dgram': ['createSocket'], 'node:http': ['request', 'get', 'createServer'], 'node:https': ['request', 'get', 'createServer'],
  'node:http2': ['connect', 'createServer', 'createSecureServer'],
  'node:dns': ['lookup', 'lookupService', 'resolve', 'resolve4', 'resolve6', 'resolveAny', 'resolveCname', 'resolveMx', 'resolveNs', 'resolveTxt', 'resolveSrv', 'reverse'] };
for (const [name, keys] of Object.entries(networkApis)) {
  const target = (await import(name)).default;
  for (const key of keys) lock(target, key, network);
  if (name === 'node:net') lock(target.Socket.prototype, 'connect', network);
  if (name === 'node:dns') for (const key of keys) if (key in target.promises) lock(target.promises, key, network);
}
for (const key of ['fetch', 'WebSocket', 'EventSource', 'XMLHttpRequest']) lock(globalThis, key, network);
const random = deny('MODULE_NONDETERMINISTIC', 'randomness');
lock(Math, 'random', random);
const crypto = (await import('node:crypto')).default;
for (const key of ['randomBytes', 'randomFill', 'randomFillSync', 'randomInt', 'randomUUID', 'getRandomValues']) lock(crypto, key, random);
if (globalThis.crypto) for (const key of ['randomUUID', 'getRandomValues']) lock(globalThis.crypto, key, random);
syncBuiltinESMExports();
const RealDate = Date;
const clock = deny('MODULE_NONDETERMINISTIC', 'the current time');
const FixedDate = new Proxy(RealDate, {
  apply: clock,
  construct(target, args, newTarget) { if (args.length === 0) clock(); return Reflect.construct(target, args, newTarget); },
});
lock(RealDate, 'now', clock);
lock(globalThis, 'Date', FixedDate);
for (const key of ['log', 'info', 'debug', 'warn', 'error', 'trace', 'dir', 'table']) console[key] = (...args) => process.stderr.write(args.map(String).join(' ') + '\n');
lock(process.stdout, 'write', () => true);
const finish = (result) => { out('\n' + sentinel + JSON.stringify(result)); process.exitCode = 0; };
function check(value, at, depth) {
  if (depth > 64) return at + ': the course is nested too deeply.';
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') return Number.isFinite(value) ? undefined : at + ': numbers must be finite.';
  if (typeof value !== 'object') return at + ': ' + typeof value + ' values are not course data.';
  const proto = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && proto !== Object.prototype && proto !== null) return at + ': only plain objects and arrays are course data.';
  for (const [key, child] of Object.entries(value)) {
    if (child === undefined && !Array.isArray(value)) continue;
    const issue = check(child, at + '/' + key, depth + 1);
    if (issue) return issue;
  }
}
try {
  const loaded = await import(pathToFileURL(file).href);
  const exported = 'default' in loaded ? loaded.default : loaded.course;
  if (exported === undefined) finish({ ok: false, code: 'MODULE_NO_COURSE', message: 'Export the course as the default export or as "course".' });
  else if (typeof exported === 'function') finish({ ok: false, code: 'MODULE_NO_COURSE', message: 'Export the course data itself, not a function that builds it.' });
  else {
    const course = await exported;
    const issue = check(course, '', 0);
    if (issue) finish({ ok: false, code: 'MODULE_NOT_JSON', message: 'The exported course is not JSON data (' + issue + ').' });
    else finish({ ok: true, course });
  }
} catch (error) {
  const code = error && (error.code === 'MODULE_NONDETERMINISTIC' || error.code === 'MODULE_ACCESS_DENIED') ? error.code
    : error && error.code === 'ERR_ACCESS_DENIED' ? 'MODULE_ACCESS_DENIED' : 'MODULE_FAILED';
  const message = error instanceof Error ? error.message : String(error);
  finish({ ok: false, code, message: message.slice(0, 2000) });
}
`;

async function projectRoot(file: string): Promise<string> {
  let directory = path.dirname(file);
  for (;;) {
    if ((await lstat(path.join(directory, 'package.json')).catch(() => undefined))?.isFile()) return directory;
    const parent = path.dirname(directory);
    if (parent === directory) return path.dirname(file);
    directory = parent;
  }
}

/** Evaluates a course module in a sandboxed child process and returns its exported course data. */
export async function loadCourseModule(file: string, options: CourseModuleOptions = {}): Promise<LoadedCourseModule> {
  const target = path.resolve(file);
  if (!isCourseModulePath(target)) throw new CourseModuleError('MODULE_UNSUPPORTED', `Course modules end in ${COURSE_MODULE_EXTENSIONS.join(', ')}.`);
  const stat = await lstat(target);
  if (!stat.isFile()) throw new CourseModuleError('MODULE_UNSUPPORTED', `${file} must be a regular file.`);
  const [major] = process.versions.node.split('.').map(Number);
  if (major! < 24) throw new CourseModuleError('MODULE_UNSUPPORTED', 'Course modules need Node.js 24 or newer (permission model and TypeScript type stripping).');
  const root = path.resolve(options.root ?? await projectRoot(target));
  if (path.relative(root, target).startsWith('..') || path.isAbsolute(path.relative(root, target)))
    throw new CourseModuleError('MODULE_UNSUPPORTED', 'The course module must be inside its project directory.');
  const sentinel = `@@course-module-${randomBytes(16).toString('hex')}@@`;
  const timeoutMs = options.timeoutMs ?? COURSE_MODULE_LIMITS.timeoutMs;
  const child = spawn(process.execPath, [
    '--permission', `--allow-fs-read=${root}`, `--max-old-space-size=${COURSE_MODULE_LIMITS.heapMb}`, '--no-warnings',
    '--disallow-code-generation-from-strings', '--input-type=module', '-e', RUNNER, '--', target, sentinel,
  ], { cwd: root, env: { TZ: 'UTC' }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  const stdout: Buffer[] = [];
  let outBytes = 0, logs = '', failure: CourseModuleError | undefined;
  const stop = (error: CourseModuleError) => { failure ??= error; child.kill('SIGKILL'); };
  const timer = setTimeout(() => stop(new CourseModuleError('MODULE_TIMEOUT', `The course module did not finish within ${timeoutMs} ms.`)), timeoutMs);
  child.stdout.on('data', (chunk: Buffer) => {
    outBytes += chunk.length;
    if (outBytes > COURSE_MODULE_LIMITS.outputBytes) stop(new CourseModuleError('MODULE_OUTPUT_LIMIT', `The course exceeds ${COURSE_MODULE_LIMITS.outputBytes} bytes.`));
    else stdout.push(chunk);
  });
  child.stderr.setEncoding('utf8').on('data', (chunk: string) => { logs = (logs + chunk).slice(-COURSE_MODULE_LIMITS.logBytes); });
  const exit = await new Promise<number | null>((resolve, reject) => { child.on('error', reject); child.on('close', resolve); }).finally(() => clearTimeout(timer));
  if (failure) throw new CourseModuleError(failure.code, failure.message, logs);
  const text = Buffer.concat(stdout).toString('utf8');
  const at = text.lastIndexOf(sentinel);
  if (at < 0) throw new CourseModuleError('MODULE_FAILED', `The course module process ended without a result (exit ${exit ?? 'signal'}).${logs ? ` ${logs.trim().split('\n').at(-1)}` : ''}`, logs);
  const result = JSON.parse(text.slice(at + sentinel.length)) as { ok: true; course: unknown } | { ok: false; code: CourseModuleErrorCode; message: string };
  if (!result.ok) throw new CourseModuleError(result.code, result.message, logs);
  return { course: result.course, logs, root };
}
