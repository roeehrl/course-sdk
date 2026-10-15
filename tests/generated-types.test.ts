import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CONTRACT_KINDS, RECORD_KINDS } from '../src/index.js';
import type { ContractKinds, CourseManifest, RecordKinds } from '../src/index.js';
import type { SchemaContracts, SchemaCourseManifest, SchemaRecords } from '../src/generated/schema-types.js';
import { CONTRACT_DEFINITIONS, RECORD_DEFINITIONS } from '../scripts/contract-map.mjs';

/**
 * Generated-types equality. `scripts/generate-types.mjs` derives TypeScript from
 * course.schema.json; the public types are hand-written for documentation. Two types are
 * equal here when each is assignable to the other, so they accept exactly the same values.
 * A mismatch names the kind and fails `npm run typecheck` (tsc checks this file).
 */
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type Mismatches<Generated, Written, K extends keyof Generated & keyof Written> = { [P in K]: Same<Generated[P], Written[P]> extends true ? never : P }[K];

type ContractMismatch = Mismatches<SchemaContracts, ContractKinds, keyof ContractKinds>;
type RecordMismatch = Mismatches<SchemaRecords, RecordKinds, keyof RecordKinds>;
const contractsEqual: [ContractMismatch] extends [never] ? true : ContractMismatch = true;
const recordsEqual: [RecordMismatch] extends [never] ? true : RecordMismatch = true;
const manifestEqual: Same<SchemaCourseManifest, CourseManifest> = true;
// Every public kind has a generated counterpart and no generated kind is unpublished.
const contractKeys: Same<keyof SchemaContracts, keyof ContractKinds> = true;
const recordKeys: Same<keyof SchemaRecords, keyof RecordKinds> = true;
// The check itself must be able to fail: a narrowed or widened type is not "the same".
const detectsNarrowing: Same<{ a: string }, { a: 'x' }> = false;
const detectsOptionality: Same<{ a?: string }, { a: string }> = false;

describe('types generated from the JSON Schema', () => {
  it('match the hand-written public types (checked by tsc)', () => {
    expect([contractsEqual, recordsEqual, manifestEqual, contractKeys, recordKeys, detectsNarrowing, detectsOptionality]).toEqual([true, true, true, true, true, false, false]);
  });
  it('cover the same kinds as the runtime validators', () => {
    expect(Object.keys(CONTRACT_DEFINITIONS).sort()).toEqual([...CONTRACT_KINDS].sort());
    expect(Object.keys(RECORD_DEFINITIONS).sort()).toEqual([...RECORD_KINDS].sort());
  });
  it('are regenerated from the current schema', () => {
    const generated = readFileSync(new URL('../src/generated/schema-types.d.ts', import.meta.url), 'utf8');
    const schema = JSON.parse(readFileSync(new URL('../src/course.schema.json', import.meta.url), 'utf8')) as { $defs: Record<string, unknown> };
    for (const name of Object.keys(schema.$defs)) expect(generated).toContain(`export type S${name[0]!.toUpperCase()}${name.slice(1)} = `);
  });
});
