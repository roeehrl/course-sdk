import { validateCourse } from './validate.js';
import { gateConversation, isVersionedGate } from './contracts-validate.js';
import type { CourseManifest, LegacyProgressionGate, ValidationIssue } from './types.js';

/**
 * Rules a course must meet to be published, beyond data validity. They match Course Core's
 * publication check (its codes carry a `PUBLISH_` prefix). Data that 0.4 and 0.5 accepted stays
 * valid and compiles byte for byte, but a host refuses to publish it:
 *
 * - CONVERSATIONAL_GATE_UNSUPPORTED (`/gates/i/conversationalEvaluatorId`): an unversioned gate's
 *   `conversationalEvaluatorId` must name an evaluator definition bound to exactly one course
 *   rubric (`rubricIds`) that may judge a conversation: a human or a model-assisted method with
 *   `humanConfirmation: "required"`, or a deterministic method. A bare extension ID names no
 *   rubric to cite, so the conversation could never decide the gate.
 * - CONVERSATION_RUBRIC_UNSUPPORTED: the rubric that evaluator is bound to must require cited
 *   evidence (`/gates/i/conversationalEvaluatorId`), and a versioned gate's
 *   `conversationalRubricRef` needs an evaluator that may judge conversations (as above) and lists
 *   the rubric in `rubricIds` (`/gates/i/conversationalRubricRef`). A model impression is not evidence.
 * - GATE_EVIDENCE_UNREACHABLE (`/gates/i`): an unversioned gate judged in conversation counts the
 *   conversation as one item family for every gate objective; with the listed items' families it
 *   must reach `minimumIndependentFamilies` for every objective (`requireAllObjectives`) or at
 *   least one.
 *
 * Hosts also check what only they know, such as an installed adapter that can review the
 * conversation, or one that confirms quoted findings for a deterministic evaluator.
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
    const path = `/gates/${i}`;
    if (isVersionedGate(gate)) {
      // Validation already requires a cited rubric and an eligible conversation evidence kind.
      if (gate.conversationalRubricRef !== undefined && !gateConversation(course, gate)) issues.push({
        code: 'CONVERSATION_RUBRIC_UNSUPPORTED', path: `${path}/conversationalRubricRef`,
        message: `Gate ${gate.id}: no evaluator may judge conversations against rubric ${gate.conversationalRubricRef}. List it in the rubricIds of an evaluator with humanConfirmation "required", or of a deterministic one.`,
      });
      continue;
    }
    if (gate.conversationalEvaluatorId === undefined) continue;
    const resolved = gateConversation(course, gate);
    if (!resolved) issues.push({
      code: 'CONVERSATIONAL_GATE_UNSUPPORTED', path: `${path}/conversationalEvaluatorId`,
      message: `Gate ${gate.id}: conversationalEvaluatorId must name an evaluator definition bound to exactly one rubric, judged by a human, a human-confirmed model draft or a deterministic method. Or use a versioned gate with conversationalRubricRef.`,
    });
    else if (!resolved.rubric.requiresCitedEvidence) issues.push({
      code: 'CONVERSATION_RUBRIC_UNSUPPORTED', path: `${path}/conversationalEvaluatorId`,
      message: `Gate ${gate.id}: rubric ${resolved.rubric.id} must require cited evidence; a model impression is not evidence.`,
    });
    else if (!legacyConversationReachable(course, gate, resolved.rubric.id)) issues.push({
      code: 'GATE_EVIDENCE_UNREACHABLE', path,
      message: `Gate ${gate.id}: with the conversation as one family, the listed items cannot supply ${gate.minimumIndependentFamilies} independent families for ${gate.requireAllObjectives ? 'every' : 'any'} gate objective.`,
    });
  }
  return issues;
}

/** The conversation is one family for every gate objective, so the listed items must supply the rest. */
function legacyConversationReachable(course: CourseManifest, gate: LegacyProgressionGate, rubricId: string): boolean {
  const items = gate.assessmentIds.map(id => course.assessments.find(a => a.id === id)).filter(item => item !== undefined);
  const reachable = (objective: string) =>
    new Set([...items.filter(item => item.objectiveIds.includes(objective)).map(item => item.familyId), `conversation:${rubricId}`]).size >= gate.minimumIndependentFamilies;
  return gate.requireAllObjectives ? gate.objectiveIds.every(reachable) : gate.objectiveIds.some(reachable);
}
