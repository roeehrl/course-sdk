import type { ValidateFunction } from 'ajv';
import { jsonIssue } from './json.js';
import type { ValidationIssue } from './types.js';

export function shapeIssues(validator: ValidateFunction, input: unknown, prefix = ''): ValidationIssue[] {
  const problem = jsonIssue(input);
  if (problem) return [{ ...problem, path: prefix + problem.path }];
  if (validator(input)) return [];
  return (validator.errors ?? []).map(error => ({ code: 'SCHEMA', path: prefix + error.instancePath, message: error.message ?? 'Invalid data.' }));
}
export class AdaptationDataError extends Error {
  constructor(public readonly issues: ValidationIssue[]) { super('Adaptation data failed validation.'); this.name = 'AdaptationDataError'; }
}
export function sameIds(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && [...a].sort().every((value, i) => value === [...b].sort()[i]);
}
