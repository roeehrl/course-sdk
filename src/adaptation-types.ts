import type { Assessment, CourseManifest, Json, MediaResource, ValidationIssue, VisualExperience } from './types.js';

export type TeachingArtifactKind = 'explanation' | 'practice' | 'assessment_variant' | 'media' | 'visual' | 'profile_suggestion';
export type AdaptationOperationKind = 'append_teaching' | 'replace_teaching' | 'attach_media' | 'attach_visual' | 'add_assessment_variant' | 'suggest_profile_correction';
export interface VersionedRef { id: string; version: string }
export interface VerifierDeclaration extends VersionedRef {
  extensionId: string;
  sourceRefs: string[];
  artifactKinds: TeachingArtifactKind[];
  requiredCheckIds: string[];
}
export interface GeneratorDeclaration extends VersionedRef {
  extensionId: string;
  sourceRefs: string[];
  artifactKinds: TeachingArtifactKind[];
}
export interface AdaptationTarget {
  episodeId: string;
  objectiveIds: string[];
  allowedOperations: Exclude<AdaptationOperationKind, 'suggest_profile_correction'>[];
  replaceableBlockIds: string[];
}
export interface CanonicalAdaptationFamily {
  familyId: string;
  canonicalAssessmentId: string;
  generatorIds: string[];
  verifierIds: string[];
  numericalRecipeIds: string[];
  maxVariantsPerPlan: number;
}
export type NumericalExpression =
  | { type: 'constant'; value: number }
  | { type: 'variable'; name: string }
  | { type: 'unary'; operator: 'negate' | 'abs'; value: NumericalExpression }
  | { type: 'binary'; operator: 'add' | 'subtract' | 'multiply' | 'divide' | 'min' | 'max'; left: NumericalExpression; right: NumericalExpression };
export interface NumericalRecipeTemplate extends VersionedRef {
  promptTemplate: string;
  sourceRefs: string[];
  variables: { name: string; minimum: number; maximum: number; integer: boolean }[];
  expression: NumericalExpression;
  maxNodes: number;
  maxDepth: number;
  maxAbsoluteValue: number;
  referenceCheck: { verifierId: string; verifierVersion: string; checkId: string; absoluteTolerance: number };
}
export interface NumericalRecipeInstance {
  templateId: string;
  templateVersion: string;
  templateDigest: string;
  variables: Record<string, number>;
}
export interface AdaptationAuthoring {
  schemaVersion: 1;
  targets: AdaptationTarget[];
  families: CanonicalAdaptationFamily[];
  generators: GeneratorDeclaration[];
  verifiers: VerifierDeclaration[];
  sourceRefs: string[];
  profileFieldIds: string[];
  numericalRecipes: NumericalRecipeTemplate[];
  limits: {
    maxOperations: number;
    maxArtifacts: number;
    maxArtifactBytes: number;
    maxPlannedMinutesPerAssignment: number;
    maxAdditionalEpisodesPerAssignment: number;
    allowedClassifications: ('required' | 'optional')[];
  };
}
interface ArtifactBase {
  id: string;
  digest: string;
  objectiveIds: string[];
  sourceRefs: string[];
  generator: VersionedRef;
}
export type TeachingArtifact = ArtifactBase & (
  | { kind: 'explanation' | 'practice'; markdown: string }
  | { kind: 'assessment_variant'; canonicalAssessmentId: string; assessment: Assessment; hiddenFixtures?: Json; recipe?: NumericalRecipeInstance }
  | { kind: 'media'; media: MediaResource }
  | { kind: 'visual'; visual: VisualExperience }
  | { kind: 'profile_suggestion'; fieldId: string; proposedValue: string | number | boolean | null; rationale: string }
);
export type TeachingArtifactDraft = TeachingArtifact extends infer A ? A extends TeachingArtifact ? Omit<A, 'digest'> : never : never;
export type AdaptationOperation =
  | { id: string; type: 'append_teaching' | 'attach_media' | 'attach_visual' | 'add_assessment_variant'; episodeId: string; artifactId: string }
  | { id: string; type: 'replace_teaching'; episodeId: string; blockId: string; expectedTargetDigest: string; artifactId: string }
  | { id: string; type: 'suggest_profile_correction'; artifactId: string };

/** A claimed receipt, not a credential. The host must authenticate its issuer/ref. */
export interface ArtifactProofReceipt {
  id: string;
  proposalDigest: string;
  artifactId: string;
  artifactDigest: string;
  verifierId: string;
  verifierVersion: string;
  verifierImplementationDigest: string;
  sourceRefs: string[];
  verifierSourceRefs: string[];
  checks: { id: string; result: 'passed' | 'failed' }[];
  outcome: 'passed' | 'failed';
  issuedAt: string;
  receiptRef: string;
}
export interface CourseAdaptation {
  schemaVersion: 1;
  id: string;
  baseCourseDigest: string;
  expectedPlanRevision: number;
  expectedPlanDigest: string;
  rationale: string;
  artifacts: TeachingArtifact[];
  operations: AdaptationOperation[];
  proofReceipts: ArtifactProofReceipt[];
}
/** Host-owned registry snapshot, never loaded from a model's proposal. */
export interface RegisteredVerifier extends VersionedRef {
  implementationDigest: string;
  sourceRefs: string[];
  artifactKinds: TeachingArtifactKind[];
  checkIds: string[];
}
export interface AdaptationPlanSnapshot {
  baseCourseDigest: string;
  revision: number;
  digest: string;
  occupiedIds: string[];
  targetDigests: { episodeId: string; blockId: string; digest: string }[];
  variantCounts: { familyId: string; count: number }[];
}
export interface AdaptationValidationContext {
  course: CourseManifest;
  baseCourseDigest: string;
  plan: AdaptationPlanSnapshot;
  registeredVerifiers: RegisteredVerifier[];
}
export type AdaptationValidationResult =
  | { valid: false; issues: ValidationIssue[] }
  | { valid: true; proposal: CourseAdaptation; proposalDigest: string; issues: [];
      proofAuthenticity: 'not_checked'; applicationAuthority: 'not_checked'; assignmentOperationIds: string[] };

/**
 * Separate trusted author/server input for generated work. Forbidden inside
 * CourseAdaptation; it cannot reclassify an existing fixed course episode.
 */
export interface ActivityAssignmentDecision {
  operationId: string;
  proposalDigest: string;
  classification: 'required' | 'optional';
  plannedMinutes: number;
  additionalEpisodes: number;
  authority: 'author' | 'server';
  authorityReceiptRef: string;
}
export interface ObjectiveEvidenceAnchor { baseCourseDigest: string; objectiveId: string }
export interface AssessmentVariantAnchor extends ObjectiveEvidenceAnchor {
  canonicalAssessmentId: string;
  canonicalFamilyId: string;
  artifactDigest: string;
}
/** Implementations are registered trusted adapters or separately isolated plugins. */
export interface ExerciseGeneratorPort {
  readonly registration: GeneratorDeclaration;
  generate(input: {
    baseCourseDigest: string; objectiveIds: string[]; canonicalAssessment?: Assessment;
    sourceRefs: string[]; specification: Json;
  }, options: { signal?: AbortSignal }): Promise<TeachingArtifactDraft>;
}
export interface ArtifactVerifierPort {
  readonly registration: RegisteredVerifier;
  verify(input: {
    baseCourseDigest: string; proposalDigest: string; artifact: TeachingArtifact; requiredCheckIds: string[];
  }, options: { signal?: AbortSignal }): Promise<{
    artifactDigest: string; checks: { id: string; result: 'passed' | 'failed' }[]; evidenceRefs: string[];
  }>;
}
export interface NumericalReferencePort {
  readonly verifierId: string;
  readonly verifierVersion: string;
  readonly checkId: string;
  evaluate(input: { templateDigest: string; variables: Record<string, number> }, options: { signal?: AbortSignal }): Promise<number>;
}
