import { describe, expect, it } from 'vitest';
import { RECORD_KINDS, validateRecord } from '../src/index.js';
import type { RecordKind } from '../src/index.js';
import schemaJson from '../src/course.schema.json' with { type: 'json' };
import { RECORD_DEFINITIONS } from '../scripts/contract-map.mjs';

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
  mediaCandidate: {},
  rubricRevision: { id: 'explain-rubric', version: '2.0.0', title: 'Explain length dependence', requiresCitedEvidence: true, uncertain: 'pending_review',
    criteria: [{ id: 'cause', description: 'Names length as the cause.', required: true, evidence: 'cited_learner_span' }] },
  contextCapsule: { enrollmentId: '3f2b6c1e-8d4a-4c1b-9e7f-0a1b2c3d4e5f', courseDigest: digest, episodeId: 'length', uiRevision: 3, profileRevision: 1, policyRevision: 2,
    eventCursor: 41, evidenceRefs: ['ev-1'], sourceRefs: ['physics-notes'], assessmentMode: 'practice', attemptId: '7c9e6679-7425-40de-944b-e07fc1f90ae7' },
  learningEventExport: { exportFormat: 1, course: { id: 'pendulum-lab', version: '1.0.0', digest }, enrollmentRef: '3f2b6c1e-8d4a-4c1b-9e7f-0a1b2c3d4e5f', exportedAt: later,
    cursor: { after: '0', through: '9223372036854775807' }, events: [
      { eventId: 'e1', sequence: '1', type: 'attempt.submitted', actorKind: 'learner', occurredAt: at, payload: { attemptId: 'att-1' }, traceId: null },
      { eventId: 'e2', sequence: '9007199254740993', type: 'gate.decided', actorKind: 'system', occurredAt: at, payload: { erased: true }, traceId: 'b'.repeat(32) },
    ] },
};
samples.mediaCandidate = structuredClone(samples.researchResult);
const breaks: [RecordKind, string, (v: any) => void, string][] = [
  ['rubricRevision', 'uncited conversational criteria', v => { v.criteria[0].evidence = 'observation'; }, 'UNCITED_CONVERSATIONAL_RUBRIC'],
  ['learningEventExport', 'out-of-order events', v => { v.events.reverse(); }, 'INVALID_CURSOR'],
  ['learningEventExport', 'an event outside the cursor', v => { v.cursor.through = '5'; }, 'INVALID_CURSOR'],
  ['learningEventExport', 'a reversed cursor', v => { v.cursor = { after: '10', through: '9' }; v.events = []; }, 'INVALID_CURSOR'],
  ['learningEventExport', 'duplicate event IDs', v => { v.events[1].eventId = 'e1'; }, 'DUPLICATE_ID'],
  ['learningEventExport', 'a numeric sequence', v => { v.events[0].sequence = 1; }, 'SCHEMA'],
  ['learningEventExport', 'a leading-zero sequence', v => { v.events[0].sequence = '01'; }, 'SCHEMA'],
  ['contextCapsule', 'an unknown assessment mode', v => { v.assessmentMode = 'graded'; }, 'SCHEMA'],
  ['contextCapsule', 'extra learner fields', v => { v.learnerEmail = 'x'; }, 'SCHEMA'],
  ['mediaCandidate', 'metadata-only claims', v => { v.inspectedEvidence.kind = 'metadata_only'; }, 'METADATA_ONLY_REVIEW'],
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

// Host-generated identifiers (enrollments, attempts, evidence, decisions, jobs, users, ...) are opaque:
// hosts mint them with randomUUID() and similar, so they may start with a digit or contain upper case.
// Author-defined course identifiers keep the course-ID pattern.
const uuids = ['0d4b5f7e-2c1a-4e8b-9f3d-6a7b8c9d0e1f', '9f1c2d3e-4b5a-4c6d-8e7f-a0b1c2d3e4f5', '3f2b6c1e-8d4a-4c1b-9e7f-0a1b2c3d4e5f', '7C9E6679-7425-40DE-944B-E07FC1F90AE7'];
type Field = [kind: RecordKind, pointer: string, many: boolean, prepare?: (v: any) => void];
const HOST_ID_FIELDS: Field[] = [
  ['attempt', '/attemptId', false], ['attempt', '/enrollmentId', false], ['attempt', '/reattemptOf', false],
  ['evidence', '/id', false], ['evidence', '/attemptId', false], ['evidence', '/enrollmentId', false], ['evidence', '/reattemptOf', false],
  ['evidence', '/citedSpans/0/turnId', false, v => { v.citedSpans = [{ turnId: 'turn-1', quote: 'Longer swings take longer.' }]; }],
  ['gateDecision', '/decisionId', false], ['gateDecision', '/enrollmentId', false], ['gateDecision', '/supersedes', false],
  ['gateDecision', '/evidenceRefs', true], ['gateDecision', '/criterionResults/0/evidenceRefs', true],
  ['teachingHypothesis', '/id', false], ['teachingHypothesis', '/enrollmentId', false], ['teachingHypothesis', '/evidenceRefs', true],
  ['interventionPlan', '/id', false], ['interventionPlan', '/enrollmentId', false], ['interventionPlan', '/hypothesisIds', true], ['interventionPlan', '/evidenceRefs', true],
  ['learnerClaim', '/id', false], ['learnerClaim', '/enrollmentId', false], ['learnerClaim', '/evidenceRefs', true],
  ['researchRequest', '/requestId', false], ['researchResult', '/requestId', false], ['mediaCandidate', '/requestId', false],
  ['mediaReview', '/id', false], ['mediaReview', '/subject/ref', false], ['mediaReview', '/reviewer/id', false],
  ['mediaJob', '/jobId', false],
  ['placementEvidence', '/id', false], ['placementEvidence', '/placementRunId', false], ['placementEvidence', '/enrollmentId', false], ['placementEvidence', '/evidenceRefs', true],
  ['pathExemption', '/id', false], ['pathExemption', '/enrollmentId', false], ['pathExemption', '/placementEvidenceRefs', true],
  ['resolvedConstraintSnapshot', '/enrollmentId', false],
  ['extensionOffer', '/offerId', false], ['extensionOffer', '/enrollmentId', false], ['extensionOffer', '/rationaleEvidenceRefs', true],
  ['extensionGrant', '/grantId', false], ['extensionGrant', '/offerId', false],
  ['closureOutcome', '/enrollmentId', false],
  ['adminCapability', '/scope/enrollmentId', false, v => { v.scope = { kind: 'enrollment', enrollmentId: 'enr-1' }; }],
  ['adminCapability', '/grantedTo', false], ['adminCapability', '/grantedBy', false],
  ['toolCapability', '/grantedTo/id', false, v => { v.grantedTo.kind = 'service'; }], ['toolCapability', '/jobId', false],
  ['artifactValidation', '/artifactId', false],
  ['activityInstance', '/instanceId', false], ['activityInstance', '/enrollmentId', false],
  ['debugTrace', '/enrollmentId', false], ['debugTrace', '/attemptId', false], ['debugTrace', '/jobId', false],
  ['decisionRecord', '/id', false], ['decisionRecord', '/subjectRef', false], ['decisionRecord', '/enrollmentId', false],
  ['decisionRecord', '/decidedBy/id', false], ['decisionRecord', '/inputEvidenceRefs', true],
  ['contextCapsule', '/enrollmentId', false], ['contextCapsule', '/attemptId', false], ['contextCapsule', '/evidenceRefs', true],
  ['contextCapsule', '/artifactRefs/0/id', false, v => { v.artifactRefs = [{ id: 'artifact-1', digest }]; }],
  ['learningEventExport', '/enrollmentRef', false], ['learningEventExport', '/events/0/eventId', false],
];
// Author-defined course identifiers: a digit-leading UUID is still not a course ID.
const COURSE_ID_FIELDS: [RecordKind, string, boolean][] = [
  ['attempt', '/assessmentId', false], ['evidence', '/objectiveIds', true], ['evidence', '/familyId', false], ['evidence', '/misconceptionIds', true],
  ['evidence', '/evaluator/id', false], ['gateDecision', '/gateId', false], ['gateDecision', '/criterionResults/0/criterionId', false],
  ['gateDecision', '/nextActivityId', false], ['teachingHypothesis', '/templateId', false], ['interventionPlan', '/probeIds', true],
  ['interventionPlan', '/actions/0/ref', false], ['researchRequest', '/taskId', false], ['researchRequest', '/objective', false],
  ['researchRequest', '/episodeRevision/episodeId', false], ['researchRequest', '/sourcePolicy/publicTopicId', false], ['mediaJob', '/storyboardRef/id', false],
  ['placementEvidence', '/objectiveId', false], ['pathExemption', '/episodeId', false], ['extensionAllowance', '/poolId', false],
  ['extensionAllowance', '/scopeId', false], ['extensionOffer', '/proposedActivities', true], ['closureOutcome', '/gapObjectiveIds', true],
  ['platformCapabilities', '/rendererIds', true], ['adminCapability', '/sectionId', false], ['toolCapability', '/toolId', false],
  ['artifactValidation', '/validator/id', false], ['activityInstance', '/activityId', false], ['episodeRevision', '/episodeId', false],
  ['conceptGraph', '/nodes/0/id', false], ['debugTrace', '/activityId', false], ['contextCapsule', '/episodeId', false],
  ['learningEventExport', '/course/id', false],
];

const segments = (pointer: string) => pointer.slice(1).split('/');
function setAt(target: any, pointer: string, value: unknown) {
  const keys = segments(pointer), last = keys.pop()!;
  for (const key of keys) target = target[key];
  target[last] = value;
}
function withId(kind: RecordKind, pointer: string, many: boolean, id: string, prepare?: (v: any) => void) {
  const value = structuredClone(samples[kind]); prepare?.(value);
  setAt(value, pointer, many ? [id] : id);
  return value;
}
const schemaPaths = (kind: RecordKind, value: unknown) => validateRecord(kind, value).issues.filter(i => i.code === 'SCHEMA').map(i => i.path);
// Every opaque reference in the record definitions, as a pointer with `*` for array items.
function opaquePointers(definition: string): string[] {
  const defs = (schemaJson as { $defs: Record<string, any> }).$defs, out = new Set<string>();
  const walk = (node: any, path: string, seen: Set<string>) => {
    if (!node || typeof node !== 'object') return;
    if (node.$ref) {
      const name = node.$ref.slice('#/$defs/'.length);
      // A list of opaque IDs counts as one field whether it uses opaqueIds or an inline array.
      if (name === 'opaqueId' || name === 'opaqueIds') out.add(path.replace(/\/\*$/, ''));
      else if (!seen.has(name)) walk(defs[name], path, new Set([...seen, name]));
      return;
    }
    for (const [key, child] of Object.entries(node.properties ?? {})) walk(child, `${path}/${key}`, seen);
    if (node.items) walk(node.items, `${path}/*`, seen);
    for (const variant of node.oneOf ?? []) walk(variant, path, seen);
  };
  walk(defs[definition], '', new Set([definition]));
  return [...out].sort();
}

describe('host-generated record identifiers', () => {
  it('accepts a whole record whose host IDs are all digit-leading UUIDs', () => {
    for (const kind of RECORD_KINDS) {
      const fields = HOST_ID_FIELDS.filter(([k, , , prepare]) => k === kind && !prepare);
      const value = structuredClone(samples[kind]) as any, mapped = new Map<string, string>();
      // Map each existing ID to one UUID so cross-references (criterion evidence within decision evidence) stay linked.
      const fresh = (old: string | null) => {
        if (old === null) return null;
        const n = mapped.size;
        if (!mapped.has(old)) mapped.set(old, `${n % 10}d4b5f7e-2c1a-4e8b-9f3d-${String(n).padStart(12, '0')}`);
        return mapped.get(old)!;
      };
      for (const [, pointer, many] of fields) {
        const keys = segments(pointer); let node = value; for (const key of keys.slice(0, -1)) node = node[key];
        const last = keys.at(-1)!, current = node[last];
        node[last] = many ? current.map(fresh) : fresh(current);
      }
      expect(validateRecord(kind, value).issues, kind).toEqual([]);
      for (const id of mapped.values()) expect(id).toMatch(/^[0-9][0-9a-f]{7}-/);
    }
  });
  it.each(HOST_ID_FIELDS)('%s %s accepts UUIDs and Core-style host IDs', (kind, pointer, many, prepare) => {
    for (const id of [...uuids, 'artifact-0d4b5f7e-2c1a-4e8b-9f3d-6a7b8c9d0e1f', 'admin-evidence:9f1c2d3e-4b5a-4c6d-8e7f-a0b1c2d3e4f5', `adapt-${'0'.repeat(64)}`, 'enr-1', '4'])
      expect(schemaPaths(kind, withId(kind, pointer, many, id, prepare)), id).toEqual([]);
  });
  it.each(HOST_ID_FIELDS)('%s %s rejects oversized or unsafe host IDs', (kind, pointer, many, prepare) => {
    const expected = many ? `${pointer}/0` : pointer;
    for (const id of ['', '1'.repeat(201), `${uuids[0]}/../x`, `${uuids[0]} `, `${uuids[0]}\n`, '-leading', '.hidden', 'é-id', 'a<b>', 'x@y'])
      expect(schemaPaths(kind, withId(kind, pointer, many, id, prepare)), JSON.stringify(id)).toContain(expected);
    expect(schemaPaths(kind, withId(kind, pointer, many, '1'.repeat(200), prepare))).toEqual([]);
  });
  it.each(COURSE_ID_FIELDS)('%s %s keeps the author course-ID pattern', (kind, pointer, many) => {
    expect(schemaPaths(kind, withId(kind, pointer, many, uuids[0]!))).toContain(many ? `${pointer}/0` : pointer);
  });
  it('lists every opaque record field (schema and tests agree)', () => {
    const star = (p: string) => p.replace(/\/\d+(?=\/|$)/g, '/*');
    for (const kind of RECORD_KINDS) {
      const definition = (RECORD_DEFINITIONS as Record<string, string>)[kind]!;
      const tested = [...new Set(HOST_ID_FIELDS.filter(([k]) => k === kind).map(([, p]) => star(p)))].sort();
      expect(opaquePointers(definition), kind).toEqual(tested);
    }
  });
});
