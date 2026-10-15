import type { ValidateFunction } from 'ajv';
import { shapeIssues } from './adaptation-shape.js';
import selectionValidator from './generated/research-selection-validator.js';
import { validateCourse } from './validate.js';
import { validateRecord } from './records.js';
import type { PublicResearchRequest, PublicResearchResolution, PublicResearchSelection } from './research-types.js';
import type { ResearchRequest, ResearchResult } from './record-types.js';
import type { ValidationIssue } from './types.js';

/**
 * Resolve only author-declared public text. The host must load its trusted, pinned
 * course and authorize the selection before dispatch. Validation does not establish
 * authorship, supervisor identity, or whether prose is actually safe to disclose.
 * There is deliberately no private-context argument or query interpolation.
 */
export function resolvePublicResearchRequest(approvedCourse: unknown, selection: unknown): PublicResearchResolution {
  const issues = shapeIssues(selectionValidator as ValidateFunction, selection);
  if (issues.length) return { valid: false, issues };
  const checked = validateCourse(approvedCourse);
  if (!checked.valid) return checked;
  const topicId = (selection as PublicResearchSelection).topicId;
  const topic = checked.course.research?.publicTopics.find(topic => topic.id === topicId);
  if (!topic) return { valid: false, issues: [{ code: 'UNAPPROVED_RESEARCH_TOPIC', path: '/topicId', message: 'Select a topic declared in the trusted author configuration.' }] };
  // Explicit allowlist: never spread the course, topic, selection, or a context.
  const request: PublicResearchRequest = { queryText: topic.queryText };
  if (topic.allowedDomains) request.allowedDomains = [...topic.allowedDomains];
  return { valid: true, request, authorityAuthenticity: 'not_checked', issues: [] };
}

/**
 * Check a dedicated-research request against the trusted course. Every field is a
 * learner-free derivation: declared IDs, enumerated buckets and author limits. The
 * misconception is a declared hypothesis ID, never conversation text. Requests cannot
 * widen domains, budgets or turn optional help into required work.
 */
export function validateResearchRequest(approvedCourse: unknown, input: unknown): { valid: true; request: ResearchRequest; issues: [] } | { valid: false; issues: ValidationIssue[] } {
  const record = validateRecord('researchRequest', input);
  if (!record.valid) return record;
  const checked = validateCourse(approvedCourse);
  if (!checked.valid) return { valid: false, issues: checked.issues.map(i => ({ ...i, path: `/course${i.path}` })) };
  const course = checked.course, request = record.value, issues: ValidationIssue[] = [];
  const report = (code: string, path: string, message: string) => issues.push({ code, path, message });
  const task = course.researchTasks?.find(t => t.id === request.taskId);
  if (!task) return { valid: false, issues: [{ code: 'UNAPPROVED_RESEARCH_TASK', path: '/taskId', message: 'Select a research task declared by the author.' }] };
  if (!task.objectiveIds.includes(request.objective)) report('RESEARCH_SCOPE_MISMATCH', '/objective', 'The objective is outside the task.');
  const episode = course.chapters.flatMap(c => c.episodes).find(e => e.id === request.episodeRevision.episodeId);
  if (!episode?.objectiveIds.includes(request.objective)) report('RESEARCH_SCOPE_MISMATCH', '/episodeRevision/episodeId', 'The episode must teach the objective.');
  if (request.misconceptionHypothesis !== null && !course.hypotheses?.some(h => h.id === request.misconceptionHypothesis && h.objectiveIds.includes(request.objective)))
    report('UNDECLARED_HYPOTHESIS', '/misconceptionHypothesis', 'Use a declared hypothesis ID for this objective.');
  const objectives = new Map(course.objectives.map(o => [o.id, o]));
  const ancestors = new Set<string>(); const stack = [...(objectives.get(request.objective)?.prerequisites ?? [])];
  while (stack.length) { const id = stack.pop()!; if (!ancestors.has(id)) { ancestors.add(id); stack.push(...(objectives.get(id)?.prerequisites ?? [])); } }
  for (const [i, id] of request.knownPrerequisites.entries()) if (!ancestors.has(id)) report('RESEARCH_SCOPE_MISMATCH', `/knownPrerequisites/${i}`, `${id} is not a prerequisite of the objective.`);
  if (!task.languages.includes(request.language)) report('RESEARCH_SCOPE_MISMATCH', '/language', 'The language is not declared by the task.');
  if (!task.modalities.includes(request.modality) && !task.modalities.includes('any')) report('RESEARCH_SCOPE_MISMATCH', '/modality', 'The modality is not declared by the task.');
  const policy = request.sourcePolicy, limits = task.sourcePolicy;
  if (!task.publicTopicIds.includes(policy.publicTopicId)) report('UNAPPROVED_RESEARCH_TOPIC', '/sourcePolicy/publicTopicId', 'Use a public topic declared by the task.');
  if (policy.maxCandidates > limits.maxCandidates || policy.maxToolCalls > limits.maxToolCalls || policy.deadlineSeconds > limits.deadlineSeconds)
    report('RESEARCH_BUDGET_WIDENED', '/sourcePolicy', 'A request cannot exceed the task budget.');
  const topic = course.research?.publicTopics.find(t => t.id === policy.publicTopicId);
  const allowed = limits.allowedDomains ?? topic?.allowedDomains;
  if (allowed && (!policy.allowedDomains || policy.allowedDomains.some(d => !allowed.includes(d)))) report('RESEARCH_DOMAIN_WIDENED', '/sourcePolicy/allowedDomains', 'A request cannot widen the reviewed domain allowlist.');
  if (request.requiredOrOptional === 'required_replacement' && task.requiredOrOptional !== 'required_replacement')
    report('RESEARCH_REQUIREMENT_ESCALATED', '/requiredOrOptional', 'Optional help cannot silently become required work.');
  return issues.length ? { valid: false, issues } : { valid: true, request, issues: [] };
}

/** Check a MediaCandidate against its request: binding, domain allowlist and review honesty. */
export function validateResearchResult(request: ResearchRequest, input: unknown): { valid: true; result: ResearchResult; issues: [] } | { valid: false; issues: ValidationIssue[] } {
  const record = validateRecord('researchResult', input);
  if (!record.valid) return record;
  const result = record.value, issues: ValidationIssue[] = [];
  if (result.requestId !== request.requestId) issues.push({ code: 'STALE_RESEARCH_RESULT', path: '/requestId', message: 'The result belongs to another request.' });
  if (result.objectiveFit.objective !== request.objective) issues.push({ code: 'STALE_RESEARCH_RESULT', path: '/objectiveFit/objective', message: 'The result is attached to another objective.' });
  let host = '';
  try { const url = new URL(result.sourceUrl); host = url.protocol === 'https:' ? url.hostname : ''; } catch { host = ''; }
  if (!host) issues.push({ code: 'UNSAFE_URL', path: '/sourceUrl', message: 'Sources must use HTTPS.' });
  else if (request.sourcePolicy.allowedDomains && !request.sourcePolicy.allowedDomains.includes(host))
    issues.push({ code: 'DOMAIN_NOT_ALLOWED', path: '/sourceUrl', message: 'The source is outside the request domain allowlist.' });
  return issues.length ? { valid: false, issues } : { valid: true, result, issues: [] };
}
