import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { conformanceReport, CourseBundleError, migrateCourse, packCourse } from '../src/compiler.js';
import { gateConversation, lintCourse, publicationIssues, validateContract, validateCourse } from '../src/index.js';
import type { CourseManifest, LegacyProgressionGate } from '../src/types.js';
import type { EvaluatorDefinition, VersionedProgressionGate } from '../src/contracts-types.js';
import { richCourse } from './contracts-fixture.js';

// Course Core publishes an unversioned 0.4 gate judged in conversation when its
// conversationalEvaluatorId names an evaluator definition bound to exactly one cited rubric.
// The conversation then counts as one item family, and the gate must still reach its families.
const legacy = (): CourseManifest => JSON.parse(readFileSync(new URL('../fixtures/compat-0.4.0/feature-tour.course.json', import.meta.url), 'utf8'));
const GATE = 2;

function conversational(method: EvaluatorDefinition['method'] = 'human', itemTypes: EvaluatorDefinition['itemTypes'] = ['rubric']) {
  const course = legacy();
  course.rubrics = [{ id: 'explain-walk', version: '1.0.0', title: 'Explaining a walk plan', requiresCitedEvidence: true, uncertain: 'pending_review',
    criteria: [{ id: 'order', description: 'Explains why the stops are visited in this order.', required: true, evidence: 'cited_learner_span' }] }];
  course.evaluators = [{ id: 'walk-review', version: '1.0.0', extensionId: 'evaluator', method, itemTypes, rubricIds: ['explain-walk'],
    humanConfirmation: method === 'deterministic' ? 'none' : 'required', outputs: { uncertainty: true, provenance: true },
    tests: { fixtureRef: 'fixtures/walk-review', acceptsValidVariants: true, rejectsMisconceptions: true } }];
  const gate = course.gates[GATE] as LegacyProgressionGate;
  gate.conversationalEvaluatorId = 'walk-review';
  return { course, gate, evaluator: course.evaluators[0]! };
}
const codes = (course: unknown) => publicationIssues(course).map(i => `${i.code} ${i.path}`);
const lintErrors = (course: unknown) => lintCourse(course).filter(f => f.severity === 'error').map(f => `${f.code} ${f.path}`);
const packIssues = (course: unknown) => {
  try { packCourse(course); return []; } catch (error) {
    expect(error).toBeInstanceOf(CourseBundleError);
    return (error as CourseBundleError).issues.map(i => `${i.code} ${i.path}`);
  }
};
const publishable = (course: unknown) => conformanceReport(course).checks.find(c => c.id === 'publishable')!.status;

describe('0.4 conversational gates', () => {
  it('publish when the evaluator definition names exactly one cited rubric', () => {
    const { course, gate } = conversational();
    expect(validateCourse(course).issues).toEqual([]);
    expect(gateConversation(course, gate)?.rubric.id).toBe('explain-walk');
    expect(codes(course)).toEqual([]);
    expect(lintErrors(course)).toEqual([]);
    expect(publishable(course)).toBe('passed');
    expect(packIssues(course)).toEqual([]);
  });

  it('refuse a bare extension ID in lint, test and pack with the gate path', () => {
    const { course, gate } = conversational();
    gate.conversationalEvaluatorId = 'evaluator';
    const refusal = [`CONVERSATIONAL_GATE_UNSUPPORTED /gates/${GATE}/conversationalEvaluatorId`];
    expect(validateCourse(course).valid).toBe(true);
    expect(gateConversation(course, gate)).toBeUndefined();
    expect(codes(course)).toEqual(refusal);
    expect(lintErrors(course)).toEqual(refusal);
    expect(publishable(course)).toBe('failed');
    expect(packIssues(course)).toEqual(refusal);
  });

  it.each([
    ['is bound to two rubrics', (c: ReturnType<typeof conversational>) => {
      c.course.rubrics!.push({ ...c.course.rubrics![0]!, id: 'explain-walk-2' });
      c.evaluator.rubricIds = ['explain-walk', 'explain-walk-2'];
    }],
    ['is bound to no rubric', (c: ReturnType<typeof conversational>) => { delete c.evaluator.rubricIds; }],
    ['lets a model decide when it is sure', (c: ReturnType<typeof conversational>) => {
      Object.assign(c.evaluator, { method: 'rubric_model_assisted', humanConfirmation: 'on_uncertain' });
    }],
    ['is a human method without required confirmation', (c: ReturnType<typeof conversational>) => { c.evaluator.humanConfirmation = 'on_uncertain'; }],
    ['runs code tests', (c: ReturnType<typeof conversational>) => { Object.assign(c.evaluator, { method: 'code_tests', itemTypes: ['code'] }); }],
  ])('refuse an evaluator definition that %s', (_, change) => {
    const c = conversational();
    change(c);
    expect(validateCourse(c.course).issues).toEqual([]);
    expect(codes(c.course)).toEqual([`CONVERSATIONAL_GATE_UNSUPPORTED /gates/${GATE}/conversationalEvaluatorId`]);
    expect(packIssues(c.course)).toEqual([`CONVERSATIONAL_GATE_UNSUPPORTED /gates/${GATE}/conversationalEvaluatorId`]);
  });

  it('accept a human-confirmed model draft', () => {
    const c = conversational();
    Object.assign(c.evaluator, { method: 'rubric_model_assisted', humanConfirmation: 'required' });
    expect(codes(c.course)).toEqual([]);
  });

  it('refuse a rubric that does not require cited evidence', () => {
    const { course } = conversational();
    course.rubrics![0]!.requiresCitedEvidence = false;
    expect(validateCourse(course).issues).toEqual([]);
    expect(codes(course)).toEqual([`CONVERSATION_RUBRIC_UNSUPPORTED /gates/${GATE}/conversationalEvaluatorId`]);
    expect(lintErrors(course)).toEqual([`CONVERSATION_RUBRIC_UNSUPPORTED /gates/${GATE}/conversationalEvaluatorId`]);
    expect(packIssues(course)).toEqual([`CONVERSATION_RUBRIC_UNSUPPORTED /gates/${GATE}/conversationalEvaluatorId`]);
  });

  it('count the conversation as one family and refuse a gate that cannot reach the rest', () => {
    const { course, gate } = conversational();
    // One listed item family plus the conversation.
    gate.minimumIndependentFamilies = 2;
    expect(validateCourse(course).issues).toEqual([]);
    expect(codes(course)).toEqual([]);
    gate.minimumIndependentFamilies = 3;
    expect(validateCourse(course).issues).toEqual([]);
    expect(codes(course)).toEqual([`GATE_EVIDENCE_UNREACHABLE /gates/${GATE}`]);
    expect(lintErrors(course)).toEqual([`GATE_EVIDENCE_UNREACHABLE /gates/${GATE}`]);
    expect(publishable(course)).toBe('failed');
    expect(packIssues(course)).toEqual([`GATE_EVIDENCE_UNREACHABLE /gates/${GATE}`]);
  });

  it('let the conversation cover an objective without items, per objective', () => {
    const { course, gate } = conversational();
    gate.assessmentIds = [];
    expect(validateCourse(course).issues).toEqual([]);
    expect(codes(course)).toEqual([]);
    // Families count per objective: an item on another objective does not help.
    gate.objectiveIds = ['plan-walk', 'read-table'];
    gate.assessmentIds = ['row-choice'];
    gate.minimumIndependentFamilies = 2;
    expect(validateCourse(course).issues).toEqual([]);
    expect(codes(course)).toEqual([`GATE_EVIDENCE_UNREACHABLE /gates/${GATE}`]);
    gate.requireAllObjectives = false;
    expect(codes(course)).toEqual([]);
  });

  it('keep the item-only rule for a gate whose conversation cannot decide', () => {
    const { course, gate } = conversational();
    gate.conversationalEvaluatorId = 'evaluator';
    gate.minimumIndependentFamilies = 2;
    expect(validateCourse(course).issues.map(i => i.code)).toEqual(['INSUFFICIENT_ITEM_FAMILIES']);
  });

  it('migrate to a versioned gate that cites the same rubric', () => {
    const { course } = conversational();
    const result = migrateCourse(course);
    const gate = result.course.gates[GATE]!;
    expect(gate).toMatchObject({ conversationalRubricRef: 'explain-walk', eligibleEvidenceKinds: expect.arrayContaining(['rubric_backed_conversation']) });
    expect(JSON.stringify(gate)).not.toContain('conversationalEvaluatorId');
    expect(result.manualSteps.join('\n')).not.toContain('replace conversationalEvaluatorId');
    // The conversation supplies the migrated gate's transfer evidence; only the other gates need manual steps.
    expect(result.issues.filter(i => i.path.startsWith(`/gates/${GATE}`))).toEqual([]);
  });
});

describe('conversation evaluator item type', () => {
  it('lets a deterministic evaluator declare conversations instead of a keyed item type', () => {
    const { course, gate } = conversational('deterministic', ['conversation']);
    expect(validateCourse(course).issues).toEqual([]);
    expect(gateConversation(course, gate)?.evaluator.id).toBe('walk-review');
    expect(codes(course)).toEqual([]);
    // The 0.5 workaround, a keyed item type, stays valid.
    expect(validateCourse(conversational('deterministic', ['trace']).course).issues).toEqual([]);
    // Without the conversation type a deterministic evaluator still cannot claim rubric items.
    expect(validateCourse(conversational('deterministic', ['rubric']).course).issues.map(i => `${i.code} ${i.path}`))
      .toEqual(['INVALID_EVALUATOR /evaluators/0/itemTypes']);
  });

  it('requires a rubric and a method that may judge conversations', () => {
    const base = conversational('deterministic', ['conversation']).evaluator;
    expect(validateContract('evaluator', base).valid).toBe(true);
    const { rubricIds: _, ...unbound } = base;
    expect(validateContract('evaluator', unbound).issues.map(i => `${i.code} ${i.path}`)).toEqual(['INVALID_EVALUATOR /rubricIds']);
    expect(validateContract('evaluator', { ...base, method: 'external', itemTypes: ['conversation', 'code'] }).issues.map(i => `${i.code} ${i.path}`))
      .toEqual(['INVALID_EVALUATOR /method']);
    expect(validateContract('evaluator', { ...base, itemTypes: ['dialogue'] }).valid).toBe(false);
  });
});

describe('versioned conversational gates', () => {
  const ref = (course: CourseManifest) => course.gates.findIndex(g => (g as VersionedProgressionGate).conversationalRubricRef !== undefined);
  it('publish when an evaluator that judges conversations lists the rubric', () => {
    const course = richCourse();
    expect(ref(course)).toBe(0);
    expect(gateConversation(course, course.gates[0]!)?.evaluator.id).toBe('explain-evaluator');
    expect(codes(course)).toEqual([]);
    expect(publishable(course)).toBe('passed');
    expect(packIssues(course)).toEqual([]);
    // A deterministic evaluator that confirms quoted findings also judges conversations.
    Object.assign(course.evaluators![0]!, { method: 'deterministic', itemTypes: ['conversation'], humanConfirmation: 'none' });
    course.assessments = course.assessments.filter(a => a.type !== 'teach_back');
    for (const gate of course.gates as VersionedProgressionGate[])
      if (gate.interactiveCheckRefs) gate.interactiveCheckRefs = gate.interactiveCheckRefs.filter(id => course.assessments.some(a => a.id === id));
    expect(validateCourse(course).issues).toEqual([]);
    expect(codes(course)).toEqual([]);
  });

  it.each([
    ['a human confirms only uncertain model judgments', (c: CourseManifest) => { c.evaluators![0]!.humanConfirmation = 'on_uncertain'; }],
    ['no evaluator lists the rubric', (c: CourseManifest) => {
      c.rubrics!.push({ ...c.rubrics![0]!, id: 'explain-rubric-2' });
      (c.gates[0] as VersionedProgressionGate).conversationalRubricRef = 'explain-rubric-2';
    }],
  ])('refuse a conversationalRubricRef when %s, in lint, test and pack', (_, change) => {
    const course = richCourse();
    change(course);
    const refusal = ['CONVERSATION_RUBRIC_UNSUPPORTED /gates/0/conversationalRubricRef'];
    expect(validateCourse(course).valid).toBe(true);
    expect(codes(course)).toEqual(refusal);
    expect(lintErrors(course)).toEqual(refusal);
    expect(publishable(course)).toBe('failed');
    expect(packIssues(course)).toEqual(refusal);
  });

});
