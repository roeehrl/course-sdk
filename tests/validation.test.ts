import { describe, expect, it } from 'vitest';
import { validateCourse, defineCourse } from '../src/index.js';
import { courseFixture } from './fixture.js';

function codes(value: unknown) { return validateCourse(value).issues.map((issue) => issue.code); }

describe('portable course validation', () => {
  it('accepts a real coherent course and returns a detached snapshot', () => {
    const input = courseFixture(); const result = validateCourse(input);
    expect(result.valid).toBe(true);
    if (result.valid) result.course.chapters[0]!.title = 'changed';
    expect(input.chapters[0]!.title).toBe('Ordering');
  });
  it('authoring helpers do not retain mutable caller references', () => {
    const input = courseFixture(); const authored = defineCourse(input); input.title = 'changed';
    expect(authored.title).toBe('Sorting basics');
  });
  it.each([NaN, Infinity, undefined, () => 1, BigInt(1), new Date()])('rejects non-JSON data instead of silently changing it', (invalid) => {
    expect(codes({ ...courseFixture(), summary: invalid })).toContain('NOT_JSON');
  });
  it('rejects a cyclic object without overflowing', () => {
    const input: Record<string, unknown> = {}; input.loop = input;
    expect(codes(input)).toContain('NOT_JSON');
  });
  it('rejects sparse arrays', () => {
    const input = courseFixture(); input.sources = new Array(2);
    expect(codes(input)).toContain('NOT_JSON');
  });
  it('rejects unknown fields and invalid calendar dates', () => {
    expect(codes({ ...courseFixture(), secretInternalField: true })).toContain('SCHEMA');
    const input = courseFixture(); input.policy.hardDeadline = '2026-02-30T12:00:00Z';
    expect(codes(input)).toContain('SCHEMA');
  });
  it('rejects duplicate identifiers and dangling references', () => {
    const input = courseFixture(); input.objectives.push(structuredClone(input.objectives[0]!));
    input.chapters[0]!.episodes[0]!.objectiveIds.push('missing');
    expect(codes(input)).toEqual(expect.arrayContaining(['DUPLICATE_ID', 'MISSING_REFERENCE']));
  });
  it('detects prerequisite cycles, including self-dependencies', () => {
    const input = courseFixture(); input.objectives[0]!.prerequisites = ['compare'];
    expect(codes(input)).toContain('PREREQUISITE_CYCLE');
  });
  it('accepts a diamond prerequisite graph', () => {
    const input = courseFixture(); input.objectives.push(
      { id: 'left', description: 'left', prerequisites: ['compare'] },
      { id: 'right', description: 'right', prerequisites: ['compare'] },
      { id: 'join', description: 'join', prerequisites: ['left', 'right'] },
    );
    expect(validateCourse(input).valid).toBe(true);
  });
  it('rejects a choice key that is not an option', () => {
    const input = courseFixture(); const item = input.assessments[0]!;
    if (item.type === 'choice') item.grading.correctOptionId = 'missing';
    expect(codes(input)).toContain('INVALID_ANSWER_KEY');
  });
  it('does not count two items from the same family as independent families', () => {
    const input = courseFixture(); input.assessments[1]!.familyId = input.assessments[0]!.familyId;
    expect(codes(input)).toContain('INSUFFICIENT_ITEM_FAMILIES');
  });
  it('rejects an uncovered episode objective even when the gate itself is valid', () => {
    const input = courseFixture(); input.objectives.push({ id: 'extra', description: 'Extra', prerequisites: [] });
    input.chapters[0]!.episodes[0]!.objectiveIds.push('extra');
    expect(codes(input)).toContain('GATE_SCOPE_MISMATCH');
  });
  it('requires an actual bound and valid time zone', () => {
    const input = courseFixture(); delete input.policy.window;
    expect(codes(input)).toContain('UNBOUNDED_POLICY');
    input.policy.window = { calendarDays: 1, timeZone: 'Not/AZone', anchor: 'enrollment_started', pauseRule: 'never' };
    expect(codes(input)).toContain('INVALID_TIME_ZONE');
  });
  it('accepts explicit open-ended pedagogy', () => {
    const input = courseFixture(); input.policy = { mode: 'open_ended', existingMaterialAccess: 'read_only' };
    expect(validateCourse(input).valid).toBe(true);
  });
  it('requires explicit learner acceptance for extensions', () => {
    const input = courseFixture() as unknown as Record<string, unknown>;
    input.policy = { mode: 'bounded', hardDeadline: '2026-12-01T00:00:00Z', existingMaterialAccess: 'read_only', extensions: { enabled: true, calendarDays: 3, maxGrants: 1, maxDaysPerGrant: 3, learnerAcceptanceRequired: false } };
    expect(codes(input)).toContain('SCHEMA');
  });
  it('requires placement opt-in eligibility and item coverage', () => {
    const input = courseFixture(); input.objectives[0]!.placeable = false;
    expect(codes(input)).toContain('NON_PLACEABLE_OBJECTIVE');
    input.placement!.assessmentIds = [];
    expect(codes(input)).toContain('UNCOVERED_PLACEMENT_OBJECTIVE');
  });
  it('rejects unsafe source protocols', () => {
    const input = courseFixture(); input.sources = [{ id: 'bad', title: 'Bad', url: 'javascript:alert(1)', reviewedAt: '2026-10-12T00:00:00Z' }];
    expect(codes(input)).toContain('UNSAFE_URL');
  });
});
