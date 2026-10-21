import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { build } from 'esbuild';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { compileCourse, CourseModuleError, loadCourseModule } from '../src/compiler.js';

let root: string, cli: string;
const write = (file: string, text: string) => { mkdirSync(path.dirname(path.join(root, file)), { recursive: true }); writeFileSync(path.join(root, file), text); };
const run = (...args: string[]) => spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: 'utf8', timeout: 60_000 });
const json = (text: string) => JSON.parse(text);

beforeAll(async () => {
  root = mkdtempSync(path.join(tmpdir(), 'course-module-'));
  write('package.json', JSON.stringify({ private: true, type: 'module' }));
  cli = path.join(root, 'cli.mjs');
  await build({ entryPoints: ['src/cli.ts'], bundle: true, platform: 'node', format: 'esm', outfile: cli, logLevel: 'silent' });
  // The SDK as an author installs it, so modules can `import { defineCourse } from '@course-core/sdk'`.
  await build({ entryPoints: ['src/index.ts'], bundle: true, platform: 'neutral', format: 'esm', outfile: path.join(root, 'node_modules/@course-core/sdk/index.js'), logLevel: 'silent' });
  write('node_modules/@course-core/sdk/package.json', JSON.stringify({ name: '@course-core/sdk', type: 'module', exports: { '.': './index.js' } }));
  // A stand-in for the released @course-core/visuals headless entry (same exports, trivial SVG).
  write('node_modules/@course-core/visuals/package.json', JSON.stringify({ name: '@course-core/visuals', version: '0.4.0', type: 'module', exports: { './headless': { import: './dist/headless.js' } } }));
  write('node_modules/@course-core/visuals/dist/headless.js', `export const RENDERER_ID = 'course-core-svg-v1';
export const SUPPORTED_FEATURES = ['gradient', 'layout_set'];
export const fromVisualExperience = v => { if (v.scene.broken) throw new Error('Broken scene'); return v; };
export const evaluateScene = scene => scene;
export const renderSvg = (frame, { idPrefix }) => '<svg id="' + idPrefix + '-scene" data-visual="' + frame.id + '"></svg>';
`);
  write('node_modules/@course-core/visuals/dist/styles.css', '.ccv-scene{display:block}');
  expect(run('init', 'starter', '--typescript', '--locales', 'he').status).toBe(0);
}, 60_000);
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe('TypeScript course modules (K02)', () => {
  it('scaffolds a course.ts that compiles to the same bundle as the equivalent course.json', () => {
    const source = readFileSync(path.join(root, 'starter/course.ts'), 'utf8');
    expect(source).toContain("import type { CourseManifest } from '@course-core/sdk';");
    expect(source).toContain('satisfies CourseManifest;');
    expect(json(run('validate', 'starter').stdout)).toEqual({ valid: true, issues: [] });
    const fromTs = run('compile', 'starter', 'from-ts.json');
    expect(fromTs.status).toBe(0);
    expect(run('init', 'starter-json', '--locales', 'he').status).toBe(0);
    expect(run('compile', 'starter-json', 'from-json.json').status).toBe(0);
    expect(readFileSync(path.join(root, 'from-ts.json'), 'utf8')).toBe(readFileSync(path.join(root, 'from-json.json'), 'utf8'));
  });

  it('loads TypeScript with imports of other .ts files and of the SDK, deterministically', async () => {
    write('dsl/objectives.ts', `import type { Objective } from '@course-core/sdk';
export const objectives: Objective[] = [{ id: 'estimate-mean', description: 'Estimate a mean.', prerequisites: [] }];
`);
    write('dsl/course.ts', `import { assembleCourse, defineCourse } from '@course-core/sdk';
import type { CourseManifest } from '@course-core/sdk';
import { objectives } from './objectives.ts';
import base from '../starter/course.ts';
interface Note { text: string }
const note: Note = { text: 'Built from TypeScript.' };
console.log('building', base.id);
const { locales: _locales, ...source } = base;
const draft: CourseManifest = { ...source, objectives, summary: note.text };
export default defineCourse(assembleCourse(draft));
`);
    const first = await loadCourseModule(path.join(root, 'dsl/course.ts'));
    const second = await loadCourseModule(path.join(root, 'dsl/course.ts'));
    expect(first.logs).toBe('building example-course\n');
    expect(first.root).toBe(realpathSync(root));
    expect(compileCourse(first.course).digest).toBe(compileCourse(second.course).digest);
    expect((first.course as { summary: string }).summary).toBe('Built from TypeScript.');
    // The CLI uses the same loader; the module's console output goes to stderr, never into the JSON.
    const result = run('inspect', 'dsl/course.ts');
    expect(result.status).toBe(0);
    expect(json(result.stdout)).toMatchObject({ valid: true });
    expect(result.stderr).toContain('building example-course');
  });

  it('packs a course directory whose course is a TypeScript module', () => {
    const packed = run('pack', 'starter', '--out', 'starter.course.tgz');
    expect(packed.status, packed.stderr).toBe(0);
    expect(json(run('verify', 'starter.course.tgz').stdout)).toMatchObject({ valid: true, courseId: 'example-course' });
  });

  it.each([
    ['fetch', `await fetch('https://example.invalid/');`, 'MODULE_ACCESS_DENIED'],
    ['a TCP socket', `const net = await import('node:net'); net.connect(80, '192.0.2.1');`, 'MODULE_ACCESS_DENIED'],
    ['a DNS lookup', `const dns = await import('node:dns/promises'); await dns.lookup('example.invalid');`, 'MODULE_ACCESS_DENIED'],
    ['a statically imported DNS lookup', `import { lookup } from 'node:dns/promises'; await lookup('example.invalid');`, 'MODULE_ACCESS_DENIED'],
    ['a statically imported socket', `import { connect } from 'node:net'; connect(80, '192.0.2.1');`, 'MODULE_ACCESS_DENIED'],
    ['a socket created directly', `import { Socket } from 'node:net'; new Socket().connect(80, '192.0.2.1');`, 'MODULE_ACCESS_DENIED'],
    ['an HTTP request', `const http = await import('node:http'); http.get('http://192.0.2.1/');`, 'MODULE_ACCESS_DENIED'],
    ['a file write', `const fs = await import('node:fs'); fs.writeFileSync('owned.txt', 'x');`, 'MODULE_ACCESS_DENIED'],
    ['a file outside the project', `const fs = await import('node:fs'); fs.readFileSync('/etc/hosts');`, 'MODULE_ACCESS_DENIED'],
    ['a child process', `const cp = await import('node:child_process'); cp.execSync('id');`, 'MODULE_ACCESS_DENIED'],
    ['a worker', `const w = await import('node:worker_threads'); new w.Worker('1', { eval: true });`, 'MODULE_ACCESS_DENIED'],
    ['eval', `eval('1 + 1');`, 'MODULE_FAILED'],
    ['Math.random', `Math.random();`, 'MODULE_NONDETERMINISTIC'],
    ['crypto randomness', `crypto.randomUUID();`, 'MODULE_NONDETERMINISTIC'],
    ['the clock', `Date.now();`, 'MODULE_NONDETERMINISTIC'],
    ['the current date', `new Date();`, 'MODULE_NONDETERMINISTIC'],
  ])('refuses %s while compiling', async (_name, code, expected) => {
    write(`bad/${expected}-${_name.replace(/\W+/g, '-')}.ts`, `${code}\nexport default {};\n`);
    const error = await loadCourseModule(path.join(root, `bad/${expected}-${_name.replace(/\W+/g, '-')}.ts`)).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CourseModuleError);
    expect((error as CourseModuleError).code).toBe(expected);
    expect(readFileSync(path.join(root, 'package.json'), 'utf8')).not.toContain('owned');
  });

  it.each([
    ['no export', `export const other = 1;`, 'MODULE_NO_COURSE'],
    ['a function', `export default () => ({});`, 'MODULE_NO_COURSE'],
    ['a class instance', `export default { when: new Map() };`, 'MODULE_NOT_JSON'],
    ['a non-finite number', `export default { n: Infinity };`, 'MODULE_NOT_JSON'],
    ['a syntax error', `export default {`, 'MODULE_FAILED'],
    ['a TypeScript enum (not erasable)', `enum Mode { A }\nexport default { m: Mode.A };`, 'MODULE_FAILED'],
  ])('reports %s', async (name, code, expected) => {
    write(`shapes/${name.replace(/\W+/g, '-')}.ts`, code);
    await expect(loadCourseModule(path.join(root, `shapes/${name.replace(/\W+/g, '-')}.ts`))).rejects.toMatchObject({ code: expected });
  });

  it('stops a module that runs too long and refuses other file types', async () => {
    write('slow/course.ts', 'while (true) {}\nexport default {};\n');
    await expect(loadCourseModule(path.join(root, 'slow/course.ts'), { timeoutMs: 1500 })).rejects.toMatchObject({ code: 'MODULE_TIMEOUT' });
    await expect(loadCourseModule(path.join(root, 'package.json'))).rejects.toMatchObject({ code: 'MODULE_UNSUPPORTED' });
    write('other/course.ts', 'export default {};');
    await expect(loadCourseModule(path.join(root, 'other/course.ts'), { root: path.join(root, 'dsl') })).rejects.toMatchObject({ code: 'MODULE_UNSUPPORTED' });
    const failed = run('validate', 'slow/../bad/MODULE_NONDETERMINISTIC-Math-random.ts');
    expect(failed.status).toBe(1);
    expect(json(failed.stderr)).toMatchObject({ code: 'MODULE_NONDETERMINISTIC' });
  }, 30_000);
});

describe('policy, compatibility and replay commands (K07, K12)', () => {
  it('prints resolved policies, runs fixtures and fails on a mismatch', () => {
    const scopes = json(run('policy', 'starter').stdout);
    expect(scopes.scopes.map((s: { scope: string }) => s.scope)).toEqual(['course', 'chapter:basics', 'episode:mean']);
    write('fixtures.json', JSON.stringify({ policyFixturesFormat: 1, fixtures: [{ id: 'caps', scope: 'episode:mean', steps: [
      { kind: 'work', use: { additionalEpisodes: 3 }, expect: 'allowed' }, { kind: 'work', use: { additionalEpisodes: 1 }, expect: 'denied', reason: 'WORK_CAP_EXCEEDED' }] }] }));
    const passed = run('policy', 'starter', 'fixtures.json');
    expect(passed.status).toBe(0);
    expect(json(passed.stdout)).toMatchObject({ status: 'passed', summary: { passed: 1 } });
    write('wrong.json', JSON.stringify({ policyFixturesFormat: 1, fixtures: [{ id: 'caps', scope: 'course', steps: [{ kind: 'work', use: { additionalEpisodes: 4 }, expect: 'allowed' }] }] }));
    expect(run('policy', 'starter', 'wrong.json').status).toBe(1);
  });

  it('reports compatibility with a host inventory and the locally installed renderer', () => {
    const local = json(run('compat', 'starter').stdout);
    expect(local).toMatchObject({ status: 'unknown', local: [{ rendererId: 'course-core-svg-v1', version: '0.4.0', source: '@course-core/visuals@0.4.0' }] });
    write('host.json', JSON.stringify({ hostInventoryFormat: 1, coreVersion: '0.1.0', sdk: { version: '0.6.0', supported: { min: '0.5.0', maxExclusive: '0.7.0' } },
      extensions: [], renderers: [], platformAdapters: [], capabilities: [] }));
    const old = run('compat', 'starter', '--host', 'host.json');
    expect(old.status).toBe(1);
    expect(json(old.stdout).problems.map((p: { code: string }) => p.code)).toContain('CORE_VERSION_TOO_OLD');
    expect(run('compat', 'starter', '--host', 'host.json', '--minimum-core-version', '0.0.9').status).toBe(0);
    expect(run('compat', 'starter', '--visuals', path.join(root, 'nowhere')).status).toBe(1);
  });

  it('exits 1 when the host only accepts SDKs older than this one, and 0 when it accepts this one', () => {
    const inventory = (supported: { min: string; maxExclusive: string }) => JSON.stringify({ hostInventoryFormat: 1, coreVersion: '0.1.50',
      sdk: { version: supported.min, supported }, extensions: [], renderers: [], platformAdapters: [], capabilities: [] });
    write('older-host.json', inventory({ min: '0.5.0', maxExclusive: '0.6.0' }));
    const refused = run('compat', 'starter', '--host', 'older-host.json', '--minimum-core-version', '0.0.9');
    expect(refused.status).toBe(1);
    const report = json(refused.stdout);
    expect(report).toMatchObject({ status: 'incompatible', sdk: { status: 'unsupported' } });
    expect(report.problems).toContainEqual(expect.objectContaining({ code: 'SDK_UNSUPPORTED', severity: 'blocking', detail: expect.stringContaining('the host supports 0.5.0 to below 0.6.0') }));
    write('current-host.json', inventory({ min: '0.6.0', maxExclusive: '0.7.0' }));
    expect(run('compat', 'starter', '--host', 'current-host.json', '--minimum-core-version', '0.0.9').status).toBe(0);
  });

  it('replays a recorded decision file', () => {
    write('replay.json', JSON.stringify({ gateReplayFormat: 1, decisions: [] }));
    const result = run('replay', 'starter', 'replay.json');
    expect(result.status).toBe(1);
    expect(json(result.stdout)).toMatchObject({ status: 'invalid', issues: [{ code: 'INVALID_REPLAY' }] });
    expect(run('replay', 'starter').status).toBe(2);
  });
});

describe('course dev (K03, K12)', () => {
  const get = (url: string, host?: string, method = 'GET') => new Promise<{ status: number; body: string; headers: Record<string, unknown> }>((resolve, reject) => {
    const target = new URL(url);
    const req = request({ hostname: target.hostname, port: target.port, path: `${target.pathname}${target.search}`, method, headers: host ? { host } : {} }, response => {
      let body = '';
      response.setEncoding('utf8').on('data', chunk => { body += chunk; }).on('end', () => resolve({ status: response.statusCode!, body, headers: response.headers }));
    });
    req.on('error', reject).end();
  });
  async function until<T>(read: () => Promise<T>, done: (value: T) => boolean): Promise<T> {
    for (let i = 0; i < 100; i++) { const value = await read(); if (done(value)) return value; await new Promise(r => setTimeout(r, 100)); }
    throw new Error('timed out');
  }

  it('serves a live preview that rebuilds on save, renders visuals and shows problems inline', async () => {
    write('live/course.ts', `import base from '../starter/course.ts';
const extension = { id: 'course-core-svg-v1', version: '0.4.0', integrity: 'sha256-${'a'.repeat(64)}', execution: 'declarative', entrypoint: 'renderers/svg.js',
  platforms: ['web'], capabilities: ['visual.render'], accessibility: { keyboard: true, reducedMotion: true, textAlternative: 'A dot plot.' } };
const visual = { id: 'dots', rendererId: 'course-core-svg-v1', platforms: ['web'], state: {}, scene: {}, layouts: { compact: {}, expanded: {} },
  timeline: { durationMs: 0, seekable: true, cues: [] }, accessibility: { description: 'Five dots.', reducedMotion: {} }, referenceChecks: [] };
const episode = { ...base.chapters[0].episodes[0], blocks: [...base.chapters[0].episodes[0].blocks, { id: 'plot', type: 'visual', visualId: 'dots' }] };
export default { ...base, locales: undefined, extensions: [extension], visuals: [visual], chapters: [{ ...base.chapters[0], episodes: [episode] }] };
`);
    const child: ChildProcess = spawn(process.execPath, [cli, 'dev', 'live', '--port', '0'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
    try {
      let stdout = '';
      child.stdout!.setEncoding('utf8').on('data', chunk => { stdout += chunk; });
      const started = await until(async () => stdout, text => text.trim().endsWith('}'));
      const { url, renderer } = json(started);
      expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/);
      expect(renderer).toBe('@course-core/visuals@0.4.0');
      const page = await get(url);
      expect(page.status).toBe(200);
      expect(page.headers['content-security-policy']).toContain("script-src 'self'");
      expect(page.body).toContain('<svg id="v0-scene" data-visual="dots"></svg>');
      expect(page.body).toContain('Text alternative: Five dots.');
      expect((await get(`${url}visuals.css`)).body).toContain('.ccv-scene');
      // Other host names (DNS rebinding) and writes are refused.
      expect((await get(url, 'attacker.example')).status).toBe(421);
      expect((await get(url, undefined, 'POST')).status).toBe(405);
      // An edit that breaks the course is shown with its problem, then a fix recovers.
      const source = readFileSync(path.join(root, 'live/course.ts'), 'utf8');
      writeFileSync(path.join(root, 'live/course.ts'), source.replace("visualId: 'dots'", "visualId: 'missing-visual'"));
      const broken = await until(() => get(url), response => response.status === 422);
      expect(broken.body).toContain('MISSING_REFERENCE');
      writeFileSync(path.join(root, 'live/course.ts'), source.replace('Five dots.', 'Six dots.'));
      const fixed = await until(() => get(url), response => response.status === 200 && response.body.includes('Six dots.'));
      expect(Number(/data-revision="(\d+)"/.exec(fixed.body)![1])).toBeGreaterThanOrEqual(3);
      const state = json((await get(`${url}build.json`)).body);
      expect(state).toMatchObject({ ok: true, loadError: null, compatibility: { local: [{ rendererId: 'course-core-svg-v1' }] } });
      expect(json((await get(`${url}compiled.json`)).body).formatVersion).toBe(1);
    } finally {
      child.kill('SIGTERM');
      await new Promise(resolve => child.once('exit', resolve));
    }
    expect(child.exitCode).toBe(0);
  }, 60_000);

  it('rejects an invalid port', () => {
    expect(run('dev', 'starter', '--port', '70000').status).toBe(2);
  });
});
