export type * from './types.js';
export { validateCourse } from './validate.js';

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
