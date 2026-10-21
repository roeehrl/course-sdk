import { isSupportedLocale } from './locale.js';
import type { ValidateFunction } from 'ajv';
import validators from './generated/records-validator.js';
import { shapeIssues } from './adaptation-shape.js';
import { FORBIDDEN_CAPABILITIES } from './contract-constants.js';
import { standaloneChecks } from './contracts-validate.js';
import type { ValidationIssue } from './types.js';
import type { RecordKind, RecordKinds } from './record-types.js';

export const RECORD_KINDS = Object.freeze(['attempt', 'evidence', 'gateDecision', 'teachingHypothesis', 'interventionPlan', 'learnerClaim',
  'researchRequest', 'researchResult', 'mediaReview', 'mediaJob', 'placementEvidence', 'pathExemption', 'resolvedConstraintSnapshot',
  'extensionAllowance', 'extensionOffer', 'extensionGrant', 'closureOutcome', 'platformCapabilities', 'adminCapability', 'toolCapability',
  'artifactValidation', 'activityInstance', 'episodeRevision', 'conceptGraph', 'debugTrace', 'decisionRecord', 'mediaCandidate', 'rubricRevision', 'contextCapsule', 'learningEventExport'] as const satisfies readonly RecordKind[]);

type Report = (code: string, path: string, message: string) => void;
const GRANTING_OUTCOMES = new Set(['ready', 'demonstrated', 'exempted', 'granted', 'passed']);

const rules: { [K in RecordKind]?: (value: RecordKinds[K], report: Report) => void } = {
  attempt(a, report) {
    if (a.reattemptOf === a.attemptId) report('INVALID_ATTEMPT', '/reattemptOf', 'An attempt cannot retry itself.');
    if (a.locale !== undefined && !isSupportedLocale(a.locale)) report('UNSUPPORTED_LOCALE', '/locale', `"${a.locale}" is not a supported locale.`);
  },
  evidence(e, report) {
    if (e.author !== 'learner' && e.independence !== 'synthetic')
      report('AGENT_AUTHORED_EVIDENCE', '/independence', 'Agent, tutor or staff authored answers are synthetic and never independent learner evidence.');
    const assisted = e.assistance.answerRevealed || e.assistance.hintsUsed > 0 || e.assistance.tutorAuthoredContent;
    if (assisted && e.independence === 'independent') report('ASSISTED_EVIDENCE', '/independence', 'Assisted work is recorded but cannot be independent.');
    if (e.reattemptOf !== null && e.independence === 'independent') report('REATTEMPT_NOT_INDEPENDENT', '/reattemptOf', 'Reattempts of the same item are not independent evidence.');
    if (e.outcome === 'abstained' && e.misconceptionIds.length > 0) report('ABSTAIN_PENALIZED', '/misconceptionIds', '"I don\'t know" carries no misconception signal or penalty.');
    if (e.mode === 'rubric_conversation' && (e.outcome === 'correct' || e.outcome === 'partial') && (!e.citedSpans?.length || !e.rubricRevision))
      report('UNCITED_JUDGMENT', '/citedSpans', 'A conversational judgment must cite the learner and bind a rubric revision.');
  },
  contextCapsule(c, report) {
    const anchor = c.semanticAnchor;
    if (anchor?.kind === 'code_line' && anchor.lineEnd < anchor.lineStart) report('INVALID_CAPSULE', '/semanticAnchor/lineEnd', 'A code selection cannot end before it starts.');
    if (anchor?.kind === 'code_line' && c.codeSnapshotHash !== undefined && anchor.codeSnapshotHash !== c.codeSnapshotHash)
      report('INVALID_CAPSULE', '/semanticAnchor/codeSnapshotHash', 'A code selection must belong to the capsule\'s code snapshot.');
    if (c.reviewedSegment && c.reviewedSegment.endSeconds <= c.reviewedSegment.startSeconds) report('INVALID_CAPSULE', '/reviewedSegment', 'A reviewed segment must end after it starts.');
    if ((c.playbackSeconds !== undefined || c.reviewedSegment) && !c.mediaRef) report('INVALID_CAPSULE', '/mediaRef', 'A playback position or reviewed segment needs the media it belongs to.');
    if (c.resolvedConstraintSnapshot && c.resolvedConstraintSnapshot.policyRevision !== c.policyRevision)
      report('INVALID_CAPSULE', '/resolvedConstraintSnapshot/policyRevision', 'The constraint snapshot must be for the capsule\'s policy revision.');
  },
  gateDecision(d, report) {
    const all = new Set(d.evidenceRefs);
    for (const [i, c] of d.criterionResults.entries()) {
      if (c.evidenceRefs.some(ref => !all.has(ref))) report('UNLINKED_DECISION', `/criterionResults/${i}/evidenceRefs`, 'Criterion evidence must be part of the decision evidence.');
      if (c.met === true && c.evidenceRefs.length === 0) report('UNLINKED_DECISION', `/criterionResults/${i}`, 'A met criterion must cite evidence.');
    }
    const kinds = new Set(d.nextActions.map(a => a.kind));
    if (d.status === 'ready') {
      if (d.criterionResults.some(c => c.met !== true) || d.missingObjectiveIds.length || d.unresolvedMisconceptionIds.length)
        report('INCONSISTENT_DECISION', '/status', 'Ready requires every criterion met, no missing objectives and no unresolved critical misconception.');
      if (d.evidenceRefs.length === 0) report('UNLINKED_DECISION', '/evidenceRefs', 'A ready decision must link evidence.');
      if (!kinds.has('continue')) report('INCONSISTENT_DECISION', '/nextActions', 'Ready decisions offer continue.');
    } else {
      if (kinds.has('continue')) report('INCONSISTENT_DECISION', '/nextActions', 'Only ready decisions may continue credited progression.');
      if (d.status === 'under_review' && !d.criterionResults.some(c => c.met === 'pending')) report('INCONSISTENT_DECISION', '/status', 'Under review needs a pending criterion.');
      if (d.status === 'closed_with_gaps' && d.missingObjectiveIds.length === 0 && d.criterionResults.every(c => c.met === true))
        report('INCONSISTENT_DECISION', '/status', 'Closure with gaps must report the gaps.');
    }
  },
  teachingHypothesis(h, report) {
    if (h.status === 'confirmed' && h.evidenceRefs.length === 0) report('UNSUPPORTED_HYPOTHESIS', '/evidenceRefs', 'Confirmed hypotheses cite evidence.');
  },
  learnerClaim(c, report) {
    if (c.class === 'observed' && c.evidenceRefs.length === 0) report('UNSUPPORTED_CLAIM', '/evidenceRefs', 'Observed claims cite evidence; a claim of knowledge does not fabricate an attempt.');
    if (c.class === 'declared' && c.author !== 'learner') report('UNSUPPORTED_CLAIM', '/author', 'Only learners declare facts and preferences about themselves.');
    if (c.class === 'hypothesis' && c.uncertainty === null) report('UNSUPPORTED_CLAIM', '/uncertainty', 'Hypotheses state their uncertainty.');
  },
  researchResult(r, report) {
    const metadataOnly = r.inspectedEvidence.kind === 'metadata_only';
    if (metadataOnly && (r.reviewStatus !== 'unreviewed' || r.claims.length > 0 || r.verifiedSegmentIfAny !== null))
      report('METADATA_ONLY_REVIEW', '/inspectedEvidence', 'Metadata is not review: no claims, segments or reviewed status.');
    const segment = r.verifiedSegmentIfAny;
    if (segment && (segment.startSeconds >= segment.endSeconds || (r.duration && segment.endSeconds > r.duration.seconds)))
      report('INVALID_SEGMENT', '/verifiedSegmentIfAny', 'A segment must lie within the media.');
    if (segment && r.inspectedEvidence.kind !== 'viewed_segment' && r.inspectedEvidence.kind !== 'transcript' && r.inspectedEvidence.kind !== 'captions')
      report('INVALID_SEGMENT', '/verifiedSegmentIfAny', 'Segment timestamps need inspected footage, captions or transcript.');
  },
  mediaJob(j, report) {
    if (j.state !== 'ready') return;
    const p = j.provenance;
    if (!p.assetHash || !p.reviewReportRef || !p.visualDescriptionRef) report('UNREVIEWED_MEDIA_READY', '/provenance', 'Ready media needs an asset hash, review report and accessible description.');
    if ((j.kind === 'generated_short_video' || j.kind === 'verified_vector_animation') && (!p.captionsRef || !p.transcriptRef))
      report('UNREVIEWED_MEDIA_READY', '/provenance', 'Ready motion media needs captions and a transcript.');
    if (j.kind === 'verified_vector_animation' && !p.referenceComputationRef) report('UNREVIEWED_MEDIA_READY', '/provenance/referenceComputationRef', 'Verified animations bind their reference computation.');
  },
  mediaReview(r, report) {
    if (r.outcome === 'approved' && r.checks.some(c => c.result === 'failed')) report('INCONSISTENT_REVIEW', '/outcome', 'A failed check cannot be approved.');
  },
  placementEvidence(p, report) {
    if (p.outcome === 'demonstrated' && (p.independence !== 'independent' || p.evidenceRefs.length === 0))
      report('UNLINKED_DECISION', '/outcome', 'Assisted or unlinked placement work does not become independent mastery.');
  },
  extensionAllowance(a, report) {
    if (a.used > a.total || a.grantsUsed > a.maxGrants || a.maxPerGrant > a.total) report('INVALID_ALLOWANCE', '', 'Allowance usage must stay within its declared totals.');
  },
  extensionOffer(o, report) {
    if (Date.parse(o.proposedEffectiveDeadline) <= Date.parse(o.currentEffectiveDeadline)) report('INVALID_OFFER', '/proposedEffectiveDeadline', 'An extension must move the deadline later.');
    if (!o.requiredApprovals.includes('learner')) report('LEARNER_ACCEPTANCE_REQUIRED', '/requiredApprovals', 'No grant without explicit learner acceptance.');
    if (o.state === 'accepted_pending_admin' && !o.requiredApprovals.includes('admin')) report('INVALID_OFFER', '/state', 'Pending admin approval requires an admin approval step.');
    const before = new Map(o.balanceBefore.map(b => [b.poolId, b.remaining])), after = new Map(o.balanceAfter.map(b => [b.poolId, b.remaining]));
    for (const [i, debit] of o.poolDebits.entries()) {
      const start = before.get(debit.poolId), end = after.get(debit.poolId);
      if (start === undefined || end === undefined || start - debit.amount !== end || end < 0) report('BALANCE_MISMATCH', `/poolDebits/${i}`, 'Balance after must equal balance before minus the debit, never negative.');
    }
  },
  closureOutcome(c, report) {
    if (c.reason === 'completed' && c.gapObjectiveIds.length > 0) report('INCONSISTENT_CLOSURE', '/gapObjectiveIds', 'A completed course has no gaps; report closure with gaps instead.');
    if (c.demonstratedObjectiveIds.some(id => c.gapObjectiveIds.includes(id))) report('INCONSISTENT_CLOSURE', '/gapObjectiveIds', 'An objective cannot be both demonstrated and a gap.');
  },
  platformCapabilities(p, report) {
    for (const [i, capability] of p.capabilities.entries()) if (FORBIDDEN_CAPABILITIES.has(capability)) report('FORBIDDEN_CAPABILITY', `/capabilities/${i}`, `${capability} is host authority.`);
  },
  toolCapability(t, report) {
    for (const [i, capability] of t.capabilities.entries()) if (FORBIDDEN_CAPABILITIES.has(capability)) report('FORBIDDEN_CAPABILITY', `/capabilities/${i}`, `${capability} is host authority.`);
  },
  artifactValidation(a, report) {
    if ((a.outcome === 'passed') !== a.checks.every(c => c.result === 'passed')) report('INCONSISTENT_VALIDATION', '/outcome', 'The outcome must follow from the checks.');
  },
  decisionRecord(d, report) {
    if (d.kind === 'gate' && d.versions.gateVersion === undefined) report('UNLINKED_DECISION', '/versions/gateVersion', 'Gate decisions bind the gate version.');
    if ((d.kind === 'gate' || d.kind === 'placement') && GRANTING_OUTCOMES.has(d.outcome) && d.inputEvidenceRefs.length === 0)
      report('UNLINKED_DECISION', '/inputEvidenceRefs', 'A progression grant must be linked to evidence and versions.');
  },
};

// A MediaCandidate is the researcher's result; both names apply the same rules.
rules.mediaCandidate = rules.researchResult!;
rules.rubricRevision = (rubric, report) => standaloneChecks.rubric(rubric, '', report);
rules.learningEventExport = (exported, report) => {
  const after = BigInt(exported.cursor.after), through = BigInt(exported.cursor.through);
  if (after > through) report('INVALID_CURSOR', '/cursor', 'The cursor range must not be reversed.');
  let previous = after;
  const ids = new Set<string>();
  for (const [i, event] of exported.events.entries()) {
    const sequence = BigInt(event.sequence);
    if (sequence <= previous || sequence > through) report('INVALID_CURSOR', `/events/${i}/sequence`, 'Events are strictly increasing and inside the cursor range.');
    previous = sequence > previous ? sequence : previous;
    if (ids.has(event.eventId)) report('DUPLICATE_ID', `/events/${i}/eventId`, `Duplicate event ${event.eventId}.`);
    ids.add(event.eventId);
  }
};

/** Validate a runtime record: JSON data, schema shape and integrity rules. Not authentication. */
export function validateRecord<K extends RecordKind>(kind: K, value: unknown): { valid: true; value: RecordKinds[K]; issues: [] } | { valid: false; issues: ValidationIssue[] } {
  const validate = (validators as Record<string, ValidateFunction | undefined>)[`record_${kind}`];
  if (!validate || !(RECORD_KINDS as readonly string[]).includes(kind)) return { valid: false, issues: [{ code: 'UNKNOWN_RECORD', path: '', message: `Unknown record kind ${String(kind)}.` }] };
  const issues = shapeIssues(validate, value);
  if (!issues.length) (rules[kind] as ((v: RecordKinds[K], r: Report) => void) | undefined)?.(value as RecordKinds[K], (code, path, message) => issues.push({ code, path, message }));
  return issues.length ? { valid: false, issues } : { valid: true, value: structuredClone(value) as RecordKinds[K], issues: [] };
}
