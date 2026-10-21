import type { AdaptationAuthoring } from './adaptation-types.js';
import type { ResearchAuthoring } from './research-types.js';
import type {
  AssessmentRole, ConceptMappingDraft, ConfidenceCapture, ContractTest, CourseContracts0_5, Interaction, RenderFeature, StateMigration, StudyInstruments,
  VersionedProgressionGate, VisualGolden, VisualInvariant, VisualLayouts, VisualPane,
} from './contracts-types.js';
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type Platform = 'web' | 'ios' | 'android';

export interface Objective {
  id: string;
  description: string;
  prerequisites: string[];
  critical?: boolean;
  placeable?: boolean;
}

export interface SourceReference {
  id: string;
  title: string;
  url: string;
  reviewedAt: string;
  license?: string;
}

export interface LearningPolicy {
  mode: 'bounded' | 'open_ended';
  targetDate?: string;
  hardDeadline?: string;
  window?: {
    calendarDays: number;
    timeZone: string;
    anchor: 'enrollment_started' | 'scope_assigned' | 'scope_started';
    pauseRule: 'never' | 'approved_only';
  };
  work?: {
    additionalEpisodes?: number;
    additionalMinutes?: number;
    remediationCyclesPerConcept?: number;
  };
  extensions?: {
    enabled: boolean;
    calendarDays: number;
    maxGrants: number;
    maxDaysPerGrant: number;
    learnerAcceptanceRequired: true;
  };
  existingMaterialAccess: 'read_only' | 'closed';
}

export type ContentBlock =
  | { id: string; type: 'text'; markdown: string; sourceRefs?: string[] }
  | { id: string; type: 'assessment'; assessmentId: string }
  | { id: string; type: 'visual'; visualId: string }
  | { id: string; type: 'media'; mediaId: string; required: boolean }
  | { id: string; type: 'activity'; extensionId: string; configuration: Record<string, Json> }
  /** 0.5: references a defineActivity contract with platform targets and fallbacks. */
  | { id: string; type: 'activity'; activityId: string; configuration?: Record<string, Json> };

export type EpisodeRequirement = 'required' | 'optional';

export interface Episode {
  id: string;
  title: string;
  objectiveIds: string[];
  blocks: ContentBlock[];
  /** Author-owned classification of this fixed unit. Omission means required. */
  requirement?: EpisodeRequirement;
  gateId?: string;
  policy?: LearningPolicy;
}

export interface Chapter {
  id: string;
  title: string;
  summary?: string;
  /** 0.5 roadmap metadata; hosts must not hard-code chapter labels or icons. */
  stageId?: string;
  subtitle?: string;
  iconAsset?: string;
  episodes: Episode[];
  policy?: LearningPolicy;
}

export interface AssessmentBase {
  id: string;
  objectiveIds: string[];
  prompt: string;
  familyId: string;
  /** 0.5: what the item can establish. Only production items may be `transfer`. */
  role?: AssessmentRole;
  /** 0.5: declared hypothesis IDs this item can expose or rule out. */
  misconceptionIds?: string[];
  /** 0.5: whether "I don't know" is offered. Omission means it is offered. */
  allowAbstain?: boolean;
  /** 0.5: optional confidence capture. Confidence alone never passes or fails. */
  confidence?: ConfidenceCapture;
}
/** Recognition item types (selecting rather than producing an answer). */
export type RecognitionAssessmentType = 'choice';
export type Assessment = AssessmentBase & (
  | { type: 'choice'; options: { id: string; text: string; misconceptionId?: string }[]; grading: { correctOptionId: string; explanation: string } }
  | { type: 'numeric'; grading: { expected: number; absoluteTolerance: number; relativeTolerance?: number; unit?: string; explanation: string } }
  | { type: 'rubric'; grading: { evaluatorId: string; rubric: { id: string; description: string; required: boolean }[] } }
  | { type: 'code'; language: string; starterCode: string; grading: { evaluatorId: string; fixtureRef: string }; browserExecution?: BrowserExecution }
  /** 0.5: commit to a quantitative prediction before observing the result. */
  | { type: 'prediction'; observationRef?: string; grading: { expected: number; absoluteTolerance: number; relativeTolerance?: number; unit?: string; explanation: string } }
  /** 0.5: annotate each step of a trace with its value. */
  | { type: 'trace'; steps: { id: string; prompt: string }[]; grading: { expected: { stepId: string; answer: string }[]; match: 'exact' | 'case_insensitive' | 'normalized_whitespace'; explanation: string } }
  /** 0.5: repair faulty code; graded by tests. */
  | { type: 'code_repair'; language: string; starterCode: string; grading: { evaluatorId: string; fixtureRef: string }; browserExecution?: BrowserExecution }
  /** 0.5: rubric-backed production tasks. */
  | { type: 'counterexample' | 'experiment_design' | 'teach_back'; grading: { evaluatorId: string; rubricId: string } }
);
export type AssessmentType = Assessment['type'];
/**
 * 0.6: whether a host may offer an in-browser practice run of a code or code_repair item. `python`
 * needs `language: "python"`; `none` opts the item out. Omitted, the host decides. A browser run is
 * practice feedback only: it never creates an attempt, evidence or a gate decision.
 */
export type BrowserExecution = 'python' | 'none';

/** The 0.4 gate shape. Still valid; `course lint` reports recognition-only risk. */
export interface LegacyProgressionGate {
  id: string;
  objectiveIds: string[];
  assessmentIds: string[];
  minimumIndependentFamilies: number;
  conversationalEvaluatorId?: string;
  requireAllObjectives: boolean;
}
export type ProgressionGate = LegacyProgressionGate | VersionedProgressionGate;

export interface PlacementPolicy {
  enabled: boolean;
  learnerMayDecline: true;
  objectiveIds: string[];
  assessmentIds: string[];
  protectedEpisodeIds: string[];
  maxItems: number;
  /** 0.5 placement inputs (all optional). */
  retestPolicy?: { maxAttempts: number; cooldownDays: number };
  assistancePolicy?: 'unassisted_only';
  evidenceThresholds?: { minimumIndependentFamilies: number; skipRequiresCriticalPrerequisites: true };
}

/** Delayed independent checks. Items are held out of gates and placement so a
 * later success is new evidence, not a repeat; hosts schedule and record them. */
export interface RetentionPolicy {
  /** Days after an objective is first demonstrated; strictly increasing.
   * 0.5: may be omitted, meaning DEFAULT_REVIEW_INTERVALS_DAYS (1, 3, 7, 21). */
  intervalsDays?: number[];
  objectiveIds: string[];
  assessmentIds: string[];
}

export interface ExtensionManifest {
  id: string;
  version: string;
  platforms: Platform[];
  execution: 'declarative' | 'sandboxed_web' | 'server' | 'bundled_native';
  capabilities: string[];
  entrypoint: string;
  integrity: string;
  accessibility: { keyboard: boolean; reducedMotion: boolean; textAlternative: string };
  /** 0.5 (optional): SPDX licence expression recorded in the bundle licence inventory. */
  license?: string;
  /** 0.5 (optional) portable contract fields. */
  stateSchema?: Record<string, Json>;
  observationSchema?: Record<string, Json>;
  resourceBudget?: { timeoutMs: number; maxMemoryMb: number; maxStateBytes?: number; maxEventBytes?: number; maxEventsPerMinute?: number };
  /** Observations reach evidence only through this registered evaluator. */
  evaluatorRef?: string;
  /** 0.6 (optional): how saved state from earlier extension versions is migrated (`migrateState`). */
  stateMigration?: StateMigration;
  /** 0.6 (optional): the extension's own test fixtures, listed in the bundle conformance report. */
  tests?: ContractTest[];
}

export interface VisualExperience {
  id: string;
  rendererId: string;
  platforms: Platform[];
  state: Record<string, Json>;
  scene: Record<string, Json>;
  /** 0.6: may carry the four-layout set (compact, tabletPortrait, tabletLandscape, wide). */
  layouts: VisualLayouts;
  timeline: { durationMs: number; seekable: boolean; cues: { atMs: number; event: string }[] };
  accessibility: { description: string; reducedMotion: Record<string, Json> };
  referenceChecks: string[];
  /** 0.6 (optional): render features the visual needs; a host refuses a renderer that lacks one. */
  requiredFeatures?: RenderFeature[];
  /** 0.6 (optional): learner inputs bound to `state`. */
  interactions?: Interaction[];
  /** 0.6 (optional): synchronized table, code and formula panes. */
  panes?: VisualPane[];
  /** 0.6 (optional): assertions a host checks at publication (render feature `invariants`). */
  invariants?: VisualInvariant[];
  /** 0.6 (optional): expected frame digests a host checks at publication (render feature `goldens`). */
  goldens?: VisualGolden[];
}

export interface MediaResource {
  id: string;
  type: 'youtube' | 'video' | 'image' | 'audio';
  sourceRef: string;
  url: string;
  review: 'unreviewed' | 'reviewed' | 'rejected';
  alternativeMarkdown: string;
  generated: boolean;
  /** 0.5 (optional): a segment that a reviewer actually inspected. */
  segment?: { startSeconds: number; endSeconds: number };
  captions?: 'creator_captions' | 'auto_captions' | 'transcript' | 'unavailable';
}

export interface CourseManifest extends CourseContracts0_5 {
  schemaVersion: 1;
  id: string;
  version: string;
  title: string;
  summary: string;
  /**
   * The source (default) locale every text field is written in: a supported BCP 47 tag such as
   * `en` or `he` (see SUPPORTED_LOCALES). 0.6 validates it (`UNSUPPORTED_LOCALE`). Text direction
   * is derived from it (`localeDirection`), never authored.
   */
  locale: string;
  /** 0.6 (optional): the additional locales this course ships, each with a bundle in `translations`. */
  locales?: string[];
  /**
   * 0.6 (optional): one bundle per entry of `locales`, keyed by stable text keys (see `courseTextKeys`).
   * Every key is translated or listed in the bundle's `fallback` (shown in the source locale).
   */
  translations?: Record<string, LocaleBundle>;
  platforms: Platform[];
  objectives: Objective[];
  chapters: Chapter[];
  assessments: Assessment[];
  gates: ProgressionGate[];
  extensions: ExtensionManifest[];
  visuals: VisualExperience[];
  media: MediaResource[];
  sources: SourceReference[];
  policy: LearningPolicy;
  placement?: PlacementPolicy;
  /** Optional delayed checks that can establish retained understanding. */
  retention?: RetentionPolicy;
  /** Optional additive authoring rules. Runtime trust and application are host-owned. */
  adaptation?: AdaptationAuthoring;
  /** Public research declarations; trusted author approval is enforced by the host. */
  research?: ResearchAuthoring;
  /** 0.5 (optional): host label for chapters, for example "Unit" or "Module". */
  chapterLabel?: string;
  /** 0.6 (optional, server-only): evaluation-study instrument sets and allowed arms. */
  studyInstruments?: StudyInstruments;
  /** 0.6 (optional, server-only): cross-course concept-mapping drafts, applied by a host only after staff review. */
  conceptMappingDrafts?: ConceptMappingDraft[];
}

/**
 * 0.6: one locale's text for a course. `texts` maps a stable text key (`episode:intro#title`,
 * `assessment:q1/option:a#text`, ...) to the translated text. Keys in `fallback` deliberately show
 * the source-locale text; they are reported by `localeCoverage`, `course lint` and `course test`.
 */
export interface LocaleBundle {
  texts: Record<string, string>;
  fallback?: string[];
}

export interface ValidationIssue {
  code: string;
  path: string;
  message: string;
}

export type ValidationResult =
  | { valid: true; course: CourseManifest; issues: [] }
  | { valid: false; issues: ValidationIssue[] };

export interface ContextCapsule {
  enrollmentId: string;
  courseDigest: string;
  /** Personal teaching changes do not replace the immutable course identity. */
  planRevision?: number;
  planDigest?: string;
  artifactRefs?: { id: string; digest: string }[];
  episodeId: string;
  blockId?: string;
  activityId?: string;
  attemptId?: string;
  uiRevision: number;
  profileRevision: number;
  policyRevision: number;
  eventCursor: number;
  selectedAnchor?: string;
  state?: Record<string, Json>;
  evidenceRefs: string[];
  sourceRefs: string[];
  assessmentMode: 'practice' | 'independent' | 'placement';
}
