import { build } from 'esbuild';
import { createContext, Script } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { courseFixture } from './fixture.js';

describe('portable runtime export', () => {
  it('validates under a CSP-like runtime that forbids dynamic code generation', async () => {
    const result = await build({ entryPoints: ['src/index.ts'], bundle: true, platform: 'browser', format: 'iife', globalName: 'CourseSDK', write: false });
    const context = createContext({ structuredClone, fixture: courseFixture() }, { codeGeneration: { strings: false, wasm: false } });
    new Script(result.outputFiles[0]!.text).runInContext(context);
    expect(new Script('CourseSDK.validateCourse(JSON.parse(JSON.stringify(fixture))).valid').runInContext(context)).toBe(true);
  });
});
