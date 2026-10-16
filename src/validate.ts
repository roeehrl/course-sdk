import type { ValidateFunction } from 'ajv';
import { jsonIssue } from './json.js';
import { getEpisodeRequirement } from './episode.js';
import { adaptationAuthoringIssues } from './adaptation-authoring.js';
import { contractIssues, gateAssessmentIds, gateConversation, gateObjectiveIds, isPortableRelativePath, isVersionedGate } from './contracts-validate.js';
import generatedValidator from './generated/course-validator.js';
import type { CourseManifest, LearningPolicy, ValidationIssue, ValidationResult } from './types.js';

const validateShape = generatedValidator as ValidateFunction<CourseManifest>;

export function validateCourse(input: unknown): ValidationResult {
  const issue = jsonIssue(input);
  if (issue) return { valid: false, issues: [issue] };
  if (!validateShape(input)) {
    return { valid: false, issues: (validateShape.errors ?? []).map((error) => ({ code: 'SCHEMA', path: error.instancePath, message: error.message ?? 'Invalid schema value.' })) };
  }
  const course = input;
  const issues: ValidationIssue[] = [];
  const report = (code: string, path: string, message: string) => issues.push({ code, path, message });
  function index<T extends { id: string }>(items: T[], path: string): Map<string, T> {
    const result = new Map<string, T>();
    for (const [i, item] of items.entries()) {
      if (result.has(item.id)) report('DUPLICATE_ID', `${path}/${i}/id`, `Duplicate ID ${item.id}.`);
      result.set(item.id, item);
    }
    return result;
  }
  function refs(ids: string[], target: Map<string, unknown>, path: string): void {
    for (const [i, id] of ids.entries()) if (!target.has(id)) report('MISSING_REFERENCE', `${path}/${i}`, `Unknown reference ${id}.`);
  }
  const policy = (p: LearningPolicy, path: string) => issues.push(...learningPolicyIssues(p, path));
  const objectives = index(course.objectives, '/objectives');
  index(course.chapters, '/chapters');
  const episodeList = course.chapters.flatMap((chapter) => chapter.episodes);
  const episodes = index(episodeList, '/episodes');
  const assessments = index(course.assessments, '/assessments');
  const gates = index(course.gates, '/gates');
  const extensions = index(course.extensions, '/extensions');
  const visuals = index(course.visuals, '/visuals');
  const media = index(course.media, '/media');
  const sources = index(course.sources, '/sources');
  if (course.research) {
    index(course.research.publicTopics, '/research/publicTopics');
    for (const [i, topic] of course.research.publicTopics.entries()) {
      refs(topic.objectiveIds, objectives, `/research/publicTopics/${i}/objectiveIds`);
    }
  }
  policy(course.policy, '/policy');

  const indegree = new Map(course.objectives.map((objective) => [objective.id, 0]));
  const dependents = new Map<string, string[]>();
  for (const [i, objective] of course.objectives.entries()) {
    refs(objective.prerequisites, objectives, `/objectives/${i}/prerequisites`);
    for (const prerequisite of objective.prerequisites) {
      if (!objectives.has(prerequisite)) continue;
      indegree.set(objective.id, (indegree.get(objective.id) ?? 0) + 1);
      dependents.set(prerequisite, [...(dependents.get(prerequisite) ?? []), objective.id]);
    }
  }
  const ready = [...indegree].filter(([, degree]) => degree === 0).map(([id]) => id);
  let processed = 0;
  for (let cursor = 0; cursor < ready.length; cursor++) {
    const id = ready[cursor]!;
    processed++;
    for (const dependent of dependents.get(id) ?? []) {
      const degree = (indegree.get(dependent) ?? 0) - 1;
      indegree.set(dependent, degree);
      if (degree === 0) ready.push(dependent);
    }
  }
  if (processed !== objectives.size) report('PREREQUISITE_CYCLE', '/objectives', 'Objective prerequisites must form an acyclic graph.');

  // Declarations without any episode coverage retain schema-1 behavior. Introducing
  // optional branches must not make supplied critical/prerequisite content skippable.
  const prerequisiteIds = new Set(course.objectives.flatMap(objective => objective.prerequisites));
  const requiredCoverage = new Set<string>();
  const optionalCoverage = new Set<string>();
  for (const episode of episodeList) {
    const coverage = getEpisodeRequirement(episode) === 'required' ? requiredCoverage : optionalCoverage;
    for (const objectiveId of episode.objectiveIds) coverage.add(objectiveId);
  }
  for (const [i, objective] of course.objectives.entries()) {
    if ((objective.critical || prerequisiteIds.has(objective.id)) && optionalCoverage.has(objective.id) && !requiredCoverage.has(objective.id)) {
      report('OPTIONAL_ONLY_OBJECTIVE', `/objectives/${i}`, 'An objective marked critical or used as a prerequisite cannot be supplied exclusively by optional episodes.');
    }
  }

  function evaluator(id: string, path: string): void {
    const extension = extensions.get(id);
    // 0.5 evaluator definitions are checked with the other contracts.
    if (!extension && course.evaluators?.some((e) => e.id === id)) return;
    if (!extension) report('MISSING_REFERENCE', path, `Unknown evaluator ${id}.`);
    else if (extension.execution !== 'server' || !extension.capabilities.includes('assessment.evaluate')) report('INVALID_EVALUATOR', path, 'Evaluators need a declared server extension with assessment.evaluate capability.');
  }
  for (const [i, a] of course.assessments.entries()) {
    refs(a.objectiveIds, objectives, `/assessments/${i}/objectiveIds`);
    if (a.type === 'choice') {
      const options = index(a.options, `/assessments/${i}/options`);
      if (!options.has(a.grading.correctOptionId)) report('INVALID_ANSWER_KEY', `/assessments/${i}/grading`, 'The correct option must exist in this item.');
    }
    if (a.type === 'rubric' || a.type === 'code') evaluator(a.grading.evaluatorId, `/assessments/${i}/grading/evaluatorId`);
    if (a.type === 'rubric') index(a.grading.rubric, `/assessments/${i}/grading/rubric`);
  }
  for (const [i, gate] of course.gates.entries()) {
    if (isVersionedGate(gate)) continue; // checked by contractIssues
    refs(gate.objectiveIds, objectives, `/gates/${i}/objectiveIds`);
    refs(gate.assessmentIds, assessments, `/gates/${i}/assessmentIds`);
    const items = gate.assessmentIds.map((id) => assessments.get(id)).filter((item) => item !== undefined);
    if (gate.conversationalEvaluatorId) evaluator(gate.conversationalEvaluatorId, `/gates/${i}/conversationalEvaluatorId`);
    // A conversationalEvaluatorId that names an evaluator definition bound to exactly one rubric
    // makes the conversation one more item family; whether the gate can still reach its families
    // is a publication rule (GATE_EVIDENCE_UNREACHABLE, see publicationIssues). Any other value,
    // such as a bare extension ID, names no rubric to cite and cannot decide the gate (hosts refuse
    // it at publication), so the listed items alone must supply the families and cover the objectives.
    if (gateConversation(course, gate)) continue;
    if (new Set(items.map((a) => a.familyId)).size < gate.minimumIndependentFamilies) report('INSUFFICIENT_ITEM_FAMILIES', `/gates/${i}`, 'The gate cannot collect its declared independent item families.');
    if (gate.requireAllObjectives) for (const objective of gate.objectiveIds) {
      if (!items.some((a) => a.objectiveIds.includes(objective))) report('UNCOVERED_GATE_OBJECTIVE', `/gates/${i}`, `No assessment covers ${objective}.`);
    }
  }
  const blank = (value: string) => value.trim().length === 0;
  function inaccessibleExtension(extension: CourseManifest['extensions'][number], path: string, code: string, what: string): void {
    if (!extension.accessibility.keyboard) report(code, path, `A required ${what} needs keyboard support; extension ${extension.id} declares none.`);
    if (blank(extension.accessibility.textAlternative)) report('MISSING_TEXT_ALTERNATIVE', path, `A required ${what} needs a non-blank text alternative; extension ${extension.id} declares none.`);
  }
  for (const [ci, chapter] of course.chapters.entries()) {
    if (chapter.policy) policy(chapter.policy, `/chapters/${ci}/policy`);
    for (const [ei, episode] of chapter.episodes.entries()) {
      const path = `/chapters/${ci}/episodes/${ei}`;
      refs(episode.objectiveIds, objectives, `${path}/objectiveIds`);
      index(episode.blocks, `${path}/blocks`);
      if (episode.policy) policy(episode.policy, `${path}/policy`);
      if (episode.gateId) {
        const gate = gates.get(episode.gateId);
        if (!gate) report('MISSING_REFERENCE', `${path}/gateId`, 'Unknown gate.');
        else if (episode.objectiveIds.some((id) => !gateObjectiveIds(gate).includes(id))) report('GATE_SCOPE_MISMATCH', `${path}/gateId`, 'The gate must cover every declared episode objective.');
      }
      for (const [bi, block] of episode.blocks.entries()) {
        const bp = `${path}/blocks/${bi}`;
        if (block.type === 'text') refs(block.sourceRefs ?? [], sources, `${bp}/sourceRefs`);
        if (block.type === 'assessment') refs([block.assessmentId], assessments, `${bp}/assessmentId`);
        if (block.type === 'visual') {
          refs([block.visualId], visuals, `${bp}/visualId`);
          const visual = visuals.get(block.visualId);
          if (visual && course.platforms.some((platform) => !visual.platforms.includes(platform))) report('UNSUPPORTED_PLATFORM', bp, 'Required visual does not support every declared course platform.');
          // Visual blocks are required lesson content: they need a keyboard path and a text alternative.
          if (visual && blank(visual.accessibility.description)) report('MISSING_TEXT_ALTERNATIVE', `${bp}/visualId`, 'A required visual needs a non-blank text description.');
          const renderer = visual && extensions.get(visual.rendererId);
          if (renderer) inaccessibleExtension(renderer, `${bp}/visualId`, 'INACCESSIBLE_VISUAL', 'visual');
        }
        if (block.type === 'activity' && 'extensionId' in block) {
          refs([block.extensionId], extensions, `${bp}/extensionId`);
          const extension = extensions.get(block.extensionId);
          if (extension && course.platforms.some((platform) => !extension.platforms.includes(platform))) report('UNSUPPORTED_PLATFORM', bp, 'Activity extension does not support every declared course platform.');
          if (extension) inaccessibleExtension(extension, `${bp}/extensionId`, 'INACCESSIBLE_ACTIVITY', 'activity');
        }
        if (block.type === 'media') {
          refs([block.mediaId], media, `${bp}/mediaId`);
          const resource = media.get(block.mediaId);
          if (resource && block.required && resource.review !== 'reviewed') report('UNREVIEWED_REQUIRED_MEDIA', bp, 'Required media must be reviewed.');
          if (resource && block.required && blank(resource.alternativeMarkdown)) report('MISSING_TEXT_ALTERNATIVE', `${bp}/mediaId`, 'Required media needs a non-blank text alternative.');
        }
      }
    }
  }
  for (const [i, extension] of course.extensions.entries()) {
    if (!isPortableRelativePath(extension.entrypoint)) report('UNSAFE_ENTRYPOINT', `/extensions/${i}/entrypoint`, 'Entrypoints must be portable relative file paths without traversal.');
  }
  for (const [i, visual] of course.visuals.entries()) {
    refs([visual.rendererId], extensions, `/visuals/${i}/rendererId`);
    const renderer = extensions.get(visual.rendererId);
    if (renderer && visual.platforms.some((p) => !renderer.platforms.includes(p))) report('UNSUPPORTED_PLATFORM', `/visuals/${i}`, 'The visual renderer lacks a declared target.');
    let previous = -1;
    for (const [j, cue] of visual.timeline.cues.entries()) {
      if (cue.atMs < previous || cue.atMs > visual.timeline.durationMs) report('INVALID_TIMELINE', `/visuals/${i}/timeline/cues/${j}`, 'Cues must be ordered and lie within the timeline.');
      previous = cue.atMs;
    }
  }
  for (const [i, resource] of course.media.entries()) {
    refs([resource.sourceRef], sources, `/media/${i}/sourceRef`);
    if (!/^(https:|asset:)/.test(resource.url)) report('UNSAFE_URL', `/media/${i}/url`, 'Media must use HTTPS or an asset reference.');
  }
  for (const [i, source] of course.sources.entries()) {
    if (!/^(https:|urn:)/.test(source.url)) report('UNSAFE_URL', `/sources/${i}/url`, 'Sources must use HTTPS or a non-executable URN.');
  }
  if (course.placement) {
    const p = course.placement;
    refs(p.objectiveIds, objectives, '/placement/objectiveIds');
    refs(p.assessmentIds, assessments, '/placement/assessmentIds');
    refs(p.protectedEpisodeIds, episodes, '/placement/protectedEpisodeIds');
    if (p.enabled) {
      if (!p.objectiveIds.length || !p.assessmentIds.length) report('EMPTY_PLACEMENT', '/placement', 'Enabled placement needs objectives and items.');
      for (const id of p.objectiveIds) {
        if (objectives.get(id)?.placeable !== true) report('NON_PLACEABLE_OBJECTIVE', '/placement/objectiveIds', `${id} is not explicitly placeable.`);
        if (!p.assessmentIds.some((item) => assessments.get(item)?.objectiveIds.includes(id))) report('UNCOVERED_PLACEMENT_OBJECTIVE', '/placement', `No placement item covers ${id}.`);
      }
    }
  }
  if (course.retention) {
    const r = course.retention;
    refs(r.objectiveIds, objectives, '/retention/objectiveIds');
    refs(r.assessmentIds, assessments, '/retention/assessmentIds');
    const intervals = r.intervalsDays ?? [];
    if (intervals.some((d, i) => !Number.isInteger(d) || d < 1 || d > 365 || (i > 0 && d <= intervals[i - 1]!)))
      report('INVALID_RETENTION_INTERVALS', '/retention/intervalsDays', 'Intervals must be strictly increasing whole days between 1 and 365.');
    // Held-out items must never be seen before the delayed check.
    const exposed = new Set([...course.gates.flatMap((g) => gateAssessmentIds(g)), ...(course.placement?.assessmentIds ?? []),
      ...(course.probes ?? []).map((p) => p.assessmentId),
      ...course.chapters.flatMap((c) => c.episodes.flatMap((e) => e.blocks.flatMap((b) => (b.type === 'assessment' ? [b.assessmentId] : []))))]);
    for (const id of r.assessmentIds) if (exposed.has(id)) report('RETENTION_ITEM_NOT_HELD_OUT', '/retention/assessmentIds', `${id} is also used in a gate, placement or episode.`);
    for (const id of r.objectiveIds)
      if (!r.assessmentIds.some((item) => assessments.get(item)?.objectiveIds.includes(id))) report('UNCOVERED_RETENTION_OBJECTIVE', '/retention', `No retention item covers ${id}.`);
  }
  issues.push(...adaptationAuthoringIssues(course));
  issues.push(...contractIssues(course));
  return issues.length ? { valid: false, issues } : { valid: true, course: structuredClone(course), issues: [] };
}

/** Semantic checks for one LearningPolicy at any scope. */
export function learningPolicyIssues(p: LearningPolicy, path = ''): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const report = (code: string, at: string, message: string) => issues.push({ code, path: at, message });
  if (p.mode === 'bounded' && !p.hardDeadline && !p.window && !p.work) report('UNBOUNDED_POLICY', path, 'Bounded progression needs a deadline, duration or finite work envelope.');
  if (p.window) {
    try { new Intl.DateTimeFormat('en', { timeZone: p.window.timeZone }).format(0); }
    catch { report('INVALID_TIME_ZONE', `${path}/window/timeZone`, 'Unknown IANA time zone.'); }
  }
  if (p.extensions?.enabled && (p.extensions.maxGrants < 1 || p.extensions.calendarDays < 1 || p.extensions.maxDaysPerGrant < 1)) report('EMPTY_EXTENSION_ALLOWANCE', `${path}/extensions`, 'Enabled extensions need a usable finite allowance.');
  if (p.extensions && p.extensions.maxDaysPerGrant > p.extensions.calendarDays) report('EXTENSION_LIMIT', `${path}/extensions`, 'A single grant cannot exceed the total allowance.');
  return issues;
}
