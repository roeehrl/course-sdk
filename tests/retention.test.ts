import { describe, expect, it } from 'vitest';
import { compileCourse, CourseValidationError } from '../src/compiler.js';
import { validateCourse } from '../src/validate.js';
import { courseFixture } from './fixture.js';

function withRetention() {
  const course = courseFixture();
  course.assessments.push({ id: 'later-min', type: 'numeric', objectiveIds: ['compare'], familyId: 'delayed', prompt: 'Enter the smaller number in 12 and 7.', grading: { expected: 7, absoluteTolerance: 0, explanation: 'Seven is smaller.' } });
  course.retention = { intervalsDays: [1, 3, 7, 21], objectiveIds: ['compare'], assessmentIds: ['later-min'] };
  return course;
}
const codes = (course: unknown) => {
  const result = validateCourse(course);
  return result.valid ? [] : result.issues.map((issue) => issue.code);
};

describe('retention policy', () => {
  it('accepts held-out delayed items and gives learners the schedule only', () => {
    const compiled = compileCourse(withRetention());
    expect(compiled.learner.retention).toEqual({ intervalsDays: [1, 3, 7, 21], objectiveIds: ['compare'] });
    expect(JSON.stringify(compiled.learner)).not.toContain('later-min');
    expect(compiled.server.retention?.assessmentIds).toEqual(['later-min']);
  });
  it('rejects reused, uncovered or unordered retention definitions', () => {
    const reused = withRetention(); reused.retention!.assessmentIds.push('pair-a');
    expect(codes(reused)).toContain('RETENTION_ITEM_NOT_HELD_OUT');
    const uncovered = withRetention(); uncovered.objectives.push({ id: 'other', description: 'Other.', prerequisites: [], placeable: false }); uncovered.retention!.objectiveIds.push('other');
    expect(codes(uncovered)).toContain('UNCOVERED_RETENTION_OBJECTIVE');
    for (const intervals of [[3, 1], [1, 1], [0, 2], [1.5]]) {
      const bad = withRetention(); bad.retention!.intervalsDays = intervals;
      expect(codes(bad), JSON.stringify(intervals)).not.toEqual([]);
    }
    const missing = withRetention(); missing.retention!.assessmentIds = ['nope'];
    expect(() => compileCourse(missing)).toThrow(CourseValidationError);
  });
});
