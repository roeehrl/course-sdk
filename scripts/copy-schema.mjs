import { copyFile } from 'node:fs/promises';
await copyFile(new URL('../src/course.schema.json', import.meta.url), new URL('../dist/course.schema.json', import.meta.url));
