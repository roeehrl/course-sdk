#!/usr/bin/env node
import { lstat, mkdir, open, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  BUNDLE_FILES, compileCourse, conformanceReport, CourseBundleError, CourseValidationError, diffCourses, importCourse, inspectCourse,
  migrateCourse, packCourse, scaffoldCourse, verifyCompiledCourse, verifyCourseBundle,
} from './compiler.js';
import { validateCourse } from './validate.js';
import { lintCourse } from './lint.js';
import { assembleDraft, ContractValidationError, hasLocalizedText } from './define.js';
import { canonicalLocale } from './locale.js';
import { courseTextKeys, localeCoverage } from './localization.js';
import type { CourseManifest, LocaleBundle } from './types.js';
import {
  COURSE_PACKAGE_LIMITS, CoursePackageError, coursePackageChecksum, packCoursePackage, verifyCoursePackage, verifyCoursePackageChecksum,
  type PackageFile,
} from './course-package.js';

const MAX_BYTES = 16 * 1024 * 1024;
const USAGE = `Usage:
  course init <directory> [--id <id>] [--title <title>] [--locale <tag>] [--locales <tag,tag>]
  course validate <course.json | course-directory>
  course lint <course.json | course-directory> [--strict]
  course compile <course.json | course-directory> <output.json>
  course inspect <course.json | course-directory | compiled.json>
  course test <course.json | course-directory>
  course locales <course.json | course-directory>
  course pack <course.json | course-directory> <output-directory>
  course pack <course.json | course-directory> --out <file.course.tgz> [--no-learner] [--registry <file>]
      [--host-requirement <file>]... [--licence <file>]... [--other <file>]...
      [--repository <https-url>] [--commit <40-hex>] [--minimum-core-version <semver>]
  course verify <bundle-directory | compiled.json | file.course.tgz>
  course diff <from.json> <to.json>
  course migrate <course.json> <output.json>
  course import <bundle-directory | compiled.json> <output.json>
`;
const COMMANDS: Record<string, { args: number | number[]; flags: string[]; valued: string[]; repeated?: string[] }> = {
  init: { args: 1, flags: [], valued: ['--id', '--title', '--locale', '--locales'] }, validate: { args: 1, flags: [], valued: [] },
  lint: { args: 1, flags: ['--strict'], valued: [] }, locales: { args: 1, flags: [], valued: [] },
  compile: { args: 2, flags: [], valued: [] }, inspect: { args: 1, flags: [], valued: [] }, test: { args: 1, flags: [], valued: [] },
  pack: { args: [1, 2], flags: ['--no-learner'], valued: ['--out', '--registry', '--repository', '--commit', '--minimum-core-version'],
    repeated: ['--host-requirement', '--licence', '--other'] }, verify: { args: 1, flags: [], valued: [] }, diff: { args: 2, flags: [], valued: [] },
  migrate: { args: 2, flags: [], valued: [] }, import: { args: 2, flags: [], valued: [] },
};

class UsageError extends Error {}
const out = (value: unknown) => process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

async function readText(file: string): Promise<string> {
  const content = await readFile(file, 'utf8');
  if (Buffer.byteLength(content) > MAX_BYTES) throw new Error('Input exceeds 16 MiB.');
  return content;
}
const readJson = async (file: string): Promise<unknown> => JSON.parse(await readText(file));
/** A bundle directory is read by its fixed file names only; anything else is reported by verification. */
async function readBundleOrJson(target: string): Promise<unknown> {
  const stat = await lstat(target);
  if (!stat.isDirectory()) return readJson(target);
  const files: Record<string, string> = {};
  for (const name of BUNDLE_FILES) {
    const file = path.join(target, name);
    const entry = await lstat(file).catch(() => undefined);
    if (entry?.isFile()) files[name] = await readText(file);
  }
  return files;
}
/**
 * 0.6: reads a course from a manifest file or a course directory. A directory holds `course.json`
 * and, optionally, one `locales/<tag>.json` bundle per additional locale; bundles and any inline
 * LocalizedText are assembled into `translations` (see assembleCourse). Returns the bytes as read
 * when nothing needed assembly, so packages keep the author's exact manifest.
 */
async function readCourse(target: string, packing = false): Promise<{ course: unknown; bytes?: Uint8Array }> {
  const directory = (await lstat(target)).isDirectory();
  const file = directory ? path.join(target, 'course.json') : target;
  // Packing reads regular files only (no links), as it always has; other commands read like readJson.
  const bytes = packing ? await readBytes(file, COURSE_PACKAGE_LIMITS.memberBytes) : new TextEncoder().encode(await readText(file));
  const course: unknown = JSON.parse(new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes));
  const bundles = directory ? await readLocaleBundles(path.join(target, 'locales')) : {};
  if (!Object.keys(bundles).length && !hasLocalizedText(course)) return { course, bytes };
  const assembled = assembleDraft(course, { translations: bundles });
  if (assembled.issues.length) throw new CourseValidationError(assembled.issues);
  return { course: assembled.course };
}
/** `locales/<tag>.json` files of a course directory (regular files only; other names are ignored). */
async function readLocaleBundles(directory: string): Promise<Record<string, LocaleBundle>> {
  const stat = await lstat(directory).catch(() => undefined);
  if (!stat) return {};
  if (!stat.isDirectory()) throw new Error(`${directory} must be a directory of <locale>.json bundles.`);
  const bundles: Record<string, LocaleBundle> = {};
  for (const name of (await readdir(directory)).sort()) {
    if (!name.endsWith('.json')) continue;
    const tag = name.slice(0, -'.json'.length);
    if (canonicalLocale(tag) !== tag) throw new Error(`${path.join(directory, name)}: name locale bundles <tag>.json with a canonical tag (such as he or en-GB).`);
    bundles[tag] = JSON.parse(new TextDecoder('utf-8', { ignoreBOM: true }).decode(await readBytes(path.join(directory, name), MAX_BYTES))) as LocaleBundle;
  }
  return bundles;
}
// Exclusive creation prevents accidentally replacing an existing artifact.
const writeNew = (file: string, content: string) => writeFile(file, content, { flag: 'wx', mode: 0o600 });

function parse(argv: string[]): { command: string; args: string[]; flags: Set<string>; values: Map<string, string>; lists: Map<string, string[]> } {
  const [command, ...rest] = argv;
  const spec = command ? COMMANDS[command] : undefined;
  if (!command || !spec) throw new UsageError('Unknown command.');
  const args: string[] = [], flags = new Set<string>(), values = new Map<string, string>(), lists = new Map<string, string[]>();
  for (let i = 0; i < rest.length; i++) {
    const token = rest[i]!;
    if (token.startsWith('-')) {
      const value = rest[i + 1] !== undefined && !rest[i + 1]!.startsWith('-') ? rest[i + 1]! : undefined;
      if (spec.flags.includes(token)) flags.add(token);
      else if (spec.valued.includes(token) && value !== undefined && !values.has(token)) { values.set(token, value); i++; }
      else if (spec.repeated?.includes(token) && value !== undefined) { lists.set(token, [...(lists.get(token) ?? []), value]); i++; }
      else throw new UsageError(`Unknown, repeated or incomplete option ${token}.`);
    } else args.push(token);
  }
  const counts = Array.isArray(spec.args) ? spec.args : [spec.args];
  if (!counts.includes(args.length)) throw new UsageError(`${command} expects ${counts.join(' or ')} argument(s).`);
  return { command, args, flags, values, lists };
}

/** Reads a regular file's bytes, refusing links, directories and oversized input before reading. */
async function readBytes(file: string, limit: number): Promise<Uint8Array> {
  const stat = await lstat(file);
  if (!stat.isFile()) throw new Error(`${file} must be a regular file.`);
  if (stat.size > limit) throw new CoursePackageError('PACKAGE_TOO_LARGE', `${path.basename(file)} exceeds ${limit} bytes.`);
  return new Uint8Array(await readFile(file));
}
const packageFiles = async (files: string[] | undefined): Promise<PackageFile[]> =>
  Promise.all((files ?? []).map(async file => ({ name: path.basename(file), bytes: await readBytes(file, COURSE_PACKAGE_LIMITS.memberBytes) })));

async function packPackage(source: string, values: Map<string, string>, lists: Map<string, string[]>, flags: Set<string>): Promise<number> {
  const read = await readCourse(source, true);
  const output = values.get('--out')!;
  const checksumFile = `${output}.sha256`;
  for (const file of [output, checksumFile]) if (await lstat(file).catch(() => undefined)) throw new Error(`${file} already exists.`);
  const source_ = { ...(values.has('--repository') ? { repository: values.get('--repository')! } : {}), ...(values.has('--commit') ? { commit: values.get('--commit')! } : {}) };
  const bytes = packCoursePackage({
    // As read, or the assembled manifest (with every locale's bundle) for a directory with locales/.
    manifest: read.bytes ?? read.course,
    learner: !flags.has('--no-learner'),
    ...(values.has('--registry') ? { adaptationRegistry: await readBytes(values.get('--registry')!, COURSE_PACKAGE_LIMITS.memberBytes) } : {}),
    hostRequirements: await packageFiles(lists.get('--host-requirement')),
    licences: await packageFiles(lists.get('--licence')),
    others: await packageFiles(lists.get('--other')),
    ...(Object.keys(source_).length ? { source: source_ } : {}),
    ...(values.has('--minimum-core-version') ? { minimumCoreVersion: values.get('--minimum-core-version')! } : {}),
  });
  const verified = verifyCoursePackage(bytes);
  await writeFile(output, bytes, { flag: 'wx', mode: 0o644 });
  await writeFile(checksumFile, coursePackageChecksum(bytes, path.basename(output)), { flag: 'wx', mode: 0o644 });
  out({ output, checksum: checksumFile, ...packageSummary(verified, bytes) });
  return 0;
}

function packageSummary(verified: ReturnType<typeof verifyCoursePackage>, bytes: Uint8Array) {
  const { packageManifest: listing } = verified;
  return {
    courseId: listing.courseId, courseVersion: listing.courseVersion, courseDigest: listing.courseDigest, sdkVersion: listing.sdkVersion,
    minimumCoreVersion: listing.minimumCoreVersion, source: listing.source ?? null, packageBytes: bytes.length,
    members: verified.members.map(({ name, role, bytes, sha256 }) => ({ name, role, bytes, sha256 })),
  };
}

async function verifyPackage(file: string): Promise<number> {
  try {
    const bytes = await readBytes(file, COURSE_PACKAGE_LIMITS.compressedBytes);
    const checksumFile = `${file}.sha256`;
    const checksum = await lstat(checksumFile).catch(() => undefined);
    if (checksum) {
      if (!checksum.isFile() || checksum.size > 4096) throw new CoursePackageError('PACKAGE_CHECKSUM_INVALID', 'The .sha256 file must be a small regular file.');
      verifyCoursePackageChecksum(bytes, await readFile(checksumFile, 'utf8'), path.basename(file));
    }
    const verified = verifyCoursePackage(bytes);
    out({ valid: true, kind: 'course-package', checksum: checksum ? 'verified' : 'absent', ...packageSummary(verified, bytes) });
    return 0;
  } catch (error) {
    if (!(error instanceof CoursePackageError)) throw error;
    out({ valid: false, kind: 'course-package', code: error.code, message: error.message, ...(error.member ? { member: error.member } : {}), ...(error.issues ? { issues: error.issues } : {}) });
    return 1;
  }
}

/** A gzip file (not a directory) is a course package. */
async function isGzipFile(target: string): Promise<boolean> {
  const stat = await lstat(target);
  if (!stat.isFile() || stat.size < 2) return false;
  const handle = await open(target, 'r');
  try {
    const head = new Uint8Array(2);
    await handle.read(head, 0, 2, 0);
    return head[0] === 0x1f && head[1] === 0x8b;
  } finally { await handle.close(); }
}

async function run(argv: string[]): Promise<number> {
  const { command, args, flags, values, lists } = parse(argv);
  const packageOptions = [...values.keys(), ...lists.keys(), ...flags].filter(option => option !== '--strict');
  if (command === 'pack' && (args.length === 1) !== values.has('--out')) throw new UsageError('pack takes either <output-directory> or --out <file.course.tgz>.');
  if (command === 'pack' && args.length === 2 && packageOptions.length) throw new UsageError('Package options need --out <file.course.tgz>.');
  const [first, second] = args as [string, string | undefined];
  switch (command) {
    case 'init': {
      const locales = values.get('--locales')?.split(',').map(tag => tag.trim()).filter(Boolean);
      const course = scaffoldCourse({ ...(values.has('--id') ? { id: values.get('--id')! } : {}), ...(values.has('--title') ? { title: values.get('--title')! } : {}),
        ...(values.has('--locale') ? { locale: values.get('--locale')! } : {}), ...(locales ? { locales } : {}) });
      const result = validateCourse(course);
      if (!result.valid) throw new CourseValidationError(result.issues);
      await mkdir(first); // refuses an existing directory
      // Additional locales are written as parallel bundles: course.json keeps the source text.
      const { translations, ...manifest } = course;
      await writeNew(path.join(first, 'course.json'), json(manifest));
      const created = [path.join(first, 'course.json')];
      if (translations) {
        await mkdir(path.join(first, 'locales'));
        for (const [tag, bundle] of Object.entries(translations)) {
          await writeNew(path.join(first, 'locales', `${tag}.json`), json(bundle));
          created.push(path.join(first, 'locales', `${tag}.json`));
        }
      }
      out({ created, id: course.id, locale: course.locale, locales: course.locales ?? [] });
      return 0;
    }
    case 'validate': {
      const result = validateCourse((await readCourse(first)).course);
      out({ valid: result.valid, issues: result.issues });
      return result.valid ? 0 : 1;
    }
    case 'locales': {
      const course = (await readCourse(first)).course;
      const result = validateCourse(course);
      // Coverage of a schema-invalid course would be meaningless; report the issues instead.
      const shaped = result.valid || result.issues.every(issue => issue.code !== 'SCHEMA' && issue.code !== 'NOT_JSON' && issue.code !== 'JSON_LIMIT');
      const texts = courseTextKeys(course);
      const coverage = shaped ? localeCoverage(course as CourseManifest).map(entry => ({ ...entry,
        missing: entry.missing.map(key => ({ key, source: texts.get(key)!.path, text: texts.get(key)!.text })) })) : [];
      out({ valid: result.valid, locale: shaped ? (course as CourseManifest).locale : null, locales: coverage, issues: result.issues });
      return result.valid ? 0 : 1;
    }
    case 'lint': {
      const findings = lintCourse((await readCourse(first)).course);
      const failing = findings.filter(f => f.severity === 'error' || (flags.has('--strict') && f.severity === 'warning'));
      out({ ok: failing.length === 0, findings });
      return failing.length ? 1 : 0;
    }
    case 'compile': {
      const compiled = compileCourse((await readCourse(first)).course);
      await writeNew(second!, json(compiled));
      out({ digest: compiled.digest, output: second });
      return 0;
    }
    case 'inspect': {
      const summary = inspectCourse((await readCourse(first)).course);
      out(summary);
      return summary.valid ? 0 : 1;
    }
    case 'test': {
      const report = conformanceReport((await readCourse(first)).course);
      out(report);
      return report.status === 'failed' ? 1 : 0;
    }
    case 'pack': {
      if (values.has('--out')) return packPackage(first, values, lists, flags);
      const files = packCourse((await readCourse(first)).course);
      await mkdir(second!); // refuses an existing directory
      for (const [name, content] of Object.entries(files)) await writeNew(path.join(second!, name), content);
      out({ output: second, files: Object.keys(files), manifest: JSON.parse(files['manifest.json']!) });
      return 0;
    }
    case 'verify': {
      if (await isGzipFile(first)) return verifyPackage(first);
      const source = await readBundleOrJson(first);
      if (source && typeof source === 'object' && !('formatVersion' in source)) {
        const result = verifyCourseBundle(source as Record<string, string>);
        out({ valid: result.valid, kind: 'bundle', digest: result.compiled?.digest ?? null, issues: result.issues, warnings: result.warnings });
        return result.valid ? 0 : 1;
      }
      const valid = verifyCompiledCourse(source);
      out({ valid, kind: 'compiled', digest: valid ? source.digest : null });
      return valid ? 0 : 1;
    }
    case 'diff': {
      out(diffCourses((await readCourse(first)).course, (await readCourse(second!)).course));
      return 0;
    }
    case 'migrate': {
      const result = migrateCourse(await readJson(first));
      await writeNew(second!, json(result.course));
      out({ output: second, status: result.issues.length ? 'needs_review' : 'valid', changes: result.changes, manualSteps: result.manualSteps, issues: result.issues });
      return result.issues.length ? 1 : 0;
    }
    case 'import': {
      const course = importCourse(await readBundleOrJson(first));
      await writeNew(second!, json(course));
      out({ output: second, id: course.id, version: course.version });
      return 0;
    }
  }
  throw new UsageError('Unknown command.');
}

try {
  process.exitCode = await run(process.argv.slice(2));
} catch (error) {
  if (error instanceof UsageError) {
    process.stderr.write(`${error.message}\n${USAGE}`);
    process.exitCode = 2;
  } else {
    const code = error instanceof CoursePackageError ? { code: error.code, ...(error.member ? { member: error.member } : {}) } : {};
    const issues = error instanceof CoursePackageError ? error.issues : error instanceof CourseValidationError || error instanceof CourseBundleError || error instanceof ContractValidationError ? error.issues : undefined;
    process.stderr.write(`${JSON.stringify({ error: error instanceof Error ? error.message : 'Course operation failed.', ...code, ...(issues ? { issues } : {}) })}\n`);
    process.exitCode = 1;
  }
}
