import { createHash } from 'node:crypto';
import { validateCourse } from './validate.js';
import type { CourseManifest, ValidationIssue } from './types.js';

export class CourseValidationError extends Error {
  constructor(public readonly issues: ValidationIssue[]) {
    super(`Course validation failed with ${issues.length} issue(s).`);
    this.name = 'CourseValidationError';
  }
}

/** Canonical JSON preserves array order and sorts object keys, without mutating input. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value === 'object' && value !== null) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`).join(',')}}`;
  }
  throw new TypeError('Canonical encoding requires finite JSON data.');
}

export type LearnerCourse = Omit<CourseManifest, 'assessments' | 'gates' | 'placement' | 'extensions'> & {
  assessments: { id: string; type: string; objectiveIds: string[] }[];
  gates: { id: string; objectiveIds: string[]; minimumIndependentFamilies: number; requireAllObjectives: boolean }[];
  placement?: { enabled: boolean; learnerMayDecline: true; objectiveIds: string[]; maxItems: number };
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
  const { assessments, gates, placement, extensions, ...rest } = structuredClone(server);
  const learner: LearnerCourse = {
    ...rest,
    assessments: assessments.map(({ id, type, objectiveIds }) => ({ id, type, objectiveIds })),
    gates: gates.map(({ id, objectiveIds, minimumIndependentFamilies, requireAllObjectives }) => ({ id, objectiveIds, minimumIndependentFamilies, requireAllObjectives })),
    extensions: extensions.filter((extension) => extension.execution !== 'server'),
  };
  if (placement) {
    learner.placement = { enabled: placement.enabled, learnerMayDecline: true, objectiveIds: placement.objectiveIds, maxItems: placement.maxItems };
  }
  return { formatVersion: 1, digest, server, learner };
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
