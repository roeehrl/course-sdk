import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { checkGateDecision, decideGate, validateRecord, validateResearchRequest, validateResearchResult } from '../src/index.js';
import type { Evidence, ResearchRequest } from '../src/index.js';
import type { ReadinessCriterion, VersionedProgressionGate } from '../src/contracts-types.js';
import { richCourse } from './contracts-fixture.js';
import { courseFixture } from './fixture.js';

const digest = 'a'.repeat(64);
const context = { decisionId: 'd-1', enrollmentId: 'enr-1', courseDigest: digest, policyRevision: 1, decidedAt: '2026-10-15T12:00:00Z' };
let n = 0;
function ev(assessmentId: string, familyId: string, overrides: Partial<Evidence> = {}): Evidence {
  n++;
  return { id: `ev-${String(n).padStart(3, '0')}`, attemptId: `att-${n}`, enrollmentId: 'enr-1', courseDigest: digest, assessmentId, familyId, objectiveIds: ['predict-period'],
    mode: 'deterministic_check', outcome: 'correct', independence: 'independent', author: 'learner', assistance: { hintsUsed: 0, answerRevealed: false, tutorAuthoredContent: false },
    reattemptOf: null, misconceptionIds: [], confidence: null, evaluator: { id: 'deterministic', version: '1.0.0' }, issuedAt: `2026-10-15T10:${String(n % 60).padStart(2, '0')}:00Z`, ...overrides };
}
const recognition = () => ev('length-choice', 'length-recognize');
const transfer = () => ev('length-prediction', 'length-predict');
const decide = (evidence: Evidence[], extra = {}) => {
  const result = decideGate(richCourse(), 'length-ready', evidence, { ...context, ...extra });
  if (!result.valid) throw new Error(JSON.stringify(result.issues));
  return result.decision;
};

describe('gate decisions (reference evaluator)', () => {
  it('is ready with independent transfer across two families and binds versions', () => {
    const d = decide([recognition(), transfer()]);
    expect(d.status).toBe('ready');
    expect(d.gateVersion).toBe('1.0.0');
    expect(d.nextActions).toEqual([{ kind: 'continue', label: 'Continue', messageId: 'gate.action.continue' }]);
    expect(validateRecord('gateDecision', d).valid).toBe(true);
    expect(checkGateDecision(richCourse(), d)).toEqual({ valid: true, issues: [] });
  });
  it('a recognition-only record cannot pass, however many guesses succeed', () => {
    const d = decide([recognition(), recognition(), recognition()]);
    expect(d.status).toBe('needs_evidence');
    expect(d.criterionResults.find(c => c.criterionId === 'transfer')!.met).toBe(false);
    expect(d.nextActions[0]).toMatchObject({ kind: 'attempt_check', targetId: 'length-prediction' });
  });
  it('assisted, reattempted, probe and agent-authored work never counts', () => {
    const assisted = transfer(); assisted.independence = 'assisted'; assisted.assistance.hintsUsed = 1;
    const retry = transfer(); retry.independence = 'assisted'; retry.reattemptOf = 'ev-x';
    const agent = transfer(); agent.author = 'agent'; agent.independence = 'synthetic';
    const probe = ev('mass-probe', 'mass-probe', { mode: 'diagnostic_probe' });
    expect(decide([recognition(), assisted, retry, agent, probe]).status).not.toBe('ready');
  });
  it('an unresolved critical misconception blocks readiness until a later independent check resolves it', () => {
    const before = transfer(); before.issuedAt = '2026-10-15T09:00:00Z';
    const right = recognition(); right.issuedAt = '2026-10-15T09:01:00Z';
    const wrong = ev('length-choice', 'length-recognize', { outcome: 'incorrect', misconceptionIds: ['mass-matters'], issuedAt: '2026-10-15T09:02:00Z' });
    const d = decide([before, right, wrong]);
    expect(d.status).toBe('needs_evidence');
    expect(d.unresolvedMisconceptionIds).toEqual(['mass-matters']);
    expect(decide([before, right, wrong, transfer()]).status).toBe('ready');
  });
  it('"I don\'t know" is not failure evidence but repeated struggle offers help', () => {
    const idk = () => ev('length-prediction', 'length-predict', { outcome: 'abstained' });
    expect(decide([idk()]).status).toBe('needs_evidence');
    const d = decide([idk(), ev('length-prediction', 'length-predict', { outcome: 'incorrect' })]);
    expect(d.status).toBe('needs_help');
    expect(d.nextActions[0]!.kind).toBe('request_help');
  });
  it('pending review is under_review, and a cap closes with gaps (never an automatic pass)', () => {
    expect(decide([recognition(), ev('length-prediction', 'length-predict', { outcome: 'pending_review' })]).status).toBe('under_review');
    const closed = decide([recognition()], { capReached: true });
    expect(closed.status).toBe('closed_with_gaps');
    expect(closed.nextActions.map(a => a.kind)).toEqual(['view_gaps', 'appeal']);
    expect(validateRecord('gateDecision', closed).valid).toBe(true);
  });
  it('conversational evidence counts only when it cites the learner against the rubric version', () => {
    const talk = (cited: boolean, version = '1.0.0') => ev('length-teach', 'length-explain', { mode: 'rubric_conversation', rubricRevision: { id: 'explain-rubric', version },
      ...(cited ? { citedSpans: [{ turnId: 't-1', quote: 'Only the length changes the period.' }] } : {}) });
    expect(decideGate(richCourse(), 'length-ready', [recognition(), talk(false)], context).valid).toBe(false);
    expect(decide([recognition(), talk(true, '0.9.0')]).status).not.toBe('ready');
    expect(decide([recognition(), talk(true)]).status).toBe('ready');
  });
  it('never claims "no critical misconception" without independent evidence to cite', () => {
    const empty = decide([]);
    const misconception = empty.criterionResults.find(c => c.criterionId === 'misconceptions')!;
    expect(misconception).toMatchObject({ met: false, evidenceRefs: [] });
    expect(misconception.reasonMessages).toEqual([{ id: 'gate.criterion.no_critical_misconception.no_evidence', params: { objectives: ['predict-period'] } }]);
    expect(empty.status).toBe('needs_evidence');
    expect(validateRecord('gateDecision', empty)).toMatchObject({ valid: true, issues: [] });
    expect(checkGateDecision(richCourse(), empty)).toEqual({ valid: true, issues: [] });
    // Only assisted or unsuccessful work: still nothing to rule a misconception out with.
    const assisted = transfer(); assisted.independence = 'assisted'; assisted.assistance.hintsUsed = 1;
    const wrong = ev('length-choice', 'length-recognize', { outcome: 'incorrect' });
    for (const d of [decide([assisted, wrong]), decide([], { capReached: true })]) {
      expect(d.criterionResults.find(c => c.criterionId === 'misconceptions')!.met).toBe(false);
      expect(validateRecord('gateDecision', d).valid).toBe(true);
    }
    // One independent success on the objective is enough to cite, and the criterion cites it.
    const right = recognition();
    const met = decide([right]).criterionResults.find(c => c.criterionId === 'misconceptions')!;
    expect(met).toMatchObject({ met: true, evidenceRefs: [right.id] });
    // An open misconception keeps the existing message with its IDs.
    const signal = ev('length-choice', 'length-recognize', { outcome: 'incorrect', misconceptionIds: ['mass-matters'] });
    expect(decide([signal]).criterionResults.find(c => c.criterionId === 'misconceptions')!.reasonMessages)
      .toEqual([{ id: 'gate.criterion.no_critical_misconception.unmet', params: { misconceptions: ['mass-matters'] } }]);
  });
  it('is deterministic for the same inputs in any order', () => {
    const items = [recognition(), transfer()];
    expect(decide(items)).toEqual(decide([...items].reverse()));
  });
  it('rejects evidence from another enrollment or course version, and legacy gates', () => {
    expect(decideGate(richCourse(), 'length-ready', [ev('length-prediction', 'x', { enrollmentId: 'other' })], context).issues[0]!.code).toBe('EVIDENCE_BINDING');
    expect(decideGate(courseFixture(), 'compare-ready', [], context).issues[0]!.code).toBe('LEGACY_GATE');
  });
  it('flags stale or unlinked stored decisions (U16)', () => {
    const d = decide([recognition(), transfer()]);
    const course = richCourse(); (course.gates[0] as VersionedProgressionGate).version = '1.1.0';
    expect(checkGateDecision(course, d).issues.map(i => i.code)).toContain('STALE_DECISION');
    expect(checkGateDecision(richCourse(), { ...d, criterionResults: d.criterionResults.slice(1) }).issues.map(i => i.code)).toContain('UNLINKED_DECISION');
  });
});

describe('gate decisions (properties)', () => {
  const items = ['length-choice', 'length-prediction', 'length-trace', 'length-teach', 'mass-probe', 'later-prediction', 'period-numeric'];
  const families: Record<string, string> = { 'length-choice': 'length-recognize', 'length-prediction': 'length-predict', 'length-trace': 'length-trace',
    'length-teach': 'length-explain', 'mass-probe': 'mass-probe', 'later-prediction': 'later', 'period-numeric': 'period-measure' };
  // Every combination validateRecord('evidence') accepts for learner work, plus synthetic agent output.
  const provenance = fc.constantFrom(
    { independence: 'independent', author: 'learner', hints: 0, reattempt: false },
    { independence: 'assisted', author: 'learner', hints: 1, reattempt: false },
    { independence: 'assisted', author: 'learner', hints: 0, reattempt: true },
    { independence: 'synthetic', author: 'agent', hints: 0, reattempt: false },
  ) as fc.Arbitrary<{ independence: Evidence['independence']; author: Evidence['author']; hints: number; reattempt: boolean }>;
  const step = fc.record({
    item: fc.constantFrom(...items),
    outcome: fc.constantFrom<Evidence['outcome']>('correct', 'incorrect', 'partial', 'abstained', 'pending_review'),
    provenance,
    misconception: fc.boolean(),
    objectives: fc.constantFrom<string[]>(['predict-period'], ['measure-period'], ['predict-period', 'measure-period']),
    conversation: fc.constantFrom('none', 'cited', 'stale'),
    minute: fc.integer({ min: 0, max: 5 }),
  });
  type Step = typeof step extends fc.Arbitrary<infer T> ? T : never;
  const toEvidence = (s: Step, i: number): Evidence => {
    const conversation = s.item === 'length-teach' && s.conversation !== 'none';
    return {
      id: `p-${i}`, attemptId: `pa-${i}`, enrollmentId: 'enr-1', courseDigest: digest, assessmentId: s.item, familyId: families[s.item]!, objectiveIds: s.objectives,
      mode: s.item === 'mass-probe' ? 'diagnostic_probe' : conversation ? 'rubric_conversation' : 'deterministic_check',
      outcome: s.outcome, independence: s.provenance.independence, author: s.provenance.author,
      assistance: { hintsUsed: s.provenance.hints, answerRevealed: false, tutorAuthoredContent: false }, reattemptOf: s.provenance.reattempt ? 'p-x' : null,
      misconceptionIds: s.misconception && s.outcome !== 'abstained' ? ['mass-matters'] : [], confidence: null, evaluator: { id: 'deterministic', version: '1.0.0' },
      ...(conversation ? { rubricRevision: { id: 'explain-rubric', version: s.conversation === 'cited' ? '1.0.0' : '0.9.0' }, citedSpans: [{ turnId: `t-${i}`, quote: 'Length sets it.' }] } : {}),
      issuedAt: `2026-10-15T10:0${s.minute}:00Z`,
    };
  };
  // Gate variants the course validator accepts: criterion scopes, thresholds and optional criteria.
  const gateVariant = fc.record({
    families: fc.integer({ min: 1, max: 3 }),
    misconceptionScope: fc.constantFrom<string[]>([], ['predict-period']),
    rubric: fc.boolean(),
    criticalHypothesis: fc.boolean(),
  });
  const courseFor = (v: typeof gateVariant extends fc.Arbitrary<infer T> ? T : never) => {
    const course = richCourse();
    const gate = course.gates[0] as VersionedProgressionGate;
    gate.minimumIndependentEvidence.families = v.families;
    const misconception = gate.readinessCriteria.find(c => c.kind === 'no_critical_misconception')!;
    misconception.objectiveIds = v.misconceptionScope;
    if (v.rubric) gate.readinessCriteria.push({ id: 'explain', kind: 'rubric_criteria', description: 'Explain it.', objectiveIds: [] } satisfies ReadinessCriterion);
    if (!v.criticalHypothesis) {
      course.hypotheses = course.hypotheses!.map(h => h.kind === 'misconception' ? { ...h, critical: false } : h);
      gate.readinessCriteria = gate.readinessCriteria.filter(c => c.kind !== 'no_critical_misconception');
    }
    return course;
  };
  const decisionContext = fc.record({ capReached: fc.boolean(), helpThreshold: fc.integer({ min: 1, max: 3 }), locale: fc.constantFrom('en', 'he') }, { requiredKeys: ['capReached', 'helpThreshold'] });

  it('every decision decideGate produces passes validateRecord and checkGateDecision', () => {
    fc.assert(fc.property(gateVariant, fc.array(step, { maxLength: 10 }), decisionContext, (variant, steps, extra) => {
      const course = courseFor(variant);
      const evidence = steps.map(toEvidence);
      for (const e of evidence) expect(validateRecord('evidence', e).issues).toEqual([]);
      const result = decideGate(course, 'length-ready', evidence, { ...context, ...extra });
      if (!result.valid) throw new Error(JSON.stringify(result.issues));
      const d = result.decision;
      expect(validateRecord('gateDecision', d)).toMatchObject({ valid: true, issues: [] });
      expect(checkGateDecision(course, d)).toEqual({ valid: true, issues: [] });
      for (const c of d.criterionResults) if (c.met === true) expect(c.evidenceRefs.length).toBeGreaterThan(0);
      expect(d.status === 'ready').toBe(d.criterionResults.every(c => c.met === true) && d.unresolvedMisconceptionIds.length === 0);
    }), { numRuns: 300 });
  });
  it('no evidence is never ready and always a valid record, whatever the gate and context', () => {
    fc.assert(fc.property(gateVariant, decisionContext, (variant, extra) => {
      const course = courseFor(variant);
      const result = decideGate(course, 'length-ready', [], { ...context, ...extra });
      if (!result.valid) throw new Error(JSON.stringify(result.issues));
      expect(result.decision.status).toBe(extra.capReached ? 'closed_with_gaps' : 'needs_evidence');
      expect(result.decision.criterionResults.every(c => c.met === false && c.evidenceRefs.length === 0)).toBe(true);
      expect(validateRecord('gateDecision', result.decision)).toMatchObject({ valid: true, issues: [] });
    }));
  });
});

describe('research request and result contracts', () => {
  const request = (): ResearchRequest => ({ requestId: 'r-1', taskId: 'find-explainer', objective: 'predict-period', episodeRevision: { episodeId: 'length', courseDigest: digest, planRevision: 0 },
    misconceptionHypothesis: 'mass-matters', knownPrerequisites: ['measure-period'], language: 'en', modality: 'video', remainingLearningTime: 'under_15_min', accessibilityNeeds: ['captions'],
    sourcePolicy: { publicTopicId: 'pendulum-topic', allowedDomains: ['reference.example'], requireReviewedContent: true, maxCandidates: 3, maxToolCalls: 10, deadlineSeconds: 120 }, requiredOrOptional: 'optional' });
  it('accepts a learner-free request within the author task', () => {
    expect(validateResearchRequest(richCourse(), request()).issues).toEqual([]);
  });
  it.each([
    ['an undeclared task', (r: ResearchRequest) => { r.taskId = 'ghost'; }, 'UNAPPROVED_RESEARCH_TASK'],
    ['an undeclared hypothesis', (r: ResearchRequest) => { r.misconceptionHypothesis = 'learner-is-tired'; }, 'UNDECLARED_HYPOTHESIS'],
    ['a non-prerequisite', (r: ResearchRequest) => { r.knownPrerequisites = ['predict-period']; }, 'RESEARCH_SCOPE_MISMATCH'],
    ['a wider domain list', (r: ResearchRequest) => { r.sourcePolicy.allowedDomains = ['reference.example', 'tracker.example']; }, 'RESEARCH_DOMAIN_WIDENED'],
    ['a bigger budget', (r: ResearchRequest) => { r.sourcePolicy.maxToolCalls = 11; }, 'RESEARCH_BUDGET_WIDENED'],
    ['escalation to required work', (r: ResearchRequest) => { r.requiredOrOptional = 'required_replacement'; }, 'RESEARCH_REQUIREMENT_ESCALATED'],
    ['an undeclared language', (r: ResearchRequest) => { r.language = 'fr'; }, 'RESEARCH_SCOPE_MISMATCH'],
  ] as const)('rejects %s', (_name, mutate, code) => {
    const r = request(); mutate(r);
    expect(validateResearchRequest(richCourse(), r).issues.map(i => i.code)).toContain(code);
  });
  it('binds results to the request and its domain allowlist', () => {
    const result = { requestId: 'r-1', sourceUrl: 'https://reference.example/v', creator: 'Synthetic', inspectedEvidence: { kind: 'metadata_only', summary: 'Title only.' },
      objectiveFit: { objective: 'predict-period', fit: 'partial', rationale: 'Title matches.' }, prerequisites: [], claims: [], verifiedSegmentIfAny: null, duration: null,
      captionsOrTranscriptStatus: 'unknown', rightsAndEmbeddingStatus: 'unknown', reviewedAt: '2026-10-15T00:00:00Z', concerns: ['Not reviewed'], reviewStatus: 'unreviewed' };
    expect(validateResearchResult(request(), result).valid).toBe(true);
    expect(validateResearchResult(request(), { ...result, sourceUrl: 'https://other.example/v' }).issues[0]!.code).toBe('DOMAIN_NOT_ALLOWED');
    expect(validateResearchResult(request(), { ...result, requestId: 'r-2' }).issues[0]!.code).toBe('STALE_RESEARCH_RESULT');
    expect(validateResearchResult(request(), { ...result, claims: [{ text: 'Invented.', supportedBy: 'title' }] }).issues[0]!.code).toBe('METADATA_ONLY_REVIEW');
  });
});
