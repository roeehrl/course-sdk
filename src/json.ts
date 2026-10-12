import type { ValidationIssue } from './types.js';

const pointer = (value: string) => value.replaceAll('~', '~0').replaceAll('/', '~1');
/** Reject non-data values before any schema, hash or getter can consume them. */
export function jsonIssue(input: unknown): ValidationIssue | undefined {
  const ancestors = new Set<object>(); let visited = 0;
  function visit(value: unknown, path: string, depth: number): ValidationIssue | undefined {
    if (++visited > 200_000 || depth > 64) return { code: 'JSON_LIMIT', path, message: 'Document exceeds the structural resource limit.' };
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
    if (typeof value === 'number' && Number.isFinite(value)) return;
    if (typeof value !== 'object') return { code: 'NOT_JSON', path, message: 'Expected a finite JSON value.' };
    if (ancestors.has(value)) return { code: 'NOT_JSON', path, message: 'Cyclic objects cannot be document data.' };
    if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
      return { code: 'NOT_JSON', path, message: 'Only plain JSON objects are accepted.' };
    }
    if (Reflect.ownKeys(value).some(key => typeof key === 'symbol')) return { code: 'NOT_JSON', path, message: 'Symbol properties are not serializable.' };
    ancestors.add(value);
    for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
      if (Array.isArray(value) && key === 'length') continue;
      if (!descriptor.enumerable || !('value' in descriptor)) return { code: 'NOT_JSON', path, message: 'Only enumerable data properties are accepted.' };
      if (Array.isArray(value) && !/^(0|[1-9][0-9]*)$/.test(key)) return { code: 'NOT_JSON', path, message: 'Array properties must be indices.' };
      const issue = visit(descriptor.value, `${path}/${pointer(key)}`, depth + 1);
      if (issue) return issue;
    }
    if (Array.isArray(value)) for (let i = 0; i < value.length; i++) {
      if (!Object.hasOwn(value, i)) return { code: 'NOT_JSON', path: `${path}/${i}`, message: 'Sparse arrays are not accepted.' };
    }
    ancestors.delete(value);
  }
  return visit(input, '', 0);
}

/** Canonical JSON sorts object keys, preserves array order and never runs getters. */
export function canonicalJson(value: unknown): string {
  if (jsonIssue(value)) throw new TypeError('Canonical encoding requires finite, bounded JSON data.');
  function encode(value: unknown): string {
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(encode).join(',')}]`;
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${encode((value as Record<string, unknown>)[key])}`).join(',')}}`;
  }
  return encode(value);
}
