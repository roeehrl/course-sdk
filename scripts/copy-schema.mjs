import { copyFile } from 'node:fs/promises';
await copyFile(new URL('../src/course.schema.json', import.meta.url), new URL('../dist/course.schema.json', import.meta.url));
await copyFile(new URL('../src/adaptation.schema.json', import.meta.url), new URL('../dist/adaptation.schema.json', import.meta.url));
await copyFile(new URL('../src/course-package.schema.json', import.meta.url), new URL('../dist/course-package.schema.json', import.meta.url));
await copyFile(new URL('../src/generated/validator-dependencies.json', import.meta.url), new URL('../dist/validator-dependencies.json', import.meta.url));
