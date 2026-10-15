import type { CourseManifest } from './types.js';
import { validateCourse } from './validate.js';
import { publicationRefusals } from './publication.js';
import { isVersionedGate } from './contracts-validate.js';
import { FORBIDDEN_CAPABILITIES, KNOWN_CAPABILITIES, RECOGNITION_TYPES } from './contract-constants.js';

export interface LintFinding {
  code: string;
  severity: 'error' | 'warning' | 'info';
  path: string;
  message: string;
}

/**
 * Advisory review of a course. Errors are validation failures or publication refusals
 * (see publicationIssues); warnings and info are risks that remain valid for compatibility
 * (for example 0.4 gate shapes). Lint never changes data and is not a substitute for host enforcement.
 */
export function lintCourse(input: unknown): LintFinding[] {
  const result = validateCourse(input);
  if (!result.valid) return result.issues.map(issue => ({ ...issue, severity: 'error' as const }));
  const course: CourseManifest = result.course;
  const findings: LintFinding[] = [];
  const add = (severity: LintFinding['severity'], code: string, path: string, message: string) => findings.push({ code, severity, path, message });
  const assessments = new Map(course.assessments.map(a => [a.id, a]));
  for (const [i, gate] of course.gates.entries()) {
    const path = `/gates/${i}`;
    if (isVersionedGate(gate)) {
      if (gate.minimumIndependentEvidence.families < 2) add('info', 'SINGLE_FAMILY_GATE', path, 'The design default is two independent item families including transfer.');
      continue;
    }
    add('warning', 'LEGACY_GATE', path, 'Unversioned 0.4 gate: it cannot require transfer or misconception checks. Run `course migrate` and review the result.');
    const items = gate.assessmentIds.map(id => assessments.get(id)).filter(item => item !== undefined);
    if (!gate.conversationalEvaluatorId && items.length > 0 && items.every(item => RECOGNITION_TYPES.has(item.type)))
      add('warning', 'RECOGNITION_ONLY_GATE', path, 'Every item is recognition-only; a guess can pass this gate.');
    if (gate.minimumIndependentFamilies < 2) add('info', 'SINGLE_FAMILY_GATE', path, 'The design default is two independent item families including transfer.');
  }
  for (const issue of publicationRefusals(course)) add('error', issue.code, issue.path, issue.message);
  for (const [ci, chapter] of course.chapters.entries()) for (const [ei, episode] of chapter.episodes.entries()) for (const [bi, block] of episode.blocks.entries()) {
    if (block.type === 'activity' && 'extensionId' in block)
      add('warning', 'LEGACY_ACTIVITY_BLOCK', `/chapters/${ci}/episodes/${ei}/blocks/${bi}`, 'This activity lacks targets, fallbacks, offline, budget, accessibility and migration fields; reference a defineActivity contract.');
  }
  for (const [i, extension] of course.extensions.entries()) {
    for (const [j, capability] of extension.capabilities.entries()) {
      if (FORBIDDEN_CAPABILITIES.has(capability)) add('warning', 'FORBIDDEN_CAPABILITY', `/extensions/${i}/capabilities/${j}`, `${capability} is host authority; hosts will deny it.`);
      else if (!KNOWN_CAPABILITIES.has(capability)) add('info', 'UNKNOWN_CAPABILITY', `/extensions/${i}/capabilities/${j}`, `${capability} is not a declared SDK capability.`);
    }
    if (!extension.license) add('info', 'EXTENSION_WITHOUT_LICENSE', `/extensions/${i}`, 'The bundle licence inventory will list this extension as undeclared.');
    if (extension.observationSchema && !extension.capabilities.includes('observation.emit'))
      add('warning', 'OBSERVATION_CAPABILITY_UNDECLARED', `/extensions/${i}/observationSchema`, 'An observation schema without observation.emit cannot be used; hosts deny undeclared capabilities.');
    if (extension.capabilities.includes('observation.emit') && extension.execution !== 'server' && extension.evaluatorRef === undefined)
      add('info', 'OBSERVATIONS_WITHOUT_EVALUATOR', `/extensions/${i}`, 'Observations become evidence only through a registered evaluator (evaluatorRef).');
    if (extension.execution !== 'declarative' && !extension.tests)
      add('info', 'EXTENSION_WITHOUT_TESTS', `/extensions/${i}`, 'Declare the extension\'s own test fixtures (tests) so reviewers can run them.');
  }
  const stageRuns: string[] = [];
  for (const [i, chapter] of course.chapters.entries())
    if (chapter.stageId !== undefined && course.chapters[i - 1]?.stageId !== chapter.stageId) stageRuns.push(chapter.stageId);
  for (const [i, stage] of (course.stages ?? []).entries()) {
    const runs = stageRuns.filter(id => id === stage.id).length;
    if (runs === 0) add('info', 'UNUSED_STAGE', `/stages/${i}`, 'No chapter belongs to this stage.');
    if (runs > 1) add('warning', 'STAGE_NOT_CONTIGUOUS', `/stages/${i}`, 'Chapters of one stage should be consecutive; the roadmap shows each run as its own group.');
  }
  for (const [i, source] of course.sources.entries()) if (!source.license) add('info', 'SOURCE_WITHOUT_LICENSE', `/sources/${i}`, 'The bundle licence inventory will list this source as undeclared.');
  for (const [i, item] of course.assessments.entries()) if (item.allowAbstain === false)
    add('info', 'ABSTAIN_DISABLED', `/assessments/${i}/allowAbstain`, '"I don\'t know" is useful evidence and is recorded without penalty.');
  if (course.retention && course.retention.intervalsDays === undefined)
    add('info', 'DEFAULT_REVIEW_SCHEDULE', '/retention', 'Using the product-default 1, 3, 7 and 21 day schedule.');
  for (const [i, objective] of course.objectives.entries()) if (objective.critical && !(course.hypotheses ?? []).some(h => h.objectiveIds.includes(objective.id)))
    add('info', 'NO_TEACHING_HYPOTHESES', `/objectives/${i}`, 'Critical objectives benefit from declared misconception hypotheses and probes.');
  for (const [i, media] of course.media.entries()) if ((media.type === 'video' || media.type === 'youtube') && media.captions === undefined)
    add('info', 'MEDIA_CAPTIONS_UNDECLARED', `/media/${i}`, 'Declare caption or transcript availability for accessible review.');
  return findings;
}
