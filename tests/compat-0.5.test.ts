import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BUNDLE_FILES, compileCourse, importCourse, packCourse, verifyCompiledCourse, verifyCourseBundle } from '../src/compiler.js';
import { SDK_VERSION, validateCourse } from '../src/index.js';

// Produced by the released 0.5.0 package (tag v0.5.0) and committed unchanged: the manifests,
// their compiled courses and `course pack` bundles. Later SDKs must keep verifying the
// bundles and recompiling the manifests byte for byte.
const fixtures = ['feature-tour', 'scaffold', 'rich'];
const read = (name: string) => readFileSync(new URL(`../fixtures/compat-0.5.0/${name}`, import.meta.url), 'utf8');
const bundle = (name: string) => Object.fromEntries(BUNDLE_FILES.map((file) => [file, read(`${name}.bundle/${file}`)]));

describe('0.5.0 compatibility', () => {
  it.each(fixtures)('%s: the 0.5.0 compiled artifact still verifies', (name) => {
    expect(verifyCompiledCourse(JSON.parse(read(`${name}.compiled.json`)))).toBe(true);
  });
  it.each(fixtures)('%s: recompiling the 0.5.0 manifest is byte-identical', (name) => {
    const course = JSON.parse(read(`${name}.course.json`));
    expect(validateCourse(course).issues).toEqual([]);
    expect(`${JSON.stringify(compileCourse(course), null, 2)}\n`).toBe(read(`${name}.compiled.json`));
  });
  it.each(fixtures)('%s: the 0.5.0 bundle verifies and imports to the original manifest', (name) => {
    const files = bundle(name);
    expect(JSON.parse(files['manifest.json']!).sdk.version).toBe('0.5.0');
    const result = verifyCourseBundle(files);
    expect(result.issues).toEqual([]);
    expect(result.valid).toBe(true);
    expect(result.warnings.map((w) => w.code)).toEqual(['DIFFERENT_SDK_VERSION']);
    expect(SDK_VERSION).not.toBe('0.5.0');
    expect(files['course.compiled.json']).toBe(read(`${name}.compiled.json`));
    expect(importCourse(files)).toEqual(JSON.parse(read(`${name}.course.json`)));
  });
  it.each(['rich', 'scaffold'])('%s: repacking keeps the compiled course bytes', (name) => {
    expect(packCourse(JSON.parse(read(`${name}.course.json`)))['course.compiled.json']).toBe(read(`${name}.compiled.json`));
  });
  it('tampering with a 0.5.0 bundle is still detected', () => {
    const files = bundle('rich');
    files['course.compiled.json'] = files['course.compiled.json']!.replace('"Pendulum timing"', '"Pendulum timing!"');
    expect(verifyCourseBundle(files).issues.map((i) => i.code)).toContain('INTEGRITY_MISMATCH');
    const compiled = JSON.parse(read('rich.compiled.json'));
    compiled.server.title = 'Changed';
    expect(verifyCompiledCourse(compiled)).toBe(false);
  });
});
