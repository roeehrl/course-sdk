import { validateCourse } from './validate.js';
import { isVersionedGate } from './contracts-validate.js';
import type { CourseManifest, ValidationIssue } from './types.js';

/**
 * Rules a course must meet to be published, beyond data validity. Data that 0.4 and 0.5
 * accepted stays valid and compiles byte for byte, but a host refuses to publish it:
 *
 * - CONVERSATIONAL_GATE_UNSUPPORTED: an unversioned gate's `conversationalEvaluatorId` names
 *   no rubric for a judgment to cite, so the conversation can never decide the gate. Course
 *   Core refuses it at publication (`PUBLISH_CONVERSATIONAL_GATE_UNSUPPORTED`). Use a versioned
 *   gate with a cited-evidence rubric in `conversationalRubricRef`; `course migrate` lists the step.
 *
 * Invalid input returns its validation issues. `course test`, `course lint` and `course pack`
 * apply these rules; hosts still enforce their own.
 */
export function publicationIssues(input: unknown): ValidationIssue[] {
  const result = validateCourse(input);
  return result.valid ? publicationRefusals(result.course) : result.issues;
}

/** Publication refusals for an already validated course. */
export function publicationRefusals(course: CourseManifest): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  for (const [i, gate] of course.gates.entries()) {
    if (!isVersionedGate(gate) && gate.conversationalEvaluatorId !== undefined) issues.push({
      code: 'CONVERSATIONAL_GATE_UNSUPPORTED', path: `/gates/${i}/conversationalEvaluatorId`,
      message: `Gate ${gate.id}: conversationalEvaluatorId cannot be published. Use a versioned gate with a cited-evidence rubric (conversationalRubricRef).`,
    });
  }
  return issues;
}
