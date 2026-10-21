import { describe, expect, it } from 'vitest';
import { addCalendarDays, policyScopes, resolveCoursePolicy, runPolicyFixtures } from '../src/index.js';
import type { CourseManifest, PolicyFixture } from '../src/index.js';
import { richCourse } from './contracts-fixture.js';

/** richCourse with a deadline, a calendar window and extensions on the course, and tighter caps lower down. */
function course(): CourseManifest {
  const c = richCourse();
  c.policy = { mode: 'bounded', hardDeadline: '2026-06-30T00:00:00Z', targetDate: '2026-05-01T00:00:00Z',
    window: { calendarDays: 14, timeZone: 'America/New_York', anchor: 'scope_started', pauseRule: 'approved_only' },
    work: { additionalEpisodes: 4, remediationCyclesPerConcept: 3 },
    extensions: { enabled: true, calendarDays: 10, maxGrants: 2, maxDaysPerGrant: 7, learnerAcceptanceRequired: true }, existingMaterialAccess: 'read_only' };
  c.chapters[0]!.policy = { mode: 'bounded', work: { additionalEpisodes: 2, additionalMinutes: 90 }, existingMaterialAccess: 'read_only' };
  c.chapters[0]!.episodes[1]!.policy = { mode: 'bounded', work: { additionalEpisodes: 0 }, extensions: { enabled: true, calendarDays: 20, maxGrants: 5, maxDaysPerGrant: 3, learnerAcceptanceRequired: true },
    existingMaterialAccess: 'closed' };
  return c;
}
const file = (...fixtures: unknown[]) => ({ policyFixturesFormat: 1, fixtures });
// 2026-03-01 09:00 EST; 14 calendar days later crosses the 8 March DST change, so the deadline is 09:00 EDT.
const anchors = { scope_started: '2026-03-01T14:00:00Z' };

describe('policy resolution', () => {
  it('intersects course, chapter and episode policies; children never remove ancestor limits', () => {
    const c = course();
    expect(policyScopes(c)).toEqual(['course', 'chapter:swing', 'episode:timing', 'episode:length']);
    const episode = resolveCoursePolicy(c, 'episode:length');
    expect(episode.path).toEqual(['course', 'chapter:swing', 'episode:length']);
    expect(episode.hardDeadline).toEqual({ at: '2026-06-30T00:00:00Z', scope: 'course' });
    expect(episode.windows).toEqual([{ scope: 'course', calendarDays: 14, timeZone: 'America/New_York', anchor: 'scope_started', pauseRule: 'approved_only' }]);
    // Zero is a real cap; an omitted field means no cap at that scope, so the ancestor value binds.
    expect(episode.work).toEqual({ additionalEpisodes: { cap: 0, scope: 'episode:length' }, additionalMinutes: { cap: 90, scope: 'chapter:swing' },
      remediationCyclesPerConcept: { cap: 3, scope: 'course' } });
    // A more generous child allowance cannot widen the course's.
    expect(episode.extensions).toEqual({ enabled: true, calendarDays: 10, maxGrants: 2, maxDaysPerGrant: 3, scopes: ['course', 'episode:length'] });
    expect(episode.existingMaterialAccess).toBe('closed');
    expect(resolveCoursePolicy(c, 'episode:timing').existingMaterialAccess).toBe('read_only');
    expect(resolveCoursePolicy(c).targetDate).toBe('2026-05-01T00:00:00Z');
    expect(() => resolveCoursePolicy(c, 'episode:missing')).toThrow(RangeError);
  });

  it('adds calendar days on the local clock across DST changes, choosing like Temporal "compatible"', () => {
    expect(addCalendarDays('2026-03-01T14:00:00Z', 14, 'America/New_York')).toBe('2026-03-15T13:00:00.000Z');
    expect(addCalendarDays('2026-03-01T14:00:00Z', 14, 'UTC')).toBe('2026-03-15T14:00:00.000Z');
    // 02:30 on 8 March 2026 does not exist in New York: the later instant (03:30 EDT).
    expect(addCalendarDays('2026-03-07T07:30:00Z', 1, 'America/New_York')).toBe('2026-03-08T07:30:00.000Z');
    // 01:30 on 1 November 2026 happens twice: the earlier (EDT) one.
    expect(addCalendarDays('2026-10-31T05:30:00Z', 1, 'America/New_York')).toBe('2026-11-01T05:30:00.000Z');
    expect(() => addCalendarDays('2026-03-01', 1, 'UTC')).toThrow(RangeError);
  });
});

describe('policy fixtures', () => {
  it('runs deadline, work, extension and admin scenarios and reports each outcome', () => {
    const fixtures: PolicyFixture[] = [{
      id: 'deadline', scope: 'chapter:swing', anchors,
      steps: [
        { kind: 'action', action: 'submit', at: '2026-03-15T12:59:59Z', expect: 'allowed' },
        // Deadlines are exclusive: the exact cutoff is late.
        { kind: 'action', action: 'submit', at: '2026-03-15T13:00:00Z', expect: 'denied', reason: 'DEADLINE_PASSED' },
        { kind: 'action', action: 'read', at: '2026-04-01T00:00:00Z', expect: 'allowed' },
        { kind: 'extension', days: 7, expect: 'granted' },
        { kind: 'action', action: 'submit', at: '2026-03-15T13:00:00Z', expect: 'allowed' },
        { kind: 'extension', days: 4, expect: 'denied', reason: 'EXTENSION_ALLOWANCE_EXHAUSTED' },
        { kind: 'extension', days: 8, expect: 'denied', reason: 'EXTENSION_TOO_LONG' },
        { kind: 'extension', days: 3, expect: 'granted' },
        { kind: 'extension', days: 1, expect: 'denied', reason: 'EXTENSION_GRANTS_EXHAUSTED' },
      ],
    }, {
      id: 'work', scope: 'chapter:swing', anchors,
      steps: [
        { kind: 'work', use: { additionalEpisodes: 2 }, expect: 'allowed' },
        { kind: 'work', use: { additionalEpisodes: 1 }, expect: 'denied', reason: 'WORK_CAP_EXCEEDED' },
        { kind: 'work', use: { additionalMinutes: 90, remediationCyclesPerConcept: 3 }, expect: 'allowed' },
      ],
    }, {
      id: 'closed-episode', scope: 'episode:length', anchors,
      steps: [
        { kind: 'work', use: { additionalEpisodes: 1 }, expect: 'denied', reason: 'WORK_CAP_EXCEEDED' },
        { kind: 'action', action: 'read', at: '2026-03-20T00:00:00Z', expect: 'denied', reason: 'MATERIAL_CLOSED' },
      ],
    }, {
      id: 'admin', scope: 'course', anchors,
      steps: [
        { kind: 'admin', sectionId: 'lab-settings', settingId: 'units', scope: 'course', value: 'imperial', granted: ['course.read', 'course.settings.write'], expect: 'allowed' },
        { kind: 'admin', sectionId: 'lab-settings', settingId: 'units', scope: 'course', value: 'imperial', granted: ['course.read'], expect: 'denied', reason: 'ADMIN_PERMISSION_DENIED' },
        { kind: 'admin', sectionId: 'lab-settings', settingId: 'max-length', scope: 'course', value: 11, granted: ['course.read', 'course.settings.write'], expect: 'denied', reason: 'INVALID_SETTING_VALUE' },
      ],
    }];
    const report = runPolicyFixtures(course(), file(...fixtures));
    expect(report.fixtures.flatMap(f => f.steps.filter(s => !s.passed))).toEqual([]);
    expect(report).toMatchObject({ status: 'passed', course: { id: 'pendulum-lab' }, summary: { fixtures: 4, passed: 4, failed: 0, invalid: 0 } });
    expect(report.fixtures[0]!.deadline).toEqual({ at: '2026-03-15T13:00:00.000Z', scope: 'course' });
    expect(report.fixtures[0]!.steps[3]!.detail).toContain('Deadline 2026-03-22T13:00:00.000Z');
    // Deterministic: the same inputs give the same report.
    expect(runPolicyFixtures(course(), file(...fixtures))).toEqual(report);
  });

  it('reports a scenario whose outcome differs from the expectation', () => {
    const report = runPolicyFixtures(course(), file({ id: 'wrong', scope: 'course', anchors, steps: [
      { kind: 'action', action: 'progress', at: '2026-07-01T00:00:00Z', expect: 'allowed' },
      { kind: 'work', use: { additionalEpisodes: 4 }, expect: 'allowed', reason: 'WORK_CAP_EXCEEDED' },
    ] }));
    expect(report.status).toBe('failed');
    expect(report.fixtures[0]!.steps.map(s => [s.actual, s.reason, s.passed])).toEqual([['denied', 'DEADLINE_PASSED', false], ['allowed', null, false]]);
  });

  it('handles open-ended scopes and missing allowances', () => {
    const c = richCourse(); // no deadline, no window, no extensions
    const report = runPolicyFixtures(c, file({ id: 'open', scope: 'course', steps: [
      { kind: 'action', action: 'submit', at: '2099-01-01T00:00:00Z', expect: 'allowed' },
      { kind: 'extension', days: 1, expect: 'denied', reason: 'EXTENSIONS_DISABLED' },
    ] }));
    expect(report.status).toBe('passed');
    expect(report.fixtures[0]!.steps[0]!.detail).toBe('No deadline applies.');
  });

  it.each([
    ['a non-file', { fixtures: [] }, 'INVALID_FIXTURE'],
    ['no fixtures', file(), 'INVALID_FIXTURE'],
  ])('rejects %s', (_name, input, code) => {
    const report = runPolicyFixtures(course(), input);
    expect(report.status).toBe('failed');
    expect(report.issues[0]!.code).toBe(code);
  });

  it.each([
    ['an unknown scope', { id: 'x', scope: 'episode:nope', steps: [{ kind: 'work', use: { additionalEpisodes: 1 }, expect: 'allowed' }] }, '/fixtures/0/scope'],
    ['a date without a zone', { id: 'x', scope: 'course', anchors, steps: [{ kind: 'action', action: 'submit', at: '2026-03-02', expect: 'allowed' }] }, '/fixtures/0/steps/0/at'],
    ['an unknown anchor', { id: 'x', scope: 'course', anchors: { enrolled: '2026-03-01T00:00:00Z' }, steps: [{ kind: 'extension', days: 1, expect: 'granted' }] }, '/fixtures/0/anchors/enrolled'],
    ['a negative work amount', { id: 'x', scope: 'course', steps: [{ kind: 'work', use: { additionalEpisodes: -1 }, expect: 'allowed' }] }, '/fixtures/0/steps/0/use/additionalEpisodes'],
    ['zero extension days', { id: 'x', scope: 'course', steps: [{ kind: 'extension', days: 0, expect: 'granted' }] }, '/fixtures/0/steps/0/days'],
    ['an unknown admin section', { id: 'x', scope: 'course', steps: [{ kind: 'admin', sectionId: 'nope', settingId: 'units', scope: 'course', value: 1, granted: [], expect: 'denied' }] }, '/fixtures/0/steps/0/sectionId'],
    ['an unknown step kind', { id: 'x', scope: 'course', steps: [{ kind: 'teleport', expect: 'allowed' }] }, '/fixtures/0/steps/0/kind'],
    ['a lower-case reason', { id: 'x', scope: 'course', steps: [{ kind: 'extension', days: 1, expect: 'denied', reason: 'nope' }] }, '/fixtures/0/steps/0/reason'],
  ])('marks a fixture with %s invalid', (_name, fixture, path) => {
    const report = runPolicyFixtures(course(), file(fixture));
    expect(report.fixtures[0]!.status).toBe('invalid');
    expect(report.fixtures[0]!.issues.map(i => i.path)).toContain(path);
  });

  it('needs the anchor a calendar window counts from, and rejects duplicate IDs and an invalid course', () => {
    const missing = runPolicyFixtures(course(), file({ id: 'x', scope: 'course', steps: [{ kind: 'action', action: 'submit', at: '2026-03-02T00:00:00Z', expect: 'allowed' }] }));
    expect(missing.fixtures[0]).toMatchObject({ status: 'invalid', issues: [{ code: 'ANCHOR_MISSING', path: '/anchors/scope_started' }] });
    const step = { kind: 'work', use: { additionalEpisodes: 1 }, expect: 'allowed' };
    const twice = runPolicyFixtures(course(), file({ id: 'x', scope: 'course', anchors, steps: [step] }, { id: 'x', scope: 'course', anchors, steps: [step] }));
    expect(twice.fixtures[1]!.issues.map(i => i.code)).toContain('DUPLICATE_ID');
    const broken = course(); broken.chapters[0]!.episodes[0]!.objectiveIds = ['missing'];
    expect(runPolicyFixtures(broken, file()).issues[0]!.path).toMatch(/^\/course\//);
  });
});
