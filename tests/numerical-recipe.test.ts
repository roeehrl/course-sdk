import { describe, expect, it } from 'vitest';
import { checkNumericalReference, evaluateNumericalRecipe, instantiateNumericalRecipe, numericalTemplateIssues } from '../src/numerical-recipe.js';
import { digestJson } from '../src/integrity.js';
import { adaptationFixture, context, reseal } from './adaptation-fixture.js';
import { validateCourseAdaptation } from '../src/adaptation.js';
import type { NumericalExpression, NumericalReferencePort, TeachingArtifact } from '../src/adaptation-types.js';

describe('bounded numerical author recipes', () => {
  it('uses author templates, variables and exact hashes without executing source strings', async () => {
    const template = adaptationFixture().course.adaptation!.numericalRecipes[0]!;
    const result = await instantiateNumericalRecipe(template, { a: 9, b: 3 });
    expect(result.value).toBe(3); expect(result.prompt).toBe('Enter the smaller of 9 and 3.'); expect(result.steps).toBe(3);
    expect(result.instance.templateDigest).toBe(await digestJson(template));
    expect((await evaluateNumericalRecipe(template, result.instance)).value).toBe(3);
  });
  it.each([{ a: -1, b: 2 }, { a: 101, b: 2 }, { a: 2.5, b: 3 }, { a: 1 }, { a: 1, b: 2, c: 3 }, { a: NaN, b: 2 }, { a: Infinity, b: 2 }])('rejects out-of-bounds, missing, extra or nonfinite variables: %j', async variables => {
    const template = adaptationFixture().course.adaptation!.numericalRecipes[0]!;
    await expect(instantiateNumericalRecipe(template, variables)).rejects.toThrow();
  });
  it('rejects changed source templates and stale template versions/digests', async () => {
    const template = adaptationFixture().course.adaptation!.numericalRecipes[0]!;
    const { instance } = await instantiateNumericalRecipe(template, { a: 1, b: 2 });
    for (const change of [{ version: '2.0.0' }, { promptTemplate: 'Changed {{a}} and {{b}}' }]) {
      await expect(evaluateNumericalRecipe({ ...template, ...change }, instance)).rejects.toThrow();
    }
    await expect(evaluateNumericalRecipe(template, { ...instance, templateDigest: '0'.repeat(64) })).rejects.toThrow();
  });
  it('bounds AST nodes, depth, domain and intermediate results', async () => {
    const template = structuredClone(adaptationFixture().course.adaptation!.numericalRecipes[0]!);
    template.maxNodes = 2; expect(numericalTemplateIssues(template).length).toBeGreaterThan(0);
    template.maxNodes = 100; template.maxDepth = 1; expect(numericalTemplateIssues(template).length).toBeGreaterThan(0);
    template.maxDepth = 8; template.expression = { type: 'binary', operator: 'divide', left: { type: 'variable', name: 'a' }, right: { type: 'variable', name: 'b' } };
    await expect(instantiateNumericalRecipe(template, { a: 1, b: 0 })).rejects.toThrow();
    template.expression.operator = 'multiply'; template.maxAbsoluteValue = 100;
    await expect(instantiateNumericalRecipe(template, { a: 100, b: 100 })).rejects.toThrow();
  });
  it('rejects arbitrary calls, property access, unknown fields, undeclared variables and template expressions', () => {
    const template = adaptationFixture().course.adaptation!.numericalRecipes[0]!;
    for (const expression of [{ type: 'call', name: 'fetch' }, { type: 'variable', name: 'a.constructor' }, { type: 'variable', name: 'missing' }, { type: 'constant', value: 2, source: 'eval(1)' }]) {
      expect(numericalTemplateIssues({ ...template, expression }).length).toBeGreaterThan(0);
    }
    expect(numericalTemplateIssues({ ...template, promptTemplate: '{{a+1}}' }).length).toBeGreaterThan(0);
    expect(numericalTemplateIssues({ ...template, variables: [...template.variables, template.variables[0]!] }).length).toBeGreaterThan(0);
  });
  it('keeps reference execution in an explicit independently selected port, never minting a proof', async () => {
    const template = adaptationFixture('plant-observations').course.adaptation!.numericalRecipes[0]!;
    const { instance } = await instantiateNumericalRecipe(template, { start: 12, end: 18, days: 3 });
    let inputs: unknown;
    const reference: NumericalReferencePort = { verifierId: template.referenceCheck.verifierId, verifierVersion: template.referenceCheck.verifierVersion, checkId: template.referenceCheck.checkId,
      async evaluate(input) { inputs = input; return (input.variables.end! - input.variables.start!) / input.variables.days!; } };
    const result = await checkNumericalReference(template, instance, reference);
    expect(result).toEqual({ value: 2, referenceValue: 2, matched: true, proofAuthenticity: 'not_checked' });
    expect(inputs).not.toHaveProperty('expected'); expect(result).not.toHaveProperty('receipt');
    expect((await checkNumericalReference(template, instance, { ...reference, evaluate: async () => 7 })).matched).toBe(false);
    await expect(checkNumericalReference(template, instance, { ...reference, evaluate: async () => NaN })).rejects.toThrow();
    await expect(checkNumericalReference(template, instance, { ...reference, verifierVersion: '99.0.0' })).rejects.toThrow();
    const controller = new AbortController(); controller.abort();
    await expect(checkNumericalReference(template, instance, reference, { signal: controller.signal })).rejects.toThrow('aborted');
  });
  it('checks every supported arithmetic operator and finite negative results', async () => {
    const source = adaptationFixture().course.adaptation!.numericalRecipes[0]!;
    for (const [operator, expected] of [['add', 10], ['subtract', 6], ['multiply', 16], ['divide', 4], ['min', 2], ['max', 8]] as const) {
      const template = { ...source, expression: { type: 'binary', operator, left: { type: 'variable', name: 'a' }, right: { type: 'variable', name: 'b' } } as NumericalExpression };
      expect((await instantiateNumericalRecipe(template, { a: 8, b: 2 })).value).toBe(expected);
    }
    const template = { ...source, expression: { type: 'unary', operator: 'abs', value: { type: 'unary', operator: 'negate', value: { type: 'constant', value: 7 } } } as NumericalExpression };
    expect((await instantiateNumericalRecipe(template, { a: 8, b: 2 })).value).toBe(7);
  });
  it('snapshots recipe and variable inputs before asynchronous digest/reference work', async () => {
    const template = adaptationFixture().course.adaptation!.numericalRecipes[0]!;
    const values = { a: 8, b: 2 };
    const pending = instantiateNumericalRecipe(template, values);
    values.b = 99; template.promptTemplate = 'mutated';
    const captured = await pending;
    expect(captured.value).toBe(2); expect(captured.prompt).toBe('Enter the smaller of 8 and 2.');
    const original = adaptationFixture().course.adaptation!.numericalRecipes[0]!;
    const reference: NumericalReferencePort = { verifierId: original.referenceCheck.verifierId, verifierVersion: original.referenceCheck.verifierVersion,
      checkId: original.referenceCheck.checkId, evaluate: async input => Math.min(input.variables.a!, input.variables.b!) };
    const check = checkNumericalReference(original, captured.instance, reference);
    captured.instance.variables.b = 99; original.referenceCheck.verifierId = 'mutated';
    expect((await check).matched).toBe(true);
  });
  it('rejects rehashed generated prompt/answer drift from a valid recipe', async () => {
    for (const field of ['prompt', 'answer']) {
      const f = adaptationFixture(), artifact = f.proposal.artifacts.find(a => a.kind === 'assessment_variant') as Extract<TeachingArtifact, { kind: 'assessment_variant' }>;
      if (artifact.assessment.type !== 'numeric') throw new Error('fixture');
      if (field === 'prompt') artifact.assessment.prompt = 'A different question.'; else artifact.assessment.grading.expected = 27;
      await reseal(f);
      expect((await validateCourseAdaptation(f.proposal, context(f))).issues.map(i => i.code)).toContain('RECIPE_OUTPUT_MISMATCH');
    }
  });
});
