import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as sdk from '../src/index.js';
import { CONTRACT_KINDS, ContractValidationError, validateContract, SDK_VERSION, windowClass } from '../src/index.js';
import type { ContractKind } from '../src/index.js';
import { richCourse } from './contracts-fixture.js';

const course = richCourse();
const ch = course.chapters[0]!;
/** One valid instance of every contract kind, taken from the coherent fixture. */
const samples: Record<ContractKind, unknown> = {
  concept: course.concepts![0], episode: ch.episodes[0], assessment: course.assessments[1], activity: course.activities![0], rubric: course.rubrics![0],
  tool: course.tools![0], adaptationPolicy: course.adaptationPolicies![0], learningPolicy: course.policy, adminSection: course.adminSections![0],
  learningStep: course.learningSteps![0], progressionGate: course.gates[0], mediaResource: course.media[0], storyboard: course.storyboards![0],
  researchTask: course.researchTasks![0], placementPolicy: { enabled: false, learnerMayDecline: true, objectiveIds: [], assessmentIds: [], protectedEpisodeIds: [], maxItems: 1, retestPolicy: { maxAttempts: 2, cooldownDays: 7 } },
  extension: course.extensions[0], renderer: course.renderers![0], evaluator: course.evaluators![0], agentStrategy: course.agentStrategies![0],
  platformAdapter: course.platformAdapters![0], debugInspector: course.debugInspectors![0], visualExperience: course.visuals[0], scene: course.scenes![0],
  timeline: course.timelines![0], rendererAdapter: course.rendererAdapters![0], teachingHypothesis: course.hypotheses![0], diagnosticProbe: course.probes![0],
  stage: course.stages![0],
  interaction: { id: 'drag-length', kind: 'drag', target: 'bob', label: 'Pendulum length', binding: { state: 'length', range: { min: 1, max: 4, step: 0.5 } },
    alternative: { kind: 'keyboard', keys: ['ArrowLeft', 'ArrowRight'] } },
  dataBinding: { state: 'length', range: { min: 1, max: 4, step: 0.5 } },
  visualLayouts: { compact: { stack: true }, expanded: { columns: 3 }, tabletPortrait: { columns: 1 }, tabletLandscape: { columns: 2 }, wide: { columns: 3 } },
  visualPane: { id: 'periods', kind: 'table', title: 'Periods', columns: ['Length (m)', 'Period (s)'], rows: [[1, 2], [4, { state: 'period' }]], highlightRow: { state: 'row' } },
  studyInstruments: { pre: ['length-choice'], post: ['length-trace'], transfer: ['length-teach'], delayed: ['later-prediction'],
    allowedArms: [{ id: 'fixed', label: 'Fixed path', behaviour: 'fixed' }, { id: 'full', label: 'Full course', behaviour: 'supervisor' }] },
  visualChecks: { invariants: [{ id: 'period-matches', description: 'The table period equals the formula value.', assert: { op: 'eq', args: [{ state: 'length' }, 1] }, times: [0, 500] }],
    goldens: [{ atMs: 0, layout: 'compact', digest: `sha256-${'0'.repeat(64)}` }] },
  conceptMappingDraft: { id: 'to-waves', status: 'draft', otherCourse: { id: 'waves-intro', version: '1.0.0' },
    links: [{ relation: 'prerequisite_of', from: { course: 'this', objectiveId: 'measure-period' }, to: { course: 'other', objectiveId: 'wave-period' } }] },
};
/** A context-free semantic violation for each kind with standalone rules. */
const semanticBreaks: Partial<Record<ContractKind, [(v: any) => void, string]>> = {
  assessment: [v => { v.role = 'transfer'; }, 'TRANSFER_REQUIRES_PRODUCTION'],
  activity: [v => { v.accessibleSemantics.nonPointerPath = false; }, 'INACCESSIBLE_ACTIVITY'],
  rubric: [v => { for (const c of v.criteria) c.required = false; }, 'RUBRIC_WITHOUT_REQUIRED_CRITERION'],
  tool: [v => { v.capabilities = ['grade.issue']; }, 'FORBIDDEN_CAPABILITY'],
  learningPolicy: [v => { delete v.work; }, 'UNBOUNDED_POLICY'],
  adminSection: [v => { v.settings[1].default = 'astral'; }, 'INVALID_SETTING_DEFAULT'],
  learningStep: [v => { v.primaryAction.blockId = 'elsewhere'; }, 'INVALID_STEP'],
  progressionGate: [v => { v.readinessCriteria = v.readinessCriteria.filter((c: any) => c.kind !== 'transfer_success'); }, 'MISSING_TRANSFER_CRITERION'],
  mediaResource: [v => { v.segment = { startSeconds: 5, endSeconds: 1 }; }, 'INVALID_SEGMENT'],
  storyboard: [v => { v.script = []; }, 'MISSING_SCRIPT'],
  evaluator: [v => { v.humanConfirmation = 'none'; }, 'UNCONFIRMED_MODEL_JUDGMENT'],
  agentStrategy: [v => { v.autonomy.maxAppliedChangesPerDay = 0; }, 'INVALID_AUTONOMY'],
  platformAdapter: [v => { v.requiresAppBuild = false; }, 'NATIVE_REQUIRES_BUILD'],
  debugInspector: [v => { v.requiredPermissions = ['audit.read']; }, 'DEBUG_PERMISSION_REQUIRED'],
  scene: [v => { v.layers[0].semanticNodeIds = ['ghost']; }, 'MISSING_REFERENCE'],
  timeline: [v => { v.cues = [{ atMs: 3000, event: 'b' }, { atMs: 1000, event: 'a' }]; }, 'INVALID_TIMELINE'],
  rendererAdapter: [v => { v.fallbacks = [{ feature: 'path_draw', fallback: 'equivalent_static' }]; }, 'REDUNDANT_FALLBACK'],
  teachingHypothesis: [v => { v.kind = 'slip'; }, 'INVALID_HYPOTHESIS'],
  diagnosticProbe: [v => { v.signals[0].hypothesisId = 'unrelated'; }, 'INVALID_PROBE'],
  visualExperience: [v => { v.layouts.wide = {}; }, 'INCOMPLETE_LAYOUT_SET'],
  interaction: [v => { delete v.alternative; }, 'INACCESSIBLE_INTERACTION'],
  dataBinding: [v => { v.range = { min: 4, max: 1 }; }, 'INVALID_BINDING'],
  visualLayouts: [v => { v.wide = v.compact; delete v.tabletLandscape; }, 'INCOMPLETE_LAYOUT_SET'],
  visualPane: [v => { v.rows.push([7]); }, 'INVALID_PANE'],
  studyInstruments: [v => { v.post.push('length-choice'); }, 'STUDY_ITEM_IN_TWO_SETS'],
  conceptMappingDraft: [v => { v.links[0].to.course = 'this'; }, 'CONCEPT_MAPPING_LINK_SCOPE'],
  visualChecks: [v => { v.goldens.push({ ...v.goldens[0] }); }, 'DUPLICATE_ID'],
};
/** The authoring helper of each kind: define<Kind>, or the two named helpers. */
function helperFor(kind: string): ((v: any) => unknown) | undefined {
  if (kind === 'dataBinding') return (v) => sdk.bindData(v.state, v);
  if (kind === 'visualLayouts') return (v) => sdk.responsiveVariant(v);
  return (sdk as Record<string, unknown>)[`define${kind[0]!.toUpperCase()}${kind.slice(1)}`] as ((v: unknown) => unknown) | undefined;
}

describe('validating define* helpers', () => {
  it('covers every define* function the approved design lists', () => {
    const design = ['defineCourse', 'defineConcept', 'defineEpisode', 'defineAssessment', 'defineActivity', 'defineRubric', 'defineTool', 'defineAdaptationPolicy',
      'defineLearningPolicy', 'defineAdminSection', 'defineLearningStep', 'defineProgressionGate', 'defineMediaResource', 'defineStoryboard', 'defineResearchTask',
      'definePlacementPolicy', 'defineExtension', 'defineRenderer', 'defineEvaluator', 'defineAgentStrategy', 'definePlatformAdapter', 'defineDebugInspector',
      'defineVisualExperience', 'defineScene', 'defineTimeline', 'defineRendererAdapter', 'bindData', 'responsiveVariant', 'defineInteraction', 'defineVisualPane',
      'defineStudyInstruments', 'defineConceptMappingDraft', 'defineVisualChecks'];
    for (const name of design) expect(typeof (sdk as Record<string, unknown>)[name], name).toBe('function');
  });
  it.each(CONTRACT_KINDS)('%s: accepts a valid contract and returns a detached copy', (kind) => {
    const value = structuredClone(samples[kind]);
    const result = validateContract(kind, value);
    expect(result.issues).toEqual([]);
    const define = helperFor(kind);
    if (define) {
      const copy = define(value) as Record<string, unknown>;
      expect(copy).toEqual(value); expect(copy).not.toBe(value);
    }
  });
  it.each(CONTRACT_KINDS)('%s: rejects unknown fields and non-JSON values', (kind) => {
    expect(validateContract(kind, { ...(samples[kind] as object), injected: true }).issues.map(i => i.code)).toContain('SCHEMA');
    expect(validateContract(kind, { ...(samples[kind] as object), id: () => 1 }).issues.map(i => i.code)).toContain('NOT_JSON');
  });
  it.each(Object.entries(semanticBreaks))('%s: rejects a semantic violation', (kind, [mutate, code]) => {
    const value = structuredClone(samples[kind as ContractKind]); mutate(value);
    const result = validateContract(kind as ContractKind, value);
    expect(result.issues.map(i => i.code)).toContain(code);
    expect(() => helperFor(kind)!(value)).toThrow(ContractValidationError);
  });
  it('rejects unknown contract kinds', () => {
    expect(validateContract('banana' as ContractKind, {}).issues[0]!.code).toBe('UNKNOWN_CONTRACT');
  });
  it('0.6: defineCourse, defineExtension and defineVisualExperience validate instead of copying', () => {
    for (const [define, value] of [[sdk.defineExtension, { id: 'not valid' }], [sdk.defineVisualExperience, { id: 'not valid' }], [sdk.defineCourse, { id: 'not valid' }]] as const) {
      let error: unknown;
      try { (define as (v: unknown) => unknown)(value); } catch (e) { error = e; }
      expect(error).toBeInstanceOf(ContractValidationError);
      expect((error as ContractValidationError).issues.map(i => i.code)).toContain('SCHEMA');
    }
    const authored = sdk.defineCourse(course);
    expect(authored).toEqual(course); expect(authored).not.toBe(course);
    const broken = structuredClone(course); broken.visuals[0]!.rendererId = 'ghost';
    expect(() => sdk.defineCourse(broken)).toThrow(expect.objectContaining({ contract: 'course', issues: [expect.objectContaining({ code: 'MISSING_REFERENCE', path: '/visuals/0/rendererId/0' })] }));
  });
  it('0.6: defineScene also applies the equation text-alternative publication rule', () => {
    const scene = structuredClone(course.scenes![0]!);
    scene.semanticNodes.push({ id: 'formula', label: 'Period formula', role: 'relation' });
    scene.layers.push({ id: 'period-formula', kind: 'equation', semanticNodeIds: ['formula'], decorative: false });
    expect(validateContract('scene', scene).valid).toBe(true);
    expect(() => sdk.defineScene(scene)).toThrow(expect.objectContaining({ issues: [expect.objectContaining({ code: 'MISSING_TEXT_ALTERNATIVE', path: '/layers/2/label' })] }));
    scene.layers[2]!.label = '   ';
    expect(() => sdk.defineScene(scene)).toThrow(ContractValidationError);
    scene.layers[2]!.label = 'T equals two pi root L over g';
    expect(sdk.defineScene(scene).layers[2]!.label).toBe('T equals two pi root L over g');
  });
  it('derives window classes from logical width and font scale', () => {
    expect([windowClass(599), windowClass(600), windowClass(839), windowClass(840), windowClass(1000, 2)]).toEqual(['compact', 'medium', 'medium', 'expanded', 'compact']);
    expect(() => windowClass(Number.NaN)).toThrow(RangeError);
  });
  it('reports the package version', () => {
    expect(SDK_VERSION).toBe(JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version);
  });
});
