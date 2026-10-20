import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import { writeTar } from '../src/tar.js';
import { main, readPackage, readVerifiedRelease, sbomFilename, sdkSbom } from '../scripts/release-sbom.mjs';

const sri = (text: string) => `sha512-${createHash('sha512').update(text).digest('base64')}`;
const manifest = { name: '@course-core/sdk', version: '9.8.7', license: 'Apache-2.0', dependencies: { ajv: '8.20.0' } };
const bundled = [{ validator: 'course', dependencies: [{ name: 'ajv', version: '8.20.0', license: 'MIT' }, { name: 'fast-deep-equal', version: '3.1.3', license: 'MIT' }] }];
const registry = (name: string, version: string) => `https://registry.npmjs.org/${name}/-/${name}-${version}.tgz`;
function lock(overrides: Record<string, unknown> = {}) {
  return { lockfileVersion: 3, packages: {
    '': { name: manifest.name, version: manifest.version, dependencies: { ajv: '8.20.0' }, devDependencies: { vitest: '5.0.4' } },
    'node_modules/ajv': { version: '8.20.0', resolved: registry('ajv', '8.20.0'), integrity: sri('ajv'), license: 'MIT' },
    'node_modules/fast-deep-equal': { version: '3.1.3', resolved: registry('fast-deep-equal', '3.1.3'), integrity: sri('fde'), license: 'MIT' },
    'node_modules/vitest': { version: '5.0.4', resolved: registry('vitest', '5.0.4'), integrity: sri('vitest'), license: 'MIT', dev: true },
    ...overrides,
  } };
}
function tarball(packageJson: unknown = manifest, inventory: unknown = bundled) {
  return Buffer.from(gzipSync(writeTar([
    { name: 'package/package.json', bytes: Buffer.from(JSON.stringify(packageJson)) },
    { name: 'package/dist/validator-dependencies.json', bytes: Buffer.from(JSON.stringify(inventory)) },
  ])));
}
const directories: string[] = [];
function verifiedRelease(bytes = tarball(), record?: Record<string, unknown>) {
  const directory = mkdtempSync(path.join(tmpdir(), 'sdk-sbom-test-'));
  directories.push(directory);
  const verified = path.join(directory, 'verified');
  mkdirSync(verified);
  writeFileSync(path.join(verified, 'course-core-sdk-9.8.7.tgz'), bytes);
  writeFileSync(path.join(verified, 'verification.json'), JSON.stringify(record ?? { name: manifest.name, version: manifest.version,
    sha256: createHash('sha256').update(bytes).digest('hex'), integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}` }));
  return { directory, verified };
}
afterEach(() => { for (const d of directories.splice(0)) rmSync(d, { recursive: true, force: true }); });

describe('release SBOM', () => {
  it('lists the runtime closure, marks bundled packages and binds the exact tarball', async () => {
    const { verified } = verifiedRelease();
    const release = await readVerifiedRelease(verified);
    const bytes = sdkSbom(release, lock());
    const bom = JSON.parse(bytes.toString('utf8'));
    expect([bom.bomFormat, bom.specVersion, bom.version]).toEqual(['CycloneDX', '1.5', 1]);
    expect(bom.serialNumber).toMatch(/^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(bom.metadata.timestamp).toBeUndefined();
    expect(bom.metadata.component).toMatchObject({ group: '@course-core', name: 'sdk', version: '9.8.7', purl: 'pkg:npm/%40course-core/sdk@9.8.7' });
    expect(bom.metadata.component.hashes[0]).toEqual({ alg: 'SHA-256', content: createHash('sha256').update(release.tarball).digest('hex') });
    expect(bom.components.map((c: { purl: string }) => c.purl)).toEqual(['pkg:npm/ajv@8.20.0', 'pkg:npm/fast-deep-equal@3.1.3']);
    expect(bom.components[0].hashes).toEqual([{ alg: 'SHA-512', content: createHash('sha512').update('ajv').digest('hex') }]);
    expect(bom.components[1].properties).toEqual([{ name: 'course-sdk:bundledInto', value: 'course' }]);
    expect(bom.dependencies).toEqual([{ ref: 'pkg:npm/%40course-core/sdk@9.8.7', dependsOn: ['pkg:npm/ajv@8.20.0'] }]);
    expect(sdkSbom(release, lock()).equals(bytes)).toBe(true);
    expect(sbomFilename('course-core-sdk-9.8.7.tgz')).toBe('course-core-sdk-9.8.7.cdx.json');
  });

  it('refuses a tarball that is not the verified one, or extra and linked files', async () => {
    const original = tarball();
    let { verified } = verifiedRelease(tarball({ ...manifest, description: 'changed' }), {
      name: manifest.name, version: manifest.version, sha256: createHash('sha256').update(original).digest('hex'),
      integrity: `sha512-${createHash('sha512').update(original).digest('base64')}` });
    await expect(readVerifiedRelease(verified)).rejects.toThrow(/differs from verification.json \(SHA-256\)/);
    ({ verified } = verifiedRelease(original, { name: manifest.name, version: manifest.version, sha256: createHash('sha256').update(original).digest('hex'), integrity: sri('other') }));
    await expect(readVerifiedRelease(verified)).rejects.toThrow(/SHA-512/);
    ({ verified } = verifiedRelease());
    writeFileSync(path.join(verified, 'extra.txt'), 'x');
    await expect(readVerifiedRelease(verified)).rejects.toThrow(/exactly one verified/);
    ({ verified } = verifiedRelease());
    const moved = path.join(path.dirname(verified), 'elsewhere.json');
    writeFileSync(moved, readFileSync(path.join(verified, 'verification.json')));
    rmSync(path.join(verified, 'verification.json'));
    symlinkSync(moved, path.join(verified, 'verification.json'));
    await expect(readVerifiedRelease(verified)).rejects.toThrow(/regular files/);
    const renamed = tarball({ ...manifest, version: '9.8.8' });
    ({ verified } = verifiedRelease(renamed, { name: manifest.name, version: '9.8.8', sha256: createHash('sha256').update(renamed).digest('hex'),
      integrity: `sha512-${createHash('sha512').update(renamed).digest('base64')}` }));
    await expect(readVerifiedRelease(verified)).rejects.toThrow(/filename does not match/);
  });

  it('refuses a lock that does not describe the packed runtime dependencies', async () => {
    const { verified } = verifiedRelease();
    const release = await readVerifiedRelease(verified);
    const base = lock();
    expect(() => sdkSbom(release, { ...base, lockfileVersion: 2 })).toThrow(/lockfileVersion 3/);
    expect(() => sdkSbom(release, lock({ '': { name: manifest.name, version: '1.0.0', dependencies: { ajv: '8.20.0' } } }))).toThrow(/another package or version/);
    expect(() => sdkSbom(release, lock({ '': { name: manifest.name, version: manifest.version, dependencies: { ajv: '8.20.0', zod: '4.0.0' } } }))).toThrow(/differ from the lock/);
    expect(() => sdkSbom(release, lock({ 'node_modules/ajv': { version: '8.20.0', resolved: registry('ajv', '8.20.0') } }))).toThrow(/SHA-512 integrity/);
    expect(() => sdkSbom(release, lock({ 'node_modules/ajv': { version: '8.20.0', resolved: 'https://example.invalid/ajv.tgz', integrity: sri('ajv') } }))).toThrow(/Invalid locked runtime package ajv/);
    expect(() => sdkSbom(release, lock({ 'node_modules/fast-deep-equal': { version: '3.1.3', resolved: registry('fast-deep-equal', '3.1.3'), integrity: sri('fde'), dev: true } })))
      .toThrow(/Bundled fast-deep-equal@3.1.3 is not a locked runtime dependency/);
  });

  it('refuses links in the tarball and writes only a new file outside the verified directory', async () => {
    const header = Buffer.alloc(512);
    header.write('package/link', 0); header.write('0000644\0', 100); header.write('00000000000\0', 124); header.write('2', 156);
    expect(() => readPackage(gzipSync(Buffer.concat([header, Buffer.alloc(1024)])))).toThrow(/link or special entry/);
    const { directory, verified } = verifiedRelease();
    writeFileSync(path.join(directory, 'package-lock.json'), JSON.stringify(lock()));
    await expect(main(['--directory', verified, '--lock', path.join(directory, 'package-lock.json'), '--output', verified])).rejects.toThrow(/outside the verified directory/);
    const output = path.join(directory, 'out');
    mkdirSync(output);
    const args = ['--directory', verified, '--lock', path.join(directory, 'package-lock.json'), '--output', output];
    const result = await main(args);
    expect(result.package).toBe('@course-core/sdk@9.8.7');
    expect(JSON.parse(readFileSync(path.join(output, 'course-core-sdk-9.8.7.cdx.json'), 'utf8')).bomFormat).toBe('CycloneDX');
    await expect(main(args)).rejects.toThrow(/EEXIST/);
    await expect(main(['--directory', verified])).rejects.toThrow(/Use --directory/);
  });
});
