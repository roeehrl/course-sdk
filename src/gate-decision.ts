import { validateCourse } from './validate.js';
import { validateRecord } from './records.js';
import { isVersionedGate } from './contracts-validate.js';
import { RECOGNITION_TYPES } from './contract-constants.js';
import { SDK_VERSION } from './version.js';
import { formatSdkMessage, formatSdkMessages, sdkMessage } from './messages.js';
import type { Assessment, CourseManifest, ValidationIssue } from './types.js';
import type { ReadinessCriterion, VersionedProgressionGate } from './contracts-types.js';
import type { Evidence, GateDecision, GateDecisionStatus, NextAction, NextActionKind, SdkMessageRef } from './record-types.js';
import type { SdkMessageId } from './messages.js';

export interface GateDecisionContext {
  decisionId: string;
  enrollmentId: string;
  courseDigest: string;
  policyRevision: number;
  decidedAt: string;
  /** True when the applicable cap or deadline has been reached. */
  capReached?: boolean;
  supersedes?: string | null;
  /** Unsuccessful relevant attempts since the last success that suggest help (default 2). */
  helpThreshold?: number;
  /**
   * 0.6: the learner's locale for the rendered reasons and action labels (default: the course's
   * source locale). The decision also carries the message IDs, so a host can render them again.
   */
  locale?: string;
}
export type GateDecisionResult = { valid: true; decision: GateDecision; issues: [] } | { valid: false; issues: ValidationIssue[] };

const sorted = (values: Iterable<string>) => [...new Set(values)].sort();

/**
 * Transparent reference evaluator for a versioned gate. Pure and deterministic: the
 * same course, evidence and context always give the same decision. A host must still
 * authenticate evidence, check current versions at commit time and persist the result.
 * Readiness needs independent successes across families, independent transfer on
 * production work and no unresolved critical misconception; recognition never suffices.
 */
export function decideGate(courseInput: unknown, gateId: string, evidenceInput: unknown[], context: GateDecisionContext): GateDecisionResult {
  const checked = validateCourse(courseInput);
  if (!checked.valid) return { valid: false, issues: checked.issues.map(i => ({ ...i, path: `/course${i.path}` })) };
  const course = checked.course;
  const gate = course.gates.find(g => g.id === gateId);
  if (!gate) return { valid: false, issues: [{ code: 'MISSING_REFERENCE', path: '/gateId', message: `Unknown gate ${gateId}.` }] };
  if (!isVersionedGate(gate)) return { valid: false, issues: [{ code: 'LEGACY_GATE', path: '/gateId', message: 'The reference evaluator decides versioned gates only; migrate the gate first.' }] };
  const issues: ValidationIssue[] = [];
  const evidence: Evidence[] = [];
  for (const [i, value] of evidenceInput.entries()) {
    const result = validateRecord('evidence', value);
    if (!result.valid) { issues.push(...result.issues.map(issue => ({ ...issue, path: `/evidence/${i}${issue.path}` }))); continue; }
    if (result.value.enrollmentId !== context.enrollmentId || result.value.courseDigest !== context.courseDigest)
      issues.push({ code: 'EVIDENCE_BINDING', path: `/evidence/${i}`, message: 'Evidence must belong to this enrollment and course version.' });
    evidence.push(result.value);
  }
  if (new Set(evidence.map(e => e.id)).size !== evidence.length) issues.push({ code: 'DUPLICATE_ID', path: '/evidence', message: 'Evidence IDs must be unique.' });
  if (issues.length) return { valid: false, issues };
  const decision = evaluate(course, gate, evidence, context);
  return { valid: true, decision, issues: [] };
}

function evaluate(course: CourseManifest, gate: VersionedProgressionGate, evidence: Evidence[], context: GateDecisionContext): GateDecision {
  const assessments = new Map(course.assessments.map(a => [a.id, a]));
  const eligibleItems = new Set([...(gate.interactiveCheckRefs ?? []), ...(gate.practicalTaskRefs ?? [])]);
  const rubric = course.rubrics?.find(r => r.id === gate.conversationalRubricRef);
  const byTime = [...evidence].sort((a, b) => a.issuedAt.localeCompare(b.issuedAt) || a.id.localeCompare(b.id));
  const isConversation = (e: Evidence) => rubric !== undefined && e.mode === 'rubric_conversation' && e.rubricRevision?.id === rubric.id
    && e.rubricRevision.version === rubric.version && (e.citedSpans?.length ?? 0) > 0;
  const relevant = (e: Evidence) => e.mode !== 'diagnostic_probe' && (eligibleItems.has(e.assessmentId) || isConversation(e));
  const counted = byTime.filter(e => relevant(e) && e.outcome === 'correct' && e.independence === 'independent' && e.author === 'learner' && e.reattemptOf === null);
  const covering = (list: Evidence[], objectives: string[]) => list.filter(e => e.objectiveIds.some(o => objectives.includes(o)));
  const isTransfer = (e: Evidence) => {
    if (isConversation(e)) return true;
    const item: Assessment | undefined = assessments.get(e.assessmentId);
    return item !== undefined && item.role === 'transfer' && !RECOGNITION_TYPES.has(item.type);
  };
  const targets = (item: Assessment | undefined, misconception: string) => item !== undefined
    && (item.misconceptionIds?.includes(misconception) || (item.type === 'choice' && item.options.some(o => o.misconceptionId === misconception)));
  const critical = (objectives: string[]) => (course.hypotheses ?? [])
    .filter(h => h.kind === 'misconception' && h.critical && h.objectiveIds.some(o => objectives.includes(o))).map(h => h.id);
  const unresolved = (objectives: string[]) => critical(objectives).filter(m => {
    const signals = byTime.filter(e => e.misconceptionIds.includes(m));
    if (signals.length === 0) return false;
    const last = signals[signals.length - 1]!.issuedAt;
    return !counted.some(e => e.issuedAt > last && targets(assessments.get(e.assessmentId), m));
  });
  const pending = (objectives: string[]) => covering(byTime.filter(e => relevant(e) && e.outcome === 'pending_review'), objectives);

  const locale = context.locale ?? course.locale;
  const outcome = (kind: ReadinessCriterion['kind'], met: boolean, params?: Record<string, string | number | string[]>) =>
    sdkMessage(`gate.criterion.${kind}.${met ? 'met' : 'unmet'}` as SdkMessageId, met ? undefined : params);
  const results = gate.readinessCriteria.map((criterion: ReadinessCriterion) => {
    const objectives = criterion.objectiveIds.length ? criterion.objectiveIds : gate.requiredObjectives;
    let met = false; let refs: Evidence[] = []; let params: Record<string, string | number | string[]> | undefined;
    if (criterion.kind === 'independent_success') {
      refs = covering(counted, objectives);
      const short = objectives.filter(o => new Set(refs.filter(e => e.objectiveIds.includes(o)).map(e => e.familyId)).size < gate.minimumIndependentEvidence.families);
      met = short.length === 0;
      params = { families: gate.minimumIndependentEvidence.families, objectives: short };
    } else if (criterion.kind === 'transfer_success') {
      refs = covering(counted, objectives).filter(isTransfer);
      met = refs.length >= gate.minimumIndependentEvidence.transferItems;
    } else if (criterion.kind === 'no_critical_misconception') {
      const open = unresolved(objectives);
      met = open.length === 0;
      refs = counted.filter(e => critical(objectives).some(m => targets(assessments.get(e.assessmentId), m)));
      params = { misconceptions: open };
    } else if (criterion.kind === 'rubric_criteria') {
      refs = covering(counted, objectives).filter(isConversation);
      met = refs.length > 0;
    } else {
      const practical = new Set(gate.practicalTaskRefs ?? []);
      refs = covering(counted, objectives).filter(e => practical.has(e.assessmentId));
      met = refs.length > 0;
    }
    const state: boolean | 'pending' = !met && pending(objectives).length > 0 ? 'pending' : met;
    const reasonMessages: SdkMessageRef[] = [outcome(criterion.kind, met, params), ...(state === 'pending' ? [sdkMessage('gate.criterion.pending')] : [])];
    return { criterionId: criterion.id, met: state, evidenceRefs: sorted(refs.map(e => e.id)), reason: formatSdkMessages(reasonMessages, locale), reasonMessages };
  });
  const missingObjectiveIds = sorted(gate.requiredObjectives.filter(o => !counted.some(e => e.objectiveIds.includes(o))));
  const unresolvedMisconceptionIds = sorted(unresolved(gate.requiredObjectives));
  const allMet = results.every(r => r.met === true) && unresolvedMisconceptionIds.length === 0;
  const lastSuccess = counted.length ? counted[counted.length - 1]!.issuedAt : '';
  const struggles = byTime.filter(e => relevant(e) && e.issuedAt > lastSuccess && (e.outcome === 'incorrect' || e.outcome === 'abstained')).length;
  let status: GateDecisionStatus;
  if (allMet) status = 'ready';
  else if (context.capReached) status = 'closed_with_gaps';
  else if (results.some(r => r.met === 'pending')) status = 'under_review';
  else if (struggles >= (context.helpThreshold ?? 2)) status = 'needs_help';
  else status = 'needs_evidence';

  const counts = new Set(counted.map(e => e.assessmentId));
  const nextItem = [...eligibleItems].find(id => !counts.has(id) && assessments.get(id)?.role === 'transfer') ?? [...eligibleItems].find(id => !counts.has(id));
  const action = (kind: NextActionKind, messageId: SdkMessageId, targetId?: string | null): NextAction =>
    ({ kind, label: formatSdkMessage(messageId, locale), ...(targetId ? { targetId } : {}), messageId });
  const attempt = nextItem ? action('attempt_check', 'gate.action.attempt_check', nextItem) : action('attempt_check', 'gate.action.explain_to_companion');
  const help = action('request_help', 'gate.action.request_help');
  const review = action('review_material', 'gate.action.review_material');
  const actions: Record<GateDecisionStatus, NextAction[]> = {
    ready: [action('continue', 'gate.action.continue', gate.nextActivityId)],
    needs_evidence: [attempt, help, review],
    needs_help: [help, review, attempt],
    under_review: [action('await_review', 'gate.action.await_review'), help],
    closed_with_gaps: [action('view_gaps', 'gate.action.view_gaps'),
      ...(gate.appealPolicy.allowed ? [action('appeal', 'gate.action.appeal')] : []),
      ...(course.policy.extensions?.enabled ? [action('consider_extension', 'gate.action.consider_extension')] : [])],
  };
  const unmet = results.filter(r => r.met !== true).flatMap(r => r.reasonMessages);
  const reasons: Record<GateDecisionStatus, SdkMessageRef[]> = {
    ready: [sdkMessage('gate.reason.ready')],
    needs_evidence: unmet.length ? unmet : [sdkMessage('gate.reason.needs_evidence')],
    needs_help: [sdkMessage('gate.reason.needs_help'), ...unmet],
    under_review: [sdkMessage('gate.reason.under_review')],
    closed_with_gaps: [sdkMessage('gate.reason.closed_with_gaps'), ...unmet],
  };
  return {
    decisionId: context.decisionId, enrollmentId: context.enrollmentId, gateId: gate.id, gateVersion: gate.version,
    courseDigest: context.courseDigest, policyRevision: context.policyRevision, status, criterionResults: results,
    missingObjectiveIds, unresolvedMisconceptionIds, evidenceRefs: sorted(results.flatMap(r => r.evidenceRefs)),
    evaluator: { kind: 'sdk_reference', id: 'course-sdk.gate-reference', version: SDK_VERSION },
    learnerVisibleReason: formatSdkMessages(reasons[status], locale), learnerVisibleReasonMessages: reasons[status], locale,
    nextActions: actions[status], nextActivityId: status === 'ready' ? gate.nextActivityId : null,
    decidedAt: context.decidedAt, supersedes: context.supersedes ?? null,
  };
}

/**
 * Check a stored or received decision against the current course (U16): an invalid,
 * unlinked or version-mismatched decision grants no progression.
 */
export function checkGateDecision(courseInput: unknown, decisionInput: unknown): { valid: boolean; issues: ValidationIssue[] } {
  const record = validateRecord('gateDecision', decisionInput);
  if (!record.valid) return record;
  const checked = validateCourse(courseInput);
  if (!checked.valid) return { valid: false, issues: checked.issues.map(i => ({ ...i, path: `/course${i.path}` })) };
  const decision = record.value;
  const gate = checked.course.gates.find(g => g.id === decision.gateId);
  const issues: ValidationIssue[] = [];
  if (!gate || !isVersionedGate(gate)) issues.push({ code: 'UNLINKED_DECISION', path: '/gateId', message: 'The decision does not reference a versioned gate in this course.' });
  else {
    if (gate.version !== decision.gateVersion) issues.push({ code: 'STALE_DECISION', path: '/gateVersion', message: 'The decision was made against another gate version.' });
    const expected = gate.readinessCriteria.map(c => c.id).sort().join(',');
    if (decision.criterionResults.map(c => c.criterionId).sort().join(',') !== expected) issues.push({ code: 'UNLINKED_DECISION', path: '/criterionResults', message: 'Every gate criterion needs exactly one result.' });
    if (decision.status === 'ready' && decision.nextActivityId !== gate.nextActivityId) issues.push({ code: 'UNLINKED_DECISION', path: '/nextActivityId', message: 'Ready decisions continue to the gate next activity.' });
  }
  return { valid: issues.length === 0, issues };
}
