#!/usr/bin/env node
// Builds a deterministic CycloneDX 1.5 SBOM for a verified SDK release tarball.
// It reads only the retained verification output (the .tgz and verification.json)
// and the committed package-lock.json; it never installs, builds or publishes.
import { createHash } from 'node:crypto';
import { lstat, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { pathToFileURL } from 'node:url';

export const SBOM_SPEC = '1.5';
const MAX_TARBALL = 64 * 1024 * 1024;
function check(condition, message) { if (!condition) throw new Error(message); }
const sha = (bytes, algorithm) => createHash(algorithm).update(bytes).digest('hex');
const purl = (name, version) => `pkg:npm/${name.startsWith('@') ? `%40${name.slice(1)}` : name}@${version}`;
const scoped = (name) => name.startsWith('@') ? { group: name.slice(0, name.indexOf('/')), name: name.slice(name.indexOf('/') + 1) } : { name };
const sriHex = (integrity) => {
  const match = /^sha512-([A-Za-z0-9+/]{86}==)$/.exec(integrity ?? '');
  check(match, 'Locked runtime dependency lacks a SHA-512 integrity');
  return Buffer.from(match[1], 'base64').toString('hex');
};

/** Regular files of a gzip'd ustar archive, by path. Links and special entries are refused. */
export function readPackage(tarball) {
  const tar = gunzipSync(tarball, { maxOutputLength: 256 * 1024 * 1024 });
  const files = new Map();
  for (let offset = 0; offset + 512 <= tar.length;) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const field = (start, length) => header.subarray(start, start + length).toString('utf8').replace(/\0.*$/s, '');
    const name = (field(345, 155) ? `${field(345, 155)}/` : '') + field(0, 100);
    const size = Number.parseInt(field(124, 12).trim() || '0', 8), type = field(156, 1) || '0';
    check(Number.isSafeInteger(size) && size >= 0, 'Invalid tar entry size');
    check(type === '0' || type === '5', 'Release tarball contains a link or special entry');
    if (type === '0') files.set(name, tar.subarray(offset + 512, offset + 512 + size));
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  return files;
}

/** The verified tarball and its record, exactly as retained by the release verification job. */
export async function readVerifiedRelease(directory) {
  const names = (await readdir(directory)).sort();
  check(names.length === 2 && names.includes('verification.json') && names.some((n) => /^[a-zA-Z0-9_.-]+\.tgz$/.test(n)),
    'Expected exactly one verified .tgz and verification.json');
  const filename = names.find((n) => n.endsWith('.tgz'));
  for (const name of names) {
    const info = await lstat(path.join(directory, name));
    check(info.isFile() && !info.isSymbolicLink(), 'Release files must be regular files');
  }
  const record = JSON.parse(await readFile(path.join(directory, 'verification.json'), 'utf8'));
  const tarball = await readFile(path.join(directory, filename));
  check(tarball.length > 0 && tarball.length <= MAX_TARBALL, 'Release tarball size is out of bounds');
  check(record.sha256 === sha(tarball, 'sha256'), 'Tarball differs from verification.json (SHA-256)');
  check(record.integrity === `sha512-${createHash('sha512').update(tarball).digest('base64')}`, 'Tarball differs from verification.json (SHA-512)');
  const files = readPackage(tarball);
  const manifest = JSON.parse(files.get('package/package.json')?.toString('utf8') ?? 'null');
  check(manifest && manifest.name === record.name && manifest.version === record.version, 'Packed package identity differs from verification.json');
  check(filename === `${manifest.name.replace(/^@/, '').replace('/', '-')}-${manifest.version}.tgz`, 'Tarball filename does not match the package identity');
  const bundled = JSON.parse(files.get('package/dist/validator-dependencies.json')?.toString('utf8') ?? '[]');
  return { filename, tarball, manifest, bundled };
}

/** CycloneDX for the published package: its runtime dependency closure from the
 * committed lock (what a consumer installs) and the packages esbuild bundled into
 * the generated validators. Deterministic: no timestamp, serial from the tarball. */
export function sdkSbom({ tarball, manifest, bundled }, lock) {
  check(lock?.lockfileVersion === 3 && lock.packages?.[''], 'SBOM requires a lockfileVersion 3 package-lock.json');
  const root = lock.packages[''];
  check(root.name === manifest.name && root.version === manifest.version, 'Lock file belongs to another package or version');
  check(JSON.stringify(root.dependencies ?? {}) === JSON.stringify(manifest.dependencies ?? {}), 'Packed runtime dependencies differ from the lock file');
  const components = new Map();
  for (const [key, entry] of Object.entries(lock.packages)) {
    if (!key || entry.dev === true || entry.devOptional === true) continue;
    check(key.startsWith('node_modules/') && !entry.link, 'Runtime dependencies must be locked registry packages');
    const name = entry.name ?? key.slice(key.lastIndexOf('node_modules/') + 'node_modules/'.length);
    check(typeof entry.version === 'string' && typeof entry.resolved === 'string' && entry.resolved.startsWith('https://registry.npmjs.org/'), `Invalid locked runtime package ${name}`);
    const ref = purl(name, entry.version);
    check(!components.has(ref), `Duplicate locked runtime package ${ref}`);
    components.set(ref, { ref, name, version: entry.version, hash: sriHex(entry.integrity), resolved: entry.resolved, license: entry.license, bundledInto: [] });
  }
  check(Array.isArray(bundled), 'Bundled dependency inventory is missing');
  for (const row of bundled) for (const dependency of row.dependencies ?? []) {
    const component = components.get(purl(dependency.name, dependency.version));
    check(component, `Bundled ${dependency.name}@${dependency.version} is not a locked runtime dependency`);
    if (!component.bundledInto.includes(row.validator)) component.bundledInto.push(row.validator);
  }
  const ref = purl(manifest.name, manifest.version), digest = sha(tarball, 'sha256');
  const bom = {
    bomFormat: 'CycloneDX', specVersion: SBOM_SPEC,
    serialNumber: `urn:uuid:${digest.slice(0, 8)}-${digest.slice(8, 12)}-5${digest.slice(13, 16)}-${(8 | (Number.parseInt(digest[16], 16) & 3)).toString(16)}${digest.slice(17, 20)}-${digest.slice(20, 32)}`,
    version: 1,
    metadata: {
      tools: { components: [{ type: 'application', name: 'course-sdk release-sbom', version: manifest.version }] },
      component: { type: 'library', 'bom-ref': ref, ...scoped(manifest.name), version: manifest.version, purl: ref,
        hashes: [{ alg: 'SHA-256', content: digest }, { alg: 'SHA-512', content: sha(tarball, 'sha512') }],
        licenses: [{ license: { id: 'Apache-2.0' } }] },
    },
    components: [...components.values()].sort((a, b) => (a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0)).map((c) => ({
      type: 'library', 'bom-ref': c.ref, ...scoped(c.name), version: c.version, purl: c.ref, scope: 'required',
      hashes: [{ alg: 'SHA-512', content: c.hash }],
      ...(c.license ? { licenses: [{ license: { name: c.license } }] } : {}),
      externalReferences: [{ type: 'distribution', url: c.resolved }],
      ...(c.bundledInto.length ? { properties: [{ name: 'course-sdk:bundledInto', value: c.bundledInto.sort().join(',') }] } : {}),
    })),
    dependencies: [{ ref, dependsOn: Object.keys(manifest.dependencies ?? {}).map((name) => {
      const entry = lock.packages[`node_modules/${name}`];
      check(entry, `Direct dependency ${name} is not locked`);
      return purl(name, entry.version);
    }).sort() }],
  };
  return Buffer.from(`${JSON.stringify(bom, null, 2)}\n`);
}

export const sbomFilename = (filename) => filename.replace(/\.tgz$/, '.cdx.json');

export async function main(args = process.argv.slice(2)) {
  const options = {};
  for (let i = 0; i < args.length; i += 2) {
    check(['--directory', '--lock', '--output'].includes(args[i]) && args[i + 1] && !(args[i].slice(2) in options), 'Use --directory <verified> --lock <package-lock.json> --output <dir>');
    options[args[i].slice(2)] = path.resolve(args[i + 1]);
  }
  check(options.directory && options.lock && options.output, 'Use --directory <verified> --lock <package-lock.json> --output <dir>');
  check(path.resolve(options.output) !== path.resolve(options.directory), 'Write the SBOM outside the verified directory');
  const release = await readVerifiedRelease(options.directory);
  const bytes = sdkSbom(release, JSON.parse(await readFile(options.lock, 'utf8')));
  const target = path.join(options.output, sbomFilename(release.filename));
  await writeFile(target, bytes, { flag: 'wx', mode: 0o644 });
  return { sbom: target, sha256: sha(bytes, 'sha256'), package: `${release.manifest.name}@${release.manifest.version}` };
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main().then((result) => console.log(JSON.stringify(result))).catch((error) => { console.error(`SBOM generation failed: ${error.message}`); process.exitCode = 1; });
}
