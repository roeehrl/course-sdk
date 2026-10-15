import { describe, expect, it } from 'vitest';
import { RECORD_KINDS, validateRecord } from '../src/index.js';
import type { RecordKind } from '../src/index.js';

const digest = 'a'.repeat(64), at = '2026-10-15T10:00:00Z', later = '2026-10-20T10:00:00Z';
const assistance = { hintsUsed: 0, answerRevealed: false, tutorAuthoredContent: false };
export const evidenceSample = () => ({
  id: 'ev-1', attemptId: 'att-1', enrollmentId: 'enr-1', courseDigest: digest, assessmentId: 'length-prediction', familyId: 'length-predict', objectiveIds: ['predict-period'],
  mode: 'deterministic_check', outcome: 'correct', independence: 'independent', author: 'learner', assistance, reattemptOf: null, misconceptionIds: [], confidence: 4,
  evaluator: { id: 'deterministic', version: '1.0.0' }, issuedAt: at,
});
const samples: Record<RecordKind, Record<string, unknown>> = {
  attempt: { attemptId: 'att-1', enrollmentId: 'enr-1', assessmentId: 'q', courseDigest: digest, response: { kind: 'abstain' }, confidence: null, assistance, author: 'learner', reattemptOf: null, idempotencyKey: 'k-1', submittedAt: at },
  evidence: evidenceSample(),
  gateDecision: { decisionId: 'd-1', enrollmentId: 'enr-1', gateId: 'g', gateVersion: '1.0.0', courseDigest: digest, policyRevision: 1, status: 'ready',
    criterionResults: [{ criterionId: 'c', met: true, evidenceRefs: ['ev-1'], reason: 'Met.' }], missingObjectiveIds: [], unresolvedMisconceptionIds: [], evidenceRefs: ['ev-1'],
    evaluator: { kind: 'host_policy', id: 'host', version: '1.0.0' }, learnerVisibleReason: 'Ready.', nextActions: [{ kind: 'continue', label: 'Continue' }], nextActivityId: null, decidedAt: at, supersedes: null },
  teachingHypothesis: { id: 'h-1', enrollmentId: 'enr-1', templateId: 'mass-matters', kind: 'misconception', statement: 'Mass matters.', objectiveIds: ['o'], evidenceRefs: ['ev-1'], uncertainty: 'medium', status: 'confirmed', author: 'supervisor', createdAt: at, expiresAt: null },
  interventionPlan: { id: 'p-1', enrollmentId: 'enr-1', revision: 1, hypothesisIds: ['h-1'], probeIds: ['probe'], objectiveIds: ['o'], actions: [{ kind: 'probe', ref: 'probe' }], rationale: 'Distinguish.', evidenceRefs: [] },
  learnerClaim: { id: 'c-1', enrollmentId: 'enr-1', class: 'observed', statement: 'Solved a transfer task.', objectiveIds: ['o'], evidenceRefs: ['ev-1'], author: 'system', uncertainty: null, createdAt: at, expiresAt: null, learnerOverride: 'none' },
  researchRequest: { requestId: 'r-1', taskId: 'find-explainer', objective: 'predict-period', episodeRevision: { episodeId: 'length', courseDigest: digest, planRevision: 0 },
    misconceptionHypothesis: 'mass-matters', knownPrerequisites: ['measure-period'], language: 'en', modality: 'video', remainingLearningTime: '15_to_60_min', accessibilityNeeds: ['captions'],
    sourcePolicy: { publicTopicId: 'pendulum-topic', allowedDomains: ['reference.example'], requireReviewedContent: true, maxCandidates: 2, maxToolCalls: 5, deadlineSeconds: 60 }, requiredOrOptional: 'optional' },
  researchResult: { requestId: 'r-1', sourceUrl: 'https://reference.example/pendulum-video', creator: 'Synthetic creator', inspectedEvidence: { kind: 'transcript', summary: 'Explains length dependence.' },
    objectiveFit: { objective: 'predict-period', fit: 'direct', rationale: 'Shows the square-root law.' }, prerequisites: [], claims: [{ text: 'Period grows with length.', supportedBy: 'transcript 01:10' }],
    verifiedSegmentIfAny: { startSeconds: 60, endSeconds: 120 }, duration: { seconds: 300 }, captionsOrTranscriptStatus: 'creator_captions', rightsAndEmbeddingStatus: 'embeddable', reviewedAt: at, concerns: [], reviewStatus: 'reviewed' },
  mediaReview: { id: 'mr-1', subject: { kind: 'media_job', ref: 'job-1' }, reviewer: { kind: 'staff', id: 'reviewer' }, checks: [{ id: 'facts', result: 'passed' }], outcome: 'approved', concerns: [], reviewedAt: at },
  mediaJob: { jobId: 'job-1', kind: 'generated_image', state: 'ready', storyboardRef: { id: 'sb', version: '1.0.0' }, objectiveIds: ['o'],
    provenance: { providerCapabilitySnapshot: 'snap-1', modelAndSettings: 'model-x', assetHash: digest, reviewReportRef: 'mr-1', captionsRef: null, transcriptRef: null, visualDescriptionRef: 'desc-1', rights: 'generated', referenceComputationRef: null },
    idempotencyKey: 'job-key', updatedAt: at },
  placementEvidence: { id: 'pe-1', placementRunId: 'run-1', enrollmentId: 'enr-1', objectiveId: 'o', evidenceRefs: ['ev-1'], outcome: 'demonstrated', independence: 'independent', courseDigest: digest, rubricRevisions: [] },
  pathExemption: { id: 'ex-1', enrollmentId: 'enr-1', episodeId: 'timing', objectiveIds: ['o'], placementEvidenceRefs: ['pe-1'], courseDigest: digest, policyRevision: 1, grantedAt: at, recordsCompletion: false, learnerMayRevisit: true },
  resolvedConstraintSnapshot: { enrollmentId: 'enr-1', policyRevision: 2, scope: 'chapter:swing', effectiveDeadline: later, bindingScope: 'course', remainingAdditionalEpisodes: 1, remainingAdditionalMinutes: null, mode: 'bounded', computedAt: at },
  extensionAllowance: { poolId: 'days', scopeId: 'course', unit: 'calendar_day', total: 5, used: 2, maxPerGrant: 3, maxGrants: 2, grantsUsed: 1 },
  extensionOffer: { offerId: 'o-1', scopeId: 'course', enrollmentId: 'enr-1', expectedPolicyRevision: 2, rationaleEvidenceRefs: ['ev-1'], proposedActivities: ['length'], currentEffectiveDeadline: at,
    proposedEffectiveDeadline: later, addedWork: { episodes: 1, minutes: 30 }, poolDebits: [{ poolId: 'days', amount: 2 }], balanceBefore: [{ poolId: 'days', remaining: 3 }], balanceAfter: [{ poolId: 'days', remaining: 1 }],
    bindingAncestorCaps: ['course'], planImpact: 'One more episode.', alternatives: ['Close with gaps'], expiresAt: later, requiredApprovals: ['learner'], state: 'proposed' },
  extensionGrant: { grantId: 'gr-1', offerId: 'o-1', acceptedTermsDigest: digest, learnerAcceptanceReceipt: 'receipt-1', authorityReceipt: null, idempotencyKey: 'grant-key', atomicLedgerTransactionId: 'tx-1', newPolicyRevision: 3 },
  closureOutcome: { enrollmentId: 'enr-1', reason: 'cap_reached', closedAt: at, policyRevision: 3, demonstratedObjectiveIds: ['a'], gapObjectiveIds: ['b'], evidenceReportRef: 'report-1', existingMaterial: 'read_only', continuation: 'explicit_opt_in_only' },
  platformCapabilities: { target: 'ipados_tablet', appVersion: '1.2.0', sdkVersion: '0.5.0', capabilities: ['state.read'], rendererIds: ['sim-renderer'], nativeModules: [], layoutClass: 'medium', inputModes: ['touch', 'keyboard'] },
  adminCapability: { sectionId: 'lab-settings', permission: 'course.settings.write', scope: { kind: 'course' }, grantedTo: 'staff-1', grantedBy: 'owner-1', expiresAt: null },
  toolCapability: { toolId: 'search-notes', toolVersion: '1.0.0', capabilities: ['research.search'], grantedTo: { kind: 'agent_strategy', id: 'tutor' }, jobId: 'job-1', expiresAt: later, revocable: true },
  artifactValidation: { artifactId: 'art-1', artifactDigest: digest, validator: { id: 'checker', version: '1.0.0' }, checks: [{ id: 'reference', result: 'passed' }], outcome: 'passed', validatedAt: at },
  activityInstance: { instanceId: 'i-1', activityId: 'pendulum-sim', activityVersion: '1.0.0', enrollmentId: 'enr-1', target: 'web_desktop', rendererId: 'sim-renderer', stateVersion: 2, state: { length: 1 }, status: 'current', startedAt: at },
  episodeRevision: { episodeId: 'length', courseDigest: digest, planRevision: 3, digest, personal: true, sourceRefs: ['physics-notes'] },
  conceptGraph: { courseDigest: digest, nodes: [{ id: 'period', title: 'Period', objectiveIds: ['o'] }], edges: [] },
  debugTrace: { traceId: 'b'.repeat(32), parentSpanId: null, enrollmentId: 'enr-1', activityId: null, attemptId: null, eventCursor: 7, workflowId: null, jobId: null, artifactHash: null,
    provenance: { courseVersion: '1.0.0', sdkVersion: '0.5.0', appPlatformVersion: null, profileRevision: 1, policyRevision: 2, gateRubricVersion: null, modelConfig: null, toolGrant: null },
    view: 'gate_placement_decision', payload: { redacted: true }, replay: { isReplay: false } },
  decisionRecord: { id: 'dr-1', kind: 'gate', subjectRef: 'length-ready', enrollmentId: 'enr-1', versions: { courseDigest: digest, policyRevision: 2, gateVersion: '1.0.0' },
    inputEvidenceRefs: ['ev-1'], outcome: 'ready', reason: 'All criteria met.', decidedBy: { kind: 'host_policy', id: 'host' }, decidedAt: at, traceId: null },
};
const breaks: [RecordKind, string, (v: any) => void, string][] = [
  ['attempt', 'retrying itself', v => { v.reattemptOf = v.attemptId; }, 'INVALID_ATTEMPT'],
  ['evidence', 'agent-authored answers marked independent', v => { v.author = 'agent'; }, 'AGENT_AUTHORED_EVIDENCE'],
  ['evidence', 'revealed answers marked independent', v => { v.assistance.answerRevealed = true; }, 'ASSISTED_EVIDENCE'],
  ['evidence', 'reattempts marked independent', v => { v.reattemptOf = 'ev-0'; }, 'REATTEMPT_NOT_INDEPENDENT'],
  ['evidence', 'punished abstention', v => { v.outcome = 'abstained'; v.misconceptionIds = ['m']; }, 'ABSTAIN_PENALIZED'],
  ['evidence', 'uncited conversational judgment', v => { v.mode = 'rubric_conversation'; }, 'UNCITED_JUDGMENT'],
  ['gateDecision', 'ready with an unmet criterion', v => { v.criterionResults[0].met = false; }, 'INCONSISTENT_DECISION'],
  ['gateDecision', 'ready without evidence', v => { v.evidenceRefs = []; v.criterionResults[0].evidenceRefs = []; }, 'UNLINKED_DECISION'],
  ['gateDecision', 'not ready but continuing', v => { v.status = 'needs_evidence'; v.criterionResults[0].met = false; }, 'INCONSISTENT_DECISION'],
  ['gateDecision', 'under review without pending criteria', v => { v.status = 'under_review'; v.nextActions = [{ kind: 'await_review', label: 'Wait' }]; }, 'INCONSISTENT_DECISION'],
  ['teachingHypothesis', 'confirmed without evidence', v => { v.evidenceRefs = []; }, 'UNSUPPORTED_HYPOTHESIS'],
  ['learnerClaim', 'observed without evidence', v => { v.evidenceRefs = []; }, 'UNSUPPORTED_CLAIM'],
  ['researchResult', 'metadata presented as reviewed', v => { v.inspectedEvidence.kind = 'metadata_only'; }, 'METADATA_ONLY_REVIEW'],
  ['researchResult', 'a segment outside the media', v => { v.verifiedSegmentIfAny.endSeconds = 900; }, 'INVALID_SEGMENT'],
  ['mediaJob', 'ready without review', v => { v.provenance.reviewReportRef = null; }, 'UNREVIEWED_MEDIA_READY'],
  ['mediaReview', 'approved with a failed check', v => { v.checks[0].result = 'failed'; }, 'INCONSISTENT_REVIEW'],
  ['placementEvidence', 'assisted work as mastery', v => { v.independence = 'assisted'; }, 'UNLINKED_DECISION'],
  ['extensionAllowance', 'overdrawn allowance', v => { v.used = 6; }, 'INVALID_ALLOWANCE'],
  ['extensionOffer', 'balance that does not add up', v => { v.balanceAfter[0].remaining = 2; }, 'BALANCE_MISMATCH'],
  ['extensionOffer', 'no learner acceptance', v => { v.requiredApprovals = ['admin']; }, 'LEARNER_ACCEPTANCE_REQUIRED'],
  ['extensionOffer', 'a deadline moved earlier', v => { v.proposedEffectiveDeadline = '2026-10-01T00:00:00Z'; }, 'INVALID_OFFER'],
  ['closureOutcome', 'completed with gaps', v => { v.reason = 'completed'; }, 'INCONSISTENT_CLOSURE'],
  ['platformCapabilities', 'host authority', v => { v.capabilities.push('cap.bypass'); }, 'FORBIDDEN_CAPABILITY'],
  ['toolCapability', 'credential access', v => { v.capabilities.push('credentials.read'); }, 'FORBIDDEN_CAPABILITY'],
  ['artifactValidation', 'passed with a failed check', v => { v.checks.push({ id: 'neg', result: 'failed' }); }, 'INCONSISTENT_VALIDATION'],
  ['decisionRecord', 'a grant linked to no evidence', v => { v.inputEvidenceRefs = []; }, 'UNLINKED_DECISION'],
  ['decisionRecord', 'a gate decision without a gate version', v => { delete v.versions.gateVersion; }, 'UNLINKED_DECISION'],
];
const schemaBreaks: [RecordKind, (v: any) => void][] = [
  ['pathExemption', v => { v.recordsCompletion = true; }],
  ['debugTrace', v => { v.replay = { isReplay: true, sourceTraceId: 'c'.repeat(32), sideEffects: 'live', progressWrites: 'denied' }; }],
  ['debugTrace', v => { v.payload = { redacted: false, value: 'secret' }; }],
  ['toolCapability', v => { v.revocable = false; }],
  ['researchRequest', v => { v.misconceptionHypothesis = 'Learner said they hate physics'; }],
  ['attempt', v => { v.confidence = 9; }],
];

describe('runtime record contracts', () => {
  it('has a sample for every record kind', () => expect(Object.keys(samples).sort()).toEqual([...RECORD_KINDS].sort()));
  it.each(RECORD_KINDS)('%s: accepts a valid record', (kind) => {
    expect(validateRecord(kind, structuredClone(samples[kind])).issues).toEqual([]);
  });
  it.each(RECORD_KINDS)('%s: rejects unknown fields', (kind) => {
    expect(validateRecord(kind, { ...structuredClone(samples[kind]), extra: 1 }).valid).toBe(false);
  });
  it.each(breaks)('%s: rejects %s', (kind, _name, mutate, code) => {
    const value = structuredClone(samples[kind]); mutate(value);
    expect(validateRecord(kind, value).issues.map(i => i.code)).toContain(code);
  });
  it.each(schemaBreaks)('%s: enforces schema constants and formats', (kind, mutate) => {
    const value = structuredClone(samples[kind]); mutate(value);
    expect(validateRecord(kind, value).issues.map(i => i.code)).toContain('SCHEMA');
  });
  it('treats "I don\'t know" as a valid attempt with optional confidence', () => {
    expect(validateRecord('attempt', { ...structuredClone(samples.attempt), confidence: 2 }).valid).toBe(true);
    expect(validateRecord('evidence', { ...evidenceSample(), outcome: 'abstained', confidence: null }).valid).toBe(true);
  });
  it('rejects unknown record kinds', () => expect(validateRecord('banana' as RecordKind, {}).issues[0]!.code).toBe('UNKNOWN_RECORD'));
});
