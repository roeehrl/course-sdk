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
  | { id: string; type: 'activity'; extensionId: string; configuration: Record<string, Json> };

export interface Episode {
  id: string;
  title: string;
  objectiveIds: string[];
  blocks: ContentBlock[];
  gateId?: string;
  policy?: LearningPolicy;
}

export interface Chapter {
  id: string;
  title: string;
  summary?: string;
  episodes: Episode[];
  policy?: LearningPolicy;
}

export interface AssessmentBase {
  id: string;
  objectiveIds: string[];
  prompt: string;
  familyId: string;
}
export type Assessment = AssessmentBase & (
  | { type: 'choice'; options: { id: string; text: string }[]; grading: { correctOptionId: string; explanation: string } }
  | { type: 'numeric'; grading: { expected: number; absoluteTolerance: number; explanation: string } }
  | { type: 'rubric'; grading: { evaluatorId: string; rubric: { id: string; description: string; required: boolean }[] } }
  | { type: 'code'; language: string; starterCode: string; grading: { evaluatorId: string; fixtureRef: string } }
);

export interface ProgressionGate {
  id: string;
  objectiveIds: string[];
  assessmentIds: string[];
  minimumIndependentFamilies: number;
  conversationalEvaluatorId?: string;
  requireAllObjectives: boolean;
}

export interface PlacementPolicy {
  enabled: boolean;
  learnerMayDecline: true;
  objectiveIds: string[];
  assessmentIds: string[];
  protectedEpisodeIds: string[];
  maxItems: number;
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
}

export interface VisualExperience {
  id: string;
  rendererId: string;
  platforms: Platform[];
  state: Record<string, Json>;
  scene: Record<string, Json>;
  layouts: { compact: Record<string, Json>; expanded: Record<string, Json> };
  timeline: { durationMs: number; seekable: boolean; cues: { atMs: number; event: string }[] };
  accessibility: { description: string; reducedMotion: Record<string, Json> };
  referenceChecks: string[];
}

export interface MediaResource {
  id: string;
  type: 'youtube' | 'video' | 'image' | 'audio';
  sourceRef: string;
  url: string;
  review: 'unreviewed' | 'reviewed' | 'rejected';
  alternativeMarkdown: string;
  generated: boolean;
}

export interface CourseManifest {
  schemaVersion: 1;
  id: string;
  version: string;
  title: string;
  summary: string;
  locale: string;
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
