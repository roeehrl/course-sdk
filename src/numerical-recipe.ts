import type { ValidateFunction } from 'ajv';
import templateValidator from './generated/numerical-recipe-validator.js';
import instanceValidator from './generated/recipe-instance-validator.js';
import type { NumericalExpression, NumericalRecipeInstance, NumericalRecipeTemplate, NumericalReferencePort } from './adaptation-types.js';
import type { ValidationIssue } from './types.js';
import { AdaptationDataError, sameIds, shapeIssues } from './adaptation-shape.js';
import { digestJson } from './integrity.js';

export function numericalTemplateIssues(input: unknown): ValidationIssue[] {
  const issues = shapeIssues(templateValidator as ValidateFunction, input);
  if (issues.length) return issues;
  const template = input as NumericalRecipeTemplate;
  const report = (message: string) => issues.push({ code: 'RECIPE_CONSTRAINT', path: '', message });
  const names = new Set<string>();
  for (const variable of template.variables) {
    if (names.has(variable.name)) report('Variable names must be unique.');
    names.add(variable.name);
    if (variable.minimum > variable.maximum || Math.max(Math.abs(variable.minimum), Math.abs(variable.maximum)) > template.maxAbsoluteValue) report('Invalid variable bounds.');
    if (variable.integer && (!Number.isSafeInteger(variable.minimum) || !Number.isSafeInteger(variable.maximum))) report('Integer bounds must be safe integers.');
  }
  let count = 0;
  function visit(node: NumericalExpression, depth: number) {
    count++;
    if (depth > template.maxDepth) report('Expression exceeds the declared depth.');
    if (node.type === 'constant' && Math.abs(node.value) > template.maxAbsoluteValue) report('Constant exceeds the magnitude bound.');
    if (node.type === 'variable' && !names.has(node.name)) report('Expression names an undeclared variable.');
    if (node.type === 'unary') visit(node.value, depth + 1);
    if (node.type === 'binary') { visit(node.left, depth + 1); visit(node.right, depth + 1); }
  }
  visit(template.expression, 1);
  if (count > template.maxNodes) report('Expression exceeds the declared node budget.');
  const remainder = template.promptTemplate.replace(/\{\{([a-z][a-z0-9_]{0,31})\}\}/g, (_match, name: string) => {
    if (!names.has(name)) report('Prompt names an undeclared variable.'); return '';
  });
  if (remainder.includes('{{') || remainder.includes('}}')) report('Only declared variable placeholders are supported.');
  return issues;
}

/** Arithmetic only: no eval, functions, property access, loops, imports or I/O. */
export async function evaluateNumericalRecipe(templateInput: NumericalRecipeTemplate, instanceInput: NumericalRecipeInstance) {
  const problems = [...numericalTemplateIssues(templateInput), ...shapeIssues(instanceValidator as ValidateFunction, instanceInput)];
  if (problems.length) throw new AdaptationDataError(problems);
  const template = structuredClone(templateInput), instance = structuredClone(instanceInput);
  const fail = (message: string): never => { throw new AdaptationDataError([{ code: 'RECIPE_CONSTRAINT', path: '', message }]); };
  const templateDigest = await digestJson(template);
  if (instance.templateId !== template.id || instance.templateVersion !== template.version || instance.templateDigest !== templateDigest) fail('Recipe template identity differs.');
  if (!sameIds(Object.keys(instance.variables), template.variables.map(v => v.name))) fail('Supply exactly the declared variables.');
  for (const variable of template.variables) {
    const value = instance.variables[variable.name]!;
    if (value < variable.minimum || value > variable.maximum || (variable.integer && !Number.isSafeInteger(value))) fail('Variable is outside its declared bounds.');
  }
  let steps = 0;
  function evaluate(node: NumericalExpression): number {
    if (++steps > template.maxNodes) fail('Expression step budget exhausted.');
    let result: number;
    switch (node.type) {
      case 'constant': result = node.value; break;
      case 'variable': result = instance.variables[node.name]!; break;
      case 'unary': { const value = evaluate(node.value); result = node.operator === 'abs' ? Math.abs(value) : -value; break; }
      case 'binary': {
        const left = evaluate(node.left), right = evaluate(node.right);
        switch (node.operator) {
          case 'add': result = left + right; break;
          case 'subtract': result = left - right; break;
          case 'multiply': result = left * right; break;
          case 'divide': if (right === 0) fail('Division by zero.'); result = left / right; break;
          case 'min': result = Math.min(left, right); break;
          case 'max': result = Math.max(left, right); break;
        }
      }
    }
    if (!Number.isFinite(result) || Math.abs(result) > template.maxAbsoluteValue) fail('Arithmetic result exceeds its finite magnitude bound.');
    return result;
  }
  const value = evaluate(template.expression);
  const prompt = template.promptTemplate.replace(/\{\{([a-z][a-z0-9_]{0,31})\}\}/g, (_match, name: string) => String(instance.variables[name]));
  return { value, prompt, templateDigest, steps };
}

/** Authoring convenience. Its computed answer is server data, not a verification receipt. */
export async function instantiateNumericalRecipe(template: NumericalRecipeTemplate, variables: Record<string, number>) {
  const issues = numericalTemplateIssues(template); if (issues.length) throw new AdaptationDataError(issues);
  const instance: NumericalRecipeInstance = { templateId: template.id, templateVersion: template.version, templateDigest: '0'.repeat(64), variables };
  const instanceIssues = shapeIssues(instanceValidator as ValidateFunction, instance);
  if (instanceIssues.length) throw new AdaptationDataError(instanceIssues);
  const snapshot = structuredClone(template), captured = structuredClone(instance);
  captured.templateDigest = await digestJson(snapshot);
  return { instance: captured, ...await evaluateNumericalRecipe(snapshot, captured) };
}

/** The host selects this port independently. A numeric match authenticates no issuer. */
export async function checkNumericalReference(template: NumericalRecipeTemplate, instance: NumericalRecipeInstance, port: NumericalReferencePort, options: { signal?: AbortSignal } = {}) {
  const issues = [...numericalTemplateIssues(template), ...shapeIssues(instanceValidator as ValidateFunction, instance)];
  if (issues.length) throw new AdaptationDataError(issues);
  const snapshot = structuredClone(template), captured = structuredClone(instance);
  const computed = await evaluateNumericalRecipe(snapshot, captured);
  const check = snapshot.referenceCheck;
  if (port.verifierId !== check.verifierId || port.verifierVersion !== check.verifierVersion || port.checkId !== check.checkId) throw new AdaptationDataError([{ code: 'REFERENCE_PORT', path: '', message: 'Reference port identity differs.' }]);
  if (options.signal?.aborted) throw new Error('Reference check aborted.');
  const referenceValue = await port.evaluate({ templateDigest: computed.templateDigest, variables: captured.variables }, options);
  if (options.signal?.aborted) throw new Error('Reference check aborted.');
  if (!Number.isFinite(referenceValue) || Math.abs(referenceValue) > snapshot.maxAbsoluteValue) throw new AdaptationDataError([{ code: 'REFERENCE_VALUE', path: '', message: 'Reference result is not within the declared finite bound.' }]);
  return { value: computed.value, referenceValue, matched: Math.abs(computed.value - referenceValue) <= check.absoluteTolerance, proofAuthenticity: 'not_checked' as const };
}
