import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { build } from 'esbuild';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  compileCourse, COURSE_PACKAGE_ERROR_CODES, CoursePackageError, coursePackageChecksum, packCoursePackage, verifyCoursePackage,
  verifyCoursePackageChecksum, type CoursePackageErrorCode, type PackCoursePackageInput,
} from '../src/compiler.js';
import { readTar, writeTar } from '../src/tar.js';
import { SDK_VERSION } from '../src/version.js';
import schema from '../src/course-package.schema.json' with { type: 'json' };
import { richCourse } from './contracts-fixture.js';

const sha = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
const text = (value: string) => new TextEncoder().encode(value);
const LIMITS = { maxMembers: 1000, maxMemberBytes: 1 << 30, maxTotalBytes: 1 << 30 };

const fullInput = (): PackCoursePackageInput => ({
  manifest: richCourse(),
  adaptationRegistry: { registryFormat: 1, entries: [] },
  hostRequirements: [{ name: 'fixture-code.py', bytes: 'print("synthetic")\n' }],
  licences: [{ name: 'LICENSE.txt', bytes: 'CC-BY-4.0 synthetic\n' }],
  others: [{ name: 'notes.md', bytes: '# Notes\n' }],
  source: { repository: 'https://example.invalid/course', commit: 'a'.repeat(40) },
});

/** A raw ustar entry; tests use it to build archives the SDK writer refuses to produce. */
interface RawEntry { name: string; bytes?: Uint8Array; type?: string; linkname?: string; prefix?: string; magic?: string }
function rawTar(entries: RawEntry[]): Uint8Array {
  const blocks: Uint8Array[] = [];
  for (const entry of entries) {
    const bytes = entry.bytes ?? new Uint8Array();
    const header = new Uint8Array(512);
    const put = (offset: number, value: string) => header.set(text(value), offset);
    put(0, entry.name); put(100, '0000644\0'); put(108, '0000000\0'); put(116, '0000000\0');
    put(124, `${bytes.length.toString(8).padStart(11, '0')}\0`); put(136, '00000000000\0');
    header.fill(0x20, 148, 156); put(156, entry.type ?? '0'); put(157, entry.linkname ?? '');
    if (entry.magic) put(257, entry.magic); else { put(257, 'ustar\0'); put(263, '00'); } put(345, entry.prefix ?? '');
    put(148, `${header.reduce((a, b) => a + b, 0).toString(8).padStart(6, '0')}\0 `);
    blocks.push(header, bytes, new Uint8Array((512 - (bytes.length % 512)) % 512));
  }
  blocks.push(new Uint8Array(1024));
  return new Uint8Array(Buffer.concat(blocks));
}
const gz = (tar: Uint8Array) => new Uint8Array(gzipSync(tar));

/** Rewrites a valid package: change members and/or the listing, then re-tar without SDK checks. */
function repack(pkg: Uint8Array, change: (entries: RawEntry[], listing: Record<string, any>) => void, relist = false): Uint8Array {
  const entries: RawEntry[] = readTar(gunzipSync(pkg), LIMITS).map(m => ({ name: m.name, bytes: m.bytes }));
  const listingEntry = entries.find(e => e.name === 'course-package.json')!;
  const listing = JSON.parse(new TextDecoder().decode(listingEntry.bytes));
  change(entries, listing);
  if (relist) for (const member of listing.members) {
    const entry = entries.find(e => e.name === member.name);
    if (entry?.bytes) { member.bytes = entry.bytes.length; member.sha256 = sha(entry.bytes); }
  }
  listingEntry.bytes = text(`${JSON.stringify(listing, null, 2)}\n`);
  return gz(rawTar(entries));
}
const setMember = (name: string, bytes: Uint8Array) => (entries: RawEntry[]) => { entries.find(e => e.name === name)!.bytes = bytes; };

function refusal(fn: () => unknown): CoursePackageErrorCode {
  try { fn(); } catch (error) {
    if (error instanceof CoursePackageError) return error.code;
    throw error;
  }
  throw new Error('Expected a CoursePackageError.');
}

describe('course-package v1', () => {
  const pkg = packCoursePackage(fullInput());

  it('packs deterministically and round-trips through verification', () => {
    expect(packCoursePackage(fullInput())).toEqual(pkg);
    // Member input order does not matter: members are sorted.
    const reordered = fullInput();
    reordered.others = [{ name: 'notes.md', bytes: text('# Notes\n') }];
    expect(packCoursePackage(reordered)).toEqual(pkg);
    expect([...pkg.subarray(0, 10)]).toEqual([0x1f, 0x8b, 8, 0, 0, 0, 0, 0, 2, 0xff]);
    const entries = readTar(gunzipSync(pkg), LIMITS);
    expect(entries.map(e => e.name)).toEqual(['LICENSE.txt', 'adaptation-registry.json', 'course-package.json', 'course.json', 'fixture-code.py', 'learner.json', 'notes.md']);
    const compiled = compileCourse(richCourse());
    const result = verifyCoursePackage(pkg);
    expect(result.packageManifest).toMatchObject({
      format: 'course-package', formatVersion: 1, courseId: 'pendulum-lab', courseVersion: '1.0.0', courseDigest: compiled.digest,
      sdkVersion: SDK_VERSION, minimumCoreVersion: '0.1.46', source: { repository: 'https://example.invalid/course', commit: 'a'.repeat(40) },
    });
    expect(result.courseManifest).toEqual(richCourse());
    expect(result.learner).toEqual(compiled.learner);
    expect(result.adaptationRegistry).toEqual({ registryFormat: 1, entries: [] });
    expect(result.members.map(m => [m.name, m.role])).toEqual([
      ['LICENSE.txt', 'licence'], ['adaptation-registry.json', 'adaptation-registry'], ['course.json', 'course-manifest'],
      ['fixture-code.py', 'host-requirement'], ['learner.json', 'learner-projection'], ['notes.md', 'other'],
    ]);
    expect(new TextDecoder().decode(result.members.find(m => m.name === 'fixture-code.py')!.content)).toBe('print("synthetic")\n');
  });

  it('stores exact manifest bytes, omits the learner on request and accepts a matching learner value', () => {
    const exact = `${JSON.stringify(richCourse())}\n`;
    const result = verifyCoursePackage(packCoursePackage({ manifest: exact, learner: false }));
    expect(new TextDecoder().decode(result.members[0]!.content)).toBe(exact);
    expect(result.members.map(m => m.role)).toEqual(['course-manifest']);
    expect(result.learner).toBeUndefined();
    expect(() => packCoursePackage({ manifest: richCourse(), learner: compileCourse(richCourse()).learner })).not.toThrow();
  });

  it('the published schema accepts the listing the packer writes and rejects unknown keys', () => {
    const ajv = new Ajv2020({ strict: true, allErrors: true });
    const validate = ajv.compile(schema);
    const listing = JSON.parse(new TextDecoder().decode(readTar(gunzipSync(pkg), LIMITS).find(e => e.name === 'course-package.json')!.bytes));
    expect(validate(listing), JSON.stringify(validate.errors)).toBe(true);
    expect(validate({ ...listing, extra: 1 })).toBe(false);
    expect(validate({ ...listing, members: [{ ...listing.members[0], role: 'script' }] })).toBe(false);
    expect(validate({ ...listing, members: [{ ...listing.members[0], name: '../x' }] })).toBe(false);
  });

  it.each<[string, () => Uint8Array, CoursePackageErrorCode]>([
    ['tampered member bytes', () => repack(pkg, setMember('notes.md', text('# Notez\n'))), 'PACKAGE_MEMBER_DIGEST_MISMATCH'],
    ['changed member size', () => repack(pkg, setMember('notes.md', text('# Notes!\n'))), 'PACKAGE_MEMBER_SIZE_MISMATCH'],
    ['unlisted member', () => repack(pkg, entries => { entries.push({ name: 'extra.txt', bytes: text('x') }); }), 'PACKAGE_UNLISTED_MEMBER'],
    ['missing member', () => repack(pkg, entries => { entries.splice(entries.findIndex(e => e.name === 'notes.md'), 1); }), 'PACKAGE_MISSING_MEMBER'],
    ['duplicate tar member', () => repack(pkg, entries => { entries.push({ name: 'notes.md', bytes: text('# Notes\n') }); }), 'PACKAGE_DUPLICATE_MEMBER'],
    ['duplicate listing', () => repack(pkg, (_e, listing) => { listing.members.push(listing.members.at(-1)); }), 'PACKAGE_DUPLICATE_LISTING'],
    ['symlink entry', () => repack(pkg, entries => { entries.push({ name: 'link', type: '2', linkname: '/etc/passwd' }); }), 'PACKAGE_LINK_ENTRY'],
    ['hardlink entry', () => repack(pkg, entries => { entries.push({ name: 'hard', type: '1', linkname: 'course.json' }); }), 'PACKAGE_LINK_ENTRY'],
    ['directory entry', () => repack(pkg, entries => { entries.unshift({ name: 'dir', type: '5' }); }), 'PACKAGE_UNSUPPORTED_ENTRY'],
    ['PAX header', () => repack(pkg, entries => { entries.unshift({ name: 'PaxHeader', type: 'x', bytes: text('20 path=course.json\n') }); }), 'PACKAGE_UNSUPPORTED_ENTRY'],
    ['nested name via prefix', () => repack(pkg, entries => { entries[0]!.prefix = 'sub'; }), 'PACKAGE_UNSUPPORTED_ENTRY'],
    ['../ traversal', () => repack(pkg, entries => { entries.push({ name: '../x', bytes: text('x') }); }), 'PACKAGE_UNSAFE_PATH'],
    ['absolute path', () => repack(pkg, entries => { entries.push({ name: '/tmp/x', bytes: text('x') }); }), 'PACKAGE_UNSAFE_PATH'],
    ['nested path', () => repack(pkg, entries => { entries.push({ name: 'a/b', bytes: text('x') }); }), 'PACKAGE_UNSAFE_PATH'],
    ['invalid name', () => repack(pkg, entries => { entries.push({ name: 'bad name', bytes: text('x') }); }), 'PACKAGE_INVALID_MEMBER_NAME'],
    ['unknown role', () => repack(pkg, (_e, listing) => { listing.members.find((m: any) => m.name === 'notes.md').role = 'script'; }), 'PACKAGE_UNKNOWN_ROLE'],
    ['two course manifests', () => repack(pkg, (_e, listing) => { listing.members.find((m: any) => m.name === 'notes.md').role = 'course-manifest'; }), 'PACKAGE_ROLE_COUNT'],
    ['no course manifest', () => repack(pkg, (_e, listing) => { listing.members.find((m: any) => m.name === 'course.json').role = 'other'; }), 'PACKAGE_ROLE_COUNT'],
    ['two learner projections', () => repack(pkg, (_e, listing) => { listing.members.find((m: any) => m.name === 'notes.md').role = 'learner-projection'; }), 'PACKAGE_ROLE_COUNT'],
    ['wrong role on a JSON member', () => repack(pkg, (_e, listing) => {
      listing.members.find((m: any) => m.name === 'course.json').role = 'other';
      listing.members.find((m: any) => m.name === 'notes.md').role = 'course-manifest';
    }), 'PACKAGE_MEMBER_NOT_JSON'],
    ['compiled wrapper as manifest', () => repack(pkg, setMember('course.json', text(JSON.stringify(compileCourse(richCourse())))), true), 'PACKAGE_COMPILED_WRAPPER'],
    ['invalid course manifest', () => repack(pkg, setMember('course.json', text('{"schemaVersion":1}')), true), 'PACKAGE_COURSE_INVALID'],
    ['courseDigest mismatch', () => repack(pkg, (_e, listing) => { listing.courseDigest = 'f'.repeat(64); }), 'PACKAGE_COURSE_DIGEST_MISMATCH'],
    ['manifest changed, digest stale', () => repack(pkg, setMember('course.json', text(JSON.stringify({ ...richCourse(), title: 'Changed' }))), true), 'PACKAGE_COURSE_DIGEST_MISMATCH'],
    ['courseId mismatch', () => repack(pkg, (_e, listing) => { listing.courseId = 'other-course'; }), 'PACKAGE_COURSE_ID_MISMATCH'],
    ['courseVersion mismatch', () => repack(pkg, (_e, listing) => { listing.courseVersion = '9.9.9'; }), 'PACKAGE_COURSE_VERSION_MISMATCH'],
    ['learner mismatch', () => repack(pkg, entries => {
      const entry = entries.find(e => e.name === 'learner.json')!;
      const learner = JSON.parse(new TextDecoder().decode(entry.bytes));
      entry.bytes = text(JSON.stringify({ ...learner, title: 'Not the compiler output' }));
    }, true), 'PACKAGE_LEARNER_MISMATCH'],
    ['unknown top-level key', () => repack(pkg, (_e, listing) => { listing.signature = 'x'; }), 'PACKAGE_UNKNOWN_KEY'],
    ['unknown member key', () => repack(pkg, (_e, listing) => { listing.members[0].mode = 493; }), 'PACKAGE_UNKNOWN_KEY'],
    ['unknown source key', () => repack(pkg, (_e, listing) => { listing.source.branch = 'main'; }), 'PACKAGE_UNKNOWN_KEY'],
    ['formatVersion 2', () => repack(pkg, (_e, listing) => { listing.formatVersion = 2; }), 'PACKAGE_UNSUPPORTED_FORMAT'],
    ['listing lists itself', () => repack(pkg, (_e, listing) => { listing.members.push({ name: 'course-package.json', bytes: 1, sha256: '0'.repeat(64), role: 'other' }); }), 'PACKAGE_LISTING_INVALID'],
    ['non-semver sdkVersion', () => repack(pkg, (_e, listing) => { listing.sdkVersion = 'latest'; }), 'PACKAGE_LISTING_INVALID'],
    ['http repository', () => repack(pkg, (_e, listing) => { listing.source.repository = 'http://example.invalid/x'; }), 'PACKAGE_LISTING_INVALID'],
    ['listing missing', () => repack(pkg, entries => { entries.splice(entries.findIndex(e => e.name === 'course-package.json'), 1); }), 'PACKAGE_LISTING_MISSING'],
    ['listing not JSON', () => gz(rawTar([{ name: 'course-package.json', bytes: text('{nope') }])), 'PACKAGE_LISTING_INVALID'],
    ['not gzip', () => rawTar([{ name: 'a', bytes: text('x') }]), 'PACKAGE_NOT_GZIP'],
    ['truncated gzip', () => pkg.slice(0, pkg.length - 20), 'PACKAGE_CORRUPT'],
    ['missing end marker', () => gz(rawTar([{ name: 'a', bytes: text('x') }]).slice(0, 1024)), 'PACKAGE_CORRUPT'],
    ['trailing data', () => gz(new Uint8Array(Buffer.concat([rawTar([{ name: 'a', bytes: text('x') }]), text('junk')]))), 'PACKAGE_CORRUPT'],
    ['bad header checksum', () => { const tar = rawTar([{ name: 'a', bytes: text('x') }]); tar[0] = 0x62; return gz(tar); }, 'PACKAGE_CORRUPT'],
    ['GNU magic', () => gz(rawTar([{ name: 'a', bytes: text('x'), magic: 'ustar  \0' }])), 'PACKAGE_CORRUPT'],
  ])('refuses %s', (_label, make, code) => {
    expect(refusal(() => verifyCoursePackage(make()))).toBe(code);
  });

  it('enforces size and count limits, and maxSizes only lowers them', () => {
    expect(refusal(() => verifyCoursePackage(pkg, { maxSizes: { memberBytes: 100 } }))).toBe('PACKAGE_TOO_LARGE');
    expect(refusal(() => verifyCoursePackage(pkg, { maxSizes: { uncompressedBytes: 1000 } }))).toBe('PACKAGE_TOO_LARGE');
    expect(refusal(() => verifyCoursePackage(pkg, { maxSizes: { compressedBytes: 100 } }))).toBe('PACKAGE_TOO_LARGE');
    expect(refusal(() => verifyCoursePackage(pkg, { maxSizes: { members: 3 } }))).toBe('PACKAGE_TOO_MANY_MEMBERS');
    expect(() => verifyCoursePackage(pkg, { maxSizes: { members: 10_000, memberBytes: 2 ** 40 } })).not.toThrow();
    // A 33 MiB member of zeros compresses well below the compressed limit; the header size refuses it.
    const big = gz(rawTar([{ name: 'big.bin', bytes: new Uint8Array(32 * 1024 * 1024 + 1) }]));
    expect(refusal(() => verifyCoursePackage(big))).toBe('PACKAGE_TOO_LARGE');
    const many = gz(rawTar(Array.from({ length: 201 }, (_, i) => ({ name: `f${i}`, bytes: text('x') }))));
    expect(refusal(() => verifyCoursePackage(many))).toBe('PACKAGE_TOO_MANY_MEMBERS');
    // A gzip bomb stops at the decompression cap.
    const bomb = new Uint8Array(gzipSync(new Uint8Array(140 * 1024 * 1024)));
    expect(refusal(() => verifyCoursePackage(bomb))).toBe('PACKAGE_TOO_LARGE');
  });

  it('refuses unsafe or invalid inputs when packing', () => {
    expect(refusal(() => packCoursePackage({ ...fullInput(), others: [{ name: '../x', bytes: 'x' }] }))).toBe('PACKAGE_UNSAFE_PATH');
    expect(refusal(() => packCoursePackage({ ...fullInput(), others: [{ name: 'course.json', bytes: 'x' }] }))).toBe('PACKAGE_DUPLICATE_MEMBER');
    expect(refusal(() => packCoursePackage({ ...fullInput(), others: [{ name: 'course-package.json', bytes: 'x' }] }))).toBe('PACKAGE_DUPLICATE_MEMBER');
    expect(refusal(() => packCoursePackage({ ...fullInput(), others: [{ name: 'x'.repeat(101), bytes: 'x' }] }))).toBe('PACKAGE_INVALID_MEMBER_NAME');
    expect(refusal(() => packCoursePackage({ ...fullInput(), others: [{ name: 'big', bytes: new Uint8Array(32 * 1024 * 1024 + 1) }] }))).toBe('PACKAGE_TOO_LARGE');
    expect(refusal(() => packCoursePackage({ manifest: compileCourse(richCourse()) }))).toBe('PACKAGE_COMPILED_WRAPPER');
    expect(refusal(() => packCoursePackage({ manifest: {} }))).toBe('PACKAGE_COURSE_INVALID');
    expect(refusal(() => packCoursePackage({ manifest: richCourse(), learner: { wrong: true } }))).toBe('PACKAGE_LEARNER_MISMATCH');
    expect(refusal(() => packCoursePackage({ manifest: richCourse(), adaptationRegistry: '{not json' }))).toBe('PACKAGE_MEMBER_NOT_JSON');
    expect(refusal(() => packCoursePackage({ manifest: richCourse(), source: { commit: 'ABC' } }))).toBe('PACKAGE_INPUT_INVALID');
    expect(refusal(() => packCoursePackage({ manifest: richCourse(), minimumCoreVersion: 'v1' }))).toBe('PACKAGE_INPUT_INVALID');
    const unpublishable = richCourse();
    unpublishable.evaluators = unpublishable.evaluators!.map(e => e.humanConfirmation ? { ...e, humanConfirmation: 'on_uncertain' } : e);
    expect(refusal(() => packCoursePackage({ manifest: unpublishable }))).toBe('PACKAGE_COURSE_UNPUBLISHABLE');
  });

  it('writes and checks sha256sum siblings', () => {
    const line = coursePackageChecksum(pkg, 'pendulum-lab-1.0.0.course.tgz');
    expect(line).toBe(`${sha(pkg)}  pendulum-lab-1.0.0.course.tgz\n`);
    expect(() => verifyCoursePackageChecksum(pkg, line, 'pendulum-lab-1.0.0.course.tgz')).not.toThrow();
    expect(() => verifyCoursePackageChecksum(pkg, `${sha(pkg)} *pendulum-lab-1.0.0.course.tgz`, 'pendulum-lab-1.0.0.course.tgz')).not.toThrow();
    expect(refusal(() => verifyCoursePackageChecksum(pkg, line, 'renamed.course.tgz'))).toBe('PACKAGE_CHECKSUM_MISMATCH');
    expect(refusal(() => verifyCoursePackageChecksum(pkg, `${'0'.repeat(64)}  pendulum-lab-1.0.0.course.tgz\n`, 'pendulum-lab-1.0.0.course.tgz'))).toBe('PACKAGE_CHECKSUM_MISMATCH');
    expect(refusal(() => verifyCoursePackageChecksum(pkg, `${line}${line}`, 'pendulum-lab-1.0.0.course.tgz'))).toBe('PACKAGE_CHECKSUM_INVALID');
    expect(refusal(() => verifyCoursePackageChecksum(pkg, 'garbage', 'x'))).toBe('PACKAGE_CHECKSUM_INVALID');
  });

  it('the tar writer emits fixed headers and refuses names that need a prefix', () => {
    const tar = writeTar([{ name: 'a.txt', bytes: text('hello') }]);
    expect(tar.length).toBe(512 * 4);
    expect(new TextDecoder().decode(tar.subarray(100, 108))).toBe('0000644\0');
    expect(new TextDecoder().decode(tar.subarray(136, 148))).toBe('00000000000\0');
    expect(readTar(tar, LIMITS)).toEqual([{ name: 'a.txt', bytes: text('hello') }]);
    expect(() => writeTar([{ name: 'x'.repeat(101), bytes: text('') }])).toThrow();
    expect(COURSE_PACKAGE_ERROR_CODES).toContain('PACKAGE_UNLISTED_MEMBER');
  });
});

describe('course CLI course packages', () => {
  let dir: string, cli: string;
  const run = (...args: string[]) => spawnSync(process.execPath, [cli, ...args], { cwd: dir, encoding: 'utf8', timeout: 60_000 });
  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'course-package-cli-'));
    cli = path.join(dir, 'cli.mjs');
    await build({ entryPoints: ['src/cli.ts'], bundle: true, platform: 'node', format: 'esm', outfile: cli, logLevel: 'silent' });
    mkdirSync(path.join(dir, 'course'));
    writeFileSync(path.join(dir, 'course/course.json'), `${JSON.stringify(richCourse(), null, 2)}\n`);
    writeFileSync(path.join(dir, 'registry.json'), '{"registryFormat":1,"entries":[]}\n');
    writeFileSync(path.join(dir, 'fixture-code.py'), 'print("synthetic")\n');
    writeFileSync(path.join(dir, 'LICENSE.txt'), 'CC-BY-4.0 synthetic\n');
    writeFileSync(path.join(dir, 'compiled.json'), JSON.stringify(compileCourse(richCourse())));
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const packArgs = (out: string, source = 'course') => ['pack', source, '--out', out, '--registry', 'registry.json', '--host-requirement', 'fixture-code.py',
    '--licence', 'LICENSE.txt', '--repository', 'https://example.invalid/course', '--commit', 'b'.repeat(40), '--minimum-core-version', '0.2.0'];

  it('packs a course directory or manifest into identical bytes with a sha256sum sibling, and verifies it', () => {
    const packed = run(...packArgs('pendulum-lab-1.0.0.course.tgz'));
    expect(packed.status, packed.stderr).toBe(0);
    expect(run(...packArgs('again.course.tgz', 'course/course.json')).status).toBe(0);
    const bytes = readFileSync(path.join(dir, 'pendulum-lab-1.0.0.course.tgz'));
    expect(readFileSync(path.join(dir, 'again.course.tgz'))).toEqual(bytes);
    expect(readFileSync(path.join(dir, 'pendulum-lab-1.0.0.course.tgz.sha256'), 'utf8')).toBe(`${sha(bytes)}  pendulum-lab-1.0.0.course.tgz\n`);
    const summary = JSON.parse(run('verify', 'pendulum-lab-1.0.0.course.tgz').stdout);
    expect(summary).toMatchObject({ valid: true, kind: 'course-package', checksum: 'verified', courseId: 'pendulum-lab', courseVersion: '1.0.0',
      minimumCoreVersion: '0.2.0', source: { commit: 'b'.repeat(40) } });
    expect(summary.members.map((m: { name: string; role: string }) => `${m.name}:${m.role}`)).toEqual([
      'LICENSE.txt:licence', 'adaptation-registry.json:adaptation-registry', 'course.json:course-manifest', 'fixture-code.py:host-requirement', 'learner.json:learner-projection']);
    expect(run(...packArgs('pendulum-lab-1.0.0.course.tgz')).status).toBe(1); // refuses replacement
  });

  it('fails verification with the error code for tampering, a wrong checksum or a symlink', () => {
    expect(run(...packArgs('tamper.course.tgz')).status).toBe(0);
    const file = path.join(dir, 'tamper.course.tgz');
    rmSync(`${file}.sha256`);
    const bytes = new Uint8Array(readFileSync(file));
    writeFileSync(file, repack(bytes, setMember('fixture-code.py', text('print("Synthetic")\n'))));
    const result = run('verify', 'tamper.course.tgz');
    expect(result.status).toBe(1);
    expect(JSON.parse(result.stdout)).toMatchObject({ valid: false, code: 'PACKAGE_MEMBER_DIGEST_MISMATCH', member: 'fixture-code.py' });
    writeFileSync(file, bytes);
    writeFileSync(`${file}.sha256`, `${'0'.repeat(64)}  tamper.course.tgz\n`);
    expect(JSON.parse(run('verify', 'tamper.course.tgz').stdout)).toMatchObject({ valid: false, code: 'PACKAGE_CHECKSUM_MISMATCH' });
    symlinkSync(file, path.join(dir, 'link.course.tgz'));
    expect(run('verify', 'link.course.tgz').status).not.toBe(0);
  });

  it('reports pack refusals with codes and keeps the bundle form and usage errors', () => {
    const wrapper = run('pack', 'compiled.json', '--out', 'wrapper.course.tgz');
    expect(wrapper.status).toBe(1);
    expect(JSON.parse(wrapper.stderr)).toMatchObject({ code: 'PACKAGE_COMPILED_WRAPPER' });
    expect(existsSync(path.join(dir, 'wrapper.course.tgz'))).toBe(false);
    expect(run('pack', 'course/course.json', 'bundle').status).toBe(0);
    expect(JSON.parse(run('verify', 'bundle').stdout).kind).toBe('bundle');
    for (const args of [['pack', 'course'], ['pack', 'course', 'dir', '--out', 'x.tgz'], ['pack', 'course', 'dir2', '--no-learner'],
      ['pack', 'course', '--out'], ['pack', 'course', '--out', 'a.tgz', '--out', 'b.tgz'], ['pack', 'course', '--out', 'a.tgz', '--sign']]) {
      const result = run(...args);
      expect(result.status, args.join(' ')).toBe(2);
    }
  });
});
