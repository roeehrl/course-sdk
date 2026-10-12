import { describe, expect, it } from 'vitest';
import { getEpisodeRequirement, validateCourse, type Episode } from '../src/index.js';
import { compileCourse, verifyCompiledCourse } from '../src/compiler.js';
import { validateAssignmentDecisions, validateCourseAdaptation } from '../src/adaptation.js';
import { courseFixture } from './fixture.js';
import { adaptationFixture, context } from './adaptation-fixture.js';

function episode(id: string, objectiveIds: string[], requirement?: 'required' | 'optional'): Episode {
  return { id, title: id, objectiveIds, blocks: [{ id: `${id}-text`, type: 'text', markdown: 'Synthetic public lesson.' }],
    ...(requirement === undefined ? {} : { requirement }) };
}

describe('author-owned fixed episode requirements', () => {
  it('keeps absent requirements required without changing legacy bytes, projections or digests', () => {
    const course = courseFixture(), before = structuredClone(course);
    const original = course.chapters[0]!.episodes[0]!;
    expect(getEpisodeRequirement(original)).toBe('required');
    const checked = validateCourse(course);
    expect(checked.valid).toBe(true);
    if (checked.valid) expect(checked.course).toEqual(before);
    const compiled = compileCourse(course);
    expect(compiled.digest).toBe('f242b9f5a8209ee66600cb0c80f74446a6aa257ca55191b30fed95a93b0b8c75');
    expect(compiled.server).toEqual(before);
    expect(compiled.learner.chapters[0]!.episodes[0]).not.toHaveProperty('requirement');
    expect(verifyCompiledCourse(compiled)).toBe(true);
    expect(course).toEqual(before);
  });

  it.each(['required', 'optional'] as const)('preserves explicit %s in both projections and the base digest', requirement => {
    const course = courseFixture(), prior = compileCourse(course).digest;
    course.chapters[0]!.episodes[0]!.requirement = requirement;
    const compiled = compileCourse(course);
    expect(getEpisodeRequirement(compiled.server.chapters[0]!.episodes[0]!)).toBe(requirement);
    expect(compiled.learner.chapters[0]!.episodes[0]!.requirement).toBe(requirement);
    expect(compiled.digest).not.toBe(prior);
    expect(verifyCompiledCourse(compiled)).toBe(true);
    compiled.learner.chapters[0]!.episodes[0]!.requirement = requirement === 'required' ? 'optional' : 'required';
    expect(verifyCompiledCourse(compiled)).toBe(false);
  });

  it.each(['skippable', 'Required', '', false, null, 0, {}, undefined])('rejects invalid serialized requirement %j', requirement => {
    const course = courseFixture(); Object.assign(course.chapters[0]!.episodes[0]!, { requirement });
    expect(validateCourse(course).valid).toBe(false);
    if (requirement !== undefined) expect(() => getEpisodeRequirement({ requirement } as Episode)).toThrow(TypeError);
  });

  it('rejects an alias rather than letting an unknown optional flag weaken the default', () => {
    const course = courseFixture(); Object.assign(course.chapters[0]!.episodes[0]!, { optional: true });
    expect(validateCourse(course).valid).toBe(false);
  });

  it('does not let gates, item banks or placement eligibility rescue an optional-only critical objective', () => {
    const course = courseFixture(); course.objectives[0]!.critical = true;
    course.chapters[0]!.episodes[0]!.requirement = 'optional';
    const checked = validateCourse(course);
    expect(checked).toMatchObject({ valid: false, issues: [{ code: 'OPTIONAL_ONLY_OBJECTIVE', path: '/objectives/0' }] });
    expect(() => compileCourse(course)).toThrow();
  });

  it.each(['required', 'optional'] as const)('protects a prerequisite even when its dependent episode is %s', requirement => {
    const course = courseFixture(); course.chapters[0]!.episodes[0]!.requirement = 'optional';
    course.objectives.push({ id: 'dependent', description: 'Depends on comparison.', prerequisites: ['compare'] });
    course.chapters.push({ id: 'later', title: 'Later chapter', episodes: [episode('dependent-unit', ['dependent'], requirement)] });
    expect(validateCourse(course)).toMatchObject({ valid: false, issues: [{ code: 'OPTIONAL_ONLY_OBJECTIVE', path: '/objectives/0' }] });
  });

  it('protects indirect ancestors across chapters and keeps diamond graphs valid with required coverage', () => {
    const course = courseFixture(); course.chapters[0]!.episodes[0]!.requirement = 'optional';
    course.objectives.push(
      { id: 'left', description: 'Left', prerequisites: ['compare'] },
      { id: 'right', description: 'Right', prerequisites: ['compare'] },
      { id: 'join', description: 'Join', prerequisites: ['left', 'right'] },
    );
    course.chapters.push({ id: 'later', title: 'Later', episodes: [episode('left-unit', ['left']), episode('right-unit', ['right']), episode('join-unit', ['join'])] });
    expect(validateCourse(course)).toMatchObject({ valid: false, issues: [{ code: 'OPTIONAL_ONLY_OBJECTIVE', path: '/objectives/0' }] });
    delete course.chapters[0]!.episodes[0]!.requirement;
    expect(validateCourse(course).valid).toBe(true);
  });

  it.each([undefined, 'required'] as const)('allows optional reinforcement with %s required coverage', requirement => {
    const course = courseFixture(); course.objectives[0]!.critical = true;
    course.chapters[0]!.episodes[0]!.requirement = 'optional';
    course.chapters.push({ id: 'required-section', title: 'Required', episodes: [episode('required-supply', ['compare'], requirement)] });
    expect(validateCourse(course).valid).toBe(true);
    // Relabeling the supplying objective as unrelated cannot count as coverage.
    course.objectives.push({ id: 'unrelated', description: 'Independent enrichment.', prerequisites: [] });
    course.chapters[1]!.episodes[0]!.objectiveIds = ['unrelated'];
    expect(validateCourse(course).valid).toBe(false);
  });

  it('allows independent optional enrichment without waiving existing gates, references or caps', () => {
    const course = courseFixture();
    course.objectives.push({ id: 'enrichment', description: 'Independent enrichment.', prerequisites: [] });
    course.chapters[0]!.episodes.push(episode('side-branch', ['enrichment'], 'optional'));
    expect(validateCourse(course).valid).toBe(true);
    course.chapters[0]!.episodes[1]!.gateId = 'missing';
    expect(validateCourse(course).valid).toBe(false);
    delete course.chapters[0]!.episodes[1]!.gateId;
    course.chapters[0]!.episodes[1]!.policy = { mode: 'bounded', existingMaterialAccess: 'read_only' };
    expect(validateCourse(course).valid).toBe(false);
  });

  it('preserves legacy validation for objective declarations with no assigned episode', () => {
    const course = courseFixture();
    course.objectives.push({ id: 'unassigned', description: 'Legacy declaration.', prerequisites: ['compare'], critical: true });
    expect(validateCourse(course).valid).toBe(true);
    // An explicit optional-only supply then activates the new coverage constraint.
    course.chapters[0]!.episodes.push(episode('optional-supply', ['unassigned'], 'optional'));
    expect(validateCourse(course).valid).toBe(false);
  });

  it('rejects model requirement fields and operations at every proposal boundary', async () => {
    for (const location of ['proposal', 'operation', 'artifact']) {
      const f = adaptationFixture();
      const target = location === 'proposal' ? f.proposal : location === 'operation' ? f.proposal.operations[0]! : f.proposal.artifacts[0]!;
      Object.assign(target, { requirement: 'optional' });
      expect((await validateCourseAdaptation(f.proposal, context(f))).issues.some(i => i.code === 'SCHEMA')).toBe(true);
    }
    const f = adaptationFixture();
    Object.assign(f.proposal.operations[0]!, { type: 'set_episode_requirement', requirement: 'optional' });
    expect((await validateCourseAdaptation(f.proposal, context(f))).valid).toBe(false);
  });

  it('binds requirement changes to the immutable base instead of treating them as a plan revision', async () => {
    const f = adaptationFixture(); f.course.chapters[0]!.episodes[0]!.requirement = 'optional';
    // This course is otherwise valid: the mismatch must be in its immutable binding.
    expect(validateCourse(f.course).valid).toBe(true);
    expect((await validateCourseAdaptation(f.proposal, context(f))).issues.some(i => i.code === 'BASE_DIGEST_MISMATCH')).toBe(true);
  });

  it('limits server optional classifications to generated work without reclassifying base episodes', async () => {
    const f = adaptationFixture(), before = structuredClone(f.course);
    f.assignments.forEach(assignment => { assignment.classification = 'optional'; });
    expect((await validateAssignmentDecisions(f.proposal, context(f), f.assignments)).valid).toBe(true);
    expect(f.course).toEqual(before);
    expect(getEpisodeRequirement(f.course.chapters[0]!.episodes[0]!)).toBe('required');
    f.assignments[0]!.operationId = f.course.chapters[0]!.episodes[0]!.id;
    expect((await validateAssignmentDecisions(f.proposal, context(f), f.assignments)).issues.some(i => i.code === 'ASSIGNMENT_SCOPE')).toBe(true);
  });
});
