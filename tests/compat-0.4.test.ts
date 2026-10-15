import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { compileCourse, verifyCompiledCourse } from '../src/compiler.js';
import { lintCourse, publicationIssues, validateCourse } from '../src/index.js';

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
  it('lint flags legacy risks and refuses publication of a conversational gate without failing validation', () => {
    const course = JSON.parse(read('feature-tour.course.json'));
    const findings = lintCourse(course);
    expect(findings.map((w) => w.code)).toEqual(expect.arrayContaining(['LEGACY_GATE', 'LEGACY_ACTIVITY_BLOCK']));
    expect(findings.filter((w) => w.severity === 'error')).toEqual([expect.objectContaining({ code: 'CONVERSATIONAL_GATE_UNSUPPORTED', path: '/gates/2/conversationalEvaluatorId' })]);
    expect(publicationIssues(course).map((i) => i.code)).toEqual(['CONVERSATIONAL_GATE_UNSUPPORTED']);
    expect(validateCourse(course).valid).toBe(true);
  });
  it.each(fixtures.filter((name) => name !== 'feature-tour'))('%s: has no publication refusals', (name) => {
    expect(publicationIssues(JSON.parse(read(`${name}.course.json`)))).toEqual([]);
  });
});
