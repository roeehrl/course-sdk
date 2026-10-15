#!/usr/bin/env node
import { lstat, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  BUNDLE_FILES, compileCourse, conformanceReport, CourseBundleError, CourseValidationError, diffCourses, importCourse, inspectCourse,
  migrateCourse, packCourse, scaffoldCourse, verifyCompiledCourse, verifyCourseBundle,
} from './compiler.js';
import { validateCourse } from './validate.js';
import { lintCourse } from './lint.js';
import { ContractValidationError } from './define.js';

const MAX_BYTES = 16 * 1024 * 1024;
const USAGE = `Usage:
  course init <directory> [--id <id>] [--title <title>]
  course validate <course.json>
  course lint <course.json> [--strict]
  course compile <course.json> <output.json>
  course inspect <course.json | compiled.json>
  course test <course.json>
  course pack <course.json> <output-directory>
  course verify <bundle-directory | compiled.json>
  course diff <from.json> <to.json>
  course migrate <course.json> <output.json>
  course import <bundle-directory | compiled.json> <output.json>
`;
const COMMANDS: Record<string, { args: number; flags: string[]; valued: string[] }> = {
  init: { args: 1, flags: [], valued: ['--id', '--title'] }, validate: { args: 1, flags: [], valued: [] }, lint: { args: 1, flags: ['--strict'], valued: [] },
  compile: { args: 2, flags: [], valued: [] }, inspect: { args: 1, flags: [], valued: [] }, test: { args: 1, flags: [], valued: [] },
  pack: { args: 2, flags: [], valued: [] }, verify: { args: 1, flags: [], valued: [] }, diff: { args: 2, flags: [], valued: [] },
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
// Exclusive creation prevents accidentally replacing an existing artifact.
const writeNew = (file: string, content: string) => writeFile(file, content, { flag: 'wx', mode: 0o600 });

function parse(argv: string[]): { command: string; args: string[]; flags: Set<string>; values: Map<string, string> } {
  const [command, ...rest] = argv;
  const spec = command ? COMMANDS[command] : undefined;
  if (!command || !spec) throw new UsageError('Unknown command.');
  const args: string[] = [], flags = new Set<string>(), values = new Map<string, string>();
  for (let i = 0; i < rest.length; i++) {
    const token = rest[i]!;
    if (token.startsWith('-')) {
      if (spec.flags.includes(token)) flags.add(token);
      else if (spec.valued.includes(token) && rest[i + 1] !== undefined && !rest[i + 1]!.startsWith('-')) values.set(token, rest[++i]!);
      else throw new UsageError(`Unknown or incomplete option ${token}.`);
    } else args.push(token);
  }
  if (args.length !== spec.args) throw new UsageError(`${command} expects ${spec.args} argument(s).`);
  return { command, args, flags, values };
}

async function run(argv: string[]): Promise<number> {
  const { command, args, flags, values } = parse(argv);
  const [first, second] = args as [string, string | undefined];
  switch (command) {
    case 'init': {
      await mkdir(first); // refuses an existing directory
      const course = scaffoldCourse({ ...(values.has('--id') ? { id: values.get('--id')! } : {}), ...(values.has('--title') ? { title: values.get('--title')! } : {}) });
      const result = validateCourse(course);
      if (!result.valid) throw new CourseValidationError(result.issues);
      await writeNew(path.join(first, 'course.json'), json(course));
      out({ created: path.join(first, 'course.json'), id: course.id });
      return 0;
    }
    case 'validate': {
      const result = validateCourse(await readJson(first));
      out({ valid: result.valid, issues: result.issues });
      return result.valid ? 0 : 1;
    }
    case 'lint': {
      const findings = lintCourse(await readJson(first));
      const failing = findings.filter(f => f.severity === 'error' || (flags.has('--strict') && f.severity === 'warning'));
      out({ ok: failing.length === 0, findings });
      return failing.length ? 1 : 0;
    }
    case 'compile': {
      const compiled = compileCourse(await readJson(first));
      await writeNew(second!, json(compiled));
      out({ digest: compiled.digest, output: second });
      return 0;
    }
    case 'inspect': {
      const summary = inspectCourse(await readJson(first));
      out(summary);
      return summary.valid ? 0 : 1;
    }
    case 'test': {
      const report = conformanceReport(await readJson(first));
      out(report);
      return report.status === 'failed' ? 1 : 0;
    }
    case 'pack': {
      const files = packCourse(await readJson(first));
      await mkdir(second!); // refuses an existing directory
      for (const [name, content] of Object.entries(files)) await writeNew(path.join(second!, name), content);
      out({ output: second, files: Object.keys(files), manifest: JSON.parse(files['manifest.json']!) });
      return 0;
    }
    case 'verify': {
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
      out(diffCourses(await readJson(first), await readJson(second!)));
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
    const issues = error instanceof CourseValidationError || error instanceof CourseBundleError || error instanceof ContractValidationError ? error.issues : undefined;
    process.stderr.write(`${JSON.stringify({ error: error instanceof Error ? error.message : 'Course operation failed.', ...(issues ? { issues } : {}) })}\n`);
    process.exitCode = 1;
  }
}
