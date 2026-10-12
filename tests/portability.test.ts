import { build } from 'esbuild';
import { createContext, Script } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { courseFixture } from './fixture.js';
import { adaptationFixture } from './adaptation-fixture.js';

describe('portable runtime export', () => {
  it('validates under a CSP-like runtime that forbids dynamic code generation', async () => {
    const result = await build({ entryPoints: ['src/index.ts'], bundle: true, platform: 'browser', format: 'iife', globalName: 'CourseSDK', write: false });
    const context = createContext({ structuredClone, fixture: courseFixture() }, { codeGeneration: { strings: false, wasm: false } });
    new Script(result.outputFiles[0]!.text).runInContext(context);
    expect(new Script('CourseSDK.validateCourse(JSON.parse(JSON.stringify(fixture))).valid').runInContext(context)).toBe(true);
    expect(new Script('CourseSDK.getEpisodeRequirement({})').runInContext(context)).toBe('required');
    expect(new Script('CourseSDK.getEpisodeRequirement({ requirement: "optional" })').runInContext(context)).toBe('optional');
    expect(new Script(`(() => {
      const c = JSON.parse(JSON.stringify(fixture));
      c.objectives[0].critical = true; c.chapters[0].episodes[0].requirement = 'optional';
      return CourseSDK.validateCourse(c).valid;
    })()`).runInContext(context)).toBe(false);
  });
  it('resolves public research with no private context under the same CSP boundary', async () => {
    const result = await build({ entryPoints: ['src/index.ts'], bundle: true, platform: 'browser', format: 'iife', globalName: 'CourseSDK', write: false });
    const fixture = courseFixture();
    fixture.research = { publicTopics: [{ id: 'order-reference', objectiveIds: ['compare'], queryText: 'Public numerical ordering reference' }] };
    const vm = createContext({ structuredClone, fixtureJson: JSON.stringify(fixture) }, { codeGeneration: { strings: false, wasm: false } });
    new Script(result.outputFiles[0]!.text).runInContext(vm);
    expect(new Script(`CourseSDK.resolvePublicResearchRequest(JSON.parse(fixtureJson), { topicId: 'order-reference' })`).runInContext(vm))
      .toEqual({ valid: true, request: { queryText: 'Public numerical ordering reference' }, authorityAuthenticity: 'not_checked', issues: [] });
    expect(new Script(`CourseSDK.resolvePublicResearchRequest(JSON.parse(fixtureJson), { topicId: 'order-reference', history: [] }).valid`).runInContext(vm)).toBe(false);
  });
  it('hashes and checks adaptation/recipe contracts without Node, eval, or Function', async () => {
    const result = await build({ entryPoints: ['src/index.ts'], bundle: true, platform: 'browser', format: 'iife', globalName: 'CourseSDK', write: false, metafile: true });
    expect(Object.keys(result.metafile!.inputs).some(path => /(?:compiler|cli)\.ts$/.test(path))).toBe(false);
    const vm = createContext({ hostClone: structuredClone, TextEncoder, crypto: globalThis.crypto, fixtureJson: JSON.stringify(adaptationFixture()) }, { codeGeneration: { strings: false, wasm: false } });
    // Native browser cloning returns objects in the receiving realm. The host VM
    // shim must do the same; keep the SDK's strict plain-data checks unchanged.
    new Script('globalThis.structuredClone = value => JSON.parse(JSON.stringify(hostClone(value)))').runInContext(vm);
    new Script(result.outputFiles[0]!.text).runInContext(vm);
    const checked = await new Script(`(async () => {
      const f = JSON.parse(fixtureJson);
      const context = { course: f.course, baseCourseDigest: f.baseCourseDigest, plan: f.plan, registeredVerifiers: f.registeredVerifiers };
      const validation = await CourseSDK.validateCourseAdaptation(f.proposal, context);
      const recipe = await CourseSDK.instantiateNumericalRecipe(f.course.adaptation.numericalRecipes[0], {a: 7, b: 2});
      return { valid: validation.valid, trust: validation.proofAuthenticity, answer: recipe.value,
        processType: typeof process, bufferType: typeof Buffer, compilerExposed: 'compileCourse' in CourseSDK };
    })()`).runInContext(vm);
    expect(checked).toEqual({ valid: true, trust: 'not_checked', answer: 2, processType: 'undefined', bufferType: 'undefined', compilerExposed: false });
  });
});
