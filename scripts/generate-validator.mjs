import { readFile, mkdir } from 'node:fs/promises';
import { Ajv2020, _ } from 'ajv/dist/2020.js';
import { fullFormats } from 'ajv-formats/dist/formats.js';
import standaloneCode from 'ajv/dist/standalone/index.js';
import { build } from 'esbuild';

const schema = JSON.parse(await readFile(new URL('../src/course.schema.json', import.meta.url), 'utf8'));
const ajv = new Ajv2020({
  allErrors: true, strict: true, strictRequired: false, ownProperties: true,
  code: { source: true, formats: _`require("ajv-formats/dist/formats").fullFormats` },
});
ajv.addFormat('date-time', fullFormats['date-time']);
ajv.addFormat('uri', fullFormats.uri);
const validate = ajv.compile(schema);
await mkdir(new URL('../src/generated/', import.meta.url), { recursive: true });
// Bundle generated static functions, so runtime validation never invokes eval/new Function.
await build({
  stdin: { contents: standaloneCode(ajv, validate), resolveDir: new URL('..', import.meta.url).pathname, sourcefile: 'course-validator.cjs' },
  outfile: new URL('../src/generated/course-validator.js', import.meta.url).pathname,
  bundle: true, platform: 'browser', format: 'esm', target: 'es2022', legalComments: 'inline',
});
