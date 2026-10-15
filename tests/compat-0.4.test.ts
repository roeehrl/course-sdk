import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { compileCourse, verifyCompiledCourse } from '../src/compiler.js';
import { lintCourse, validateCourse } from '../src/index.js';

// These compiled files were produced by the released 0.4.0 package (tag v0.4.0) and
// committed unchanged. 0.5 must keep accepting and reproducing them byte for byte.
const fixtures = ['feature-tour', 'ordering', 'language', 'plant-observations'];
const read = (name: string) => readFileSync(new URL(`../fixtures/compat-0.4.0/${name}`, import.meta.url), 'utf8');

describe('0.4.0 compatibility', () => {
  it.each(fixtures)('%s: the 0.4.0 compiled artifact still verifies', (name) => {
    expect(verifyCompiledCourse(JSON.parse(read(`${name}.compiled.json`)))).toBe(true);
  });
  it.each(fixtures)('%s: recompiling the 0.4.0 manifest is byte-identical', (name) => {
    const course = JSON.parse(read(`${name}.course.json`));
    expect(validateCourse(course).issues).toEqual([]);
    expect(`${JSON.stringify(compileCourse(course), null, 2)}\n`).toBe(read(`${name}.compiled.json`));
  });
  it('tampering with a 0.4.0 artifact is still detected', () => {
    const compiled = JSON.parse(read('feature-tour.compiled.json'));
    compiled.learner.gates[0].minimumIndependentFamilies = 1;
    expect(verifyCompiledCourse(compiled)).toBe(false);
  });
  it('lint flags legacy recognition and conversational risks without failing validation', () => {
    const course = JSON.parse(read('feature-tour.course.json'));
    const codes = lintCourse(course).map((w) => w.code);
    expect(codes).toEqual(expect.arrayContaining(['LEGACY_GATE', 'LEGACY_CONVERSATIONAL_GATE', 'LEGACY_ACTIVITY_BLOCK']));
    expect(validateCourse(course).valid).toBe(true);
  });
});
