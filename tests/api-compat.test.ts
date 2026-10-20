import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import { writeTar } from '../src/tar.js';
import { compareApi, decide, entryExports, loadBaseline, parseDeclarations, surfaceChanges, versionPolicy } from '../scripts/api-compat.mjs';

const baseline = {
  'index.d.ts': [
    "export * from './util.js';",
    "export type * from './types.js';",
    "export { inner as renamed, Kept } from './more.js';",
    'export declare const LIMIT = 5;',
    'export declare function run(input: string): number;',
    'export declare function widen(input: string): string;',
    'export interface Options {\n    name: string;\n    size?: number;\n}',
    'export type Box<T, U = string> = { value: T; label: U };',
    'export declare class Failure extends Error {\n    code: string;\n}',
  ].join('\n'),
  'util.d.ts': 'export declare function helper(a: number): number;\nexport declare function gone(): void;',
  'types.d.ts': 'export interface Shape {\n    sides: number;\n}\nexport declare const SHAPE_KINDS: readonly string[];',
  'more.d.ts': 'export declare function inner(): void;\nexport declare const Kept: { a: number };',
};
const directories: string[] = [];
function tree(files: Record<string, string>) {
  const directory = mkdtempSync(path.join(tmpdir(), 'api-compat-test-'));
  directories.push(directory);
  for (const [name, text] of Object.entries(files)) writeFileSync(path.join(directory, name), `${text}\n`);
  return directory;
}
const asBytes = (files: Record<string, string>) => new Map(Object.entries(files).map(([n, t]) => [n, Buffer.from(`${t}\n`)]));
afterEach(() => { for (const d of directories.splice(0)) rmSync(d, { recursive: true, force: true }); });

describe('API compatibility', () => {
  it('parses the declaration forms tsc emits and resolves re-exports', async () => {
    const parsed = parseDeclarations(baseline['index.d.ts']);
    expect([...parsed.declared.keys()].sort()).toEqual(['Box', 'Failure', 'LIMIT', 'Options', 'run', 'widen']);
    expect(parsed.declared.get('Box')).toEqual({ value: false, type: true, arity: 1 });
    expect(parsed.declared.get('Failure')).toMatchObject({ value: true, type: true });
    const exports = await entryExports(tree(baseline), 'index.d.ts');
    expect([...exports.keys()].sort()).toEqual(['Box', 'Failure', 'Kept', 'LIMIT', 'Options', 'SHAPE_KINDS', 'Shape', 'gone', 'helper', 'renamed', 'run', 'widen']);
    expect(exports.get('SHAPE_KINDS')).toMatchObject({ value: true, typeOnly: true });
    expect(exports.get('renamed')).toMatchObject({ value: true, typeOnly: false });
    await expect(entryExports(tree({ 'index.d.ts': "export { missing } from './util.js';", 'util.d.ts': '' }), 'index.d.ts')).rejects.toThrow(/unknown missing/);
    expect(() => parseDeclarations("export * as ns from './x.js';")).toThrow(/not supported/);
  });

  it('applies semver, treating a 0.x minor bump as breaking-capable', () => {
    expect(versionPolicy('0.5.0', '0.5.1')).toEqual({ breakingAllowed: false, changeAllowed: true });
    expect(versionPolicy('0.5.0', '0.6.0')).toEqual({ breakingAllowed: true, changeAllowed: true });
    expect(versionPolicy('1.2.0', '1.3.0')).toEqual({ breakingAllowed: false, changeAllowed: true });
    expect(versionPolicy('1.2.0', '2.0.0')).toEqual({ breakingAllowed: true, changeAllowed: true });
    expect(versionPolicy('0.5.0', '0.5.0')).toEqual({ breakingAllowed: false, changeAllowed: false });
    expect(() => versionPolicy('0.5.0', '0.4.9')).toThrow(/older than/);
    expect(() => versionPolicy('0.5.0', '0.6.0-rc.1')).toThrow(/Unsupported version/);
    const none = { removed: [], changed: [], added: [] };
    expect(decide(none, versionPolicy('0.5.0', '0.5.0')).ok).toBe(true);
    expect(decide({ ...none, added: ['x'] }, versionPolicy('0.5.0', '0.5.0')).reason).toMatch(/without a version bump/);
    expect(decide({ ...none, removed: ['x'] }, versionPolicy('1.0.0', '1.1.0')).reason).toMatch(/major version bump/);
  });

  it('flags removed exports, lost runtime values and arity changes before type checking', () => {
    const before = new Map([['a', { value: true, type: false, typeOnly: false }], ['b', { value: true, type: false, typeOnly: false }], ['T', { value: false, type: true, arity: 1, typeOnly: false }]]);
    const after = new Map([['b', { value: true, type: false, typeOnly: true }], ['T', { value: false, type: true, arity: 2, typeOnly: false }], ['c', { value: false, type: true, typeOnly: false }]]);
    expect(surfaceChanges(before, after)).toEqual({ removed: ['a'], changed: ['T: required type parameters 1 -> 2', 'b: runtime value is no longer exported'], added: ['c'] });
  });

  it('accepts a compatible evolution and rejects incompatible signatures and types through tsc', async () => {
    const compatible = { ...baseline,
      'index.d.ts': baseline['index.d.ts']
        .replace('export declare function run(input: string): number;', 'export declare function run(input: string, extra?: boolean): number;\nexport declare function added(): void;'),
    };
    const ok = await compareApi({ oldFiles: asBytes(baseline), newDirectory: tree(compatible), entries: ['index.d.ts'], baselineVersion: '1.0.0', currentVersion: '1.1.0' });
    expect(ok).toMatchObject({ ok: true, removed: [], changed: [], added: ['added'] });

    const broken = { ...baseline,
      'index.d.ts': baseline['index.d.ts']
        .replace('run(input: string): number', 'run(input: string, required: boolean): number')
        .replace('widen(input: string): string', 'widen(input: string): string | undefined')
        .replace('size?: number;', 'size: number;')
        .replace("export * from './util.js';", "export type * from './util.js';"),
      'types.d.ts': baseline['types.d.ts'].replace('sides: number;', 'sides: string;'),
    };
    const result = await compareApi({ oldFiles: asBytes(baseline), newDirectory: tree(broken), entries: ['index.d.ts'], baselineVersion: '1.0.0', currentVersion: '1.1.0' });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/major version bump/);
    expect(result.incompatible.sort()).toEqual(['Options (type)', 'Shape (type)', 'run (value signature)', 'widen (value signature)']);
    expect(result.changed).toEqual(expect.arrayContaining(['gone: runtime value is no longer exported', 'helper: runtime value is no longer exported']));
    const allowed = await compareApi({ oldFiles: asBytes(baseline), newDirectory: tree(broken), entries: ['index.d.ts'], baselineVersion: '1.0.0', currentVersion: '2.0.0' });
    expect(allowed).toMatchObject({ ok: true, reason: expect.stringMatching(/allowed/) });
    const exempted = await compareApi({ oldFiles: asBytes(baseline), newDirectory: tree({ ...baseline, 'index.d.ts': baseline['index.d.ts'].replace('LIMIT = 5', 'LIMIT = 6') }),
      entries: ['index.d.ts'], baselineVersion: '1.0.0', currentVersion: '1.0.1', exempt: { LIMIT: 'literal changes each release' } });
    expect(exempted).toMatchObject({ ok: true, changed: [] });
  });

  it('uses only a pinned release asset whose bytes match the pinned SHA-512', async () => {
    const tarball = Buffer.from(gzipSync(writeTar([{ name: 'package/dist/index.d.ts', bytes: Buffer.from('export declare const A = 1;\n') }, { name: 'package/package.json', bytes: Buffer.from('{}') }])));
    const integrity = `sha512-${createHash('sha512').update(tarball).digest('base64')}`;
    const config = { version: '0.5.0', url: 'https://github.com/roeehrl/course-sdk/releases/download/v0.5.0/course-core-sdk-0.5.0.tgz', integrity };
    const fetchImpl = async () => new Response(tarball);
    expect([...(await loadBaseline(config, { fetchImpl })).keys()]).toEqual(['index.d.ts']);
    await expect(loadBaseline({ ...config, integrity: `sha512-${createHash('sha512').update('other').digest('base64')}` }, { fetchImpl })).rejects.toThrow(/pinned SHA-512/);
    await expect(loadBaseline({ ...config, url: 'https://example.invalid/sdk.tgz' }, { fetchImpl })).rejects.toThrow(/release asset/);
    await expect(loadBaseline(config, { fetchImpl: async () => new Response('', { status: 404 }) })).rejects.toThrow(/HTTP 404/);
    await expect(loadBaseline({ ...config, exempt: { A: 'short' } }, { fetchImpl })).rejects.toThrow(/stated reason/);
    const local = path.join(tree({}), 'local.tgz');
    mkdirSync(path.dirname(local), { recursive: true });
    writeFileSync(local, tarball);
    expect((await loadBaseline(config, { tarball: local })).size).toBe(1);
  });
});
