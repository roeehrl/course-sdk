import type { ValidationIssue } from './types.js';

/** Author-reviewed public text, never a learner-context or query-template slot. */
export interface PublicResearchTopic {
  id: string;
  objectiveIds: string[];
  queryText: string;
  /** Exact lowercase ASCII DNS names (IDNs use punycode); no implicit subdomains. */
  allowedDomains?: string[];
}

export interface ResearchAuthoring {
  publicTopics: PublicResearchTopic[];
}

/** The host authorizes the supervisor's selection; a model cannot approve a query. */
export interface PublicResearchSelection {
  topicId: string;
}

/** The complete external research payload. No learner identifiers or context. */
export interface PublicResearchRequest {
  queryText: string;
  allowedDomains?: string[];
}

export type PublicResearchResolution =
  | { valid: true; request: PublicResearchRequest; authorityAuthenticity: 'not_checked'; issues: [] }
  | { valid: false; issues: ValidationIssue[] };
