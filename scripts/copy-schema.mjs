import { copyFile, readFile, writeFile } from 'node:fs/promises';
import { eventExportSchema } from './event-export-schema.mjs';
await copyFile(new URL('../src/course.schema.json', import.meta.url), new URL('../dist/course.schema.json', import.meta.url));
await copyFile(new URL('../src/adaptation.schema.json', import.meta.url), new URL('../dist/adaptation.schema.json', import.meta.url));
await copyFile(new URL('../src/course-package.schema.json', import.meta.url), new URL('../dist/course-package.schema.json', import.meta.url));
await copyFile(new URL('../src/generated/validator-dependencies.json', import.meta.url), new URL('../dist/validator-dependencies.json', import.meta.url));
const course = JSON.parse(await readFile(new URL('../src/course.schema.json', import.meta.url), 'utf8'));
await writeFile(new URL('../dist/learning-event-export.schema.json', import.meta.url), `${JSON.stringify(eventExportSchema(course), null, 2)}\n`);
