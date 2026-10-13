import { createHash } from 'node:crypto';
import { canonicalJson } from './json.js';
export { canonicalJson } from './json.js';
import { validateCourse } from './validate.js';
import type { CourseManifest, ValidationIssue } from './types.js';
import { validateCourseAdaptation } from './adaptation.js';
import { digestJson } from './integrity.js';
import { projectLearnerAdaptation, type LearnerAdaptation } from './adaptation-projection.js';
import type { AdaptationValidationContext, CourseAdaptation } from './adaptation-types.js';

export class CourseValidationError extends Error {
  constructor(public readonly issues: ValidationIssue[]) {
    super(`Course validation failed with ${issues.length} issue(s).`);
    this.name = 'CourseValidationError';
  }
}

export type LearnerCourse = Omit<CourseManifest, 'assessments' | 'gates' | 'placement' | 'retention' | 'extensions' | 'adaptation' | 'research'> & {
  assessments: { id: string; type: string; objectiveIds: string[] }[];
  gates: { id: string; objectiveIds: string[]; minimumIndependentFamilies: number; requireAllObjectives: boolean }[];
  placement?: { enabled: boolean; learnerMayDecline: true; objectiveIds: string[]; maxItems: number };
  /** Schedule only; held-out item identities and keys stay server-side. */
  retention?: { intervalsDays: number[]; objectiveIds: string[] };
  extensions: CourseManifest['extensions'];
};

export interface CompiledCourse {
  formatVersion: 1;
  digest: string;
  server: CourseManifest;
  learner: LearnerCourse;
}

/** Assessment prompts/options are served per authorized attempt, never as a full item bank. */
export function compileCourse(input: unknown): CompiledCourse {
  const result = validateCourse(input);
  if (!result.valid) throw new CourseValidationError(result.issues);
  const server = result.course;
  const digest = createHash('sha256').update(canonicalJson(server)).digest('hex');
  const { assessments, gates, placement, retention, extensions, adaptation: _authoring, research: _research, ...rest } = structuredClone(server);
  const learner: LearnerCourse = {
    ...rest,
    // Held-out retention items stay entirely server-side until issued.
    assessments: assessments.filter(({ id }) => !retention?.assessmentIds.includes(id)).map(({ id, type, objectiveIds }) => ({ id, type, objectiveIds })),
    gates: gates.map(({ id, objectiveIds, minimumIndependentFamilies, requireAllObjectives }) => ({ id, objectiveIds, minimumIndependentFamilies, requireAllObjectives })),
    extensions: extensions.filter((extension) => extension.execution !== 'server'),
  };
  if (retention) learner.retention = { intervalsDays: retention.intervalsDays, objectiveIds: retention.objectiveIds };
  if (placement) {
    learner.placement = { enabled: placement.enabled, learnerMayDecline: true, objectiveIds: placement.objectiveIds, maxItems: placement.maxItems };
  }
  return { formatVersion: 1, digest, server, learner };
}

export interface CompiledCourseAdaptation {
  formatVersion: 1;
  status: 'proposal';
  proofAuthenticity: 'not_checked';
  applicationAuthority: 'not_checked';
  proposalDigest: string;
  proposedPlan: { baseCourseDigest: string; parentDigest: string; revision: number; digest: string };
  server: CourseAdaptation;
  learner: LearnerAdaptation;
}

/** Compiles a candidate plan, not an applied/authorized update or evidence receipt. */
export async function compileCourseAdaptation(input: unknown, context: AdaptationValidationContext): Promise<CompiledCourseAdaptation> {
  const result = await validateCourseAdaptation(input, context);
  if (!result.valid) throw new CourseValidationError(result.issues);
  const identity = { baseCourseDigest: result.proposal.baseCourseDigest, parentDigest: result.proposal.expectedPlanDigest,
    revision: result.proposal.expectedPlanRevision + 1, proposalDigest: result.proposalDigest };
  return { formatVersion: 1, status: 'proposal', proofAuthenticity: 'not_checked', applicationAuthority: 'not_checked',
    proposalDigest: result.proposalDigest,
    proposedPlan: { baseCourseDigest: identity.baseCourseDigest, parentDigest: identity.parentDigest, revision: identity.revision, digest: await digestJson(identity) },
    server: result.proposal, learner: projectLearnerAdaptation(result.proposal) };
}

/** Verifies data integrity/projection only. It does not authenticate claimed proofs. */
export async function verifyCompiledCourseAdaptation(value: unknown, context: AdaptationValidationContext): Promise<boolean> {
  if (!value || typeof value !== 'object') return false;
  try {
    const expected = await compileCourseAdaptation((value as CompiledCourseAdaptation).server, context);
    return canonicalJson(value) === canonicalJson(expected);
  } catch { return false; }
}

/** A checksum proves integrity, not trust in an author or in the correctness of their lessons. */
export function verifyCompiledCourse(value: unknown): value is CompiledCourse {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  if (record.formatVersion !== 1 || typeof record.digest !== 'string') return false;
  try {
    const expected = compileCourse(record.server);
    return expected.digest === record.digest && canonicalJson(expected.learner) === canonicalJson(record.learner)
      && Object.keys(record).sort().join(',') === 'digest,formatVersion,learner,server';
  } catch { return false; }
}
