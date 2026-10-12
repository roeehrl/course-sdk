export type * from './types.js';
export type * from './adaptation-types.js';
export type * from './research-types.js';
export { resolvePublicResearchRequest } from './research.js';
export type { LearnerAdaptation, LearnerAdaptationArtifact } from './adaptation-projection.js';
export { validateCourse } from './validate.js';
export { getEpisodeRequirement } from './episode.js';
export { defineCourseAdaptation, validateCourseAdaptation, validateAssignmentDecisions } from './adaptation.js';
export { digestJson, digestTeachingArtifact, digestAdaptationProposal } from './integrity.js';
export { instantiateNumericalRecipe, evaluateNumericalRecipe, checkNumericalReference, numericalTemplateIssues } from './numerical-recipe.js';
export { AdaptationDataError } from './adaptation-shape.js';

import type { CourseManifest, VisualExperience, ExtensionManifest } from './types.js';

/** Typed authoring helper. Use validateCourse or the compiler before publication. */
export function defineCourse(course: CourseManifest): CourseManifest {
  return structuredClone(course);
}
export function defineVisualExperience(visual: VisualExperience): VisualExperience {
  return structuredClone(visual);
}
export function defineExtension(extension: ExtensionManifest): ExtensionManifest {
  return structuredClone(extension);
}
