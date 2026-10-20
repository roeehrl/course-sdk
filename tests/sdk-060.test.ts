import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { compileCourse } from '../src/compiler.js';
import { lintCourse, publicationIssues, validateCourse } from '../src/index.js';
import type { Assessment, CourseManifest, RenderFeature, VisualExperience } from '../src/index.js';
import { richCourse } from './contracts-fixture.js';

const codes = (course: unknown) => { const r = validateCourse(course); return r.valid ? [] : r.issues.map(i => i.code); };
const issues = (course: unknown) => { const r = validateCourse(course); return r.valid ? [] : r.issues; };
const lint = (course: unknown, code: string) => lintCourse(course).filter(f => f.code === code);

/** The rich fixture with a 0.6 visual: four layouts, a bound interaction, panes and a renderer definition. */
function visualCourse(): CourseManifest & { visuals: VisualExperience[] } {
  const course = richCourse();
  course.renderers!.push({ id: 'swing-renderer', version: '1.0.0', surface: 'visual', extensionId: 'sim-plugin', targets: ['web_desktop'],
    features: ['layout_set', 'panes', 'spring', 'symbol', 'stagger', 'equation'] });
  Object.assign(course.visuals[0]!, {
    state: { length: 1, row: 0 },
    layouts: { compact: { stack: true }, expanded: { columns: 3 }, tabletPortrait: { columns: 1 }, tabletLandscape: { columns: 2 }, wide: { columns: 3 } },
    requiredFeatures: ['layout_set', 'panes', 'spring'],
    interactions: [{ id: 'drag-length', kind: 'drag', target: 'bob', label: 'Pendulum length', binding: { state: 'length', range: { min: 1, max: 4, step: 0.5 } },
      alternative: { kind: 'keyboard', keys: ['ArrowLeft', 'ArrowRight'] } },
    { id: 'pick-row', kind: 'tap', target: 'table', label: 'Choose a row', binding: { state: 'row', values: [0, 1] } }],
    panes: [
      { id: 'periods', kind: 'table', title: 'Periods', columns: ['Length (m)', 'Period (s)'], rows: [[1, 2], [4, 4]], highlightRow: { state: 'row' } },
      { id: 'source', kind: 'code', title: 'Period', language: 'python', lines: ['def period(length):', '    return 2 * sqrt(length)'], highlightLine: 2 },
      { id: 'formula', kind: 'formula', title: 'Period', tex: 'T = 2\\pi\\sqrt{L/g}', label: 'T equals two pi times the square root of L over g',
        values: [{ symbol: 'L', value: { state: 'length' } }] },
    ],
  } satisfies Partial<VisualExperience>);
  return course as CourseManifest & { visuals: VisualExperience[] };
}

describe('0.6 visuals: render features, four layouts, interactions and panes', () => {
  it('accepts the new render features, layouts, interactions and panes, and keeps 0.5 visuals valid', () => {
    expect(issues(visualCourse())).toEqual([]);
    expect(issues(richCourse())).toEqual([]);
    const course = visualCourse();
    course.rendererAdapters![0]!.supportedFeatures.push('symbol', 'spring', 'stagger', 'layout_set', 'panes');
    course.renderers![0]!.features.push('symbol');
    course.rendererAdapters![0]!.fallbacks.push({ feature: 'symbol', fallback: 'equivalent_static' });
    expect(codes(course)).toEqual(['REDUNDANT_FALLBACK']);
  });
  it('rejects unknown render features', () => {
    const course = visualCourse(); (course.visuals[0]!.requiredFeatures as string[]).push('sparkle');
    expect(codes(course)).toContain('SCHEMA');
  });
  it('rejects a required feature no visual renderer of the extension declares', () => {
    const course = visualCourse(); course.renderers!.at(-1)!.features = ['layout_set', 'spring'];
    expect(issues(course)).toEqual([expect.objectContaining({ code: 'UNSUPPORTED_FEATURE', path: '/visuals/0/requiredFeatures/1' })]);
    // Without any visual renderer definition for the extension there is nothing to compare against.
    course.renderers!.pop();
    expect(issues(course)).toEqual([]);
  });
  it('requires layout_set and panes in requiredFeatures when the visual uses them', () => {
    const course = visualCourse(); course.visuals[0]!.requiredFeatures = ['spring'];
    expect(issues(course).map(i => [i.code, i.message])).toEqual([
      ['MISSING_REQUIRED_FEATURE', 'The four-layout set needs the layout_set render feature.'],
      ['MISSING_REQUIRED_FEATURE', 'Synchronized panes needs the panes render feature.'],
    ]);
    delete course.visuals[0]!.requiredFeatures;
    expect(issues(course)).toEqual([]);
    expect(lint(course, 'UNDECLARED_RENDER_FEATURES')).toHaveLength(1);
  });
  it.each([['tabletPortrait'], ['tabletLandscape'], ['wide']] as const)('rejects a layout set without %s', (missing) => {
    const course = visualCourse(); delete course.visuals[0]!.layouts[missing];
    expect(issues(course)).toEqual([expect.objectContaining({ code: 'INCOMPLETE_LAYOUT_SET', path: '/visuals/0/layouts' })]);
  });
  it('checks interaction bindings against visual state and requires accessible alternatives', () => {
    const course = visualCourse();
    course.visuals[0]!.interactions![0]!.binding.state = 'mass';
    course.visuals[0]!.state = { length: 1, row: 'first' };
    course.visuals[0]!.interactions![1]!.binding = { state: 'row', range: { min: 0, max: 1 } };
    delete course.visuals[0]!.interactions![0]!.alternative;
    expect(issues(course).map(i => [i.code, i.path])).toEqual([
      ['INACCESSIBLE_INTERACTION', '/visuals/0/interactions/0/alternative'],
      ['MISSING_REFERENCE', '/visuals/0/interactions/0/binding/state'],
      ['INVALID_BINDING', '/visuals/0/interactions/1/binding/range'],
    ]);
  });
  it('rejects malformed bindings and duplicate interaction IDs', () => {
    const course = visualCourse();
    course.visuals[0]!.interactions![1]!.id = 'drag-length';
    course.visuals[0]!.interactions![0]!.binding.range = { min: 1, max: 4, step: 5 };
    course.visuals[0]!.interactions![1]!.binding.range = { min: 0, max: 1 };
    expect(codes(course).sort()).toEqual(['DUPLICATE_ID', 'INVALID_BINDING', 'INVALID_BINDING']);
  });
  it('checks panes: unique IDs, table row widths and formula text alternatives', () => {
    const course = visualCourse();
    const [table, , formula] = course.visuals[0]!.panes!;
    if (table?.kind !== 'table' || formula?.kind !== 'formula') throw new Error('fixture');
    table.rows.push([9]);
    formula.label = '  ';
    formula.id = 'periods';
    expect(issues(course).map(i => [i.code, i.path])).toEqual([
      ['DUPLICATE_ID', '/visuals/0/panes/2'],
      ['INVALID_PANE', '/visuals/0/panes/0/rows/2'],
      ['MISSING_TEXT_ALTERNATIVE', '/visuals/0/panes/2/label'],
    ]);
    (course.visuals[0]!.panes![1] as Record<string, unknown>).kind = 'chart';
    expect(codes(course)).toContain('SCHEMA');
    course.visuals[0]!.panes = [];
    expect(codes(course)).toContain('SCHEMA');
  });
});

describe('0.6 scene defs (clips, masks, symbols) and equation labels', () => {
  function sceneCourse() {
    const course = richCourse();
    const scene = course.scenes![0]!;
    scene.semanticNodes.push({ id: 'token', label: 'Token', role: 'object' });
    scene.layers.push(
      { id: 'window', kind: 'vector', semanticNodeIds: [], decorative: true },
      { id: 'fade', kind: 'vector', semanticNodeIds: [], decorative: true },
      { id: 'token-shape', kind: 'vector', semanticNodeIds: ['token'], decorative: false, clip: 'reveal' },
      { id: 'token-1', kind: 'use', symbol: 'token', semanticNodeIds: ['token'], decorative: false, mask: 'fade-out' },
      { id: 'formula', kind: 'equation', semanticNodeIds: ['bob'], decorative: false, label: 'T equals two pi root L over g' },
    );
    scene.defs = { clips: [{ id: 'reveal', layerIds: ['window'] }], masks: [{ id: 'fade-out', layerIds: ['fade'] }],
      symbols: [{ id: 'token', width: 20, height: 20, layerIds: ['token-shape'] }] };
    return course;
  }
  it('accepts resolved defs and 0.5 scenes without them', () => {
    expect(issues(sceneCourse())).toEqual([]);
    expect(publicationIssues(sceneCourse())).toEqual([]);
  });
  it('rejects unknown references, misplaced symbols and duplicate definitions', () => {
    const course = sceneCourse(); const scene = course.scenes![0]!;
    scene.layers[4]!.clip = 'missing-clip';
    scene.layers[5]!.symbol = 'missing-symbol';
    scene.layers[2]!.symbol = 'token';
    scene.defs!.masks!.push({ id: 'fade-out', layerIds: ['ghost-layer'] });
    expect(issues(course).map(i => [i.code, i.path])).toEqual(expect.arrayContaining([
      ['DUPLICATE_ID', '/scenes/0/defs/masks/1'],
      ['MISSING_REFERENCE', '/scenes/0/defs/masks/1/layerIds/0'],
      ['INVALID_LAYER', '/scenes/0/layers/2'],
      ['MISSING_REFERENCE', '/scenes/0/layers/4/clip'],
      ['MISSING_REFERENCE', '/scenes/0/layers/5/symbol'],
    ]));
    expect(codes(course)).toHaveLength(5);
  });
  it('rejects a use layer without a symbol', () => {
    const course = sceneCourse(); delete course.scenes![0]!.layers[5]!.symbol;
    expect(issues(course)).toEqual([expect.objectContaining({ code: 'INVALID_LAYER', path: '/scenes/0/layers/5' })]);
  });
  it('rejects a symbol that draws itself, directly or through another definition', () => {
    const direct = sceneCourse();
    direct.scenes![0]!.defs!.symbols![0]!.layerIds.push('token-1');
    expect(issues(direct).map(i => [i.code, i.path])).toEqual([['DEFS_CYCLE', '/scenes/0/defs/symbols/0']]);
    const indirect = sceneCourse(); const scene = indirect.scenes![0]!;
    scene.layers[2]!.mask = 'fade-out'; // window (clip reveal) -> mask fade-out
    scene.layers[3]!.clip = 'reveal'; // fade (mask fade-out) -> clip reveal
    expect(issues(indirect).map(i => i.code)).toEqual(['DEFS_CYCLE', 'DEFS_CYCLE']);
  });
  it('keeps unlabeled equation layers valid but refuses to publish them', () => {
    const course = sceneCourse(); delete course.scenes![0]!.layers[6]!.label;
    expect(issues(course)).toEqual([]);
    expect(publicationIssues(course)).toEqual([expect.objectContaining({ code: 'MISSING_TEXT_ALTERNATIVE', path: '/scenes/0/layers/6/label' })]);
    expect(lint(course, 'MISSING_TEXT_ALTERNATIVE')).toEqual([expect.objectContaining({ severity: 'error' })]);
    compileCourse(course);
  });
});

describe('0.6 browser execution on code items', () => {
  function codeCourse(item: Partial<Assessment> = {}) {
    const course = richCourse();
    course.assessments.push({ id: 'period-code', type: 'code', objectiveIds: ['measure-period'], familyId: 'period-code', prompt: 'Return the period.',
      language: 'python', starterCode: 'def solve(input):\n    pass\n', grading: { evaluatorId: 'grader', fixtureRef: 'fixtures/period' }, browserExecution: 'python', ...item } as Assessment);
    return course;
  }
  it('accepts python runs on python items and an opt-out on any language', () => {
    expect(issues(codeCourse())).toEqual([]);
    expect(issues(codeCourse({ language: 'javascript', browserExecution: 'none' } as Partial<Assessment>))).toEqual([]);
    expect(issues(codeCourse({ type: 'code_repair' } as Partial<Assessment>))).toEqual([]);
  });
  it('rejects a python run on another language', () => {
    expect(issues(codeCourse({ language: 'javascript' } as Partial<Assessment>))).toEqual([
      expect.objectContaining({ code: 'UNSUPPORTED_BROWSER_EXECUTION', path: '/assessments/7/browserExecution' })]);
  });
  it('rejects other values and browserExecution on non-code items', () => {
    expect(codes(codeCourse({ browserExecution: 'node' } as never))).toContain('SCHEMA');
    const course = richCourse(); (course.assessments[0] as unknown as Record<string, unknown>).browserExecution = 'python';
    expect(codes(course)).toContain('SCHEMA');
  });
  it('warns that placement and retention checks never offer a browser run', () => {
    const course = codeCourse(); course.retention!.assessmentIds.push('period-code');
    expect(lint(course, 'BROWSER_RUN_NOT_OFFERED')).toEqual([expect.objectContaining({ severity: 'warning', path: '/assessments/7/browserExecution' })]);
    expect(lint(codeCourse(), 'BROWSER_RUN_NOT_OFFERED')).toEqual([]);
  });
});

describe('0.6 study instruments, pre-test steps and study arms', () => {
  function studyCourse() {
    const course = richCourse();
    course.studyInstruments = { pre: ['period-numeric'], post: ['length-trace'], transfer: ['length-teach'], delayed: ['later-prediction'],
      allowedArms: [{ id: 'fixed', label: 'Fixed path', behaviour: 'fixed' }, { id: 'full', label: 'Full course', behaviour: 'supervisor' }] };
    course.chapters[0]!.episodes[0]!.blocks.push({ id: 'pre-check', type: 'assessment', assessmentId: 'period-numeric' });
    course.learningSteps!.push({ id: 'step-pre', episodeId: 'timing', kind: 'pre_test', requirement: 'required', blockIds: ['pre-check'],
      primaryAction: { label: 'Start the pre-test', blockId: 'pre-check' }, nextStepId: null });
    return course;
  }
  it('accepts instrument sets and a pre-test step over non-gate items, and keeps them server-side', () => {
    const course = studyCourse();
    expect(issues(course)).toEqual([]);
    const compiled = compileCourse(course);
    expect(compiled.server.studyInstruments).toEqual(course.studyInstruments);
    expect(compiled.learner).not.toHaveProperty('studyInstruments');
    expect(JSON.stringify(compiled.learner)).not.toContain('allowedArms');
  });
  it('rejects unknown items, repeated measurements, non-transfer roles and delayed items outside retention', () => {
    const course = studyCourse(); const si = course.studyInstruments!;
    si.pre.push('ghost'); si.post.push('period-numeric'); si.transfer!.push('length-trace'); si.delayed!.push('length-choice');
    expect(issues(course).map(i => [i.code, i.path])).toEqual(expect.arrayContaining([
      ['STUDY_ITEM_IN_TWO_SETS', '/studyInstruments/post/1'],
      ['STUDY_ITEM_IN_TWO_SETS', '/studyInstruments/transfer/1'],
      ['MISSING_REFERENCE', '/studyInstruments/pre/1'],
      ['STUDY_TRANSFER_ROLE', '/studyInstruments/transfer/1'],
      ['STUDY_DELAYED_NOT_RETENTION', '/studyInstruments/delayed/1'],
    ]));
    expect(codes(course)).toHaveLength(5);
  });
  it('rejects duplicate and malformed arms', () => {
    const course = studyCourse(); course.studyInstruments!.allowedArms![1]!.id = 'fixed';
    expect(issues(course)).toEqual([expect.objectContaining({ code: 'DUPLICATE_ID', path: '/studyInstruments/allowedArms/1' })]);
    course.studyInstruments!.allowedArms![1]!.id = 'Full Course';
    expect(codes(course)).toContain('SCHEMA');
    course.studyInstruments!.allowedArms = [{ id: 'only', label: 'Only arm', behaviour: 'fixed' }];
    expect(codes(course)).toContain('SCHEMA');
    (course.studyInstruments as unknown as Record<string, unknown>).allowedArms = [{ id: 'a', label: 'A', behaviour: 'tutor' }, { id: 'b', label: 'B', behaviour: 'fixed' }];
    expect(codes(course)).toContain('SCHEMA');
  });
  it('never lets a pre-test item count as gate evidence', () => {
    const course = studyCourse();
    course.chapters[0]!.episodes[0]!.blocks.push({ id: 'pre-gated', type: 'assessment', assessmentId: 'length-choice' });
    course.learningSteps!.at(-1)!.blockIds.push('pre-gated');
    expect(issues(course)).toEqual([expect.objectContaining({ code: 'PRE_TEST_GATE_EVIDENCE', path: '/learningSteps/3/blockIds' })]);
  });
  it('requires an assessment in a pre-test step and no gate reference', () => {
    const course = studyCourse(); const step = course.learningSteps!.at(-1)!;
    step.blockIds = ['timing-text']; step.primaryAction.blockId = 'timing-text';
    expect(issues(course)).toEqual([expect.objectContaining({ code: 'INVALID_STEP', path: '/learningSteps/3/blockIds' })]);
    const gated = studyCourse(); gated.learningSteps!.at(-1)!.gateId = 'length-ready';
    expect(codes(gated)).toContain('INVALID_STEP');
  });
  it('lints unmatched pre/post objective coverage, gated instrument items and stray pre-test items', () => {
    const course = studyCourse();
    expect(lint(course, 'STUDY_INSTRUMENTS_UNMATCHED')).toEqual([expect.objectContaining({ severity: 'warning',
      message: expect.stringContaining('measure-period') })]);
    course.studyInstruments!.pre = ['length-choice'];
    course.chapters[0]!.episodes[0]!.blocks.push({ id: 'stray', type: 'assessment', assessmentId: 'mass-probe' });
    course.learningSteps!.at(-1)!.blockIds.push('stray');
    expect(lint(course, 'STUDY_INSTRUMENTS_UNMATCHED')).toEqual([]);
    expect(lint(course, 'STUDY_ITEM_GATED').map(f => f.path)).toEqual(['/studyInstruments/pre/0', '/studyInstruments/post/0']);
    expect(lint(course, 'PRE_TEST_NOT_INSTRUMENT').map(f => f.message)).toEqual([
      'period-numeric is presented as a pre-test but is not in studyInstruments.pre.', 'mass-probe is presented as a pre-test but is not in studyInstruments.pre.']);
    course.studyInstruments!.post = [];
    expect(lint(course, 'STUDY_INSTRUMENTS_INCOMPLETE')).toHaveLength(1);
  });
});

describe('0.6 cross-course concept-mapping drafts', () => {
  function mappingCourse() {
    const course = richCourse();
    course.conceptMappingDrafts = [{ id: 'to-waves', status: 'draft', otherCourse: { id: 'waves-intro', version: '2.1.0' }, note: 'Proposed by the course author.',
      links: [
        { relation: 'prerequisite_of', from: { course: 'this', objectiveId: 'measure-period' }, to: { course: 'other', objectiveId: 'wave-period' } },
        { relation: 'prerequisite_of', from: { course: 'other', objectiveId: 'oscillation' }, to: { course: 'this', objectiveId: 'predict-period' } },
        { relation: 'overlaps', from: { course: 'other', objectiveId: 'wave-period' }, to: { course: 'this', objectiveId: 'predict-period' } },
      ] }];
    return course;
  }
  it('accepts a draft, keeps it server-side and labels it a draft in lint', () => {
    const course = mappingCourse();
    expect(issues(course)).toEqual([]);
    expect(compileCourse(course).learner).not.toHaveProperty('conceptMappingDrafts');
    expect(lint(course, 'CONCEPT_MAPPING_DRAFT')).toEqual([expect.objectContaining({ severity: 'info', message: expect.stringContaining('after staff') })]);
  });
  it('rejects links within one course, duplicate pairs, unknown objectives and self-mappings', () => {
    const course = mappingCourse(); const draft = course.conceptMappingDrafts![0]!;
    draft.links.push({ relation: 'equivalent', from: { course: 'this', objectiveId: 'measure-period' }, to: { course: 'this', objectiveId: 'predict-period' } });
    draft.links.push({ relation: 'equivalent', from: { course: 'other', objectiveId: 'wave-period' }, to: { course: 'this', objectiveId: 'measure-period' } });
    draft.links.push({ relation: 'overlaps', from: { course: 'this', objectiveId: 'ghost' }, to: { course: 'other', objectiveId: 'x' } });
    draft.otherCourse.id = course.id;
    expect(issues(course).map(i => [i.code, i.path])).toEqual([
      ['CONCEPT_MAPPING_LINK_SCOPE', '/conceptMappingDrafts/0/links/3'],
      ['CONCEPT_MAPPING_DUPLICATE_LINK', '/conceptMappingDrafts/0/links/4'],
      ['CONCEPT_MAPPING_SAME_COURSE', '/conceptMappingDrafts/0/otherCourse/id'],
      ['MISSING_REFERENCE', '/conceptMappingDrafts/0/links/5/from/objectiveId'],
    ]);
  });
  it('accepts only drafts and known relations, and warns about two drafts for one course', () => {
    const course = mappingCourse();
    (course.conceptMappingDrafts![0] as unknown as Record<string, unknown>).status = 'applied';
    expect(codes(course)).toContain('SCHEMA');
    const relation = mappingCourse(); (relation.conceptMappingDrafts![0]!.links[0] as Record<string, unknown>).relation = 'similar';
    expect(codes(relation)).toContain('SCHEMA');
    const twice = mappingCourse(); twice.conceptMappingDrafts!.push({ ...structuredClone(twice.conceptMappingDrafts![0]!), id: 'to-waves-2' });
    expect(issues(twice)).toEqual([]);
    expect(lint(twice, 'CONCEPT_MAPPING_DRAFT_REPEATED')).toHaveLength(1);
    const dup = mappingCourse(); dup.conceptMappingDrafts!.push(structuredClone(dup.conceptMappingDrafts![0]!));
    expect(codes(dup)).toEqual(['DUPLICATE_ID']);
  });
});

describe('property: 0.6 visual rules', () => {
  const runs = { seed: 6060, numRuns: 60 } as const;
  const FEATURES: RenderFeature[] = ['mask', 'clip', 'gradient', 'blend', 'morph', 'shader', '3d', 'text_layout', 'equation', 'path_draw', 'symbol', 'spring', 'stagger', 'layout_set', 'panes'];
  it('reports UNSUPPORTED_FEATURE exactly for required features no renderer declares', () => {
    fc.assert(fc.property(fc.subarray(FEATURES), fc.subarray(FEATURES), (required, offered) => {
      const course = visualCourse(); const visual = course.visuals[0]!;
      delete visual.panes; visual.layouts = { compact: {}, expanded: {} }; visual.requiredFeatures = required;
      course.renderers!.at(-1)!.features = offered;
      const missing = required.filter(f => !offered.includes(f));
      expect(issues(course).map(i => i.path)).toEqual(missing.map(f => `/visuals/0/requiredFeatures/${required.indexOf(f)}`));
    }), runs);
  });
  it('reports INCOMPLETE_LAYOUT_SET exactly for one or two of the three larger layouts', () => {
    fc.assert(fc.property(fc.boolean(), fc.boolean(), fc.boolean(), (portrait, landscape, wide) => {
      const course = visualCourse(); const visual = course.visuals[0]!;
      visual.layouts = { compact: {}, expanded: {}, ...(portrait && { tabletPortrait: {} }), ...(landscape && { tabletLandscape: {} }), ...(wide && { wide: {} }) };
      const count = [portrait, landscape, wide].filter(Boolean).length;
      if (count < 3) visual.requiredFeatures = ['panes', 'spring'];
      expect(codes(course)).toEqual(count === 1 || count === 2 ? ['INCOMPLETE_LAYOUT_SET'] : []);
    }), runs);
  });
});
