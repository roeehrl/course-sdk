import type { ValidateFunction } from 'ajv';
import { shapeIssues } from './adaptation-shape.js';
import selectionValidator from './generated/research-selection-validator.js';
import { validateCourse } from './validate.js';
import type { PublicResearchRequest, PublicResearchResolution, PublicResearchSelection } from './research-types.js';

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
