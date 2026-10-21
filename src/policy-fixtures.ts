import { validateCourse } from './validate.js';
import { checkAdminSettingChange } from './admin.js';
import type { CourseManifest, LearningPolicy, ValidationIssue } from './types.js';
import type { AdminPermission, AdminSetting } from './contracts-types.js';

/**
 * 0.6: policy fixtures. An author writes scenarios against the course's learning policies (caps,
 * extension allowances, deadlines and admin settings) and `runPolicyFixtures` replays them with a
 * fixed clock and reports what happened. This is an author-side reference of the declared intent,
 * pure and deterministic; the host's policy service stays authoritative for real enrollments.
 *
 * Resolution follows Course Core's rules: a scope's policy is the intersection of the course,
 * chapter and episode policies on its path. Children never remove an ancestor constraint: the
 * earliest deadline binds, each work cap is the smallest declared value (zero is a real cap, an
 * omitted field means no cap at that scope), extension allowances take the smallest limits and are
 * disabled if any declaring scope disables them, and closed material access wins. Target dates are
 * advisory and never deny. Deadlines are exclusive: an action at the exact cutoff is late.
 */

export type PolicyAnchor = 'enrollment_started' | 'scope_assigned' | 'scope_started';
export type PolicyWorkField = 'additionalEpisodes' | 'additionalMinutes' | 'remediationCyclesPerConcept';
export type PolicyFixtureStep =
  | { kind: 'action'; action: 'progress' | 'submit' | 'read'; at: string; expect: 'allowed' | 'denied'; reason?: string }
  | { kind: 'work'; use: Partial<Record<PolicyWorkField, number>>; expect: 'allowed' | 'denied'; reason?: string }
  | { kind: 'extension'; days: number; expect: 'granted' | 'denied'; reason?: string }
  | { kind: 'admin'; sectionId: string; settingId: string; scope: AdminSetting['scope']; value: unknown; granted: AdminPermission[]; expect: 'allowed' | 'denied'; reason?: string };
export interface PolicyFixture {
  id: string;
  description?: string;
  /** `course`, `chapter:<id>` or `episode:<id>`. */
  scope: string;
  /** Instants (ISO 8601 with a zone) of the events calendar windows count from. */
  anchors?: Partial<Record<PolicyAnchor, string>>;
  steps: PolicyFixtureStep[];
}
export interface PolicyFixtureFile { policyFixturesFormat: 1; fixtures: PolicyFixture[] }

export interface ResolvedCoursePolicy {
  scope: string;
  /** Scopes whose policy applies, outermost first. */
  path: string[];
  mode: 'bounded' | 'open_ended';
  targetDate: string | null;
  hardDeadline: { at: string; scope: string } | null;
  windows: { scope: string; calendarDays: number; timeZone: string; anchor: PolicyAnchor; pauseRule: 'never' | 'approved_only' }[];
  work: Record<PolicyWorkField, { cap: number; scope: string } | null>;
  extensions: { enabled: boolean; calendarDays: number; maxGrants: number; maxDaysPerGrant: number; scopes: string[] } | null;
  existingMaterialAccess: 'read_only' | 'closed';
}

export interface PolicyStepOutcome {
  index: number;
  kind: PolicyFixtureStep['kind'];
  expected: string;
  actual: string;
  /** The first rule that denied the step, or null. */
  reason: string | null;
  passed: boolean;
  detail: string;
}
export interface PolicyFixtureOutcome {
  id: string;
  scope: string;
  status: 'passed' | 'failed' | 'invalid';
  resolved: ResolvedCoursePolicy | null;
  /** The effective deadline before any step, after resolving windows from the anchors. */
  deadline: { at: string; scope: string } | null;
  steps: PolicyStepOutcome[];
  issues: ValidationIssue[];
}
export interface PolicyFixtureReport {
  policyFixturesFormat: 1;
  course: { id: string; version: string } | null;
  status: 'passed' | 'failed';
  summary: { fixtures: number; passed: number; failed: number; invalid: number };
  fixtures: PolicyFixtureOutcome[];
  issues: ValidationIssue[];
}

export const POLICY_FIXTURE_LIMITS = Object.freeze({ fixtures: 500, stepsPerFixture: 200, maxDays: 3660, maxWork: 1_000_000 });
const WORK_FIELDS: readonly PolicyWorkField[] = ['additionalEpisodes', 'additionalMinutes', 'remediationCyclesPerConcept'];
const ANCHORS: readonly PolicyAnchor[] = ['enrollment_started', 'scope_assigned', 'scope_started'];
const DAY_MS = 86_400_000;

/** Every policy scope of a course: the course, then each chapter followed by its episodes. */
export function policyScopes(course: CourseManifest): string[] {
  return ['course', ...course.chapters.flatMap(chapter => [`chapter:${chapter.id}`, ...chapter.episodes.map(episode => `episode:${episode.id}`)])];
}

function scopePath(course: CourseManifest, scope: string): { scope: string; policy: LearningPolicy | undefined }[] | undefined {
  if (scope === 'course') return [{ scope, policy: course.policy }];
  const [kind, id] = [scope.slice(0, scope.indexOf(':')), scope.slice(scope.indexOf(':') + 1)];
  for (const chapter of course.chapters) {
    const top = [{ scope: 'course', policy: course.policy }, { scope: `chapter:${chapter.id}`, policy: chapter.policy }];
    if (kind === 'chapter' && chapter.id === id) return top;
    const episode = kind === 'episode' ? chapter.episodes.find(e => e.id === id) : undefined;
    if (episode) return [...top, { scope, policy: episode.policy }];
  }
  return undefined;
}

/** The effective policy of one scope (see the module comment for the intersection rules). */
export function resolveCoursePolicy(course: CourseManifest, scope = 'course'): ResolvedCoursePolicy {
  const path = scopePath(course, scope);
  if (!path) throw new RangeError(`Unknown policy scope ${scope}; use course, chapter:<id> or episode:<id>.`);
  const declared = path.filter((entry): entry is { scope: string; policy: LearningPolicy } => entry.policy !== undefined);
  const own = declared.at(-1)!;
  let hardDeadline: ResolvedCoursePolicy['hardDeadline'] = null;
  const work = Object.fromEntries(WORK_FIELDS.map(field => [field, null])) as ResolvedCoursePolicy['work'];
  let extensions: ResolvedCoursePolicy['extensions'] = null;
  for (const { scope: at, policy } of declared) {
    if (policy.hardDeadline && (!hardDeadline || Date.parse(policy.hardDeadline) < Date.parse(hardDeadline.at))) hardDeadline = { at: policy.hardDeadline, scope: at };
    for (const field of WORK_FIELDS) {
      const cap = policy.work?.[field];
      if (cap !== undefined && (work[field] === null || cap < work[field].cap)) work[field] = { cap, scope: at };
    }
    if (policy.extensions) {
      const e = policy.extensions;
      extensions = extensions
        ? { enabled: extensions.enabled && e.enabled, calendarDays: Math.min(extensions.calendarDays, e.calendarDays), maxGrants: Math.min(extensions.maxGrants, e.maxGrants),
          maxDaysPerGrant: Math.min(extensions.maxDaysPerGrant, e.maxDaysPerGrant), scopes: [...extensions.scopes, at] }
        : { enabled: e.enabled, calendarDays: e.calendarDays, maxGrants: e.maxGrants, maxDaysPerGrant: e.maxDaysPerGrant, scopes: [at] };
    }
  }
  return {
    scope, path: path.map(entry => entry.scope), mode: own.policy.mode, targetDate: [...declared].reverse().find(entry => entry.policy.targetDate)?.policy.targetDate ?? null,
    hardDeadline, windows: declared.flatMap(({ scope: at, policy }) => policy.window ? [{ scope: at, ...policy.window }] : []), work, extensions,
    existingMaterialAccess: declared.some(entry => entry.policy.existingMaterialAccess === 'closed') ? 'closed' : 'read_only',
  };
}

// ------------------------------------------------------------------ calendar arithmetic

const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/;
const instant = (value: unknown): number | undefined => typeof value === 'string' && ISO_INSTANT.test(value) && Number.isFinite(Date.parse(value)) ? Date.parse(value) : undefined;

function wallClock(ms: number, timeZone: string): number {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric',
    hour: 'numeric', minute: 'numeric', second: 'numeric' }).formatToParts(ms).map(part => [part.type, Number(part.value)]));
  return Date.UTC(parts.year!, parts.month! - 1, parts.day!, parts.hour!, parts.minute!, parts.second!) + (((ms % 1000) + 1000) % 1000);
}
/**
 * Adds whole calendar days to the anchor's local date and time in `timeZone`, like Temporal's
 * `compatible` disambiguation: in a repeated hour the earlier instant, in a skipped hour the later.
 */
export function addCalendarDays(anchor: string, days: number, timeZone: string): string {
  const start = instant(anchor);
  if (start === undefined) throw new RangeError('The anchor must be an ISO 8601 instant with a zone.');
  const target = wallClock(start, timeZone) + days * DAY_MS;
  const offsets = [...new Set([wallClock(target - DAY_MS, timeZone) - (target - DAY_MS), wallClock(target + DAY_MS, timeZone) - (target + DAY_MS)])];
  const valid = offsets.map(offset => target - offset).filter(at => wallClock(at, timeZone) === target).sort((a, b) => a - b);
  // A skipped local time moves forward by the gap (the offset before the transition applies).
  return new Date(valid[0] ?? target - offsets[0]!).toISOString();
}

// ------------------------------------------------------------------ fixtures

const isObject = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const count = (value: unknown, max: number) => typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= max;

function fixtureIssues(course: CourseManifest, fixture: unknown, at: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const report = (path: string, message: string) => issues.push({ code: 'INVALID_FIXTURE', path: `${at}${path}`, message });
  if (!isObject(fixture)) { report('', 'A fixture is an object with id, scope and steps.'); return issues; }
  if (typeof fixture.id !== 'string' || !/^[a-z0-9][a-z0-9._:-]{0,127}$/.test(fixture.id)) report('/id', 'Use a lower-case fixture ID.');
  if (typeof fixture.scope !== 'string' || !scopePath(course, fixture.scope)) report('/scope', 'Use course, chapter:<id> or episode:<id> of this course.');
  if (fixture.description !== undefined && (typeof fixture.description !== 'string' || fixture.description.length > 500)) report('/description', 'A description is text of at most 500 characters.');
  if (fixture.anchors !== undefined) {
    if (!isObject(fixture.anchors)) report('/anchors', 'Anchors map an anchor name to an instant.');
    else for (const [name, value] of Object.entries(fixture.anchors)) {
      if (!ANCHORS.includes(name as PolicyAnchor)) report(`/anchors/${name}`, `Anchors are ${ANCHORS.join(', ')}.`);
      else if (instant(value) === undefined) report(`/anchors/${name}`, 'Use an ISO 8601 instant with a zone, such as 2026-03-01T09:00:00Z.');
    }
  }
  if (!Array.isArray(fixture.steps) || !fixture.steps.length || fixture.steps.length > POLICY_FIXTURE_LIMITS.stepsPerFixture) {
    report('/steps', `List 1 to ${POLICY_FIXTURE_LIMITS.stepsPerFixture} steps.`);
    return issues;
  }
  for (const [i, step] of fixture.steps.entries()) {
    const path = `/steps/${i}`;
    if (!isObject(step)) { report(path, 'A step is an object with a kind.'); continue; }
    const outcomes = step.kind === 'extension' ? ['granted', 'denied'] : ['allowed', 'denied'];
    if (!outcomes.includes(step.expect as string)) report(`${path}/expect`, `Expect ${outcomes.join(' or ')}.`);
    if (step.reason !== undefined && (typeof step.reason !== 'string' || !/^[A-Z][A-Z0-9_]{0,63}$/.test(step.reason))) report(`${path}/reason`, 'A reason is a rule code such as DEADLINE_PASSED.');
    switch (step.kind) {
      case 'action':
        if (!['progress', 'submit', 'read'].includes(step.action as string)) report(`${path}/action`, 'Actions are progress, submit and read.');
        if (instant(step.at) === undefined) report(`${path}/at`, 'Use an ISO 8601 instant with a zone.');
        break;
      case 'work':
        if (!isObject(step.use) || !Object.keys(step.use).length) report(`${path}/use`, `Use some of ${WORK_FIELDS.join(', ')}.`);
        else for (const [field, value] of Object.entries(step.use)) {
          if (!WORK_FIELDS.includes(field as PolicyWorkField)) report(`${path}/use/${field}`, `Work fields are ${WORK_FIELDS.join(', ')}.`);
          else if (!count(value, POLICY_FIXTURE_LIMITS.maxWork)) report(`${path}/use/${field}`, 'Use a whole number of zero or more.');
        }
        break;
      case 'extension':
        if (!count(step.days, POLICY_FIXTURE_LIMITS.maxDays) || step.days === 0) report(`${path}/days`, `Request 1 to ${POLICY_FIXTURE_LIMITS.maxDays} whole days.`);
        break;
      case 'admin': {
        const section = (course.adminSections ?? []).find(s => s.id === step.sectionId);
        if (!section) report(`${path}/sectionId`, 'Name an admin section of this course.');
        if (typeof step.settingId !== 'string') report(`${path}/settingId`, 'Name the setting to change.');
        if (!['course', 'chapter', 'enrollment'].includes(step.scope as string)) report(`${path}/scope`, 'Scopes are course, chapter and enrollment.');
        if (!Array.isArray(step.granted) || step.granted.some(p => typeof p !== 'string')) report(`${path}/granted`, 'List the permissions the actor holds.');
        if (!('value' in step)) report(`${path}/value`, 'Give the new value.');
        break;
      }
      default: report(`${path}/kind`, 'Step kinds are action, work, extension and admin.');
    }
  }
  return issues;
}

/** Runs one valid fixture. State (work used, grants, the deadline) carries from step to step. */
function runFixture(course: CourseManifest, fixture: PolicyFixture): PolicyFixtureOutcome {
  const resolved = resolveCoursePolicy(course, fixture.scope);
  const issues: ValidationIssue[] = [];
  // The effective deadline: the earliest hard deadline or resolved window.
  let deadline: { ms: number; scope: string; timeZone: string } | null = resolved.hardDeadline ? { ms: Date.parse(resolved.hardDeadline.at), scope: resolved.hardDeadline.scope, timeZone: 'UTC' } : null;
  for (const window of resolved.windows) {
    const anchor = fixture.anchors?.[window.anchor];
    if (!anchor) { issues.push({ code: 'ANCHOR_MISSING', path: `/anchors/${window.anchor}`, message: `${window.scope} counts ${window.calendarDays} days from ${window.anchor}; give its instant.` }); continue; }
    const ms = Date.parse(addCalendarDays(anchor, window.calendarDays, window.timeZone));
    if (!deadline || ms < deadline.ms) deadline = { ms, scope: window.scope, timeZone: window.timeZone };
  }
  const initial = deadline && { at: new Date(deadline.ms).toISOString(), scope: deadline.scope };
  if (issues.length) return { id: fixture.id, scope: fixture.scope, status: 'invalid', resolved, deadline: initial, steps: [], issues };
  const used = Object.fromEntries(WORK_FIELDS.map(field => [field, 0])) as Record<PolicyWorkField, number>;
  let grantedDays = 0, grants = 0;
  const steps: PolicyStepOutcome[] = [];
  for (const [index, step] of fixture.steps.entries()) {
    let reason: string | null = null, detail: string;
    switch (step.kind) {
      case 'action': {
        const at = Date.parse(step.at);
        const late = deadline !== null && at >= deadline.ms;
        if (late && step.action !== 'read') reason = 'DEADLINE_PASSED';
        if (late && step.action === 'read' && resolved.existingMaterialAccess === 'closed') reason = 'MATERIAL_CLOSED';
        detail = deadline ? `Deadline ${new Date(deadline.ms).toISOString()} (${deadline.scope}); the action is ${late ? 'at or after' : 'before'} it.` : 'No deadline applies.';
        if (late && step.action === 'read' && !reason) detail += ' Existing material stays readable.';
        break;
      }
      case 'work': {
        const over = WORK_FIELDS.filter(field => {
          const cap = resolved.work[field]?.cap;
          return step.use[field] !== undefined && cap !== undefined && used[field] + step.use[field] > cap;
        });
        if (over.length) reason = 'WORK_CAP_EXCEEDED';
        else for (const field of WORK_FIELDS) used[field] += step.use[field] ?? 0;
        detail = WORK_FIELDS.filter(field => step.use[field] !== undefined)
          .map(field => `${field}: ${used[field]}${over.includes(field) ? ` + ${step.use[field]}` : ''} of ${resolved.work[field] ? `${resolved.work[field].cap} (${resolved.work[field].scope})` : 'no cap'}`).join('; ');
        break;
      }
      case 'extension': {
        const e = resolved.extensions;
        if (!e || !e.enabled) reason = 'EXTENSIONS_DISABLED';
        else if (step.days > e.maxDaysPerGrant) reason = 'EXTENSION_TOO_LONG';
        else if (grants + 1 > e.maxGrants) reason = 'EXTENSION_GRANTS_EXHAUSTED';
        else if (grantedDays + step.days > e.calendarDays) reason = 'EXTENSION_ALLOWANCE_EXHAUSTED';
        else if (!deadline) reason = 'NO_DEADLINE_TO_EXTEND';
        if (!reason && deadline) {
          grants++; grantedDays += step.days;
          deadline = { ...deadline, ms: Date.parse(addCalendarDays(new Date(deadline.ms).toISOString(), step.days, deadline.timeZone)) };
        }
        detail = e ? `${grants} of ${e.maxGrants} grants and ${grantedDays} of ${e.calendarDays} days used; at most ${e.maxDaysPerGrant} days per grant.${deadline ? ` Deadline ${new Date(deadline.ms).toISOString()}.` : ''} The learner must accept a grant.`
          : 'No extension allowance is declared.';
        break;
      }
      case 'admin': {
        const section = course.adminSections!.find(s => s.id === step.sectionId)!;
        const found = checkAdminSettingChange(section, { settingId: step.settingId, scope: step.scope, value: step.value }, step.granted);
        reason = found[0]?.code ?? null;
        detail = found.length ? found.map(issue => issue.message).join(' ') : 'The change may be applied and must be audited.';
        break;
      }
    }
    const actual = reason ? 'denied' : step.kind === 'extension' ? 'granted' : 'allowed';
    const passed = actual === step.expect && (step.reason === undefined || step.reason === reason);
    steps.push({ index, kind: step.kind, expected: step.reason ? `${step.expect} (${step.reason})` : step.expect, actual, reason, passed, detail });
  }
  return { id: fixture.id, scope: fixture.scope, status: steps.every(s => s.passed) ? 'passed' : 'failed', resolved, deadline: initial, steps, issues: [] };
}

/** Validates the course and the fixtures, then runs every fixture. Deterministic and offline. */
export function runPolicyFixtures(courseInput: unknown, fixturesInput: unknown): PolicyFixtureReport {
  const empty = (issues: ValidationIssue[], course: PolicyFixtureReport['course'] = null): PolicyFixtureReport =>
    ({ policyFixturesFormat: 1, course, status: 'failed', summary: { fixtures: 0, passed: 0, failed: 0, invalid: 0 }, fixtures: [], issues });
  const checked = validateCourse(courseInput);
  if (!checked.valid) return empty(checked.issues.map(issue => ({ ...issue, path: `/course${issue.path}` })));
  const course = checked.course, identity = { id: course.id, version: course.version };
  if (!isObject(fixturesInput) || fixturesInput.policyFixturesFormat !== 1 || !Array.isArray(fixturesInput.fixtures))
    return empty([{ code: 'INVALID_FIXTURE', path: '', message: 'A fixture file is { "policyFixturesFormat": 1, "fixtures": [...] }.' }], identity);
  if (!fixturesInput.fixtures.length || fixturesInput.fixtures.length > POLICY_FIXTURE_LIMITS.fixtures)
    return empty([{ code: 'INVALID_FIXTURE', path: '/fixtures', message: `List 1 to ${POLICY_FIXTURE_LIMITS.fixtures} fixtures.` }], identity);
  const seen = new Set<string>();
  const fixtures = fixturesInput.fixtures.map((fixture, i): PolicyFixtureOutcome => {
    const issues = fixtureIssues(course, fixture, `/fixtures/${i}`);
    const id = isObject(fixture) && typeof fixture.id === 'string' ? fixture.id : `#${i}`;
    if (seen.has(id)) issues.push({ code: 'DUPLICATE_ID', path: `/fixtures/${i}/id`, message: `Fixture ${id} is listed twice.` });
    seen.add(id);
    const scope = isObject(fixture) && typeof fixture.scope === 'string' ? fixture.scope : '';
    return issues.length ? { id, scope, status: 'invalid', resolved: null, deadline: null, steps: [], issues } : runFixture(course, fixture as unknown as PolicyFixture);
  });
  const tally = (status: PolicyFixtureOutcome['status']) => fixtures.filter(f => f.status === status).length;
  const summary = { fixtures: fixtures.length, passed: tally('passed'), failed: tally('failed'), invalid: tally('invalid') };
  return { policyFixturesFormat: 1, course: identity, status: summary.passed === fixtures.length ? 'passed' : 'failed', summary, fixtures, issues: [] };
}
