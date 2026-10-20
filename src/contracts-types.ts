/**
 * SDK 0.5 authoring contracts. Every field added to CourseManifest by this module is
 * optional, so schema-1 manifests written for 0.4.0 keep their bytes, digests and
 * compiled projections. Contracts declare intent; the host enforces permissions,
 * evidence integrity, caps and authorization.
 */
import type { AssessmentType, Json } from './types.js';
import type { AdaptationOperationKind } from './adaptation-types.js';

export type PlatformTarget = 'web_desktop' | 'web_mobile' | 'ios_phone' | 'ipados_tablet' | 'android_phone' | 'android_tablet';
export type LayoutClass = 'compact' | 'medium' | 'expanded';
export type LayoutInput = 'effective_window_bounds' | 'safe_areas' | 'font_scale' | 'input_mode' | 'keyboard_visibility' | 'orientation' | 'split_view';
export type ExecutionAdapter = 'declarative' | 'sandboxed_web' | 'server' | 'bundled_native';

/** Scope reference for an applicable LearningPolicy: `course`, `chapter:<id>` or `episode:<id>`. */
export type PolicyScopeRef = string;

// ---------------------------------------------------------------- concepts & teaching

export interface Concept {
  id: string;
  title: string;
  objectiveIds: string[];
  /** Concept-level prerequisites. Must form an acyclic graph. */
  prerequisiteConceptIds: string[];
}

export type HypothesisKind = 'misconception' | 'missing_prerequisite' | 'slip' | 'ambiguous_item' | 'useful_analogy';

/** An author-declared competing explanation for an error, revisable at runtime. */
export interface TeachingHypothesisTemplate {
  id: string;
  kind: HypothesisKind;
  statement: string;
  objectiveIds: string[];
  /** A critical misconception must be resolved before a versioned gate can be ready. */
  critical?: boolean;
  /** For missing_prerequisite hypotheses: the objective that may be missing. */
  prerequisiteObjectiveId?: string;
}

/** The smallest check that discriminates between competing hypotheses. Never grants credit. */
export interface DiagnosticProbe {
  id: string;
  objectiveId: string;
  assessmentId: string;
  /** At least two competing hypotheses the probe separates. */
  distinguishes: string[];
  signals: ({ hypothesisId: string; optionIds: string[] } | { hypothesisId: string; outcome: 'correct' | 'incorrect' | 'abstained' })[];
}

// ---------------------------------------------------------------- assessments

export type AssessmentRole = 'recognition' | 'application' | 'transfer' | 'diagnostic_probe';
export interface ConfidenceCapture { capture: 'optional'; scale: { minimum: 1; maximum: 3 | 4 | 5 | 7 } }

// ---------------------------------------------------------------- gates

export type EvidenceMode = 'rubric_backed_conversation' | 'deterministic_interactive_check' | 'verified_practical_task' | 'configured_combination';
export type ReadinessCriterionKind = 'independent_success' | 'transfer_success' | 'no_critical_misconception' | 'rubric_criteria' | 'practical_task';
export interface ReadinessCriterion {
  id: string;
  kind: ReadinessCriterionKind;
  description: string;
  objectiveIds: string[];
}
export type GateScope = { kind: 'course' } | { kind: 'chapter'; chapterId: string } | { kind: 'episode'; episodeId: string };

/** The versioned gate from the approved design (`progression_gate.required_fields`). */
export interface VersionedProgressionGate {
  id: string;
  version: string;
  scope: GateScope;
  requiredObjectives: string[];
  readinessCriteria: ReadinessCriterion[];
  eligibleEvidenceKinds: EvidenceMode[];
  minimumIndependentEvidence: {
    /** Distinct independent item families per required objective. */
    families: number;
    /** Independent successes on production (non-recognition) transfer items. At least 1. */
    transferItems: number;
  };
  conversationalRubricRef?: string;
  interactiveCheckRefs?: string[];
  practicalTaskRefs?: string[];
  assistancePolicy: {
    /** Assisted work is recorded but never counted as independent evidence. */
    assistedEvidence: 'recorded_not_counted';
    revealRequiresFreshEvidence: true;
    agentAuthoredAnswers: 'rejected';
    reattemptsOfSameItem: 'not_independent';
  };
  /** Next activity (episode, learning step or activity ID), or null at the end of a path. */
  nextActivityId: string | null;
  remediationPolicyRef: string;
  capPolicyRef: PolicyScopeRef;
  appealPolicy: { allowed: boolean; windowDays?: number; reviewer: 'staff' | 'independent_evaluator' };
  previewAccess?: 'none' | 'read_only';
}

// ---------------------------------------------------------------- rubrics, evaluators, tools

export interface Rubric {
  id: string;
  version: string;
  title: string;
  criteria: { id: string; description: string; required: boolean; evidence: 'cited_learner_span' | 'artifact_result' | 'observation' }[];
  /** Conversation evidence must quote the learner; impressions are not evidence. */
  requiresCitedEvidence: boolean;
  uncertain: 'pending_review' | 'clarifying_probe';
}

/** What an evaluator judges: assessment items of these types, or `conversation`, the quoted
 * findings of a gate conversation (see `gateConversation`). */
export type EvaluatorItemType = AssessmentType | 'conversation';
export type EvaluatorMethod = 'deterministic' | 'code_tests' | 'rubric_model_assisted' | 'human' | 'external';
export interface EvaluatorDefinition {
  id: string;
  version: string;
  extensionId: string;
  method: EvaluatorMethod;
  itemTypes: EvaluatorItemType[];
  rubricIds?: string[];
  humanConfirmation: 'required' | 'on_uncertain' | 'none';
  outputs: { uncertainty: true; provenance: true };
  tests: { fixtureRef: string; acceptsValidVariants: true; rejectsMisconceptions: true };
}

export type ToolSideEffect = 'none' | 'proposal_only' | 'artifact_write';
export interface ToolDefinition {
  id: string;
  version: string;
  description: string;
  execution: 'server' | 'sandboxed' | 'mcp_http';
  extensionId?: string;
  inputSchema: Record<string, Json>;
  outputSchema: Record<string, Json>;
  capabilities: string[];
  sideEffects: ToolSideEffect;
  idempotency: 'idempotent' | 'idempotency_key' | 'non_idempotent';
  timeoutMs: number;
  maxOutputBytes: number;
}

// ---------------------------------------------------------------- policies

export type RemediationStrategy = 'change_representation' | 'visit_prerequisite' | 'worked_example' | 'contrast_case' | 'practice' | 'diagnostic_probe';
export interface AdaptationPolicy {
  id: string;
  version: string;
  maxCyclesPerConcept: number;
  strategies: RemediationStrategy[];
  onExhausted: 'close_with_gaps' | 'offer_extension' | 'staff_review';
  autoApply: 'verified_only' | 'never';
  learnerUndo: true;
}

// ---------------------------------------------------------------- activities

/** How saved state from earlier versions is handled. The host runs the migration; it never invents evidence. */
export interface StateMigration { stateVersion: number; strategy: 'none' | 'migrate' | 'reset_with_notice'; migratesFrom: number[] }
/** A test fixture shipped with an extension: a portable relative path inside the extension package. */
export interface ContractTest { id: string; kind: 'conformance' | 'renderer' | 'evaluator' | 'state_migration' | 'accessibility'; fixtureRef: string }

export interface ActivityDefinition {
  id: string;
  version: string;
  title: string;
  objectiveIds: string[];
  supportedTargets: PlatformTarget[];
  rendererRefs: { target: PlatformTarget; rendererId: string }[];
  executionAdapter: ExecutionAdapter;
  capabilityRequirements: { capability: string; required: boolean }[];
  /** Objective-equivalent alternatives for declared course targets without native support. */
  equivalentFallbacks: { target: PlatformTarget; kind: 'activity' | 'assessment' | 'text_block'; ref: string; objectiveIds: string[] }[];
  offlineBehavior: 'unavailable' | 'read_only' | 'queue_observations' | 'full';
  resourceBudget: { timeoutMs: number; maxMemoryMb: number; maxStateBytes: number; maxEventBytes: number; maxEventsPerMinute: number };
  accessibleSemantics: { keyboard: boolean; screenReader: boolean; reducedMotion: boolean; nonPointerPath: boolean; textAlternative: string };
  stateMigration: StateMigration;
  layoutInputs: LayoutInput[];
  layouts: Partial<Record<LayoutClass, Record<string, Json>>>;
  stateSchema?: Record<string, Json>;
  observationSchema?: Record<string, Json>;
  /** Observations reach evidence only through this registered evaluator. */
  evaluatorRef?: string;
}

// ---------------------------------------------------------------- admin, steps, research, media

export type AdminPermission = 'course.read' | 'course.settings.write' | 'policy.read' | 'policy.write' | 'learners.read_evidence'
  | 'reviews.write' | 'research.review' | 'supervision.control' | 'debug.read' | 'debug.payload' | 'audit.read';
export type AdminSetting = {
  id: string; label: string; description?: string; scope: 'course' | 'chapter' | 'enrollment'; mutationPermission: AdminPermission;
} & (
  | { type: 'boolean'; default: boolean }
  | { type: 'integer' | 'number'; default: number; minimum: number; maximum: number }
  | { type: 'string'; default: string; maxLength: number }
  | { type: 'enum'; default: string; options: string[] }
);
export interface AdminSection {
  id: string;
  version: string;
  title: string;
  description?: string;
  requiredPermissions: AdminPermission[];
  settings: AdminSetting[];
  rendererRef?: string;
  learnerDataAccess: 'none' | 'aggregate' | 'scoped_with_consent';
  audit: 'all_mutations';
}

/** 0.6 adds `pre_test`: a study pre-test whose answers never count as gate evidence. */
export type LearningStepKind = 'explain' | 'predict' | 'manipulate' | 'solve' | 'explain_back' | 'revisit' | 'review' | 'gate' | 'optional_help' | 'pre_test';
export type StepStatus = 'required' | 'optional_help' | 'completed' | 'current' | 'locked' | 'under_review' | 'closed_with_gaps';
export interface LearningStep {
  id: string;
  episodeId: string;
  kind: LearningStepKind;
  requirement: 'required' | 'optional_help';
  blockIds: string[];
  primaryAction: { label: string; blockId: string };
  nextStepId: string | null;
  gateId?: string;
}

export type ResearchModality = 'article' | 'video' | 'interactive' | 'worked_example' | 'any';
export type AccessibilityNeed = 'captions' | 'transcript' | 'screen_reader' | 'reduced_motion' | 'keyboard_only' | 'audio_description' | 'plain_language';
export interface ResearchTask {
  id: string;
  objectiveIds: string[];
  /** Author-reviewed public query texts; the only text a search provider receives. */
  publicTopicIds: string[];
  modalities: ResearchModality[];
  languages: string[];
  requiredOrOptional: 'optional' | 'required_replacement';
  sourcePolicy: { allowedDomains?: string[]; requireReviewedContent: true; maxCandidates: number; maxToolCalls: number; deadlineSeconds: number };
}

export type MediaJobKind = 'verified_vector_animation' | 'generated_image' | 'generated_short_video' | 'reviewed_external_embed';
export interface Storyboard {
  id: string;
  version: string;
  kind: MediaJobKind;
  objectiveIds: string[];
  durationMs: number;
  script: { id: string; atMs: number; text: string }[];
  frames: { id: string; atMs: number; description: string; visualId?: string; referenceCheckIds?: string[] }[];
  referenceVisualId?: string;
  captionsRequired: true;
  accessibleEquivalent: { kind: 'text_block' | 'visual' | 'activity'; ref: string };
  sourceRefs: string[];
}

// ---------------------------------------------------------------- agents, platform, debug, visuals

export type AgentRole = 'supervisor' | 'companion_tutor' | 'researcher' | 'builder' | 'evaluator' | 'verifier';
export type ModelCapability = 'tool_calling' | 'structured_output' | 'long_context' | 'vision' | 'streaming';
export interface AgentStrategy {
  id: string;
  version: string;
  roles: AgentRole[];
  description: string;
  inputSchema: Record<string, Json>;
  outputContract: { schema: Record<string, Json>; proposalKinds: string[] };
  toolRefs: string[];
  modelRequirements: { capabilities: ModelCapability[]; minContextTokens?: number };
  autonomy: {
    level: 'propose_only' | 'apply_verified_personal';
    /** Adaptation operations the strategy may apply after verification and learner opt-in. */
    mayApply: AdaptationOperationKind[];
    requiresLearnerOptIn: true;
    maxAppliedChangesPerDay: number;
  };
  budget: { maxToolCalls: number; maxWallSeconds: number; maxOutputTokens: number };
  retry: { maxAttempts: number; reconcileUnknownOutcome: true };
  cancellation: 'cooperative';
}

export interface PlatformAdapter {
  id: string;
  version: string;
  target: PlatformTarget;
  kind: 'web_island' | 'native_module' | 'server_sandbox';
  providesCapabilities: string[];
  /** Native capability requires a compiled app release; content cannot grant it dynamically. */
  requiresAppBuild: boolean;
  layoutInputs: LayoutInput[];
}

export type DebugView = 'context' | 'dispatch_graph' | 'tool_model_calls' | 'rubric_evidence' | 'gate_placement_decision'
  | 'budgets_caps' | 'artifact_changes' | 'client_sync' | 'safe_replay';
export interface DebugInspector {
  id: string;
  version: string;
  title: string;
  subjects: { kind: 'activity' | 'visual' | 'evaluator' | 'agent_strategy' | 'gate' | 'tool'; ref: string }[];
  views: DebugView[];
  rendererRef?: string;
  payloadAccess: 'redacted' | 'payload_with_audit';
  requiredPermissions: AdminPermission[];
  replay: { allowed: boolean; sideEffects: 'stubbed'; progressWrites: 'denied' };
}

export type RenderSurface = 'learner_activity' | 'visual' | 'admin' | 'inspector';
export interface RendererDefinition {
  id: string;
  version: string;
  surface: RenderSurface;
  extensionId: string;
  targets: PlatformTarget[];
  features: RenderFeature[];
}
/** 0.6 adds `symbol`, `spring`, `stagger`, `layout_set` and `panes` (Course Core visuals 0.2/0.3). SDK 0.5 hosts reject them. */
export type RenderFeature = 'mask' | 'clip' | 'gradient' | 'blend' | 'morph' | 'shader' | '3d' | 'text_layout' | 'equation' | 'path_draw'
  | 'symbol' | 'spring' | 'stagger' | 'layout_set' | 'panes';
export interface RendererAdapter {
  id: string;
  version: string;
  rendererId: string;
  target: PlatformTarget;
  engine: 'svg' | 'canvas' | 'skia' | 'native_svg' | 'webgl' | 'lottie' | 'rive' | 'custom';
  supportedFeatures: RenderFeature[];
  /** Unsupported features need a tested equivalent; the taught result must not change. */
  fallbacks: { feature: RenderFeature; fallback: 'equivalent_static' | 'simplified_decoration' }[];
}
export interface Scene {
  id: string;
  version: string;
  semanticNodes: { id: string; label: string; role: 'object' | 'value' | 'relation' | 'annotation' }[];
  layers: SceneLayer[];
  assets: { id: string; url: string; license?: string; sourceRef?: string }[];
  /** 0.6 (optional): scene-local clips, masks and symbols, referenced by ID only. */
  defs?: SceneDefs;
}
export interface SceneLayer {
  id: string;
  /** 0.6 adds `use`: an instance of a `defs.symbols` entry. */
  kind: 'vector' | 'text' | 'image' | 'equation' | 'group' | 'use';
  semanticNodeIds: string[];
  assetRef?: string;
  decorative: boolean;
  /** 0.6: the layer's text alternative. Publication requires one on every equation layer. */
  label?: string;
  /** 0.6: a `defs.clips` ID. */
  clip?: string;
  /** 0.6: a `defs.masks` ID (luminance). */
  mask?: string;
  /** 0.6: the `defs.symbols` ID a `use` layer instantiates; only `use` layers name one. */
  symbol?: string;
}
/** 0.6: reusable scene-local definitions. Each lists the scene layers that draw it. */
export interface SceneDefs {
  clips?: { id: string; layerIds: string[] }[];
  masks?: { id: string; layerIds: string[] }[];
  symbols?: { id: string; width: number; height: number; layerIds: string[] }[];
}

/** 0.6: the two-layout form (compact/expanded) or, with all three optional entries, the four-layout set.
 * `expanded` stays the fallback for renderers without the `layout_set` feature. */
export interface VisualLayouts {
  compact: Record<string, Json>;
  expanded: Record<string, Json>;
  tabletPortrait?: Record<string, Json>;
  tabletLandscape?: Record<string, Json>;
  wide?: Record<string, Json>;
}
/** 0.6: binds a learner input to one key of the visual's `state` (see `bindData`). */
export interface DataBinding {
  state: string;
  /** A numeric range; the state value must be a number. Exclusive with `values`. */
  range?: { min: number; max: number; step?: number };
  /** The discrete values the input can select. Exclusive with `range`. */
  values?: Json[];
}
export type InteractionKind = 'tap' | 'drag' | 'scrub' | 'pinch' | 'pan' | 'hover' | 'keyboard' | 'stylus';
/** 0.6: a learner input on a visual, bound to visual state. Pointer-only kinds need an accessible alternative. */
export interface Interaction {
  id: string;
  kind: InteractionKind;
  /** The semantic anchor (node or layer ID) the input acts on. */
  target: string;
  label: string;
  binding: DataBinding;
  alternative?: { kind: 'keyboard' | 'control'; keys?: string[] };
}
/** 0.6: an HTML pane kept in step with the visual (same state, time and computation).
 * Expressions (`rows` cells, `highlightRow`, `highlightLine`, `values[].value`) are renderer data. */
export type VisualPane =
  | { id: string; kind: 'table'; title: string; columns: string[]; rows: Json[][]; highlightRow?: Json }
  | { id: string; kind: 'code'; title: string; language: string; lines: string[]; highlightLine?: Json }
  | { id: string; kind: 'formula'; title: string; tex: string; label: string; values?: { symbol: string; value: Json }[] };

/** 0.6: what a study arm changes, as Course Core defines it. */
export type StudyArmBehaviour = 'fixed' | 'chat_only' | 'supervisor';
/**
 * 0.6: evaluation-study instrument sets over the course's own assessment items, and the study arms
 * the author allows. Hosts build study definitions from them; consent, allocation and export stay host-owned.
 */
export interface StudyInstruments {
  pre: string[];
  post: string[];
  transfer?: string[];
  /** Held-out retention items (`retention.assessmentIds`) only. */
  delayed?: string[];
  /** When present, a host offers only these arms for studies of this course. */
  allowedArms?: { id: string; label: string; behaviour: StudyArmBehaviour }[];
}

export type ConceptRelation = 'equivalent' | 'prerequisite_of' | 'overlaps';
/** 0.6: one side of a concept-mapping link: an objective of this course or of the named other course. */
export interface ConceptMappingEnd { course: 'this' | 'other'; objectiveId: string }
/**
 * 0.6 (draft only): a proposed mapping between this course's objectives and another course's.
 * Hosts apply it only after staff review; it never moves evidence or grants mastery.
 */
export interface ConceptMappingDraft {
  id: string;
  status: 'draft';
  otherCourse: { id: string; version?: string };
  note?: string;
  links: { relation: ConceptRelation; from: ConceptMappingEnd; to: ConceptMappingEnd }[];
}
export interface Timeline {
  id: string;
  version: string;
  sceneId: string;
  durationMs: number;
  seekable: boolean;
  tracks: { id: string; layerId: string; property: string; easing: 'linear' | 'ease_in' | 'ease_out' | 'ease_in_out' | 'step' | 'spring'; keyframes: { atMs: number; value: Json }[] }[];
  cues: { atMs: number; event: string }[];
  reducedMotion: 'static_frames' | 'crossfade' | 'no_motion_needed';
}

/** Optional roadmap stage grouping; replaces host-hard-coded chapter labels. */
export interface CourseStage {
  id: string;
  title: string;
  summary?: string;
  /** 0.6 (optional) roadmap presentation, in place of host-hard-coded labels and icons. */
  subtitle?: string;
  iconAsset?: string;
}

/** Every optional 0.5 manifest section. */
export interface CourseContracts0_5 {
  stages?: CourseStage[];
  concepts?: Concept[];
  hypotheses?: TeachingHypothesisTemplate[];
  probes?: DiagnosticProbe[];
  rubrics?: Rubric[];
  evaluators?: EvaluatorDefinition[];
  tools?: ToolDefinition[];
  adaptationPolicies?: AdaptationPolicy[];
  activities?: ActivityDefinition[];
  adminSections?: AdminSection[];
  learningSteps?: LearningStep[];
  researchTasks?: ResearchTask[];
  storyboards?: Storyboard[];
  agentStrategies?: AgentStrategy[];
  platformAdapters?: PlatformAdapter[];
  debugInspectors?: DebugInspector[];
  renderers?: RendererDefinition[];
  rendererAdapters?: RendererAdapter[];
  scenes?: Scene[];
  timelines?: Timeline[];
}

