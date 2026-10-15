import type { ActivityDefinition, LayoutClass, LayoutInput, PlatformTarget } from './contracts-types.js';
import type { AssessmentType, Platform } from './types.js';

/** Product-default spaced review intervals (days). Author data overrides them. */
export const DEFAULT_REVIEW_INTERVALS_DAYS: readonly number[] = Object.freeze([1, 3, 7, 21]);

export const PLATFORM_TARGETS: Readonly<Record<Platform, readonly PlatformTarget[]>> = Object.freeze({
  web: Object.freeze(['web_desktop', 'web_mobile'] as const),
  ios: Object.freeze(['ios_phone', 'ipados_tablet'] as const),
  android: Object.freeze(['android_phone', 'android_tablet'] as const),
});
export const NATIVE_TARGETS: ReadonlySet<PlatformTarget> = new Set(['ios_phone', 'ipados_tablet', 'android_phone', 'android_tablet']);
export const PHONE_TARGETS: ReadonlySet<PlatformTarget> = new Set(['web_mobile', 'ios_phone', 'android_phone']);

/** Capabilities a contract may request. The host still grants or denies each one per call. */
export const KNOWN_CAPABILITIES: ReadonlySet<string> = new Set([
  'state.read', 'state.patch', 'observation.emit', 'artifact.read', 'artifact.write', 'media.play', 'network.fetch',
  'clipboard.write', 'storage.local', 'code.execute', 'assessment.evaluate', 'teaching.generate', 'teaching.verify',
  'research.search', 'research.fetch', 'learner.profile.read', 'learner.evidence.read', 'learner.history.read',
  'proposal.submit', 'camera.capture', 'microphone.capture', 'sensor.motion',
]);
/** Authority that no SDK contract can request: evidence, grades, caps and credentials stay with the host. */
export const FORBIDDEN_CAPABILITIES: ReadonlySet<string> = new Set([
  'evidence.write', 'grade.issue', 'mastery.grant', 'policy.override', 'cap.bypass', 'credentials.read',
  'learner.chat.read_all', 'native.load_dynamic', 'admin.impersonate',
]);
/** Capabilities a declarative (no custom code) activity may use. */
export const DECLARATIVE_CAPABILITIES: ReadonlySet<string> = new Set(['state.read', 'state.patch', 'observation.emit', 'artifact.read', 'media.play']);

/** Selecting among given options; cannot alone establish a skill or count as transfer. */
export const RECOGNITION_TYPES: ReadonlySet<AssessmentType> = new Set(['choice']);
/** Types with an author-declared key that a deterministic evaluator can score. */
export const DETERMINISTIC_TYPES: ReadonlySet<AssessmentType> = new Set(['choice', 'numeric', 'prediction', 'trace']);
/** Evaluator-verified production tasks (code, written and design work). */
export const PRACTICAL_TYPES: ReadonlySet<AssessmentType> = new Set(['code', 'code_repair', 'counterexample', 'experiment_design', 'rubric', 'teach_back']);
export const RUBRIC_PRODUCTION_TYPES: ReadonlySet<AssessmentType> = new Set(['counterexample', 'experiment_design', 'teach_back']);

/** Words that would let an admin setting or profile field impersonate host authority. */
export const RESERVED_AUTHORITY_WORDS: ReadonlySet<string> = new Set(['mastery', 'credit', 'credits', 'grade', 'grading', 'score', 'consent',
  'policy', 'cap', 'caps', 'evidence', 'completion', 'passed', 'deadline', 'extension', 'allowance']);

export const ADMIN_WRITE_PERMISSIONS: ReadonlySet<string> = new Set(['course.settings.write', 'policy.write', 'reviews.write', 'supervision.control']);

/** Initial ceilings from the design: 16 KiB interaction events, 64 KiB state snapshots. */
export const MAX_EVENT_BYTES = 16 * 1024;
export const MAX_STATE_BYTES = 64 * 1024;

export const LAYOUT_BREAKPOINTS = Object.freeze({ medium: 600, expanded: 840 });

/**
 * Window class from effective logical width. Larger text reduces the usable width, so
 * the width is divided by the font scale (minimum 1). compact < 600 ≤ medium < 840 ≤ expanded.
 */
export function windowClass(widthLogicalPx: number, fontScale = 1): LayoutClass {
  if (!Number.isFinite(widthLogicalPx) || widthLogicalPx < 0 || !Number.isFinite(fontScale) || fontScale <= 0) throw new RangeError('Width and font scale must be finite and positive.');
  const effective = widthLogicalPx / Math.max(1, fontScale);
  return effective >= LAYOUT_BREAKPOINTS.expanded ? 'expanded' : effective >= LAYOUT_BREAKPOINTS.medium ? 'medium' : 'compact';
}

export function targetsForPlatforms(platforms: readonly Platform[]): PlatformTarget[] {
  return platforms.flatMap(platform => PLATFORM_TARGETS[platform]);
}
export function platformOfTarget(target: PlatformTarget): Platform {
  return target.startsWith('web') ? 'web' : target.startsWith('android') ? 'android' : 'ios';
}

/**
 * The approved design's `platform_contract`: platform targets, layout classes and inputs, and
 * the nine `required_activity_fields` every activity declares (see `defineActivity`).
 */
export const REQUIRED_ACTIVITY_FIELDS = Object.freeze(['supportedTargets', 'rendererRefs', 'executionAdapter', 'capabilityRequirements',
  'equivalentFallbacks', 'offlineBehavior', 'resourceBudget', 'accessibleSemantics', 'stateMigration'] as const satisfies readonly (keyof ActivityDefinition)[]);
export type PlatformContract = Pick<ActivityDefinition, typeof REQUIRED_ACTIVITY_FIELDS[number]>;
export const PLATFORM_CONTRACT = Object.freeze({
  targets: Object.freeze(['web_desktop', 'web_mobile', 'ios_phone', 'ipados_tablet', 'android_phone', 'android_tablet'] as const satisfies readonly PlatformTarget[]),
  layoutClasses: Object.freeze(['compact', 'medium', 'expanded'] as const satisfies readonly LayoutClass[]),
  layoutInputs: Object.freeze(['effective_window_bounds', 'safe_areas', 'font_scale', 'input_mode', 'keyboard_visibility', 'orientation', 'split_view'] as const satisfies readonly LayoutInput[]),
  requiredActivityFields: REQUIRED_ACTIVITY_FIELDS,
});
/** The nine platform-contract fields of an activity, detached from its other fields. */
export function platformContract(activity: ActivityDefinition): PlatformContract {
  return structuredClone(Object.fromEntries(REQUIRED_ACTIVITY_FIELDS.map(field => [field, activity[field]]))) as PlatformContract;
}
