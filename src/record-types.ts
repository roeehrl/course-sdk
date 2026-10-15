/**
 * Runtime record contracts exchanged between hosts, evaluators, agents and the
 * debug inspector. They are data shapes with integrity rules, not authority: a host
 * still authenticates issuers, authorizes commands and owns durable state.
 */
import type { Json } from './types.js';
import type { AccessibilityNeed, EvidenceMode, GateScope, LayoutClass, MediaJobKind, PlatformTarget, ResearchModality, StepStatus } from './contracts-types.js';

export interface VersionRef { id: string; version: string }

// ---------------------------------------------------------------- attempts & evidence

export type ResponseAuthor = 'learner' | 'agent' | 'tutor' | 'staff';
export interface Assistance { hintsUsed: number; answerRevealed: boolean; tutorAuthoredContent: boolean }

/** A submitted response. "I don't know" is an explicit abstention, never a wrong answer. */
export interface Attempt {
  attemptId: string;
  enrollmentId: string;
  assessmentId: string;
  courseDigest: string;
  response: { kind: 'answer'; value: Json } | { kind: 'abstain' };
  /** Optional self-rating on the item's declared scale; it never passes or fails anything alone. */
  confidence: number | null;
  assistance: Assistance;
  author: ResponseAuthor;
  /** Same item retried: not independent evidence. */
  reattemptOf: string | null;
  idempotencyKey: string;
  submittedAt: string;
}

export type EvidenceOutcome = 'correct' | 'incorrect' | 'partial' | 'abstained' | 'pending_review';
export type EvidenceIndependence = 'independent' | 'assisted' | 'synthetic';
export interface Evidence {
  id: string;
  attemptId: string;
  enrollmentId: string;
  courseDigest: string;
  assessmentId: string;
  familyId: string;
  objectiveIds: string[];
  mode: 'deterministic_check' | 'rubric_conversation' | 'practical_task' | 'placement' | 'retention' | 'diagnostic_probe';
  outcome: EvidenceOutcome;
  independence: EvidenceIndependence;
  author: ResponseAuthor;
  assistance: Assistance;
  reattemptOf: string | null;
  /** Hypothesis IDs signalled by this response (e.g. a distractor tied to a misconception). */
  misconceptionIds: string[];
  confidence: number | null;
  evaluator: VersionRef;
  rubricRevision?: VersionRef;
  /** Quoted learner spans backing a conversational judgment. */
  citedSpans?: { turnId: string; quote: string }[];
  issuedAt: string;
}

// ---------------------------------------------------------------- gate decisions

export type GateDecisionStatus = 'ready' | 'needs_evidence' | 'needs_help' | 'under_review' | 'closed_with_gaps';
export type NextActionKind = 'continue' | 'attempt_check' | 'request_help' | 'review_material' | 'await_review' | 'appeal' | 'consider_extension' | 'view_gaps';
export interface NextAction { kind: NextActionKind; label: string; targetId?: string }
export interface GateDecision {
  decisionId: string;
  enrollmentId: string;
  gateId: string;
  gateVersion: string;
  courseDigest: string;
  policyRevision: number;
  status: GateDecisionStatus;
  criterionResults: { criterionId: string; met: boolean | 'pending'; evidenceRefs: string[]; reason: string }[];
  missingObjectiveIds: string[];
  unresolvedMisconceptionIds: string[];
  evidenceRefs: string[];
  evaluator: { kind: 'sdk_reference' | 'host_policy' | 'staff_review'; id: string; version: string };
  learnerVisibleReason: string;
  nextActions: NextAction[];
  nextActivityId: string | null;
  decidedAt: string;
  supersedes: string | null;
}

// ---------------------------------------------------------------- teaching

export interface TeachingHypothesis {
  id: string;
  enrollmentId: string;
  templateId: string | null;
  kind: 'misconception' | 'missing_prerequisite' | 'slip' | 'ambiguous_item' | 'useful_analogy';
  statement: string;
  objectiveIds: string[];
  evidenceRefs: string[];
  uncertainty: 'low' | 'medium' | 'high';
  status: 'proposed' | 'confirmed' | 'corrected' | 'rejected' | 'pinned';
  author: 'supervisor' | 'learner' | 'staff';
  createdAt: string;
  expiresAt: string | null;
}
export interface InterventionPlan {
  id: string;
  enrollmentId: string;
  revision: number;
  hypothesisIds: string[];
  probeIds: string[];
  objectiveIds: string[];
  actions: { kind: 'probe' | 'contrast_case' | 'change_representation' | 'visit_prerequisite' | 'transfer_check' | 'review'; ref: string }[];
  rationale: string;
  evidenceRefs: string[];
}
export interface LearnerClaim {
  id: string;
  enrollmentId: string;
  class: 'declared' | 'observed' | 'hypothesis' | 'projection';
  statement: string;
  objectiveIds: string[];
  evidenceRefs: string[];
  author: 'learner' | 'supervisor' | 'staff' | 'system';
  uncertainty: 'low' | 'medium' | 'high' | null;
  createdAt: string;
  expiresAt: string | null;
  learnerOverride: 'none' | 'corrected' | 'excluded' | 'disputed';
}

// ---------------------------------------------------------------- research & media

export interface ResearchRequest {
  requestId: string;
  taskId: string;
  objective: string;
  episodeRevision: { episodeId: string; courseDigest: string; planRevision: number };
  /** A declared hypothesis ID, never free text from a learner conversation. */
  misconceptionHypothesis: string | null;
  knownPrerequisites: string[];
  language: string;
  modality: ResearchModality;
  remainingLearningTime: 'under_15_min' | '15_to_60_min' | 'over_60_min';
  accessibilityNeeds: AccessibilityNeed[];
  sourcePolicy: { publicTopicId: string; allowedDomains?: string[]; requireReviewedContent: true; maxCandidates: number; maxToolCalls: number; deadlineSeconds: number };
  requiredOrOptional: 'optional' | 'required_replacement';
}

/** A MediaCandidate. Metadata alone is not review: such candidates carry no claims or segments. */
export interface ResearchResult {
  requestId: string;
  sourceUrl: string;
  creator: string;
  inspectedEvidence: { kind: 'full_text' | 'transcript' | 'captions' | 'viewed_segment' | 'metadata_only'; summary: string };
  objectiveFit: { objective: string; fit: 'direct' | 'partial' | 'background'; rationale: string };
  prerequisites: string[];
  claims: { text: string; supportedBy: string }[];
  verifiedSegmentIfAny: { startSeconds: number; endSeconds: number } | null;
  duration: { seconds: number } | null;
  captionsOrTranscriptStatus: 'creator_captions' | 'auto_captions' | 'transcript_authorized' | 'unavailable' | 'unknown';
  rightsAndEmbeddingStatus: 'embeddable' | 'link_only' | 'licensed_reuse' | 'not_permitted' | 'unknown';
  reviewedAt: string;
  concerns: string[];
  reviewStatus: 'reviewed' | 'unreviewed';
}
export type MediaCandidate = ResearchResult;

export interface MediaReview {
  id: string;
  subject: { kind: 'research_result' | 'media_job'; ref: string };
  reviewer: { kind: 'staff' | 'verifier'; id: string };
  checks: { id: 'facts' | 'visuals' | 'captions' | 'rights' | 'accessibility' | 'reference_computation'; result: 'passed' | 'failed' | 'not_applicable' }[];
  outcome: 'approved' | 'rejected' | 'needs_changes';
  concerns: string[];
  reviewedAt: string;
}
export type MediaJobState = 'requested' | 'budget_reserved' | 'queued' | 'generating' | 'reviewing' | 'ready' | 'rejected' | 'cancelled' | 'provider_failed' | 'outcome_unknown';
export interface MediaJob {
  jobId: string;
  kind: MediaJobKind;
  state: MediaJobState;
  storyboardRef: VersionRef;
  objectiveIds: string[];
  provenance: {
    providerCapabilitySnapshot: string; modelAndSettings: string; assetHash: string | null; reviewReportRef: string | null;
    captionsRef: string | null; transcriptRef: string | null; visualDescriptionRef: string | null; rights: string; referenceComputationRef: string | null;
  };
  idempotencyKey: string;
  updatedAt: string;
}

// ---------------------------------------------------------------- placement

export interface PlacementEvidence {
  id: string;
  placementRunId: string;
  enrollmentId: string;
  objectiveId: string;
  evidenceRefs: string[];
  outcome: 'demonstrated' | 'not_demonstrated' | 'pending_evaluation';
  independence: 'independent' | 'assisted';
  courseDigest: string;
  rubricRevisions: VersionRef[];
}
export interface PathExemption {
  id: string;
  enrollmentId: string;
  episodeId: string;
  objectiveIds: string[];
  placementEvidenceRefs: string[];
  courseDigest: string;
  policyRevision: number;
  grantedAt: string;
  /** Exemptions skip teaching; they never fabricate completion or retention. */
  recordsCompletion: false;
  learnerMayRevisit: true;
}

// ---------------------------------------------------------------- policy records

export interface ResolvedConstraintSnapshot {
  enrollmentId: string;
  policyRevision: number;
  scope: string;
  effectiveDeadline: string | null;
  bindingScope: string | null;
  remainingAdditionalEpisodes: number | null;
  remainingAdditionalMinutes: number | null;
  mode: 'bounded' | 'open_ended';
  computedAt: string;
}
export interface ExtensionAllowance {
  poolId: string;
  scopeId: string;
  unit: 'calendar_day' | 'scope_calendar_day';
  total: number;
  used: number;
  maxPerGrant: number;
  maxGrants: number;
  grantsUsed: number;
}
export type ExtensionOfferState = 'proposed' | 'accepted_pending_admin' | 'granted' | 'declined' | 'expired' | 'rejected' | 'superseded';
export interface ExtensionOffer {
  offerId: string;
  scopeId: string;
  enrollmentId: string;
  expectedPolicyRevision: number;
  rationaleEvidenceRefs: string[];
  proposedActivities: string[];
  currentEffectiveDeadline: string;
  proposedEffectiveDeadline: string;
  addedWork: { episodes: number; minutes: number };
  poolDebits: { poolId: string; amount: number }[];
  balanceBefore: { poolId: string; remaining: number }[];
  balanceAfter: { poolId: string; remaining: number }[];
  bindingAncestorCaps: string[];
  planImpact: string;
  alternatives: string[];
  expiresAt: string;
  requiredApprovals: ('learner' | 'admin')[];
  state: ExtensionOfferState;
}
export interface ExtensionGrant {
  grantId: string;
  offerId: string;
  acceptedTermsDigest: string;
  learnerAcceptanceReceipt: string;
  authorityReceipt: string | null;
  idempotencyKey: string;
  atomicLedgerTransactionId: string;
  newPolicyRevision: number;
}
export interface ClosureOutcome {
  enrollmentId: string;
  reason: 'completed' | 'cap_reached' | 'withdrawn' | 'policy_closure';
  closedAt: string;
  policyRevision: number;
  demonstratedObjectiveIds: string[];
  gapObjectiveIds: string[];
  evidenceReportRef: string;
  existingMaterial: 'read_only' | 'closed';
  continuation: 'none' | 'explicit_opt_in_only';
}

// ---------------------------------------------------------------- platform, admin, tools, debug

export interface PlatformCapabilities {
  target: PlatformTarget;
  appVersion: string;
  sdkVersion: string;
  capabilities: string[];
  rendererIds: string[];
  nativeModules: string[];
  layoutClass: LayoutClass;
  inputModes: ('touch' | 'pointer' | 'keyboard' | 'stylus' | 'screen_reader')[];
}
export interface AdminCapability {
  sectionId: string;
  permission: string;
  scope: { kind: 'course' } | { kind: 'chapter'; chapterId: string } | { kind: 'enrollment'; enrollmentId: string };
  grantedTo: string;
  grantedBy: string;
  expiresAt: string | null;
}
export interface ToolCapability {
  toolId: string;
  toolVersion: string;
  capabilities: string[];
  grantedTo: { kind: 'agent_strategy' | 'activity' | 'service'; id: string };
  jobId: string | null;
  expiresAt: string;
  revocable: true;
}
export interface ArtifactValidation {
  artifactId: string;
  artifactDigest: string;
  validator: VersionRef;
  checks: { id: string; result: 'passed' | 'failed' }[];
  outcome: 'passed' | 'failed';
  validatedAt: string;
}
export interface ActivityInstance {
  instanceId: string;
  activityId: string;
  activityVersion: string;
  enrollmentId: string;
  target: PlatformTarget;
  rendererId: string;
  stateVersion: number;
  state: Record<string, Json>;
  status: StepStatus;
  startedAt: string;
}
export interface EpisodeRevision {
  episodeId: string;
  courseDigest: string;
  planRevision: number;
  digest: string;
  personal: boolean;
  sourceRefs: string[];
}
export interface ConceptGraph {
  courseDigest: string;
  nodes: { id: string; title: string; objectiveIds: string[] }[];
  edges: { from: string; to: string }[];
}
export interface DebugTrace {
  traceId: string;
  parentSpanId: string | null;
  enrollmentId: string | null;
  activityId: string | null;
  attemptId: string | null;
  eventCursor: number | null;
  workflowId: string | null;
  jobId: string | null;
  artifactHash: string | null;
  provenance: {
    courseVersion: string; sdkVersion: string; appPlatformVersion: string | null; profileRevision: number | null;
    policyRevision: number | null; gateRubricVersion: string | null; modelConfig: string | null; toolGrant: string | null;
  };
  view: 'context' | 'dispatch_graph' | 'tool_model_calls' | 'rubric_evidence' | 'gate_placement_decision' | 'budgets_caps' | 'artifact_changes' | 'client_sync' | 'safe_replay';
  /** Payloads are redacted unless an authorized, audited reveal happened. */
  payload: { redacted: true } | { redacted: false; auditReceipt: string; value: Json };
  replay: { isReplay: false } | { isReplay: true; sourceTraceId: string; sideEffects: 'stubbed'; progressWrites: 'denied' };
}
export interface DecisionRecord {
  id: string;
  kind: 'gate' | 'placement' | 'intervention' | 'adaptation' | 'extension' | 'closure';
  subjectRef: string;
  enrollmentId: string;
  versions: { courseDigest: string; policyRevision: number; gateVersion?: string; rubricRevisions?: VersionRef[] };
  inputEvidenceRefs: string[];
  outcome: string;
  reason: string;
  decidedBy: { kind: 'host_policy' | 'staff' | 'learner' | 'sdk_reference'; id: string };
  decidedAt: string;
  traceId: string | null;
}

/** Learner-safe projection of a versioned gate (requirements are readable; item banks are not). */
export interface LearnerVersionedGate {
  id: string;
  version: string;
  scope: GateScope;
  requiredObjectives: string[];
  readinessCriteria: { id: string; kind: string; description: string; objectiveIds: string[] }[];
  eligibleEvidenceKinds: EvidenceMode[];
  minimumIndependentEvidence: { families: number; transferItems: number };
  nextActivityId: string | null;
  appealPolicy: { allowed: boolean; windowDays?: number; reviewer: 'staff' | 'independent_evaluator' };
  previewAccess?: 'none' | 'read_only';
}

export interface RecordKinds {
  attempt: Attempt;
  evidence: Evidence;
  gateDecision: GateDecision;
  teachingHypothesis: TeachingHypothesis;
  interventionPlan: InterventionPlan;
  learnerClaim: LearnerClaim;
  researchRequest: ResearchRequest;
  researchResult: ResearchResult;
  mediaReview: MediaReview;
  mediaJob: MediaJob;
  placementEvidence: PlacementEvidence;
  pathExemption: PathExemption;
  resolvedConstraintSnapshot: ResolvedConstraintSnapshot;
  extensionAllowance: ExtensionAllowance;
  extensionOffer: ExtensionOffer;
  extensionGrant: ExtensionGrant;
  closureOutcome: ClosureOutcome;
  platformCapabilities: PlatformCapabilities;
  adminCapability: AdminCapability;
  toolCapability: ToolCapability;
  artifactValidation: ArtifactValidation;
  activityInstance: ActivityInstance;
  episodeRevision: EpisodeRevision;
  conceptGraph: ConceptGraph;
  debugTrace: DebugTrace;
  decisionRecord: DecisionRecord;
  /** The design's name for a research result; validated identically. */
  mediaCandidate: MediaCandidate;
}
export type RecordKind = keyof RecordKinds;
