import type { CourseManifest } from './types.js';
import { validateCourse } from './validate.js';
import { publicationRefusals } from './publication.js';
import { gateAssessmentIds, isVersionedGate } from './contracts-validate.js';
import { FORBIDDEN_CAPABILITIES, KNOWN_CAPABILITIES, RECOGNITION_TYPES } from './contract-constants.js';
import { courseTextKeys, localeCoverage, pointerSegment } from './localization.js';

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
  lint060(course, add);
  lintLocales(course, add);
  return findings;
}

/** 0.6 locale advisories: reported fallbacks and bidirectional override characters. */
function lintLocales(course: CourseManifest, add: Add): void {
  for (const entry of localeCoverage(course)) if (entry.fallback.length) {
    const shown = entry.fallback.slice(0, 10).join(', ') + (entry.fallback.length > 10 ? `, and ${entry.fallback.length - 10} more` : '');
    add('info', 'TRANSLATION_FALLBACK', `/translations/${pointerSegment(entry.locale)}/fallback`,
      `${entry.fallback.length} of ${entry.texts} text(s) show in ${course.locale} for ${entry.locale} learners: ${shown}.`);
  }
  // Embeddings and overrides (U+202A..U+202E) can make text display differently from its logical order.
  // Isolates (U+2066..U+2069) are the safe way to set direction and are not reported.
  const overrides = /[\u202A-\u202E]/;
  for (const [key, { path, text }] of courseTextKeys(course)) if (overrides.test(text))
    add('warning', 'BIDI_OVERRIDE', path, `${key} contains a bidirectional embedding or override character; use isolates (U+2066..U+2069) or none.`);
  for (const [tag, bundle] of Object.entries(course.translations ?? {})) for (const [key, text] of Object.entries(bundle.texts)) if (overrides.test(text))
    add('warning', 'BIDI_OVERRIDE', `/translations/${pointerSegment(tag)}/texts/${pointerSegment(key)}`, `${key} (${tag}) contains a bidirectional embedding or override character; use isolates (U+2066..U+2069) or none.`);
}

type Add = (severity: LintFinding['severity'], code: string, path: string, message: string) => void;

/** 0.6 advisories: visuals, browser runs, study instruments, pre-tests and concept-mapping drafts. */
function lint060(course: CourseManifest, add: Add): void {
  for (const [i, visual] of course.visuals.entries()) {
    const uses = visual.layouts.wide !== undefined || [visual.panes, visual.invariants, visual.goldens].some(list => (list?.length ?? 0) > 0);
    if (uses && visual.requiredFeatures === undefined)
      add('info', 'UNDECLARED_RENDER_FEATURES', `/visuals/${i}`, 'Declare requiredFeatures (layout_set, panes, invariants, goldens, ...) so a host can refuse a renderer that lacks them.');
  }
  // Course Core offers browser runs only on lesson checks; placement and delayed checks never get one.
  const heldOut = new Set([...(course.placement?.assessmentIds ?? []), ...(course.retention?.assessmentIds ?? [])]);
  for (const [i, item] of course.assessments.entries())
    if ((item.type === 'code' || item.type === 'code_repair') && item.browserExecution === 'python' && heldOut.has(item.id))
      add('warning', 'BROWSER_RUN_NOT_OFFERED', `/assessments/${i}/browserExecution`, 'Placement and delayed retention checks never offer a browser run; this setting has no effect there.');
  const items = new Map(course.assessments.map(a => [a.id, a]));
  const si = course.studyInstruments;
  if (si) {
    const objectives = (ids: string[]) => new Set(ids.flatMap(id => items.get(id)?.objectiveIds ?? []));
    const pre = objectives(si.pre), post = objectives(si.post);
    if (!si.pre.length || !si.post.length) add('warning', 'STUDY_INSTRUMENTS_INCOMPLETE', '/studyInstruments', 'A study opens only with both a pre-test and a post-test.');
    else if (pre.size !== post.size || [...pre].some(o => !post.has(o)))
      add('warning', 'STUDY_INSTRUMENTS_UNMATCHED', '/studyInstruments', `The pre-test covers ${[...pre].sort().join(', ') || 'no objectives'} and the post-test ${[...post].sort().join(', ') || 'no objectives'}; matched sets cover the same objectives.`);
    const gated = new Set(course.gates.flatMap(g => gateAssessmentIds(g)));
    for (const set of ['pre', 'post', 'transfer'] as const) for (const [j, id] of (si[set] ?? []).entries()) {
      if (gated.has(id)) add('warning', 'STUDY_ITEM_GATED', `/studyInstruments/${set}/${j}`, `${id} also counts toward a gate, so learners may meet it during instruction.`);
      if (set === 'transfer' && items.has(id) && items.get(id)!.role === undefined)
        add('info', 'STUDY_TRANSFER_ROLE_UNDECLARED', `/studyInstruments/transfer/${j}`, `${id} declares no role; confirm it is a novel transfer task.`);
    }
  }
  const pretest = new Set(si?.pre ?? []);
  const episodes = new Map(course.chapters.flatMap(c => c.episodes).map(e => [e.id, e]));
  for (const [i, step] of (course.learningSteps ?? []).entries()) {
    if (step.kind !== 'pre_test' || !si) continue;
    const episode = episodes.get(step.episodeId);
    for (const id of step.blockIds) {
      const block = episode?.blocks.find(b => b.id === id);
      if (block?.type === 'assessment' && !pretest.has(block.assessmentId))
        add('warning', 'PRE_TEST_NOT_INSTRUMENT', `/learningSteps/${i}/blockIds`, `${block.assessmentId} is presented as a pre-test but is not in studyInstruments.pre.`);
    }
  }
  const others = new Map<string, number>();
  for (const [i, draft] of (course.conceptMappingDrafts ?? []).entries()) {
    add('info', 'CONCEPT_MAPPING_DRAFT', `/conceptMappingDrafts/${i}`, 'A draft only: a host applies it after staff who administer both courses review and save it.');
    const before = others.get(draft.otherCourse.id);
    if (before !== undefined) add('warning', 'CONCEPT_MAPPING_DRAFT_REPEATED', `/conceptMappingDrafts/${i}/otherCourse`, `Draft ${before} already maps ${draft.otherCourse.id}; a host keeps one mapping per course pair.`);
    else others.set(draft.otherCourse.id, i);
  }
}
