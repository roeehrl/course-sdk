import { describe, expect, it } from 'vitest';
import { defineVisualChecks, lintCourse, normalizeDigestNumbers, validateContract, validateCourse, VISUAL_CHECK_LIMITS } from '../src/index.js';
import type { CourseManifest, VisualExperience, VisualGolden, VisualInvariant } from '../src/index.js';
import { richCourse } from './contracts-fixture.js';

const digest = (c: string) => `sha256-${c.repeat(64)}`;
const issues = (course: unknown) => { const r = validateCourse(course); return r.valid ? [] : r.issues; };

/** The rich fixture with a visual carrying panes, invariants and goldens (Course Core visuals 0.4 shapes). */
function checkedCourse(): CourseManifest & { visuals: VisualExperience[] } {
  const course = richCourse();
  course.renderers!.push({ id: 'swing-renderer', version: '1.0.0', surface: 'visual', extensionId: 'sim-plugin', targets: ['web_desktop'],
    features: ['panes', 'invariants', 'goldens'] });
  Object.assign(course.visuals[0]!, {
    state: { length: 1, row: 0 },
    timeline: { durationMs: 1000, seekable: true, cues: [{ atMs: 500, event: 'half' }] },
    requiredFeatures: ['panes', 'invariants', 'goldens'],
    panes: [
      { id: 'periods', kind: 'table', title: 'Periods', columns: ['Length (m)', 'Period (s)'], rows: [[1, 2], [4, 4]], highlightRow: { state: 'row' } },
      { id: 'formula', kind: 'formula', title: 'Period', tex: 'T = 2\\sqrt{L}', label: 'T equals two root L', values: [{ symbol: 'L', value: { state: 'length' } }] },
    ],
    invariants: [{ id: 'table-matches-formula', description: 'The highlighted period equals the formula for L.',
      assert: { op: 'eq', args: [{ cell: { pane: 'periods', row: { highlight: 'periods' }, column: 1 } }, { op: 'mul', args: [2, { op: 'sqrt', args: [{ value: { pane: 'formula', symbol: 'L' } }] }] }] },
      states: [{ length: 4, row: 1 }] },
    { id: 'bob-on-screen', description: 'The bob stays inside the frame.', assert: { op: 'lte', args: [{ node: 'bob', property: 'worldY' }, 400] }, times: [0, 250, 1000] }],
    goldens: [{ atMs: 0, layout: 'compact', digest: digest('a') }, { atMs: 1000, layout: 'expanded', digest: digest('b') }],
  } satisfies Partial<VisualExperience>);
  return course as CourseManifest & { visuals: VisualExperience[] };
}

describe('visual checks: invariants and golden digests (Course Core visuals 0.4)', () => {
  it('accepts invariants and goldens, and keeps 0.5 visuals without them valid', () => {
    expect(issues(checkedCourse())).toEqual([]);
    expect(issues(richCourse())).toEqual([]);
  });
  it('accepts the invariants and goldens render features and rejects unknown ones', () => {
    const course = checkedCourse();
    course.rendererAdapters![0]!.supportedFeatures.push('invariants', 'goldens');
    expect(issues(course)).toEqual([]);
    (course.visuals[0]!.requiredFeatures as string[]).push('snapshots');
    expect(issues(course).map(i => i.code)).toContain('SCHEMA');
  });
  it('requires the invariants and goldens features once requiredFeatures is declared', () => {
    const course = checkedCourse(); course.visuals[0]!.requiredFeatures = ['panes'];
    expect(issues(course).map(i => i.message)).toEqual(['Publish-time invariants needs the invariants render feature.', 'Golden frame digests needs the goldens render feature.']);
    course.renderers!.at(-1)!.features = ['panes'];
    course.visuals[0]!.requiredFeatures = ['panes', 'invariants', 'goldens'];
    expect(issues(course).map(i => i.code)).toEqual(['UNSUPPORTED_FEATURE', 'UNSUPPORTED_FEATURE']);
    delete course.visuals[0]!.requiredFeatures;
    expect(lintCourse(course).filter(f => f.code === 'UNDECLARED_RENDER_FEATURES')).toHaveLength(1);
  });
  it('rejects probes of unknown state, panes, cells, formula values and highlights', () => {
    const course = checkedCourse(); const visual = course.visuals[0]!;
    visual.invariants![0]!.assert = { op: 'and', args: [
      { state: 'mass' }, { cell: { pane: 'periods', row: 0, column: 2 } }, { cell: { pane: 'formula', row: 0, column: 0 } },
      { value: { pane: 'formula', symbol: 'g' } }, { highlight: 'formula' }, { highlight: 'ghost' }] };
    expect(issues(course).map(i => i.message)).toEqual([
      'The invariant reads undeclared state mass.',
      'The invariant reads an unknown table cell in periods.',
      'The invariant reads an unknown table cell in formula.',
      'The invariant reads an unknown formula value g.',
      'The invariant reads an unknown highlight formula.',
      'The invariant reads an unknown highlight ghost.',
    ]);
  });
  it('rejects state overrides of undeclared state and times outside the timeline', () => {
    const course = checkedCourse(); const visual = course.visuals[0]!;
    visual.invariants![0]!.states = [{ mass: 2 }];
    visual.invariants![1]!.times = [0, 1001];
    visual.goldens![1]!.atMs = 1500;
    expect(issues(course).map(i => [i.code, i.path])).toEqual([
      ['MISSING_REFERENCE', '/visuals/0/invariants/0/states/0'],
      ['INVALID_TIMELINE', '/visuals/0/invariants/1/times/1'],
      ['INVALID_TIMELINE', '/visuals/0/goldens/1/atMs'],
    ]);
  });
  it('rejects duplicate invariants and goldens, and goldens for a layout the visual lacks', () => {
    const course = checkedCourse(); const visual = course.visuals[0]!;
    visual.invariants![1]!.id = 'table-matches-formula';
    visual.goldens!.push({ atMs: 0, layout: 'compact', digest: digest('c') }, { atMs: 0, layout: 'wide', digest: digest('d') });
    expect(issues(course).map(i => [i.code, i.path])).toEqual([
      ['DUPLICATE_ID', '/visuals/0/invariants/1'],
      ['DUPLICATE_ID', '/visuals/0/goldens/2'],
      ['INVALID_GOLDEN', '/visuals/0/goldens/3/layout'],
    ]);
    // With the four-layout set, wide is a layout and expanded is not.
    visual.layouts = { compact: {}, expanded: {}, tabletPortrait: {}, tabletLandscape: {}, wide: {} };
    visual.requiredFeatures!.push('layout_set'); course.renderers!.at(-1)!.features.push('layout_set');
    visual.invariants![1]!.id = 'bob-on-screen'; visual.goldens!.splice(2, 1);
    expect(issues(course).map(i => [i.code, i.path])).toEqual([['INVALID_GOLDEN', '/visuals/0/goldens/1/layout']]);
  });
  it('rejects malformed digests, layouts and probes outside the schema', () => {
    for (const mutate of [
      (g: VisualGolden) => { g.digest = 'sha256-ABC'; }, (g: VisualGolden) => { g.digest = digest('A'); },
      (g: VisualGolden) => { (g as { layout: string }).layout = 'tablet'; }, (g: VisualGolden) => { g.atMs = -1; },
    ]) {
      const course = checkedCourse(); mutate(course.visuals[0]!.goldens![0]!);
      expect(issues(course).map(i => i.code)).toContain('SCHEMA');
    }
    for (const mutate of [
      (v: VisualInvariant) => { v.description = ''; }, (v: VisualInvariant) => { v.times = []; },
      // Invalid on purpose: state overrides hold numbers, strings or booleans only.
      (v: VisualInvariant) => { v.states = [{ length: [1] }] as never; }, (v: VisualInvariant) => { v.states = [{ length: null }] as never; },
    ]) {
      const course = checkedCourse(); mutate(course.visuals[0]!.invariants![0]!);
      expect(issues(course).map(i => i.code)).toContain('SCHEMA');
    }
    const empty = checkedCourse(); empty.visuals[0]!.goldens = [];
    expect(issues(empty).map(i => i.code)).toContain('SCHEMA');
  });
  it(`limits invariants to ${VISUAL_CHECK_LIMITS.checkFrames} checked frames (layouts x states x times)`, () => {
    const course = checkedCourse(); const visual = course.visuals[0]!;
    visual.timeline.durationMs = 100000;
    // 2 layouts x (1 + 7 states) x 32 times = 512: at the limit.
    visual.invariants = [{ id: 'many', description: 'At the limit.', assert: true,
      times: Array.from({ length: 32 }, (_, i) => i * 100), states: Array.from({ length: 7 }, (_, i) => ({ length: i + 2 })) }];
    expect(issues(course)).toEqual([]);
    visual.invariants.push({ id: 'one-more', description: 'One more time.', assert: true, times: [99999] });
    expect(issues(course)).toEqual([expect.objectContaining({ code: 'TOO_MANY_CHECK_FRAMES', path: '/visuals/0/invariants' })]);
    // Default times are 0, every cue and the duration; repeated state overrides count once.
    visual.invariants = [{ id: 'defaults', description: 'Defaults.', assert: true, states: [{ length: 2 }, { length: 2 }] }];
    expect(issues(course)).toEqual([]);
  });
  it('defineVisualChecks validates checks on their own', () => {
    const checks = { invariants: [{ id: 'a', description: 'A.', assert: true }], goldens: [{ atMs: 0, layout: 'compact' as const, digest: digest('e') }] };
    expect(defineVisualChecks(checks)).toEqual(checks);
    expect(validateContract('visualChecks', { goldens: [checks.goldens[0], checks.goldens[0]] }).issues.map(i => i.code)).toEqual(['DUPLICATE_ID']);
    expect(() => defineVisualChecks({ invariants: [{ id: 'a', description: 'A.', assert: true }, { id: 'a', description: 'B.', assert: false }] })).toThrow(/visualChecks/);
  });
});

describe('golden digest number normalization', () => {
  it('rounds every number to 10 significant digits and flushes |x| < 1e-9 to 0, as Course Core does', () => {
    expect(normalizeDigestNumbers('{"x":0.1234567891234,"y":1e-10,"z":-3.00000000049,"w":12345678901234,"v":-0.0000000001,"u":2.5e-7,"t":42}'))
      .toBe('{"x":0.1234567891,"y":0,"z":-3,"w":12345678900000,"v":0,"u":2.5e-7,"t":42}');
    expect(normalizeDigestNumbers('{"id":"node-12","label":"3.14159265358979 m"}')).toBe('{"id":"node-12","label":"3.141592654 m"}');
    expect(normalizeDigestNumbers('[1e+21,-1.5e-300,0.30000000000000004,123456789012345678]')).toBe('[1e+21,0,0.3,123456789000000000]');
    expect(VISUAL_CHECK_LIMITS).toMatchObject({ checkFrames: 512, significantDigits: 10, zeroBelow: 1e-9 });
  });
});
