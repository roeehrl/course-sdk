import { describe, expect, it } from 'vitest';
import { canonicalJson, compileCourse, CourseValidationError, verifyCompiledCourse } from '../src/compiler.js';
import { courseFixture } from './fixture.js';

describe('compiler and learner boundary', () => {
  it('produces stable identities independent of object key insertion order', () => {
    const input = courseFixture();
    const reordered = Object.fromEntries(Object.entries(input).reverse());
    expect(compileCourse(input).digest).toBe(compileCourse(reordered).digest);
    expect(canonicalJson([1, 2])).not.toBe(canonicalJson([2, 1]));
  });
  it('changes identity when an answer key or teaching content changes', () => {
    const input = courseFixture(); const original = compileCourse(input).digest;
    const item = input.assessments[1]!; if (item.type === 'numeric') item.grading.expected = 5;
    expect(compileCourse(input).digest).not.toBe(original);
  });
  it('does not publish answer keys, item prompts or hidden placement bank references', () => {
    const input = courseFixture(); const compiled = compileCourse(input);
    const learner = JSON.stringify(compiled.learner);
    expect(learner).not.toContain('correctOptionId');
    expect(learner).not.toContain('absoluteTolerance');
    expect(learner).not.toContain(input.assessments[0]!.prompt);
    expect(compiled.learner.placement).not.toHaveProperty('assessmentIds');
    expect(compiled.server.assessments[0]).toHaveProperty('grading');
  });
  it('detects tampering in either artifact half, not just its claimed digest', () => {
    const compiled = compileCourse(courseFixture());
    expect(verifyCompiledCourse(compiled)).toBe(true);
    const changed = structuredClone(compiled); changed.learner.title = 'changed';
    expect(verifyCompiledCourse(changed)).toBe(false);
    changed.learner.title = compiled.learner.title; changed.server.summary = 'changed';
    expect(verifyCompiledCourse(changed)).toBe(false);
    expect(verifyCompiledCourse({ ...compiled, extra: true })).toBe(false);
  });
  it('refuses invalid input before compilation', () => {
    expect(() => compileCourse({})).toThrow(CourseValidationError);
  });
});
