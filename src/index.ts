export type * from './types.js';
export type * from './adaptation-types.js';
export type * from './research-types.js';
export type * from './contracts-types.js';
export type * from './record-types.js';
export { resolvePublicResearchRequest, validateResearchRequest, validateResearchResult } from './research.js';
export type { LearnerAdaptation, LearnerAdaptationArtifact } from './adaptation-projection.js';
export { validateCourse, learningPolicyIssues } from './validate.js';
export { getEpisodeRequirement } from './episode.js';
export { defineCourseAdaptation, validateCourseAdaptation, validateAssignmentDecisions } from './adaptation.js';
export { digestJson, digestTeachingArtifact, digestAdaptationProposal } from './integrity.js';
export { instantiateNumericalRecipe, evaluateNumericalRecipe, checkNumericalReference, numericalTemplateIssues } from './numerical-recipe.js';
export { AdaptationDataError } from './adaptation-shape.js';
export { SDK_VERSION } from './version.js';
export {
  CONTRACT_KINDS, ContractValidationError, validateContract,
  defineConcept, defineEpisode, defineAssessment, defineActivity, defineRubric, defineTool, defineAdaptationPolicy, defineLearningPolicy,
  defineAdminSection, defineLearningStep, defineProgressionGate, defineMediaResource, defineStoryboard, defineResearchTask, definePlacementPolicy,
  defineRenderer, defineEvaluator, defineAgentStrategy, definePlatformAdapter, defineDebugInspector, defineScene, defineTimeline,
  defineRendererAdapter, defineTeachingHypothesis, defineDiagnosticProbe, defineStage,
} from './define.js';
export type { ContractKind, ContractKinds } from './define.js';
export { RECORD_KINDS, validateRecord } from './records.js';
export { decideGate, checkGateDecision } from './gate-decision.js';
export type { GateDecisionContext, GateDecisionResult } from './gate-decision.js';
export { lintCourse } from './lint.js';
export { publicationIssues } from './publication.js';
export type { LintFinding } from './lint.js';
export { isVersionedGate, gateObjectiveIds, gateAssessmentIds } from './contracts-validate.js';
export { buildConceptGraph, resolveRetentionIntervals } from './concepts.js';
export {
  DEFAULT_REVIEW_INTERVALS_DAYS, PLATFORM_TARGETS, KNOWN_CAPABILITIES, FORBIDDEN_CAPABILITIES, RECOGNITION_TYPES, LAYOUT_BREAKPOINTS,
  MAX_EVENT_BYTES, MAX_STATE_BYTES, windowClass, targetsForPlatforms,
} from './contract-constants.js';

import type { CourseManifest, VisualExperience, ExtensionManifest } from './types.js';

/**
 * Typed authoring helpers kept from 0.4: they copy without validating, so existing
 * callers keep their behavior. Use validateCourse or validateContract before publishing.
 */
export function defineCourse(course: CourseManifest): CourseManifest {
  return structuredClone(course);
}
export function defineVisualExperience(visual: VisualExperience): VisualExperience {
  return structuredClone(visual);
}
export function defineExtension(extension: ExtensionManifest): ExtensionManifest {
  return structuredClone(extension);
}
