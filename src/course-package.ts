import { createHash } from 'node:crypto';
import { crc32, deflateRawSync, gunzipSync } from 'node:zlib';
import { canonicalJson } from './json.js';
import { compileCourse, CourseValidationError, type CompiledCourse, type LearnerCourse } from './compiler.js';
import { publicationRefusals } from './publication.js';
import { readTar, TarError, TAR_NAME_BYTES, writeTar, type TarMember } from './tar.js';
import { SDK_VERSION } from './version.js';
import type { CourseManifest, ValidationIssue } from './types.js';

/**
 * course-package v1: a gzip-compressed POSIX ustar archive of top-level regular files, listed by
 * `course-package.json`. Nothing in a package is ever executed: verification only parses JSON,
 * hashes bytes and runs the SDK's own validator and compiler on the course manifest.
 */

export const COURSE_PACKAGE_FORMAT = 'course-package';
export const COURSE_PACKAGE_FORMAT_VERSION = 1;
export const COURSE_PACKAGE_LISTING = 'course-package.json';
/** Course Core release expected to install course-package v1; override per package. */
export const DEFAULT_MINIMUM_CORE_VERSION = '0.1.46';
export const COURSE_PACKAGE_ROLES = Object.freeze(['course-manifest', 'learner-projection', 'adaptation-registry', 'host-requirement', 'licence', 'other'] as const);
export type CoursePackageRole = typeof COURSE_PACKAGE_ROLES[number];

/** Spec limits. `maxSizes` may lower them, never raise them. */
export const COURSE_PACKAGE_LIMITS = Object.freeze({
  members: 200,
  memberBytes: 32 * 1024 * 1024,
  uncompressedBytes: 128 * 1024 * 1024,
  compressedBytes: 64 * 1024 * 1024,
});
export type CoursePackageLimits = { -readonly [K in keyof typeof COURSE_PACKAGE_LIMITS]: number };

export interface CoursePackageMember { name: string; bytes: number; sha256: string; role: CoursePackageRole }
export interface CoursePackageManifest {
  format: 'course-package';
  formatVersion: 1;
  courseId: string;
  courseVersion: string;
  courseDigest: string;
  sdkVersion: string;
  minimumCoreVersion: string;
  source?: { repository?: string; commit?: string };
  members: CoursePackageMember[];
}

export const COURSE_PACKAGE_ERROR_CODES = Object.freeze([
  'PACKAGE_INPUT_INVALID', // pack: an option or file the packer was given is unusable
  'PACKAGE_COURSE_UNPUBLISHABLE', // pack: the course is valid data but a host refuses to publish it
  'PACKAGE_NOT_GZIP',
  'PACKAGE_CORRUPT', // gzip or tar structure is damaged, truncated or not strict ustar
  'PACKAGE_TOO_LARGE',
  'PACKAGE_TOO_MANY_MEMBERS',
  'PACKAGE_LINK_ENTRY',
  'PACKAGE_UNSUPPORTED_ENTRY',
  'PACKAGE_UNSAFE_PATH',
  'PACKAGE_INVALID_MEMBER_NAME',
  'PACKAGE_DUPLICATE_MEMBER',
  'PACKAGE_LISTING_MISSING',
  'PACKAGE_LISTING_INVALID',
  'PACKAGE_UNSUPPORTED_FORMAT',
  'PACKAGE_UNKNOWN_KEY',
  'PACKAGE_UNKNOWN_ROLE',
  'PACKAGE_DUPLICATE_LISTING',
  'PACKAGE_UNLISTED_MEMBER',
  'PACKAGE_MISSING_MEMBER',
  'PACKAGE_MEMBER_SIZE_MISMATCH',
  'PACKAGE_MEMBER_DIGEST_MISMATCH',
  'PACKAGE_ROLE_COUNT',
  'PACKAGE_MEMBER_NOT_JSON',
  'PACKAGE_COMPILED_WRAPPER',
  'PACKAGE_COURSE_INVALID',
  'PACKAGE_COURSE_ID_MISMATCH',
  'PACKAGE_COURSE_VERSION_MISMATCH',
  'PACKAGE_COURSE_DIGEST_MISMATCH',
  'PACKAGE_LEARNER_MISMATCH',
  'PACKAGE_CHECKSUM_INVALID',
  'PACKAGE_CHECKSUM_MISMATCH',
] as const);
export type CoursePackageErrorCode = typeof COURSE_PACKAGE_ERROR_CODES[number];

export class CoursePackageError extends Error {
  constructor(
    public readonly code: CoursePackageErrorCode,
    message: string,
    public readonly member?: string,
    public readonly issues?: ValidationIssue[],
  ) {
    super(`${code}: ${message}`);
    this.name = 'CoursePackageError';
  }
}
const fail = (code: CoursePackageErrorCode, message: string, member?: string, issues?: ValidationIssue[]): never => {
  throw new CoursePackageError(code, message, member, issues);
};

const SEMVER = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-[0-9A-Za-z.-]+)?$/;
const COURSE_ID = /^[a-z][a-z0-9._:-]{0,127}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const COMMIT = /^[0-9a-f]{40}$/;
const REPOSITORY = /^https:\/\/[^\s]+$/;
/** The spec's name rule. Names must also fit the 100-byte ustar name field (no prefix). */
const MEMBER_NAME = /^[A-Za-z0-9._-]{1,128}$/;
const TOP_LEVEL_KEYS = new Set(['format', 'formatVersion', 'courseId', 'courseVersion', 'courseDigest', 'sdkVersion', 'minimumCoreVersion', 'source', 'members']);
const MEMBER_KEYS = ['bytes', 'name', 'role', 'sha256'];
const SINGLE_ROLES: Partial<Record<CoursePackageRole, [number, number]>> = {
  'course-manifest': [1, 1], 'learner-projection': [0, 1], 'adaptation-registry': [0, 1],
};

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const encoder = new TextEncoder();
const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const own = (value: Record<string, unknown>, key: string) => Object.hasOwn(value, key);

/** Why a name is unsafe or invalid, or undefined when it is a valid top-level member name. */
function nameProblem(name: string): { code: 'PACKAGE_UNSAFE_PATH' | 'PACKAGE_INVALID_MEMBER_NAME'; message: string } | undefined {
  if (name.startsWith('/') || /^[A-Za-z]:/.test(name)) return { code: 'PACKAGE_UNSAFE_PATH', message: `Absolute member path: ${name}` };
  if (name.includes('/') || name.includes('\\') || name === '..' || name === '.') return { code: 'PACKAGE_UNSAFE_PATH', message: `Members must be top-level files: ${name}` };
  if (!MEMBER_NAME.test(name)) return { code: 'PACKAGE_INVALID_MEMBER_NAME', message: `Member names must match ${MEMBER_NAME.source}: ${name}` };
  if (encoder.encode(name).length > TAR_NAME_BYTES) return { code: 'PACKAGE_INVALID_MEMBER_NAME', message: `Member names longer than ${TAR_NAME_BYTES} bytes cannot be stored as top-level ustar names: ${name}` };
}

function resolveLimits(maxSizes: Partial<CoursePackageLimits> | undefined): CoursePackageLimits {
  const limits: CoursePackageLimits = { ...COURSE_PACKAGE_LIMITS };
  for (const key of Object.keys(limits) as (keyof CoursePackageLimits)[]) {
    const value = maxSizes?.[key];
    if (value === undefined) continue;
    if (!Number.isSafeInteger(value) || value < 0) fail('PACKAGE_INPUT_INVALID', `maxSizes.${key} must be a non-negative integer.`);
    limits[key] = Math.min(limits[key], value!);
  }
  return limits;
}

/** Strict UTF-8 JSON. A byte-order mark is refused rather than silently dropped. */
function parseJsonMember(bytes: Uint8Array, member: string, code: 'PACKAGE_MEMBER_NOT_JSON' | 'PACKAGE_LISTING_INVALID' = 'PACKAGE_MEMBER_NOT_JSON'): unknown {
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes));
  } catch {
    return fail(code, `${member} is not strict UTF-8 JSON.`, member);
  }
}

// ------------------------------------------------------------------ gzip with a fixed header

/** gzip with a fixed header (no name, mtime 0, OS 255), so the bytes do not depend on the host OS. */
function gzip(data: Uint8Array): Uint8Array {
  const body = deflateRawSync(data, { level: 9, memLevel: 9, strategy: 0, windowBits: 15 });
  const out = new Uint8Array(10 + body.length + 8);
  out.set([0x1f, 0x8b, 0x08, 0x00, 0, 0, 0, 0, 0x02, 0xff], 0);
  out.set(body, 10);
  const view = new DataView(out.buffer, out.byteOffset, out.byteLength);
  view.setUint32(10 + body.length, crc32(data) >>> 0, true);
  view.setUint32(14 + body.length, data.length >>> 0, true);
  return out;
}

// ------------------------------------------------------------------ pack

export type PackageFileContent = Uint8Array | string;
export interface PackageFile { name: string; bytes: PackageFileContent }
export interface PackCoursePackageInput {
  /** The course manifest: exact JSON bytes/text (stored as given) or a value (stored as 2-space JSON). Never a compiled wrapper. */
  manifest: unknown;
  /** `true` (default) stores the compiler's learner projection; `false` omits it; a value must equal the compiler's output. */
  learner?: unknown;
  /** The release's adaptation/recovery registry: JSON bytes/text or a value. */
  adaptationRegistry?: unknown;
  /** Files the host must already have configured. Carried and hashed; never installed or executed. */
  hostRequirements?: PackageFile[];
  licences?: PackageFile[];
  others?: PackageFile[];
  source?: { repository?: string; commit?: string };
  minimumCoreVersion?: string;
}

export const COURSE_MANIFEST_MEMBER = 'course.json';
export const LEARNER_PROJECTION_MEMBER = 'learner.json';
export const ADAPTATION_REGISTRY_MEMBER = 'adaptation-registry.json';

const jsonBytes = (value: unknown) => encoder.encode(`${JSON.stringify(value, null, 2)}\n`);
const contentBytes = (value: PackageFileContent) => typeof value === 'string' ? encoder.encode(value) : new Uint8Array(value);
const isContent = (value: unknown): value is PackageFileContent => typeof value === 'string' || value instanceof Uint8Array;

function isCompiledWrapper(value: unknown): boolean {
  return isRecord(value) && (own(value, 'formatVersion') || own(value, 'server') || own(value, 'learner') || own(value, 'digest'));
}

function compileManifest(value: unknown, member: string): CompiledCourse {
  if (isCompiledWrapper(value)) fail('PACKAGE_COMPILED_WRAPPER', `${member} is a compiled course; packages carry the authored course manifest.`, member);
  try {
    return compileCourse(value);
  } catch (error) {
    if (error instanceof CourseValidationError) return fail('PACKAGE_COURSE_INVALID', `${member} is not a valid course manifest.`, member, error.issues);
    throw error;
  }
}

/**
 * Builds a deterministic course package. Members are sorted by name and written with fixed mode,
 * owner and mtime; gzip uses a fixed header. With the same inputs and the same Node.js zlib build
 * the output bytes are identical; the uncompressed tar stream is identical everywhere.
 */
export function packCoursePackage(input: PackCoursePackageInput): Uint8Array {
  if (!isRecord(input)) return fail('PACKAGE_INPUT_INVALID', 'packCoursePackage expects an options object.');
  const manifestBytes = isContent(input.manifest) ? contentBytes(input.manifest) : jsonBytes(input.manifest);
  const manifestValue = isContent(input.manifest) ? parseJsonMember(manifestBytes, COURSE_MANIFEST_MEMBER) : input.manifest;
  const compiled = compileManifest(manifestValue, COURSE_MANIFEST_MEMBER);
  const refusals = publicationRefusals(compiled.server);
  if (refusals.length) fail('PACKAGE_COURSE_UNPUBLISHABLE', 'A host refuses to publish this course.', COURSE_MANIFEST_MEMBER, refusals);

  const files: { name: string; bytes: Uint8Array; role: CoursePackageRole }[] = [{ name: COURSE_MANIFEST_MEMBER, bytes: manifestBytes, role: 'course-manifest' }];
  const learner = input.learner ?? true;
  if (learner !== false) {
    if (learner !== true) {
      const given = isContent(learner) ? parseJsonMember(contentBytes(learner), LEARNER_PROJECTION_MEMBER) : learner;
      let same = false;
      try { same = canonicalJson(given) === canonicalJson(compiled.learner); } catch { /* not JSON data */ }
      if (!same) fail('PACKAGE_LEARNER_MISMATCH', 'The learner projection differs from the compiler output.', LEARNER_PROJECTION_MEMBER);
    }
    files.push({ name: LEARNER_PROJECTION_MEMBER, bytes: jsonBytes(compiled.learner), role: 'learner-projection' });
  }
  if (input.adaptationRegistry !== undefined) {
    const registry = input.adaptationRegistry;
    const bytes = isContent(registry) ? contentBytes(registry) : jsonBytes(registry);
    parseJsonMember(bytes, ADAPTATION_REGISTRY_MEMBER);
    files.push({ name: ADAPTATION_REGISTRY_MEMBER, bytes, role: 'adaptation-registry' });
  }
  for (const [list, role] of [[input.hostRequirements, 'host-requirement'], [input.licences, 'licence'], [input.others, 'other']] as const) {
    if (list === undefined) continue;
    if (!Array.isArray(list)) fail('PACKAGE_INPUT_INVALID', `${role} files must be an array of { name, bytes }.`);
    for (const file of list) {
      if (!isRecord(file) || typeof file.name !== 'string' || !isContent(file.bytes)) fail('PACKAGE_INPUT_INVALID', `${role} files must be { name, bytes }.`);
      files.push({ name: file.name, bytes: contentBytes(file.bytes), role });
    }
  }

  const limits = COURSE_PACKAGE_LIMITS;
  const names = new Set<string>([COURSE_PACKAGE_LISTING]);
  let total = 0;
  for (const file of files) {
    const problem = nameProblem(file.name);
    if (problem) fail(problem.code, problem.message, file.name);
    if (names.has(file.name)) fail('PACKAGE_DUPLICATE_MEMBER', `Member name used twice: ${file.name}`, file.name);
    names.add(file.name);
    if (file.bytes.length > limits.memberBytes) fail('PACKAGE_TOO_LARGE', `${file.name} exceeds ${limits.memberBytes} bytes.`, file.name);
    total += file.bytes.length;
  }
  if (names.size > limits.members) fail('PACKAGE_TOO_MANY_MEMBERS', `A package holds at most ${limits.members} members.`);

  const source = input.source;
  if (source !== undefined) {
    if (!isRecord(source) || Object.keys(source).some(key => key !== 'repository' && key !== 'commit')) fail('PACKAGE_INPUT_INVALID', 'source has only repository and commit.');
    if (source!.repository !== undefined && (typeof source!.repository !== 'string' || !REPOSITORY.test(source!.repository) || source!.repository.length > 2048)) fail('PACKAGE_INPUT_INVALID', 'source.repository must be an https URL.');
    if (source!.commit !== undefined && (typeof source!.commit !== 'string' || !COMMIT.test(source!.commit))) fail('PACKAGE_INPUT_INVALID', 'source.commit must be 40 lowercase hex characters.');
  }
  const minimumCoreVersion = input.minimumCoreVersion ?? DEFAULT_MINIMUM_CORE_VERSION;
  if (typeof minimumCoreVersion !== 'string' || !SEMVER.test(minimumCoreVersion)) fail('PACKAGE_INPUT_INVALID', 'minimumCoreVersion must be a semver version.');

  files.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const listing: CoursePackageManifest = {
    format: COURSE_PACKAGE_FORMAT, formatVersion: COURSE_PACKAGE_FORMAT_VERSION,
    courseId: compiled.server.id, courseVersion: compiled.server.version, courseDigest: compiled.digest,
    sdkVersion: SDK_VERSION, minimumCoreVersion,
    source: { ...(source?.repository !== undefined ? { repository: source.repository } : {}), ...(source?.commit !== undefined ? { commit: source.commit } : {}) },
    members: files.map(file => ({ name: file.name, bytes: file.bytes.length, sha256: sha256(file.bytes), role: file.role })),
  };
  const listingBytes = jsonBytes(listing);
  if (total + listingBytes.length > limits.uncompressedBytes) fail('PACKAGE_TOO_LARGE', `Members exceed ${limits.uncompressedBytes} bytes in total.`);
  const members: TarMember[] = [{ name: COURSE_PACKAGE_LISTING, bytes: listingBytes }, ...files]
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)).map(({ name, bytes }) => ({ name, bytes }));
  const archive = gzip(writeTar(members));
  if (archive.length > limits.compressedBytes) fail('PACKAGE_TOO_LARGE', `The compressed package exceeds ${limits.compressedBytes} bytes.`);
  return archive;
}

// ------------------------------------------------------------------ verify

export interface VerifiedCoursePackageMember extends CoursePackageMember { content: Uint8Array }
export interface VerifiedCoursePackage {
  packageManifest: CoursePackageManifest;
  courseManifest: CourseManifest;
  /** The compiler's digest of the course manifest (equal to packageManifest.courseDigest). */
  courseDigest: string;
  learner?: LearnerCourse;
  adaptationRegistry?: unknown;
  /** Every listed member with its verified bytes, in listing order. course-package.json is not listed. */
  members: VerifiedCoursePackageMember[];
}
export interface VerifyCoursePackageOptions { maxSizes?: Partial<CoursePackageLimits> }

function unpack(bytes: Uint8Array, limits: CoursePackageLimits): TarMember[] {
  if (!(bytes instanceof Uint8Array)) fail('PACKAGE_INPUT_INVALID', 'verifyCoursePackage expects the package bytes.');
  if (bytes.length > limits.compressedBytes) fail('PACKAGE_TOO_LARGE', `The compressed package exceeds ${limits.compressedBytes} bytes.`);
  if (bytes.length < 18 || bytes[0] !== 0x1f || bytes[1] !== 0x8b || bytes[2] !== 0x08) fail('PACKAGE_NOT_GZIP', 'A course package is a gzip-compressed tar.');
  // Headers, padding and the end marker may add up to 1 KiB per member plus a 10 KiB record.
  const maxTar = limits.uncompressedBytes + (limits.members + 1) * 1024 + 20 * 1024;
  let tar: Uint8Array;
  try {
    tar = gunzipSync(bytes, { maxOutputLength: maxTar });
  } catch (error) {
    if ((error as { code?: string }).code === 'ERR_BUFFER_TOO_LARGE' || error instanceof RangeError) return fail('PACKAGE_TOO_LARGE', 'The decompressed package exceeds its size limit.');
    return fail('PACKAGE_CORRUPT', 'The gzip stream is damaged.');
  }
  try {
    return readTar(tar, { maxMembers: limits.members, maxMemberBytes: limits.memberBytes, maxTotalBytes: limits.uncompressedBytes });
  } catch (error) {
    if (!(error instanceof TarError)) throw error;
    const code = ({ corrupt: 'PACKAGE_CORRUPT', link: 'PACKAGE_LINK_ENTRY', unsupported: 'PACKAGE_UNSUPPORTED_ENTRY', too_large: 'PACKAGE_TOO_LARGE', too_many: 'PACKAGE_TOO_MANY_MEMBERS' } as const)[error.refusal];
    return fail(code, error.message, error.memberName);
  }
}

/** Structural checks equivalent to course-package.schema.json, with stable codes. */
function checkListing(value: unknown): CoursePackageManifest {
  if (!isRecord(value)) return fail('PACKAGE_LISTING_INVALID', `${COURSE_PACKAGE_LISTING} must be a JSON object.`, COURSE_PACKAGE_LISTING);
  const invalid = (message: string) => fail('PACKAGE_LISTING_INVALID', message, COURSE_PACKAGE_LISTING);
  if (value.format !== COURSE_PACKAGE_FORMAT || value.formatVersion !== COURSE_PACKAGE_FORMAT_VERSION) {
    fail('PACKAGE_UNSUPPORTED_FORMAT', `Expected format "course-package" with formatVersion 1.`, COURSE_PACKAGE_LISTING);
  }
  const unknown = Object.keys(value).filter(key => !TOP_LEVEL_KEYS.has(key));
  if (unknown.length) fail('PACKAGE_UNKNOWN_KEY', `Unknown top-level key(s) ${unknown.join(', ')} need a new formatVersion.`, COURSE_PACKAGE_LISTING);
  if (typeof value.courseId !== 'string' || !COURSE_ID.test(value.courseId)) invalid('courseId must be a course id.');
  for (const key of ['courseVersion', 'sdkVersion', 'minimumCoreVersion'] as const) {
    if (typeof value[key] !== 'string' || !SEMVER.test(value[key] as string)) invalid(`${key} must be a semver version.`);
  }
  if (typeof value.courseDigest !== 'string' || !SHA256.test(value.courseDigest)) invalid('courseDigest must be 64 lowercase hex characters.');
  if (own(value, 'source')) {
    const source = value.source;
    if (!isRecord(source)) return invalid('source must be an object.');
    const extra = Object.keys(source).filter(key => key !== 'repository' && key !== 'commit');
    if (extra.length) fail('PACKAGE_UNKNOWN_KEY', `Unknown source key(s) ${extra.join(', ')}.`, COURSE_PACKAGE_LISTING);
    if (own(source, 'repository') && (typeof source.repository !== 'string' || !REPOSITORY.test(source.repository) || source.repository.length > 2048)) invalid('source.repository must be an https URL.');
    if (own(source, 'commit') && (typeof source.commit !== 'string' || !COMMIT.test(source.commit))) invalid('source.commit must be 40 lowercase hex characters.');
  }
  if (!Array.isArray(value.members) || value.members.length === 0) return invalid('members must be a non-empty array.');
  for (const [i, member] of value.members.entries()) {
    if (!isRecord(member)) return invalid(`members[${i}] must be an object.`);
    const extra = Object.keys(member).filter(key => !MEMBER_KEYS.includes(key));
    if (extra.length) fail('PACKAGE_UNKNOWN_KEY', `Unknown key(s) ${extra.join(', ')} in members[${i}].`, COURSE_PACKAGE_LISTING);
    if (typeof member.name !== 'string') return invalid(`members[${i}].name must be a string.`);
    const problem = nameProblem(member.name);
    if (problem) fail(problem.code, problem.message, member.name);
    if (member.name === COURSE_PACKAGE_LISTING) invalid(`${COURSE_PACKAGE_LISTING} must not list itself.`);
    if (typeof member.role !== 'string' || !(COURSE_PACKAGE_ROLES as readonly string[]).includes(member.role)) fail('PACKAGE_UNKNOWN_ROLE', `Unknown role ${JSON.stringify(member.role)} for ${member.name}.`, member.name);
    if (!Number.isSafeInteger(member.bytes) || (member.bytes as number) < 0) invalid(`members[${i}].bytes must be a non-negative integer.`);
    if (typeof member.sha256 !== 'string' || !SHA256.test(member.sha256)) invalid(`members[${i}].sha256 must be 64 lowercase hex characters.`);
  }
  return value as unknown as CoursePackageManifest;
}

/**
 * Verifies a course package without executing anything in it. Throws a CoursePackageError with a
 * stable code on the first refusal. Integrity is not authenticity: a valid package proves the
 * members match their listing and the course compiles to the listed digest, not who made it.
 */
export function verifyCoursePackage(bytes: Uint8Array, options: VerifyCoursePackageOptions = {}): VerifiedCoursePackage {
  const limits = resolveLimits(options.maxSizes);
  const entries = unpack(bytes, limits);
  const byName = new Map<string, Uint8Array>();
  for (const entry of entries) {
    const problem = entry.name === COURSE_PACKAGE_LISTING ? undefined : nameProblem(entry.name);
    if (problem) fail(problem.code, problem.message, entry.name);
    if (byName.has(entry.name)) fail('PACKAGE_DUPLICATE_MEMBER', `Archive contains ${entry.name} more than once.`, entry.name);
    byName.set(entry.name, entry.bytes);
  }
  const listingBytes = byName.get(COURSE_PACKAGE_LISTING);
  if (!listingBytes) return fail('PACKAGE_LISTING_MISSING', `The package has no ${COURSE_PACKAGE_LISTING}.`);
  const listing = checkListing(parseJsonMember(listingBytes, COURSE_PACKAGE_LISTING, 'PACKAGE_LISTING_INVALID'));

  const listed = new Set<string>();
  for (const member of listing.members) {
    if (listed.has(member.name)) fail('PACKAGE_DUPLICATE_LISTING', `${member.name} is listed more than once.`, member.name);
    listed.add(member.name);
  }
  for (const name of byName.keys()) if (name !== COURSE_PACKAGE_LISTING && !listed.has(name)) fail('PACKAGE_UNLISTED_MEMBER', `${name} is not listed in ${COURSE_PACKAGE_LISTING}.`, name);
  const members: VerifiedCoursePackageMember[] = [];
  for (const member of listing.members) {
    const content = byName.get(member.name);
    if (!content) return fail('PACKAGE_MISSING_MEMBER', `Listed member ${member.name} is not in the archive.`, member.name);
    if (content.length !== member.bytes) fail('PACKAGE_MEMBER_SIZE_MISMATCH', `${member.name} has ${content.length} bytes, listed ${member.bytes}.`, member.name);
    if (sha256(content) !== member.sha256) fail('PACKAGE_MEMBER_DIGEST_MISMATCH', `${member.name} does not match its listed SHA-256.`, member.name);
    members.push({ ...member, content });
  }
  for (const role of COURSE_PACKAGE_ROLES) {
    const bounds = SINGLE_ROLES[role];
    if (!bounds) continue;
    const count = members.filter(member => member.role === role).length;
    if (count < bounds[0] || count > bounds[1]) fail('PACKAGE_ROLE_COUNT', `Role ${role} must appear ${bounds[0] === bounds[1] ? `exactly ${bounds[0]}` : `at most ${bounds[1]}`} time(s); found ${count}.`);
  }

  const courseMember = members.find(member => member.role === 'course-manifest')!;
  const compiled = compileManifest(parseJsonMember(courseMember.content, courseMember.name), courseMember.name);
  if (compiled.server.id !== listing.courseId) fail('PACKAGE_COURSE_ID_MISMATCH', `Listed courseId ${listing.courseId} differs from the manifest id ${compiled.server.id}.`, courseMember.name);
  if (compiled.server.version !== listing.courseVersion) fail('PACKAGE_COURSE_VERSION_MISMATCH', `Listed courseVersion ${listing.courseVersion} differs from the manifest version ${compiled.server.version}.`, courseMember.name);
  if (compiled.digest !== listing.courseDigest) fail('PACKAGE_COURSE_DIGEST_MISMATCH', 'Listed courseDigest differs from the digest the SDK compiler computes.', courseMember.name);

  const result: VerifiedCoursePackage = {
    packageManifest: listing, courseManifest: compiled.server, courseDigest: compiled.digest,
    members: members.map(member => ({ name: member.name, bytes: member.bytes, sha256: member.sha256, role: member.role, content: member.content })),
  };
  const learnerMember = members.find(member => member.role === 'learner-projection');
  if (learnerMember) {
    const learner = parseJsonMember(learnerMember.content, learnerMember.name);
    let same = false;
    try { same = canonicalJson(learner) === canonicalJson(compiled.learner); } catch { /* not bounded JSON data */ }
    if (!same) fail('PACKAGE_LEARNER_MISMATCH', 'The learner projection differs from the compiler output.', learnerMember.name);
    result.learner = compiled.learner;
  }
  const registryMember = members.find(member => member.role === 'adaptation-registry');
  if (registryMember) result.adaptationRegistry = parseJsonMember(registryMember.content, registryMember.name);
  return result;
}

// ------------------------------------------------------------------ sibling .sha256

/** The sha256sum line for `<file>.sha256`: `<64 hex>  <file name>\n`. */
export function coursePackageChecksum(bytes: Uint8Array, fileName: string): string {
  if (!fileName || /[\\/\n\r]/.test(fileName)) fail('PACKAGE_INPUT_INVALID', 'The checksum names a plain file name.');
  return `${sha256(bytes)}  ${fileName}\n`;
}

/**
 * Verifies a sibling `.sha256` file in sha256sum format: one line, the package's SHA-256 and the
 * package's file name (text ` ` or binary ` *` mode). Installers must check it when present.
 */
export function verifyCoursePackageChecksum(bytes: Uint8Array, checksumText: string, fileName: string): void {
  const match = /^([0-9a-fA-F]{64}) [ *](.+)\r?\n?$/.exec(checksumText);
  if (!match || checksumText.trimEnd().includes('\n')) return fail('PACKAGE_CHECKSUM_INVALID', 'The .sha256 file must hold one sha256sum line.');
  if (match[2] !== fileName) fail('PACKAGE_CHECKSUM_MISMATCH', `The .sha256 file names ${match[2]}, not ${fileName}.`);
  if (match[1]!.toLowerCase() !== sha256(bytes)) fail('PACKAGE_CHECKSUM_MISMATCH', 'The package does not match its .sha256 file.');
}
