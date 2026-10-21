import { createHash } from 'node:crypto';
import { canonicalJson } from './json.js';
export { canonicalJson } from './json.js';
import { validateCourse } from './validate.js';
import type { CourseManifest, ValidationIssue } from './types.js';
import { validateCourseAdaptation } from './adaptation.js';
import { digestJson } from './integrity.js';
import { projectLearnerAdaptation, type LearnerAdaptation } from './adaptation-projection.js';
import type { AdaptationValidationContext, CourseAdaptation } from './adaptation-types.js';
import type { ActivityDefinition, PlatformAdapter, RendererDefinition } from './contracts-types.js';
import type { LearnerVersionedGate } from './record-types.js';
import { isVersionedGate } from './contracts-validate.js';
import { DEFAULT_REVIEW_INTERVALS_DAYS } from './contract-constants.js';
import { filterTranslations } from './localization.js';

export class CourseValidationError extends Error {
  constructor(public readonly issues: ValidationIssue[]) {
    super(`Course validation failed with ${issues.length} issue(s).`);
    this.name = 'CourseValidationError';
  }
}

/** Server-only sections: grading, agents, research, admin and debug configuration, and (0.6) study instruments and concept-mapping drafts. */
export const SERVER_ONLY_SECTIONS = ['hypotheses', 'probes', 'rubrics', 'evaluators', 'tools', 'adaptationPolicies', 'adminSections',
  'researchTasks', 'storyboards', 'agentStrategies', 'debugInspectors', 'studyInstruments', 'conceptMappingDrafts'] as const;
type ServerOnlySection = typeof SERVER_ONLY_SECTIONS[number];
export type LearnerLegacyGate = { id: string; objectiveIds: string[]; minimumIndependentFamilies: number; requireAllObjectives: boolean };
export type LearnerActivity = Omit<ActivityDefinition, 'evaluatorRef'>;
export type LearnerCourse = Omit<CourseManifest, 'assessments' | 'gates' | 'placement' | 'retention' | 'extensions' | 'adaptation' | 'research'
  | ServerOnlySection | 'activities' | 'renderers' | 'platformAdapters' | 'translations'> & {
  /**
   * 0.6: the course's bundles restricted to texts this projection contains. Assessment prompts,
   * options, feedback and server-only sections stay server-side in every locale.
   */
  translations?: CourseManifest['translations'];
  assessments: { id: string; type: string; objectiveIds: string[] }[];
  gates: (LearnerLegacyGate | LearnerVersionedGate)[];
  placement?: { enabled: boolean; learnerMayDecline: true; objectiveIds: string[]; maxItems: number };
  /** Schedule only; held-out item identities and keys stay server-side. */
  retention?: { intervalsDays: number[]; objectiveIds: string[] };
  extensions: CourseManifest['extensions'];
  activities?: LearnerActivity[];
  renderers?: RendererDefinition[];
  platformAdapters?: PlatformAdapter[];
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
  const { assessments, gates, placement, retention, extensions, adaptation: _authoring, research: _research,
    activities, renderers, platformAdapters, translations, ...withServerSections } = structuredClone(server);
  const rest = Object.fromEntries(Object.entries(withServerSections).filter(([key]) => !(SERVER_ONLY_SECTIONS as readonly string[]).includes(key))) as Omit<typeof withServerSections, ServerOnlySection>;
  const learner: LearnerCourse = {
    ...rest,
    // Held-out retention items stay entirely server-side until issued.
    assessments: assessments.filter(({ id }) => !retention?.assessmentIds.includes(id)).map(({ id, type, objectiveIds }) => ({ id, type, objectiveIds })),
    gates: gates.map((gate) => {
      if (!isVersionedGate(gate)) {
        const { id, objectiveIds, minimumIndependentFamilies, requireAllObjectives } = gate;
        return { id, objectiveIds, minimumIndependentFamilies, requireAllObjectives };
      }
      // Requirements are readable by learners; item banks, rubrics and policy refs are not.
      const projected: LearnerVersionedGate = { id: gate.id, version: gate.version, scope: gate.scope, requiredObjectives: gate.requiredObjectives,
        readinessCriteria: gate.readinessCriteria, eligibleEvidenceKinds: gate.eligibleEvidenceKinds, minimumIndependentEvidence: gate.minimumIndependentEvidence,
        nextActivityId: gate.nextActivityId, appealPolicy: gate.appealPolicy };
      if (gate.previewAccess) projected.previewAccess = gate.previewAccess;
      return projected;
    }),
    extensions: extensions.filter((extension) => extension.execution !== 'server'),
  };
  if (activities) learner.activities = activities.map(({ evaluatorRef: _evaluator, ...activity }) => activity);
  if (renderers) learner.renderers = renderers.filter((renderer) => renderer.surface === 'learner_activity' || renderer.surface === 'visual');
  if (platformAdapters) learner.platformAdapters = platformAdapters.filter((adapter) => adapter.kind !== 'server_sandbox');
  if (retention) learner.retention = { intervalsDays: retention.intervalsDays ?? [...DEFAULT_REVIEW_INTERVALS_DAYS], objectiveIds: retention.objectiveIds };
  if (placement) {
    learner.placement = { enabled: placement.enabled, learnerMayDecline: true, objectiveIds: placement.objectiveIds, maxItems: placement.maxItems };
  }
  // Last, so the filter sees exactly the projected texts.
  if (translations) learner.translations = filterTranslations(translations, learner);
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

export {
  BUNDLE_FILES, CourseBundleError, conformanceReport, diffCourses, importCourse, inspectCourse, licenseInventory, migrateCourse,
  packCourse, requiredCapabilities, scaffoldCourse, verifyCourseBundle,
} from './tooling.js';
export type { BundleManifest, BundleVerification, CapabilityReport, ConformanceReport, CourseDiff, LicenseInventory, MigrationResult } from './tooling.js';
export {
  ADAPTATION_REGISTRY_MEMBER, COURSE_MANIFEST_MEMBER, COURSE_PACKAGE_ERROR_CODES, COURSE_PACKAGE_FORMAT, COURSE_PACKAGE_FORMAT_VERSION,
  COURSE_PACKAGE_LIMITS, COURSE_PACKAGE_LISTING, COURSE_PACKAGE_ROLES, CoursePackageError, DEFAULT_MINIMUM_CORE_VERSION, LEARNER_PROJECTION_MEMBER,
  coursePackageChecksum, packCoursePackage, verifyCoursePackage, verifyCoursePackageChecksum,
} from './course-package.js';
export type {
  CoursePackageErrorCode, CoursePackageLimits, CoursePackageManifest, CoursePackageMember, CoursePackageRole, PackageFile, PackageFileContent,
  PackCoursePackageInput, VerifiedCoursePackage, VerifiedCoursePackageMember, VerifyCoursePackageOptions,
} from './course-package.js';
// 0.6: author tooling for TypeScript course modules, compatibility, gate replay and the live preview.
export { COURSE_MODULE_EXTENSIONS, COURSE_MODULE_LIMITS, CourseModuleError, isCourseModulePath, loadCourseModule } from './course-module.js';
export type { CourseModuleErrorCode, CourseModuleOptions, LoadedCourseModule } from './course-module.js';
export { compareSemver, compatibilityReport, sdk06Reasons } from './compat.js';
export type {
  CompatibilityItem, CompatibilityOptions, CompatibilityProblem, CompatibilityReport, CompatibilityStatus, HostInventory, LocalRenderer,
} from './compat.js';
export { GATE_REPLAY_LIMITS, replayGateDecisions } from './replay.js';
export type { GateReplayEntry, GateReplayFile, GateReplayOutcome, GateReplayReport } from './replay.js';
export { MINIMUM_VISUALS_VERSION, VISUALS_PACKAGE, findVisualsPackage, loadVisualsRenderer } from './local-renderer.js';
export type { VisualsRenderer } from './local-renderer.js';
export { renderPreviewPage, startDevServer } from './dev-server.js';
export type { DevBuild, DevServer, DevServerOptions } from './dev-server.js';
