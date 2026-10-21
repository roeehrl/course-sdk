import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { build } from 'esbuild';
import fc from 'fast-check';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  assembleCourse, bindData, canonicalLocale, ContractValidationError, courseText, courseTextKeys, decideGate, defineCourse, defineInteraction,
  defineVisualExperience, defineVisualPane, formatSdkMessage, formatSdkMessages, isSupportedLocale, lintCourse, localeCoverage, localeDirection,
  localizeCourse, negotiateLocale, publicationIssues, SDK_MESSAGE_IDS, SDK_MESSAGES, structureDifferences, textStructure, validateCourse, validateRecord,
} from '../src/index.js';
import { compileCourse, conformanceReport, diffCourses, migrateCourse, packCoursePackage, scaffoldCourse, verifyCoursePackage } from '../src/compiler.js';
import { messageParameters } from '../src/messages.js';
import type { CourseManifest, Evidence, LocaleBundle } from '../src/index.js';
import { courseFixture } from './fixture.js';
import { richCourse } from './contracts-fixture.js';

const example = () => JSON.parse(readFileSync(new URL('../examples/mean-starter/course.json', import.meta.url), 'utf8')) as CourseManifest;
const exampleHe = () => JSON.parse(readFileSync(new URL('../examples/mean-starter/locales/he.json', import.meta.url), 'utf8')) as LocaleBundle;
const assembledExample = () => assembleCourse(example(), { translations: { he: exampleHe() } });
const codes = (input: unknown) => { const r = validateCourse(input); return r.valid ? [] : r.issues.map(i => i.code); };

/** A course with `he` declared and every text translated (structure-preserving prefix). */
function bilingual(base: CourseManifest = courseFixture()): CourseManifest {
  const course = structuredClone(base);
  course.locales = ['he'];
  course.translations = { he: { texts: Object.fromEntries([...courseTextKeys(course)].map(([key, { text }]) => [key, `בעברית: ${text}`])) } };
  return course;
}

describe('locale tags', () => {
  it('supports en and he, with an optional region, in canonical case', () => {
    expect(['en', 'he', 'en-GB', 'he-IL', 'en-001'].map(isSupportedLocale)).toEqual([true, true, true, true, true]);
    expect(['fr', 'EN', 'en_US', 'english', 'he-il', '', 'e'].map(isSupportedLocale)).toEqual([false, false, false, false, false, false, false]);
    expect(['EN', 'en_us', ' he-il ', 'HE'].map(canonicalLocale)).toEqual(['en', 'en-US', 'he-IL', 'he']);
    expect(canonicalLocale('not a tag')).toBeUndefined();
  });
  it('derives direction from the language, not from authors', () => {
    expect(['en', 'en-GB', 'he', 'he-IL', 'fr'].map(localeDirection)).toEqual(['ltr', 'ltr', 'rtl', 'rtl', 'ltr']);
  });
  it('negotiates exact tags, then the language, then the fallback', () => {
    expect(negotiateLocale(['he-IL', 'en'], ['en', 'he'], 'en')).toBe('he');
    expect(negotiateLocale(['fr', 'en-US'], ['he', 'en'], 'he')).toBe('en');
    expect(negotiateLocale(['fr'], ['en', 'he'], 'en')).toBe('en');
    expect(negotiateLocale(['HE'], ['en', 'he'], 'en')).toBe('he');
  });
});

describe('course locale validation', () => {
  it('keeps every course that declares "en" valid and reports unsupported tags with a hint', () => {
    expect(codes(courseFixture())).toEqual([]);
    for (const [locale, hint] of [['fr', false], ['EN', true], ['en_US', true]] as const) {
      const course = { ...courseFixture(), locale };
      const issue = (validateCourse(course) as { issues: { code: string; path: string; message: string }[] }).issues[0]!;
      expect(issue).toMatchObject({ code: 'UNSUPPORTED_LOCALE', path: '/locale' });
      expect(issue.message.includes('Write it as')).toBe(hint);
    }
  });
  it('accepts a complete bundle and a partial one with explicit fallbacks', () => {
    expect(codes(bilingual())).toEqual([]);
    const partial = bilingual();
    delete partial.translations!.he!.texts['course#summary'];
    partial.translations!.he!.fallback = ['course#summary'];
    expect(codes(partial)).toEqual([]);
    expect(localeCoverage(partial)[1]).toMatchObject({ locale: 'he', direction: 'rtl', fallback: ['course#summary'], missing: [], complete: false });
    expect(lintCourse(partial).find(f => f.code === 'TRANSLATION_FALLBACK')).toMatchObject({ severity: 'info', path: '/translations/he/fallback' });
    expect(conformanceReport(partial).checks.find(c => c.id === 'locales')).toMatchObject({ status: 'warning' });
  });
  it('rejects missing, unknown, blank and conflicting translations with stable codes and paths', () => {
    const missing = bilingual(); delete missing.translations!.he!.texts['episode:compare-pair#title'];
    expect(validateCourse(missing).issues).toEqual([expect.objectContaining({ code: 'MISSING_TRANSLATION', path: '/translations/he/texts', message: expect.stringContaining('episode:compare-pair#title') })]);
    const unknown = bilingual(); unknown.translations!.he!.texts['episode:compare-pair-he#title'] = 'כותרת';
    expect(validateCourse(unknown).issues).toEqual([expect.objectContaining({ code: 'UNKNOWN_TEXT_KEY', path: '/translations/he/texts/episode:compare-pair-he#title' })]);
    const blank = bilingual(); blank.translations!.he!.texts['course#title'] = '  ';
    expect(codes(blank)).toEqual(['BLANK_TRANSLATION']);
    const both = bilingual(); both.translations!.he!.fallback = ['course#title'];
    expect(codes(both)).toEqual(['TRANSLATION_FALLBACK_CONFLICT']);
    const ghost = bilingual(); ghost.translations!.he!.fallback = ['objective:ghost#description'];
    expect(validateCourse(ghost).issues).toEqual([expect.objectContaining({ code: 'UNKNOWN_TEXT_KEY', path: '/translations/he/fallback/0' })]);
  });
  it('keeps answer keys, tolerances and IDs out of translation', () => {
    for (const key of ['assessment:pair-a#correctOptionId', 'assessment:pair-b#expected', 'assessment:pair-a/option:three#id', 'gate:compare-ready#objectiveIds']) {
      const course = bilingual(); course.translations!.he!.texts[key] = 'x';
      expect(codes(course), key).toEqual(['UNKNOWN_TEXT_KEY']);
    }
  });
  it('requires declared locales and their bundles to agree', () => {
    const undeclared = bilingual(); undeclared.locales = [];
    expect(codes(undeclared)).toEqual(['UNDECLARED_LOCALE']);
    const noBundle = bilingual(); noBundle.locales = ['he', 'en-GB'];
    expect(codes(noBundle)).toEqual(['MISSING_TRANSLATIONS']);
    const self = bilingual(); self.locales = ['he', 'en'];
    expect(codes(self)).toEqual(['DUPLICATE_LOCALE']);
    const unsupported = bilingual(); unsupported.locales = ['he', 'fr']; unsupported.translations!.fr = structuredClone(unsupported.translations!.he!);
    expect(codes(unsupported)).toEqual(['UNSUPPORTED_LOCALE']);
    expect(codes({ ...bilingual(), locales: ['he', 'he'] })).toEqual(['SCHEMA']);
  });
  it('refuses locale-specific IDs once a course ships more than one locale', () => {
    const course = bilingual();
    course.chapters[0]!.episodes[0]!.blocks[0]!.id = 'explain-he';
    for (const key of Object.keys(course.translations!.he!.texts)) if (key.includes('block:explain#')) {
      course.translations!.he!.texts[key.replace('block:explain#', 'block:explain-he#')] = course.translations!.he!.texts[key]!;
      delete course.translations!.he!.texts[key];
    }
    expect(validateCourse(course).issues).toEqual([expect.objectContaining({ code: 'LOCALE_SPECIFIC_ID', path: '/chapters/0/episodes/0/blocks/0/id' })]);
    const single = structuredClone(courseFixture()); single.chapters[0]!.episodes[0]!.blocks[0]!.id = 'explain-he';
    expect(codes(single)).toEqual([]); // 0.5 data is unaffected
  });
  it('requires placeholders, code, math, images, links and headings to survive translation', () => {
    const same = 'Use `x = 1` and $a^2$ here.\n\n```py\nprint(1)\n```\n![plot](asset:plot.png) see [docs](https://example.invalid).';
    expect(structureDifferences(same, 'השתמשו ב־`x = 1` וב־$a^2$ כאן.\n\n```py\nprint(1)\n```\n![גרף](asset:plot.png) ראו [תיעוד](https://example.invalid/he).')).toEqual([]);
    const cases: [string, string, string][] = [
      ['Value {{a}} and {{b}}', 'ערך {{a}}', 'PLACEHOLDER_MISMATCH'],
      ['Run `len(x)`', 'הריצו `אורך(x)`', 'STRUCTURE_MISMATCH'],
      ['```py\nprint(1)\n```', '```py\nprint(2)\n```', 'STRUCTURE_MISMATCH'],
      ['Is $x^2$ even?', 'האם x בריבוע זוגי?', 'STRUCTURE_MISMATCH'],
      ['![a](asset:a.png)', '![א](asset:b.png)', 'STRUCTURE_MISMATCH'],
      ['## Title\ntext', 'כותרת\nטקסט', 'STRUCTURE_MISMATCH'],
      ['See [a](https://a.invalid) and [b](https://b.invalid)', 'ראו [א](https://a.invalid)', 'STRUCTURE_MISMATCH'],
    ];
    for (const [source, translation, code] of cases) expect(structureDifferences(source, translation).map(d => d.code), source).toEqual([code]);
    // Prices are not math: "$5 and $10" has no closing delimiter after a non-space.
    expect(structureDifferences('It costs $5 and $10.', 'זה עולה 5 או 10 דולר.')).toEqual([]);
    expect(textStructure('a `x` b ``y`z`` c `unclosed')).toMatchObject({ inlineCode: ['x', 'y`z'] });
    expect(textStructure('```py\nprint(1)\n```\ntext\n~~~\nopen')).toMatchObject({ codeBlocks: ['py\nprint(1)', '\nopen'] });
    expect(textStructure('$$ a $$ and \\(b\\) and \\[c\\] and $d$ but not $5 and $10.')).toMatchObject({ math: ['a', 'b', 'c', 'd'] });
    expect(textStructure('![x](a.png "t") [l](u) [m]( <v> )')).toMatchObject({ images: ['a.png'], links: 2 });
    const course = bilingual();
    course.chapters[0]!.episodes[0]!.blocks[0] = { id: 'explain', type: 'text', markdown: 'Run `sort(values)` first.' };
    course.translations!.he!.texts['episode:compare-pair/block:explain#markdown'] = 'קודם הריצו `מיין(ערכים)`.';
    expect(validateCourse(course).issues).toEqual([expect.objectContaining({ code: 'STRUCTURE_MISMATCH', path: '/translations/he/texts/episode:compare-pair~1block:explain#markdown' })]);
  });
});

it('scans hostile text in linear time (hosts validate packages they did not write)', () => {
  const n = 100_000;
  for (const text of ['`'.repeat(n), '``a`'.repeat(n / 4), '!['.repeat(n / 2), '['.repeat(n), '\\('.repeat(n / 2), `${'$$'.repeat(n / 2)}x`,
    '$a'.repeat(n / 2), '```\n'.repeat(n / 4), '{{'.repeat(n / 2), '$'.repeat(n), '\\$'.repeat(n / 2)]) {
    const started = performance.now();
    textStructure(text);
    expect(performance.now() - started, text.slice(0, 6)).toBeLessThan(2000);
  }
});

describe('display, grading and the learner projection', () => {
  it('localizes a display copy without touching grading, IDs or order', () => {
    const course = assembledExample();
    const shown = localizeCourse(course, ['he-IL', 'en']);
    expect(shown).toMatchObject({ locale: 'he', direction: 'rtl', fallbacks: ['assessment:mean-choice/option:four#text', 'assessment:mean-choice/option:twelve#text'] });
    expect(shown.course.title).toBe('איך מחשבים ממוצע');
    expect('translations' in shown.course).toBe(false);
    const strip = (c: Omit<CourseManifest, 'translations'>) => c.assessments.map(a => ({ id: a.id, type: a.type, grading: 'grading' in a ? a.grading : null, options: 'options' in a ? a.options.map(o => o.id) : null }))
      .map(a => ({ ...a, grading: a.grading && 'explanation' in a.grading ? { ...a.grading, explanation: '' } : a.grading }));
    expect(strip(shown.course)).toEqual(strip(course));
    expect(localizeCourse(course, 'fr')).toMatchObject({ locale: 'en', direction: 'ltr', fallbacks: [] });
    expect(localizeCourse(course, 'en').course.title).toBe(course.title);
    expect(courseText(course, 'he', 'assessment:mean-choice#prompt')).toBe('מהו הממוצע של 2, 4 ו־6?');
    expect(courseText(course, 'he', 'assessment:mean-choice/option:four#text')).toBe('4');
    expect(courseText(course, 'he', 'assessment:ghost#prompt')).toBeUndefined();
    // A display copy is not a course: compiling it fails instead of producing a second digest.
    expect(validateCourse(shown.course).valid).toBe(false);
  });
  it('projects only translations of texts learners may see', () => {
    const course = assembledExample();
    const { learner, server, digest } = compileCourse(course);
    const keys = Object.keys(learner.translations!.he!.texts);
    expect(keys.length).toBeGreaterThan(10);
    expect(keys.filter(k => k.startsWith('assessment:') || k.startsWith('rubric:') || k.startsWith('extension:staff-review'))).toEqual([]);
    expect(learner.translations!.he!.fallback).toEqual([]);
    expect(server.translations).toEqual(course.translations);
    expect(JSON.stringify(learner)).not.toContain('מהו הממוצע');
    expect(conformanceReport(course).checks.find(c => c.id === 'learner-projection-private')!.status).toBe('passed');
    // The digest covers every locale.
    const changed = structuredClone(course); changed.translations!.he!.texts['course#title'] = 'ממוצע';
    expect(compileCourse(changed).digest).not.toBe(digest);
    expect(diffCourses(course, changed).changes).toContainEqual({ section: 'translations:he', id: 'course#title', change: 'changed' });
  });
  it('leaves courses without locales byte-identical in compiled output', () => {
    const plain = compileCourse(courseFixture());
    expect('translations' in plain.learner).toBe(false);
    expect('locales' in plain.learner).toBe(false);
  });
});

describe('graders and lint', () => {
  it('records the locale an item was shown in on an attempt', () => {
    const attempt = { attemptId: 'att-1', enrollmentId: 'enr-1', assessmentId: 'q', courseDigest: 'a'.repeat(64), response: { kind: 'answer', value: 'כי מחלקים' },
      confidence: null, assistance: { hintsUsed: 0, answerRevealed: false, tutorAuthoredContent: false }, author: 'learner', reattemptOf: null, idempotencyKey: 'k', submittedAt: '2026-10-01T00:00:00Z' };
    expect(validateRecord('attempt', { ...attempt, locale: 'he' }).valid).toBe(true);
    expect(validateRecord('attempt', attempt).valid).toBe(true);
    expect(validateRecord('attempt', { ...attempt, locale: 'fr' }).issues.map(i => i.code)).toEqual(['UNSUPPORTED_LOCALE']);
  });
  it('warns about bidi embeddings and overrides but not isolates', () => {
    const course = bilingual();
    course.translations!.he!.texts['course#title'] = 'כותרת \u202Eabc\u202C';
    course.chapters[0]!.title = 'Ordering \u2068x\u2069';
    course.translations!.he!.texts['chapter:start#title'] = 'סדר \u2068x\u2069';
    expect(lintCourse(course).filter(f => f.code === 'BIDI_OVERRIDE').map(f => f.path)).toEqual(['/translations/he/texts/course#title']);
  });
});

describe('the en + he example course', () => {
  it('is valid, publishable, complete except its declared fallbacks, and right to left in Hebrew', () => {
    const course = assembledExample();
    expect(publicationIssues(course)).toEqual([]);
    expect(lintCourse(course).filter(f => f.severity !== 'info')).toEqual([]);
    expect(localeCoverage(course).map(({ locale, direction, missing, fallback }) => ({ locale, direction, missing: missing.length, fallback: fallback.length })))
      .toEqual([{ locale: 'en', direction: 'ltr', missing: 0, fallback: 0 }, { locale: 'he', direction: 'rtl', missing: 0, fallback: 2 }]);
    // Every Hebrew text is Hebrew, not a copy of the English.
    const sources = courseTextKeys(course);
    for (const [key, text] of Object.entries(exampleHe().texts)) {
      expect(text, key).not.toBe(sources.get(key)!.text);
      expect(/[֐-׿]/.test(text), key).toBe(true);
    }
  });
  it('packs deterministically with every locale covered by the digests', () => {
    const course = assembledExample();
    const a = packCoursePackage({ manifest: course }), b = packCoursePackage({ manifest: assembledExample() });
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
    const verified = verifyCoursePackage(a);
    expect(verified.courseManifest.translations!.he!.texts['course#title']).toBe('איך מחשבים ממוצע');
    expect(verified.learner!.translations!.he!.texts['course#title']).toBe('איך מחשבים ממוצע');
    expect(verified.courseDigest).toBe(compileCourse(course).digest);
    // Bundle key order does not matter: assembly sorts keys.
    const shuffled = exampleHe(); shuffled.texts = Object.fromEntries(Object.entries(shuffled.texts).reverse());
    const c = packCoursePackage({ manifest: assembleCourse(example(), { translations: { he: shuffled } }) });
    expect(Buffer.from(c).equals(Buffer.from(a))).toBe(true);
  });
});

describe('inline localized text and the visual helpers', () => {
  const interaction = {
    id: 'pick', kind: 'tap' as const, target: 'marker', label: { en: 'Choose what to mark', he: 'בחרו מה לסמן' },
    binding: { state: 'show', values: ['mean', 'sum'], labels: [{ en: 'Mean', he: 'ממוצע' }, { en: 'Sum', he: 'סכום' }] },
  };
  it('accept LocalizedText for labels and text alternatives and validate every locale', () => {
    expect(defineInteraction(interaction)).toEqual(interaction);
    expect(bindData('show', { values: ['mean', 'sum'], labels: [{ en: 'Mean', he: 'ממוצע' }, 'Sum'] }).labels).toEqual([{ en: 'Mean', he: 'ממוצע' }, 'Sum']);
    expect(() => bindData('show', { values: ['mean', 'sum'], labels: ['Mean'] })).toThrow(expect.objectContaining({ issues: [expect.objectContaining({ code: 'INVALID_BINDING' })] }));
    const pane = { id: 'p', kind: 'formula' as const, title: { en: 'Mean', he: 'ממוצע' }, tex: '\\bar{x}', label: { en: 'x bar', he: '   ' } };
    expect(() => defineVisualPane(pane)).toThrow(expect.objectContaining({ issues: [expect.objectContaining({ code: 'MISSING_TEXT_ALTERNATIVE', message: expect.stringContaining('[he]') })] }));
    expect(() => defineInteraction({ ...interaction, label: { en: 'Pick', fr: 'Choisir' } })).toThrow(expect.objectContaining({ issues: expect.arrayContaining([expect.objectContaining({ code: 'UNSUPPORTED_LOCALE' })]) }));
    expect(() => defineInteraction({ ...interaction, label: { en: 'Pick' } })).toThrow(expect.objectContaining({ issues: [expect.objectContaining({ code: 'INCONSISTENT_LOCALIZED_TEXT' })] }));
  });
  it('assembleCourse moves inline variants into translations, and defineCourse refuses unassembled text', () => {
    const base = assembledExample();
    const visual = defineVisualExperience({ ...structuredClone(base.visuals[0]!), interactions: [defineInteraction({ ...interaction, target: 'marker' })],
      accessibility: { description: { en: 'A dot plot.', he: 'תרשים נקודות.' }, reducedMotion: {} } });
    const draft = { ...example(), visuals: [visual] };
    // The bundle keeps the pane texts; the description and the new interaction come inline.
    const bundle = exampleHe();
    bundle.texts = Object.fromEntries(Object.entries(bundle.texts).filter(([key]) => !key.startsWith('visual:dot-plot#') && !key.startsWith('visual:dot-plot/interaction:')));
    const course = assembleCourse(draft, { translations: { he: bundle } });
    expect(course.visuals[0]!.accessibility.description).toBe('A dot plot.');
    expect(course.translations!.he!.texts['visual:dot-plot#description']).toBe('תרשים נקודות.');
    expect(course.translations!.he!.texts['visual:dot-plot/interaction:pick/value:1#label']).toBe('סכום');
    expect(() => defineCourse(draft as unknown as CourseManifest)).toThrow(expect.objectContaining({ issues: expect.arrayContaining([expect.objectContaining({ code: 'UNASSEMBLED_LOCALIZED_TEXT' })]) }));
    const fail = (value: unknown, code: string) => {
      let error: unknown; try { assembleCourse(value as CourseManifest, { translations: { he: exampleHe() } }); } catch (e) { error = e; }
      expect(error).toBeInstanceOf(ContractValidationError);
      expect((error as ContractValidationError).issues.map(i => i.code)).toContain(code);
    };
    fail({ ...example(), title: { he: 'כותרת' } }, 'MISSING_SOURCE_TEXT');
    fail({ ...example(), title: { en: 'Title', 'en-GB': 'Title' } }, 'UNDECLARED_LOCALE');
    fail({ ...example(), title: { en: 'Title', he: 'כותרת' } }, 'DUPLICATE_TRANSLATION');
  });
});

describe('SDK-generated text goes through message IDs', () => {
  it('ships the same IDs and parameters in every catalog', () => {
    for (const [language, catalog] of Object.entries(SDK_MESSAGES)) {
      expect(Object.keys(catalog).sort(), language).toEqual([...SDK_MESSAGE_IDS].sort());
      for (const id of SDK_MESSAGE_IDS) {
        expect(messageParameters(catalog[id]), `${language} ${id}`).toEqual(messageParameters(SDK_MESSAGES.en[id]));
        expect(catalog[id].trim().length, `${language} ${id}`).toBeGreaterThan(0);
      }
    }
    for (const id of SDK_MESSAGE_IDS) expect(/[֐-׿]/.test(SDK_MESSAGES.he[id]), id).toBe(true);
  });
  it('isolates parameters in right-to-left text and falls back to English', () => {
    const ref = { id: 'gate.criterion.independent_success.unmet', params: { families: 2, objectives: ['add', 'divide'] } };
    expect(formatSdkMessage(ref, 'en')).toBe('Needs independent success in 2 item families for add, divide.');
    expect(formatSdkMessage(ref, 'he-IL')).toBe('נדרשת הצלחה עצמאית ב־⁨2⁩ משפחות שאלות עבור ⁨add, divide⁩.');
    expect(formatSdkMessage(ref, 'fr')).toBe(formatSdkMessage(ref, 'en'));
    expect(() => formatSdkMessage({ id: 'gate.nope' })).toThrow(RangeError);
  });
  it('renders gate decisions in the learner locale with re-renderable message IDs', () => {
    const context = { decisionId: 'd1', enrollmentId: 'e1', courseDigest: 'a'.repeat(64), policyRevision: 1, decidedAt: '2026-10-01T00:00:00Z' };
    const course = richCourse();
    const en = decideGate(course, 'length-ready', [] as Evidence[], context);
    const he = decideGate(course, 'length-ready', [], { ...context, locale: 'he' });
    if (!en.valid || !he.valid) throw new Error('decision failed');
    expect(he.decision.locale).toBe('he');
    expect(he.decision.learnerVisibleReason).not.toBe(en.decision.learnerVisibleReason);
    expect(formatSdkMessages(he.decision.learnerVisibleReasonMessages!, 'en')).toBe(en.decision.learnerVisibleReason);
    expect(he.decision.nextActions.map(a => a.messageId)).toEqual(en.decision.nextActions.map(a => a.messageId));
    expect(he.decision.nextActions.map(a => formatSdkMessage(a.messageId!, 'en'))).toEqual(en.decision.nextActions.map(a => a.label));
    for (const [i, result] of he.decision.criterionResults.entries()) expect(formatSdkMessages(result.reasonMessages!, 'en')).toBe(en.decision.criterionResults[i]!.reason);
    // The message fields are part of the record schema. (With no evidence at all, the reference
    // evaluator's met misconception criterion cites none, which validateRecord reports separately.)
    expect(validateRecord('gateDecision', he.decision).issues.filter(i => i.code === 'SCHEMA')).toEqual([]);
  });
  it('scaffolds and migrates in the course locales', () => {
    const he = scaffoldCourse({ locale: 'he', locales: ['en'] });
    expect(validateCourse(he).issues).toEqual([]);
    expect(he.title).toBe('קורס לדוגמה');
    expect(he.translations!.en!.texts['course#title']).toBe('Example course');
    const titled = scaffoldCourse({ title: 'Means', locales: ['he'] });
    expect(titled.translations!.he!.fallback).toEqual(['course#title']);
    expect(validateCourse(titled).issues).toEqual([]);
    const legacy = bilingual(courseFixture());
    const migrated = migrateCourse(legacy);
    expect(migrated.issues.filter(i => i.code.includes('TRANSLATION'))).toEqual([]);
    expect(migrated.course.translations!.he!.texts['gate:compare-ready/criterion:transfer#description']).toBe(SDK_MESSAGES.he['migrate.criterion.transfer']);
    expect(migrateCourse({ ...courseFixture(), locale: 'EN' }).changes[0]).toBe('Rewrote locale "EN" as en.');
  });
});

// Fixed seed and bounded runs, as in properties.test.ts.
const runs = { seed: 6021, numRuns: 40 } as const;
describe('property: translation coverage, fallback and packing determinism', () => {
  const keys = [...courseTextKeys(assembledExample()).keys()];
  it('any split of keys into translated and fallback is valid and reported exactly', () => {
    fc.assert(fc.property(fc.array(fc.boolean(), { minLength: keys.length, maxLength: keys.length }), (translated) => {
      const course = assembledExample();
      const he = exampleHe(), texts: Record<string, string> = {}, fallback: string[] = [];
      keys.forEach((key, i) => { if (translated[i] && he.texts[key] !== undefined) texts[key] = he.texts[key]; else fallback.push(key); });
      course.translations = { he: fallback.length ? { texts, fallback } : { texts } };
      expect(validateCourse(course).issues).toEqual([]);
      expect(localeCoverage(course)[1]!.fallback.sort()).toEqual([...fallback].sort());
      const shown = localizeCourse(course, 'he');
      expect(shown.fallbacks.sort()).toEqual([...fallback].sort());
    }), runs);
  });
  it('dropping any one key without a fallback is reported for exactly that key', () => {
    fc.assert(fc.property(fc.nat(keys.length - 1), (i) => {
      const course = assembledExample();
      const key = keys[i]!;
      delete course.translations!.he!.texts[key];
      course.translations!.he!.fallback = (course.translations!.he!.fallback ?? []).filter(k => k !== key);
      const result = validateCourse(course);
      expect(result.valid).toBe(false);
      expect(result.issues).toEqual([expect.objectContaining({ code: 'MISSING_TRANSLATION', message: expect.stringContaining(key) })]);
    }), runs);
  });
  it('packing is independent of bundle key order and translation edits always change the digest', () => {
    const he = exampleHe(), entries = Object.entries(he.texts);
    const reference = packCoursePackage({ manifest: assembledExample() });
    const digest = compileCourse(assembledExample()).digest;
    fc.assert(fc.property(fc.shuffledSubarray(entries, { minLength: entries.length, maxLength: entries.length }), fc.nat(entries.length - 1), (order, at) => {
      const bundle = { ...he, texts: Object.fromEntries(order) };
      const bytes = packCoursePackage({ manifest: assembleCourse(example(), { translations: { he: bundle } }) });
      expect(Buffer.from(bytes).equals(Buffer.from(reference))).toBe(true);
      const [key, text] = entries[at]!;
      const edited = assembleCourse(example(), { translations: { he: { ...bundle, texts: { ...bundle.texts, [key]: `${text} ` } } } });
      expect(compileCourse(edited).digest).not.toBe(digest);
    }), runs);
  });
});

describe('course CLI with locales', () => {
  let dir: string, cli: string;
  const run = (...args: string[]) => spawnSync(process.execPath, [cli, ...args], { cwd: dir, encoding: 'utf8', timeout: 60_000 });
  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'course-locales-'));
    cli = path.join(dir, 'cli.mjs');
    await build({ entryPoints: ['src/cli.ts'], bundle: true, platform: 'node', format: 'esm', outfile: cli, logLevel: 'silent' });
    cpSync(new URL('../examples/mean-starter', import.meta.url), path.join(dir, 'example'), { recursive: true });
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('assembles course directories with locales/<tag>.json bundles', () => {
    expect(JSON.parse(run('validate', 'example').stdout)).toEqual({ valid: true, issues: [] });
    const report = JSON.parse(run('locales', 'example').stdout);
    expect(report.locales.map((l: { locale: string; direction: string }) => [l.locale, l.direction])).toEqual([['en', 'ltr'], ['he', 'rtl']]);
    // The manifest alone declares he but has no bundle.
    expect(run('validate', 'example/course.json').status).toBe(1);
    expect(run('pack', 'example', '--out', 'example.course.tgz').status).toBe(0);
    const verified = JSON.parse(run('verify', 'example.course.tgz').stdout);
    expect(verified).toMatchObject({ valid: true, courseDigest: compileCourse(assembledExample()).digest });
  });
  it('reports a missing translation with its key and source text', () => {
    mkdirSync(path.join(dir, 'partial/locales'), { recursive: true });
    cpSync(path.join(dir, 'example/course.json'), path.join(dir, 'partial/course.json'));
    const he = exampleHe(); delete he.texts['course#title'];
    writeFileSync(path.join(dir, 'partial/locales/he.json'), JSON.stringify(he));
    const result = run('locales', 'partial');
    expect(result.status).toBe(1);
    expect(JSON.parse(result.stdout).locales[1].missing).toEqual([{ key: 'course#title', source: '/title', text: 'Finding the mean' }]);
    writeFileSync(path.join(dir, 'partial/locales/HE.json'), '{}');
    expect(run('validate', 'partial').status).toBe(1);
  });
  it('init writes the source course and one bundle per additional locale', () => {
    expect(run('init', 'bilingual', '--locale', 'he', '--locales', 'en').status).toBe(0);
    expect(JSON.parse(readFileSync(path.join(dir, 'bilingual/course.json'), 'utf8'))).toMatchObject({ locale: 'he', locales: ['en'], title: 'קורס לדוגמה' });
    expect(JSON.parse(readFileSync(path.join(dir, 'bilingual/locales/en.json'), 'utf8')).texts['course#title']).toBe('Example course');
    expect(JSON.parse(run('validate', 'bilingual').stdout).valid).toBe(true);
    expect(run('init', 'french', '--locale', 'fr').status).toBe(1);
  });
});
