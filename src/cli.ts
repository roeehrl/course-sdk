#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { compileCourse, CourseValidationError } from './compiler.js';
import { validateCourse } from './validate.js';

const [command, inputPath, outputPath] = process.argv.slice(2);
if ((command !== 'validate' && command !== 'compile') || !inputPath || (command === 'compile' && !outputPath)) {
  process.stderr.write('Usage: course validate <course.json> | course compile <course.json> <output.json>\n');
  process.exitCode = 2;
} else {
  try {
    const content = await readFile(inputPath, 'utf8');
    if (Buffer.byteLength(content) > 16 * 1024 * 1024) throw new Error('Course input exceeds 16 MiB.');
    const input: unknown = JSON.parse(content);
    if (command === 'validate') {
      const result = validateCourse(input);
      process.stdout.write(`${JSON.stringify({ valid: result.valid, issues: result.issues }, null, 2)}\n`);
      if (!result.valid) process.exitCode = 1;
    } else {
      const compiled = compileCourse(input);
      // Exclusive creation prevents accidentally replacing an existing course artifact.
      await writeFile(outputPath!, `${JSON.stringify(compiled, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
      process.stdout.write(`${JSON.stringify({ digest: compiled.digest, output: outputPath })}\n`);
    }
  } catch (error) {
    const body = error instanceof CourseValidationError ? { error: error.message, issues: error.issues }
      : { error: error instanceof Error ? error.message : 'Course operation failed.' };
    process.stderr.write(`${JSON.stringify(body)}\n`);
    process.exitCode = 1;
  }
}
