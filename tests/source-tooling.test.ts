import { describe, expect, it } from 'vitest';
import { extractExamples } from '../scripts/docs-examples.mjs';
import { lintText, portableImportProblems } from '../scripts/lint-source.mjs';

const root = new URL('../', import.meta.url).pathname;

describe('documentation examples', () => {
  it('collects ts fences, honours skip, typecheck and continue, and ignores other languages', () => {
    const markdown = ['```ts', 'const a = 1;', '```', '<!-- docs-example: continue -->', '```ts', 'console.log(a);', '```',
      '<!-- docs-example: skip -->', '```ts', 'retention: {}', '```', '<!-- docs-example: typecheck -->', '```ts', 'declare const x: number;', '```',
      '```sh', 'npm test', '```'].join('\n');
    expect(extractExamples(markdown)).toEqual([
      { line: 2, code: 'const a = 1;\nconsole.log(a);', mode: 'run' },
      { line: 14, code: 'declare const x: number;', mode: 'typecheck' },
    ]);
    expect(() => extractExamples('```ts\nconst a = 1;\n')).toThrow(/Unclosed/);
    expect(() => extractExamples('<!-- docs-example: continue -->\n```ts\nx\n```')).toThrow(/no previous example/);
  });
});

describe('source lint rules', () => {
  // Rule samples are assembled from parts so this file does not trip the rules itself.
  it('flags code generation, focused tests, suppressions, library console output and attribution', () => {
    expect(lintText('src/a.ts', 'const x = eval(text);')).toEqual(['src/a.ts:1 no-eval Code generation from strings is not allowed.']);
    expect(lintText('tests/a.test.ts', `describe${'.'}only('x', () => {});`)[0]).toContain('no-focused-tests');
    expect(lintText('src/a.ts', `// @ts-${'nocheck'}`)[0]).toContain('no-ts-suppression');
    expect(lintText('src/a.ts', 'console.warn(x);')[0]).toContain('no-console-in-library');
    expect(lintText('CHANGELOG.md', `Co-${'Authored'}-By: a bot`)[0]).toContain('no-attribution');
    // The CLI may print; retrieval is not eval; a test named "only" is not focused.
    expect(lintText('src/cli.ts', 'console.error(x);')).toEqual([]);
    expect(lintText('src/a.ts', 'const v = retrieval(x);')).toEqual([]);
  });

  it('keeps the portable main entry free of Node modules', async () => {
    expect(await portableImportProblems(root)).toEqual([]);
  });
});
