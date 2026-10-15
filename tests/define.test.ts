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
};
const helperName = (kind: string) => `define${kind[0]!.toUpperCase()}${kind.slice(1)}`;

describe('validating define* helpers', () => {
  it('covers every define* function the approved design lists', () => {
    const design = ['defineCourse', 'defineConcept', 'defineEpisode', 'defineAssessment', 'defineActivity', 'defineRubric', 'defineTool', 'defineAdaptationPolicy',
      'defineLearningPolicy', 'defineAdminSection', 'defineLearningStep', 'defineProgressionGate', 'defineMediaResource', 'defineStoryboard', 'defineResearchTask',
      'definePlacementPolicy', 'defineExtension', 'defineRenderer', 'defineEvaluator', 'defineAgentStrategy', 'definePlatformAdapter', 'defineDebugInspector',
      'defineVisualExperience', 'defineScene', 'defineTimeline', 'defineRendererAdapter'];
    for (const name of design) expect(typeof (sdk as Record<string, unknown>)[name], name).toBe('function');
  });
  it.each(CONTRACT_KINDS)('%s: accepts a valid contract and returns a detached copy', (kind) => {
    const value = structuredClone(samples[kind]);
    const result = validateContract(kind, value);
    expect(result.issues).toEqual([]);
    const define = (sdk as Record<string, unknown>)[helperName(kind)] as ((v: unknown) => unknown) | undefined;
    if (define && !['extension', 'visualExperience'].includes(kind)) {
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
    const define = (sdk as Record<string, unknown>)[helperName(kind)] as (v: unknown) => unknown;
    expect(() => define(value)).toThrow(ContractValidationError);
  });
  it('rejects unknown contract kinds', () => {
    expect(validateContract('banana' as ContractKind, {}).issues[0]!.code).toBe('UNKNOWN_CONTRACT');
  });
  it('keeps the 0.4 clone-only helpers unchanged', () => {
    expect(sdk.defineExtension({ id: 'not valid' } as never)).toEqual({ id: 'not valid' });
  });
  it('derives window classes from logical width and font scale', () => {
    expect([windowClass(599), windowClass(600), windowClass(839), windowClass(840), windowClass(1000, 2)]).toEqual(['compact', 'medium', 'medium', 'expanded', 'compact']);
    expect(() => windowClass(Number.NaN)).toThrow(RangeError);
  });
  it('reports the package version', () => {
    expect(SDK_VERSION).toBe(JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version);
  });
});
