import { DEFAULT_REVIEW_INTERVALS_DAYS } from './contract-constants.js';
import type { CourseManifest } from './types.js';
import type { ConceptGraph } from './record-types.js';

/** ConceptGraph record for a validated course (edges point from prerequisite to concept). */
export function buildConceptGraph(course: CourseManifest, courseDigest: string): ConceptGraph {
  const concepts = [...(course.concepts ?? [])].sort((a, b) => a.id.localeCompare(b.id));
  return {
    courseDigest,
    nodes: concepts.map(({ id, title, objectiveIds }) => ({ id, title, objectiveIds: [...objectiveIds] })),
    edges: concepts.flatMap(c => [...c.prerequisiteConceptIds].sort().map(from => ({ from, to: c.id }))),
  };
}

/** Author intervals when declared; otherwise the product default 1, 3, 7 and 21 days. */
export function resolveRetentionIntervals(course: Pick<CourseManifest, 'retention'>): number[] {
  return [...(course.retention?.intervalsDays ?? DEFAULT_REVIEW_INTERVALS_DAYS)];
}
