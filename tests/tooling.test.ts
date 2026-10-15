import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { build } from 'esbuild';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  compileCourse, conformanceReport, diffCourses, importCourse, inspectCourse, licenseInventory, migrateCourse, packCourse, requiredCapabilities,
  scaffoldCourse, verifyCourseBundle, CourseBundleError,
} from '../src/compiler.js';
import { lintCourse, validateCourse } from '../src/index.js';
import type { VersionedProgressionGate } from '../src/contracts-types.js';
import { richCourse } from './contracts-fixture.js';
import { courseFixture } from './fixture.js';

const legacy = () => JSON.parse(readFileSync(new URL('../fixtures/compat-0.4.0/feature-tour.course.json', import.meta.url), 'utf8'));

describe('bundle, conformance and author tooling', () => {
  it('packs deterministically with manifest, integrity map, licences, capabilities and conformance', () => {
    const files = packCourse(richCourse());
    expect(Object.keys(files)).toEqual(['capabilities.json', 'conformance.json', 'course.compiled.json', 'integrity.json', 'licenses.json', 'manifest.json']);
    expect(packCourse(richCourse())).toEqual(files);
    expect(files['course.compiled.json']).toBe(`${JSON.stringify(compileCourse(richCourse()), null, 2)}\n`);
    expect(JSON.parse(files['manifest.json']!)).toMatchObject({ bundleFormat: 1, sdk: { version: '0.5.0' }, course: { id: 'pendulum-lab' } });
    expect(verifyCourseBundle(files)).toMatchObject({ valid: true, issues: [] });
  });
  it.each([
    ['changed bytes', (f: Record<string, string>) => { f['licenses.json'] = f['licenses.json']!.replace('CC-BY-4.0', 'CC0-1.0'); }, 'INTEGRITY_MISMATCH'],
    ['an extra file', (f: Record<string, string>) => { f['extra.js'] = 'x'; }, 'UNEXPECTED_FILE'],
    ['a missing file', (f: Record<string, string>) => { delete f['conformance.json']; }, 'MISSING_FILE'],
    ['a recomputed integrity map over forged reports', (f: Record<string, string>) => {
      f['capabilities.json'] = f['capabilities.json']!.replace('"state.patch"', '"state.read"');
      const integrity = JSON.parse(f['integrity.json']!);
      integrity.files['capabilities.json'] = createHash('sha256').update(f['capabilities.json']).digest('hex');
      f['integrity.json'] = `${JSON.stringify(integrity, null, 2)}\n`; }, 'DERIVED_FILE_MISMATCH'],
  ] as const)('rejects a bundle with %s', (_name, tamper, code) => {
    const files = packCourse(richCourse()); tamper(files);
    expect(verifyCourseBundle(files).issues.map(i => i.code)).toContain(code);
  });
  it('inventories licences and required capabilities', () => {
    const inventory = licenseInventory(richCourse());
    expect(inventory.undeclared).toEqual([]);
    expect(inventory.sceneAssets).toEqual([{ sceneId: 'swing-scene', assetId: 'sky-image', url: 'asset:images/sky.png', license: 'CC0-1.0', sourceRef: null }]);
    expect(licenseInventory(legacy()).undeclared).toEqual(['extension:curve-lab', 'extension:curve-renderer', 'extension:evaluator']);
    const caps = requiredCapabilities(richCourse());
    expect(caps.capabilities.find(c => c.capability === 'state.patch')).toEqual({ capability: 'state.patch', required: true, requestedBy: ['activity:pendulum-sim', 'extension:sim-plugin'] });
    expect(caps.nativeModules).toEqual(['ios-haptics']);
    expect(caps.targets).toEqual(['ios_phone', 'ipados_tablet', 'web_desktop', 'web_mobile']);
  });
  it('reports conformance: full pass, warnings for 0.4 data, failure for invalid input', () => {
    expect(conformanceReport(richCourse()).status).toBe('passed');
    const old = conformanceReport(legacy());
    expect(old.status).toBe('passed_with_warnings');
    expect(old.checks.find(c => c.id === 'gates-require-transfer')!.status).toBe('warning');
    expect(conformanceReport({}).status).toBe('failed');
    expect(() => packCourse({})).toThrow(CourseBundleError);
  });
  it('packs a legacy 0.4 course with its compiled file unchanged', () => {
    const files = packCourse(legacy());
    expect(files['course.compiled.json']).toBe(readFileSync(new URL('../fixtures/compat-0.4.0/feature-tour.compiled.json', import.meta.url), 'utf8'));
  });
  it('imports only verified compiled courses or bundles', () => {
    expect(importCourse(compileCourse(richCourse()))).toEqual(richCourse());
    expect(importCourse(packCourse(richCourse()))).toEqual(richCourse());
    const tampered = compileCourse(richCourse()); tampered.server.title = 'Changed';
    expect(() => importCourse(tampered)).toThrow(CourseBundleError);
  });
  it('diffs by stable ID and flags version-less and grading changes', () => {
    const next = richCourse(); next.version = '1.1.0';
    next.activities![0]!.offlineBehavior = 'read_only';
    const numeric = next.assessments[0]!; if (numeric.type === 'numeric') numeric.grading.expected = 3;
    next.stages!.push({ id: 'advanced', title: 'Advanced' });
    const diff = diffCourses(richCourse(), next);
    expect(diff.changes).toEqual(expect.arrayContaining([{ section: 'activities', id: 'pendulum-sim', change: 'changed' }, { section: 'stages', id: 'advanced', change: 'added' }]));
    expect(diff.breaking.map(b => `${b.section}:${b.id}`)).toEqual(expect.arrayContaining(['activities:pendulum-sim', 'assessments:period-numeric']));
    const same = richCourse(); same.title = 'Retitled';
    expect(diffCourses(richCourse(), same).breaking).toEqual([{ section: 'course', id: 'version', reason: expect.any(String) }]);
    expect(diffCourses(richCourse(), richCourse())).toMatchObject({ changes: [], breaking: [] });
  });
  it('migrates legacy gates without inventing pedagogy', () => {
    const result = migrateCourse(legacy());
    expect(result.course.gates.every(g => 'version' in g)).toBe(true);
    expect(result.issues.map(i => i.code)).toContain('MISSING_TRANSFER_ITEM');
    expect(result.manualSteps.join('\n')).toMatch(/conversationalEvaluatorId/);
    const fixed = structuredClone(result.course);
    for (const id of ['row-numeric', 'interp-code', 'walk-rubric']) fixed.assessments.find(a => a.id === id)!.role = 'transfer';
    const walk = fixed.gates.find(g => g.id === 'walk-gate') as VersionedProgressionGate;
    expect(walk).toMatchObject({ scope: { kind: 'episode', episodeId: 'walk' }, capPolicyRef: 'episode:walk', practicalTaskRefs: ['walk-rubric'], nextActivityId: null });
    expect((fixed.gates[0] as VersionedProgressionGate).nextActivityId).toBe('between');
    expect(validateCourse(fixed).issues).toEqual([]);
    expect(migrateCourse(richCourse()).changes).toEqual([]);
  });
  it('scaffolds a valid, lint-clean course and inspects courses and compiled files', () => {
    const starter = scaffoldCourse({ id: 'my-course', title: 'Mine' });
    expect(validateCourse(starter).issues).toEqual([]);
    expect(lintCourse(starter).filter(f => f.severity !== 'info')).toEqual([]);
    const summary = inspectCourse(compileCourse(richCourse()));
    expect(summary).toMatchObject({ valid: true, id: 'pendulum-lab', gates: [{ id: 'length-ready', versioned: true }] });
    expect(inspectCourse({}).valid).toBe(false);
  });
});

describe('course CLI', () => {
  let dir: string, cli: string;
  const run = (...args: string[]) => spawnSync(process.execPath, [cli, ...args], { cwd: dir, encoding: 'utf8', timeout: 60_000 });
  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'course-cli-'));
    cli = path.join(dir, 'cli.mjs');
    await build({ entryPoints: ['src/cli.ts'], bundle: true, platform: 'node', format: 'esm', outfile: cli, logLevel: 'silent' });
    writeFileSync(path.join(dir, 'rich.json'), JSON.stringify(richCourse()));
    writeFileSync(path.join(dir, 'legacy.json'), JSON.stringify(courseFixture()));
    writeFileSync(path.join(dir, 'invalid.json'), '{}');
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('init scaffolds once and refuses to replace a directory', () => {
    expect(run('init', 'starter', '--id', 'cli-course').status).toBe(0);
    expect(JSON.parse(readFileSync(path.join(dir, 'starter/course.json'), 'utf8')).id).toBe('cli-course');
    expect(run('init', 'starter').status).toBe(1);
  });
  it('validate, lint and test report status through exit codes', () => {
    expect(run('validate', 'rich.json').status).toBe(0);
    expect(run('validate', 'invalid.json').status).toBe(1);
    expect(run('lint', 'legacy.json').status).toBe(0);
    expect(run('lint', 'legacy.json', '--strict').status).toBe(1);
    expect(JSON.parse(run('test', 'rich.json').stdout).status).toBe('passed');
    expect(run('test', 'invalid.json').status).toBe(1);
  });
  it('pack, verify and import round-trip; tampering and replacement are refused', () => {
    expect(run('pack', 'rich.json', 'bundle').status).toBe(0);
    expect(readdirSync(path.join(dir, 'bundle')).sort()).toHaveLength(6);
    expect(run('pack', 'rich.json', 'bundle').status).toBe(1);
    expect(JSON.parse(run('verify', 'bundle').stdout).valid).toBe(true);
    expect(run('compile', 'rich.json', 'compiled.json').status).toBe(0);
    expect(JSON.parse(run('verify', 'compiled.json').stdout)).toMatchObject({ valid: true, kind: 'compiled' });
    expect(run('import', 'bundle', 'imported.json').status).toBe(0);
    expect(JSON.parse(readFileSync(path.join(dir, 'imported.json'), 'utf8'))).toEqual(richCourse());
    const manifest = path.join(dir, 'bundle', 'manifest.json');
    writeFileSync(manifest, readFileSync(manifest, 'utf8').replace('pendulum-lab', 'pendulum-lab-x'));
    expect(run('verify', 'bundle').status).toBe(1);
    expect(run('import', 'bundle', 'imported-2.json').status).toBe(1);
  });
  it('inspect, diff and migrate produce JSON reports', () => {
    expect(JSON.parse(run('inspect', 'rich.json').stdout).id).toBe('pendulum-lab');
    expect(JSON.parse(run('diff', 'legacy.json', 'rich.json').stdout).from.id).toBe('sorting-basics');
    const migrated = run('migrate', 'legacy.json', 'migrated.json');
    expect(JSON.parse(migrated.stdout).status).toBe('needs_review');
    expect(migrated.status).toBe(1);
    expect(run('migrate', 'legacy.json', 'migrated.json').status).toBe(1);
  });
  it('rejects unknown commands, options and argument counts with usage', () => {
    for (const args of [['frobnicate'], ['lint', 'rich.json', '--fix'], ['compile', 'rich.json'], [], ['init', 'x', '--id']]) {
      const result = run(...args);
      expect(result.status, args.join(' ')).toBe(2);
      expect(result.stderr).toContain('Usage:');
    }
  });
});
