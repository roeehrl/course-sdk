import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { compileCourse, CourseBundleError, CourseValidationError, importCourse, packCourse, verifyCompiledCourse, verifyCourseBundle, BUNDLE_FILES } from '../src/compiler.js';
import { CoursePackageError, packCoursePackage, verifyCoursePackage } from '../src/course-package.js';
import { validateCourse } from '../src/index.js';
import type { CourseManifest } from '../src/types.js';
import { courseFixture } from './fixture.js';

// Fixed seed and bounded runs: failures are reproducible and the suite stays fast.
const runs = { seed: 4207, numRuns: 60 } as const;
const safeText = (max: number) => fc.string({ minLength: 1, maxLength: max, unit: fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz ABCXYZ0123456789.,;:!?()-éßπ漢'.split('')) })
  .filter((s) => s.trim().length > 0);

/** Valid courses: the public fixture with generated text, values, extra text episodes and objectives. */
const course: fc.Arbitrary<CourseManifest> = fc.record({
  title: safeText(80), summary: safeText(200), version: fc.tuple(fc.nat(9), fc.nat(9), fc.nat(9)).map((v) => v.join('.')),
  expected: fc.integer({ min: -1000, max: 1000 }), tolerance: fc.integer({ min: 0, max: 5 }),
  extra: fc.array(fc.array(safeText(400), { minLength: 1, maxLength: 3 }), { maxLength: 6 }),
  objectives: fc.array(safeText(120), { maxLength: 3 }),
}).map(({ title, summary, version, expected, tolerance, extra, objectives }) => {
  const c = courseFixture();
  Object.assign(c, { title, summary, version });
  const numeric = c.assessments.find((a) => a.type === 'numeric')!;
  Object.assign(numeric, { prompt: `Enter ${expected}.`, grading: { expected, absoluteTolerance: tolerance, explanation: `The value is ${expected}.` } });
  objectives.forEach((description, i) => c.objectives.push({ id: `extra-objective-${i}`, description, prerequisites: ['compare'], placeable: false }));
  c.chapters[0]!.episodes.push(...extra.map((blocks, i) => ({
    id: `reading-${i}`, title: `Reading ${i}`, objectiveIds: ['compare'],
    blocks: blocks.map((markdown, j) => ({ id: `reading-${i}-${j}`, type: 'text' as const, markdown })),
  })));
  return c;
});

/** A different character at one position: the smallest possible edit. */
const edit = (text: string, at: number, replacement: string) => {
  const i = at % text.length;
  const next = replacement === text[i] ? (text[i] === 'x' ? 'y' : 'x') : replacement;
  return text.slice(0, i) + next + text.slice(i + 1);
};

describe('property: validate, compile, pack and verify round trips', () => {
  it('every generated course validates, compiles deterministically and verifies', () => {
    fc.assert(fc.property(course, (c) => {
      const result = validateCourse(c);
      expect(result.valid).toBe(true);
      const compiled = compileCourse(structuredClone(c));
      expect(compileCourse(structuredClone(c))).toEqual(compiled);
      expect(verifyCompiledCourse(compiled)).toBe(true);
      expect(compiled.server).toEqual(result.valid ? result.course : undefined);
    }), runs);
  });

  it('a content change changes the digest, and a forged digest does not verify', () => {
    fc.assert(fc.property(course, safeText(80), (c, title) => {
      fc.pre(title !== c.title);
      const a = compileCourse(c), b = compileCourse({ ...structuredClone(c), title });
      expect(b.digest).not.toBe(a.digest);
      expect(verifyCompiledCourse({ ...b, digest: a.digest })).toBe(false);
      expect(verifyCompiledCourse({ ...a, server: b.server })).toBe(false);
    }), runs);
  });

  it('a packed bundle verifies and imports back to the validated course', () => {
    fc.assert(fc.property(course, (c) => {
      const files = packCourse(c);
      expect(packCourse(structuredClone(c))).toEqual(files);
      expect(verifyCourseBundle(files)).toMatchObject({ valid: true, issues: [] });
      const validated = validateCourse(c);
      expect(importCourse(files)).toEqual(validated.valid ? validated.course : undefined);
    }), runs);
  });

  it('any one-character edit to any bundle file is detected', () => {
    fc.assert(fc.property(course, fc.constantFrom(...BUNDLE_FILES), fc.nat(), fc.constantFrom('0', 'a', '"', '}', ' ', 'Z'), (c, name, at, replacement) => {
      const files = packCourse(c);
      const tampered = { ...files, [name]: edit(files[name]!, at, replacement) };
      expect(tampered[name]).not.toBe(files[name]);
      expect(verifyCourseBundle(tampered).valid).toBe(false);
      expect(() => importCourse(tampered)).toThrow(CourseBundleError);
    }), runs);
  });

  it('a course package verifies to the compiler digest and the same manifest', () => {
    fc.assert(fc.property(course, (c) => {
      const bytes = packCoursePackage({ manifest: c });
      expect(packCoursePackage({ manifest: structuredClone(c) })).toEqual(bytes);
      const verified = verifyCoursePackage(bytes);
      expect(verified.courseDigest).toBe(compileCourse(c).digest);
      expect(verified.courseManifest).toEqual(c);
    }), runs);
  });

  it('flipping any byte of a course package is refused or leaves the verified content unchanged', () => {
    fc.assert(fc.property(course, fc.nat(), fc.integer({ min: 1, max: 255 }), (c, at, mask) => {
      const bytes = packCoursePackage({ manifest: c });
      const original = verifyCoursePackage(bytes);
      const tampered = Uint8Array.from(bytes);
      tampered[at % tampered.length]! ^= mask;
      let verified;
      try { verified = verifyCoursePackage(tampered); } catch (error) {
        // Corrupt compression surfaces as a stable package error, never as a crash or a different course.
        expect(error).toBeInstanceOf(CoursePackageError);
        return;
      }
      // Only bytes no reader interprets (gzip header metadata) may change without refusal.
      expect(verified.courseDigest).toBe(original.courseDigest);
      expect(verified.members).toEqual(original.members);
    }), { ...runs, numRuns: 200 });
  });

  it('a structurally or semantically broken course never compiles or packs', () => {
    const breakers: ((c: CourseManifest) => void)[] = [
      (c) => { (c.gates[0] as { assessmentIds: string[] }).assessmentIds.push('missing-assessment'); },
      (c) => { c.objectives[0]!.prerequisites.push('compare'); },
      (c) => { c.chapters[0]!.episodes.push(structuredClone(c.chapters[0]!.episodes[0]!)); },
      (c) => { (c as { title: unknown }).title = ''; },
      (c) => { c.placement!.assessmentIds = ['unknown']; },
    ];
    fc.assert(fc.property(course, fc.constantFrom(...breakers.keys()), (c, which) => {
      const broken = structuredClone(c);
      breakers[which]!(broken);
      expect(validateCourse(broken).valid).toBe(false);
      expect(() => compileCourse(broken)).toThrow(CourseValidationError);
      expect(() => packCourse(broken)).toThrow();
      expect(() => packCoursePackage({ manifest: broken })).toThrow();
    }), runs);
  });
});
