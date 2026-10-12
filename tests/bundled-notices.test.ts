import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

interface Dependency { name: string; version: string; license: string; licenseSha256: string; modules: string[] }
interface Bundle { validator: string; dependencies: Dependency[] }
describe('actual bundled third-party licenses', () => {
  it('matches esbuild input inventories to installed package licenses and preserves exact notices', () => {
    const inventory = JSON.parse(readFileSync('src/generated/validator-dependencies.json', 'utf8')) as Bundle[];
    const notice = readFileSync('NOTICE', 'utf8');
    const names = new Set<string>();
    for (const bundle of inventory) {
      const code = readFileSync(`src/generated/${bundle.validator}-validator.js`, 'utf8');
      for (const dependency of bundle.dependencies) {
        names.add(dependency.name);
        const metadata = JSON.parse(readFileSync(`node_modules/${dependency.name}/package.json`, 'utf8'));
        const license = readFileSync(`node_modules/${dependency.name}/LICENSE`, 'utf8').trim();
        expect(metadata.version).toBe(dependency.version); expect(metadata.license).toBe('MIT');
        expect(createHash('sha256').update(license).digest('hex')).toBe(dependency.licenseSha256);
        expect(notice).toContain(`${dependency.name}@${dependency.version}`); expect(notice).toContain(license);
        expect(code).toContain(license);
        expect(dependency.modules.length).toBeGreaterThan(0);
        for (const input of dependency.modules) expect(code).toContain(`node_modules/${input}`);
      }
    }
    expect([...names].sort()).toEqual(['ajv', 'ajv-formats', 'fast-deep-equal']);
    expect(notice).not.toContain('fast-uri'); expect(notice).not.toContain('esbuild@');
    expect(readFileSync('LICENSE', 'utf8')).toContain('Apache License');
    expect(readFileSync('LICENSE', 'utf8')).not.toContain('Third-party notices');
  });
});
