import { canonicalLocale, isSupportedLocale, localeDirection, negotiateLocale, SUPPORTED_LOCALES, type TextDirection } from './locale.js';
import type { CourseManifest, ExtensionManifest, LocaleBundle, ValidationIssue, VisualExperience } from './types.js';
import type { DataBinding, Interaction, Scene, SceneLayer, VisualPane } from './contracts-types.js';

/**
 * 0.6 localized course text.
 *
 * Every learner-visible text field of a course has a stable **text key** built from author IDs, never
 * from array positions of items with IDs: `episode:intro#title`, `episode:intro/block:welcome#markdown`,
 * `assessment:q1/option:a#text`, `visual:curve/interaction:drag-bob#label`. Source text stays inline in
 * the manifest (in `locale`); each additional locale is a bundle in `translations` mapping keys to text.
 * Grading data (answer keys, tolerances, units, code, IDs) is never localized.
 */

/** A text in several locales, keyed by locale tag. Accepted by `assembleCourse` and the visual helpers. */
export type LocalizedText = { readonly [locale: string]: string };
/** A source string or, before `assembleCourse`, a LocalizedText. */
export type TextInput = string | LocalizedText;

type Holder = Record<string, unknown> | unknown[];
/** One text field: its key, JSON pointer and the object and property holding it. */
export interface TextSite { key: string; path: string; holder: Holder; field: string | number }
type Visit = (site: TextSite) => void;

const record = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
const list = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const idOf = (value: unknown): string | undefined => {
  const id = record(value)?.id;
  return typeof id === 'string' ? id : undefined;
};
const escape = (segment: string) => segment.replaceAll('~', '~0').replaceAll('/', '~1');
/** The JSON pointer for a property name (text keys contain `/`). */
export const pointerSegment = escape;

function field(visit: Visit, holder: unknown, name: string, key: string, path: string): void {
  const object = record(holder);
  if (object && Object.hasOwn(object, name)) visit({ key, path: `${path}/${escape(name)}`, holder: object, field: name });
}
/** Visits each `[id]` item of an array as `${prefix}:${id}`. */
function each(items: unknown, path: string, fn: (item: Record<string, unknown>, id: string, itemPath: string) => void): void {
  for (const [i, item] of list(items).entries()) {
    const id = idOf(item);
    if (id !== undefined) fn(item as Record<string, unknown>, id, `${path}/${i}`);
  }
}
function strings(visit: Visit, items: unknown, prefix: string, name: string, path: string): void {
  const array = list(items);
  for (let i = 0; i < array.length; i++) visit({ key: `${prefix}:${i}#${name}`, path: `${path}/${i}`, holder: array, field: i });
}

// ------------------------------------------------------------------ text sites per contract

export function bindingSites(binding: unknown, prefix: string, path: string, visit: Visit): void {
  const labels = record(binding)?.labels;
  if (Array.isArray(labels)) strings(visit, labels, `${prefix}/value`, 'label', `${path}/labels`);
}
export function interactionSites(interaction: unknown, prefix: string, path: string, visit: Visit): void {
  field(visit, interaction, 'label', `${prefix}#label`, path);
  bindingSites(record(interaction)?.binding, prefix, `${path}/binding`, visit);
}
export function paneSites(pane: unknown, prefix: string, path: string, visit: Visit): void {
  const value = record(pane);
  if (!value) return;
  field(visit, value, 'title', `${prefix}#title`, path);
  if (value.kind === 'formula') field(visit, value, 'label', `${prefix}#label`, path);
  if (value.kind === 'table') strings(visit, value.columns, `${prefix}/column`, 'label', `${path}/columns`);
}
export function visualSites(visual: unknown, prefix: string, path: string, visit: Visit): void {
  const value = record(visual);
  if (!value) return;
  field(visit, value.accessibility, 'description', `${prefix}#description`, `${path}/accessibility`);
  each(value.interactions, `${path}/interactions`, (item, id, p) => interactionSites(item, `${prefix}/interaction:${id}`, p, visit));
  each(value.panes, `${path}/panes`, (item, id, p) => paneSites(item, `${prefix}/pane:${id}`, p, visit));
}
export function sceneSites(scene: unknown, prefix: string, path: string, visit: Visit): void {
  const value = record(scene);
  if (!value) return;
  each(value.semanticNodes, `${path}/semanticNodes`, (item, id, p) => field(visit, item, 'label', `${prefix}/node:${id}#label`, p));
  each(value.layers, `${path}/layers`, (item, id, p) => field(visit, item, 'label', `${prefix}/layer:${id}#label`, p));
}
export function extensionSites(extension: unknown, prefix: string, path: string, visit: Visit): void {
  field(visit, record(extension)?.accessibility, 'textAlternative', `${prefix}#textAlternative`, `${path}/accessibility`);
}

function assessmentSites(item: Record<string, unknown>, prefix: string, path: string, visit: Visit): void {
  field(visit, item, 'prompt', `${prefix}#prompt`, path);
  each(item.options, `${path}/options`, (option, id, p) => field(visit, option, 'text', `${prefix}/option:${id}#text`, p));
  each(item.steps, `${path}/steps`, (step, id, p) => field(visit, step, 'prompt', `${prefix}/step:${id}#prompt`, p));
  const grading = record(item.grading);
  field(visit, grading, 'explanation', `${prefix}#explanation`, `${path}/grading`);
  if (grading && Array.isArray(grading.rubric))
    each(grading.rubric, `${path}/grading/rubric`, (criterion, id, p) => field(visit, criterion, 'description', `${prefix}/criterion:${id}#description`, p));
}

/**
 * Calls `visit` for every localizable text field of a course (or of its learner projection, or of a
 * draft), in a fixed order. Tolerates partial or invalid data: absent sections are skipped.
 */
export function forEachTextSite(course: unknown, visit: Visit): void {
  const c = record(course);
  if (!c) return;
  for (const name of ['title', 'summary', 'chapterLabel']) field(visit, c, name, `course#${name}`, '');
  each(c.objectives, '/objectives', (item, id, p) => field(visit, item, 'description', `objective:${id}#description`, p));
  each(c.stages, '/stages', (item, id, p) => { for (const name of ['title', 'summary', 'subtitle']) field(visit, item, name, `stage:${id}#${name}`, p); });
  each(c.chapters, '/chapters', (chapter, chapterId, cp) => {
    for (const name of ['title', 'summary', 'subtitle']) field(visit, chapter, name, `chapter:${chapterId}#${name}`, cp);
    each(chapter.episodes, `${cp}/episodes`, (episode, episodeId, ep) => {
      field(visit, episode, 'title', `episode:${episodeId}#title`, ep);
      each(episode.blocks, `${ep}/blocks`, (block, blockId, bp) => {
        if (block.type === 'text') field(visit, block, 'markdown', `episode:${episodeId}/block:${blockId}#markdown`, bp);
      });
    });
  });
  each(c.concepts, '/concepts', (item, id, p) => field(visit, item, 'title', `concept:${id}#title`, p));
  each(c.assessments, '/assessments', (item, id, p) => assessmentSites(item, `assessment:${id}`, p, visit));
  each(c.gates, '/gates', (gate, id, p) =>
    each(gate.readinessCriteria, `${p}/readinessCriteria`, (criterion, cid, cp) => field(visit, criterion, 'description', `gate:${id}/criterion:${cid}#description`, cp)));
  each(c.rubrics, '/rubrics', (rubric, id, p) => {
    field(visit, rubric, 'title', `rubric:${id}#title`, p);
    each(rubric.criteria, `${p}/criteria`, (criterion, cid, cp) => field(visit, criterion, 'description', `rubric:${id}/criterion:${cid}#description`, cp));
  });
  each(c.activities, '/activities', (activity, id, p) => {
    field(visit, activity, 'title', `activity:${id}#title`, p);
    field(visit, activity.accessibleSemantics, 'textAlternative', `activity:${id}#textAlternative`, `${p}/accessibleSemantics`);
  });
  each(c.learningSteps, '/learningSteps', (step, id, p) => field(visit, step.primaryAction, 'label', `step:${id}#actionLabel`, `${p}/primaryAction`));
  each(c.extensions, '/extensions', (item, id, p) => extensionSites(item, `extension:${id}`, p, visit));
  each(c.visuals, '/visuals', (item, id, p) => visualSites(item, `visual:${id}`, p, visit));
  each(c.scenes, '/scenes', (item, id, p) => sceneSites(item, `scene:${id}`, p, visit));
  each(c.media, '/media', (item, id, p) => field(visit, item, 'alternativeMarkdown', `media:${id}#alternative`, p));
  each(c.sources, '/sources', (item, id, p) => field(visit, item, 'title', `source:${id}#title`, p));
  each(c.storyboards, '/storyboards', (board, id, p) =>
    each(board.script, `${p}/script`, (line, lid, lp) => field(visit, line, 'text', `storyboard:${id}/script:${lid}#text`, lp)));
  each(record(c.studyInstruments)?.allowedArms, '/studyInstruments/allowedArms', (arm, id, p) => field(visit, arm, 'label', `studyArm:${id}#label`, p));
  each(c.conceptMappingDrafts, '/conceptMappingDrafts', (draft, id, p) => field(visit, draft, 'note', `conceptMapping:${id}#note`, p));
  each(record(c.adaptation)?.numericalRecipes, '/adaptation/numericalRecipes', (recipe, id, p) => field(visit, recipe, 'promptTemplate', `recipe:${id}#promptTemplate`, p));
}

/** A course's localizable source texts: key → { path, text }. Blank source fields have nothing to translate. */
export function courseTextKeys(course: unknown): Map<string, { path: string; text: string }> {
  const texts = new Map<string, { path: string; text: string }>();
  forEachTextSite(course, ({ key, path, holder, field: name }) => {
    const value = (holder as Record<string | number, unknown>)[name];
    if (typeof value === 'string' && value.trim() !== '' && !texts.has(key)) texts.set(key, { path, text: value });
  });
  return texts;
}

// ------------------------------------------------------------------ structure

/** What must survive translation unchanged: placeholders, code, math, images, links and headings. */
export interface TextStructure {
  placeholders: string[];
  codeBlocks: string[];
  inlineCode: string[];
  math: string[];
  images: string[];
  links: number;
  headings: string;
}
const sorted = (values: string[]) => [...values].sort();
/**
 * Extracts the parts of a (Markdown) text that a translation must keep. Hosts verify packages they
 * did not write, so every scan here is linear in the text length (no backtracking patterns).
 */
export function textStructure(text: string): TextStructure {
  const placeholders = sorted([...text.matchAll(/\{\{\s*([A-Za-z_][A-Za-z0-9_.]*)\s*\}\}/g)].map(m => m[1]!));
  const { blocks: codeBlocks, rest: prose } = fencedBlocks(text);
  const { spans: inlineCode, rest: withoutCode } = codeSpans(prose);
  const math: string[] = [];
  let rest = withoutCode;
  for (const [open, close] of [['$$', '$$'], ['\\[', '\\]'], ['\\(', '\\)']] as const) rest = delimited(rest, open, close, math);
  // Pandoc's rule: an opening $ is followed by a non-space, a closing $ follows a non-space and is not followed by a
  // digit. The body cannot contain $ or a line break, so each attempt stops at the next $ or line end.
  rest = rest.replace(/(?<![\\$])\$(?![\s$])((?:[^$\\\n]|\\.)+?)(?<!\s)\$(?![\d$])/g, (_m, body: string) => { math.push(body.trim()); return ' '; });
  const { images, links } = linkTargets(rest);
  const headings = [...rest.matchAll(/^ {0,3}(#{1,6})[ \t]/gm)].map(m => m[1]!.length).join(',');
  return { placeholders, codeBlocks, inlineCode: sorted(inlineCode.map(s => s.trim())), math: sorted(math), images: sorted(images), links, headings };
}

/** Fenced code blocks (``` or ~~~, at least three); an unclosed fence runs to the end, as in CommonMark. */
function fencedBlocks(text: string): { blocks: string[]; rest: string } {
  const lines = text.split('\n'), blocks: string[] = [], rest: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const open = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(lines[i]!);
    if (!open) { rest.push(lines[i]!); continue; }
    const fence = open[1]!, body: string[] = [];
    let j = i + 1;
    for (; j < lines.length; j++) {
      const close = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(lines[j]!);
      if (close && close[1]![0] === fence[0] && close[1]!.length >= fence.length) break;
      body.push(lines[j]!);
    }
    blocks.push(`${open[2]!.trim()}\n${body.join('\n')}`);
    rest.push(' ');
    i = j;
  }
  return { blocks, rest: rest.join('\n') };
}

/** Inline code spans: a run of n backticks closed by the next run of exactly n. */
function codeSpans(text: string): { spans: string[]; rest: string } {
  const runs: { start: number; length: number }[] = [];
  for (let i = 0; i < text.length;) {
    if (text[i] !== '`') { i++; continue; }
    let j = i; while (j < text.length && text[j] === '`') j++;
    runs.push({ start: i, length: j - i }); i = j;
  }
  const byLength = new Map<number, number[]>();
  runs.forEach((run, index) => { const list = byLength.get(run.length); if (list) list.push(index); else byLength.set(run.length, [index]); });
  const next = new Map<number, number>();
  const spans: string[] = [];
  let rest = '', last = 0;
  for (let r = 0; r < runs.length;) {
    const open = runs[r]!, candidates = byLength.get(open.length)!;
    let p = next.get(open.length) ?? 0;
    while (p < candidates.length && candidates[p]! <= r) p++;
    next.set(open.length, p);
    if (p === candidates.length) { r++; continue; }
    const close = runs[candidates[p]!]!;
    spans.push(text.slice(open.start + open.length, close.start));
    rest += `${text.slice(last, open.start)} `;
    last = close.start + close.length;
    r = candidates[p]! + 1;
  }
  return { spans, rest: rest + text.slice(last) };
}

/** Removes `open … close` spans (pushing their trimmed bodies to `into`) with one forward pass. */
function delimited(text: string, open: string, close: string, into: string[]): string {
  let rest = '', at = 0;
  for (;;) {
    const start = text.indexOf(open, at);
    if (start < 0) break;
    const end = text.indexOf(close, start + open.length);
    if (end < 0) break;
    const body = text.slice(start + open.length, end);
    if (body.trim() === '') { rest += text.slice(at, end); at = end; continue; }
    into.push(body.trim());
    rest += `${text.slice(at, start)} `;
    at = end + close.length;
  }
  return rest + text.slice(at);
}

/** Image targets and the number of links (`[text](target)`), in one forward pass. */
function linkTargets(text: string): { images: string[]; links: number } {
  const images: string[] = [];
  let links = 0, open = -1;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '\n' && text[i + 1] === '\n') open = -1;
    else if (c === '[') open = i;
    else if (c === ']' && open >= 0 && text[i + 1] === '(') {
      let j = i + 2;
      while (j < text.length && (text[j] === ' ' || text[j] === '\t')) j++;
      if (text[j] === '<') j++;
      let k = j;
      while (k < text.length && !/[\s)>]/.test(text[k]!)) k++;
      if (open > 0 && text[open - 1] === '!') images.push(text.slice(j, k)); else links++;
      open = -1;
      i = k - 1;
    }
  }
  return { images, links };
}

/** Differences between a source text and its translation, as validation issue codes and messages. */
export function structureDifferences(source: string, translation: string): { code: 'PLACEHOLDER_MISMATCH' | 'STRUCTURE_MISMATCH'; message: string }[] {
  const a = textStructure(source), b = textStructure(translation);
  const same = (x: string[], y: string[]) => x.length === y.length && x.every((v, i) => v === y[i]);
  const out: { code: 'PLACEHOLDER_MISMATCH' | 'STRUCTURE_MISMATCH'; message: string }[] = [];
  if (!same(a.placeholders, b.placeholders))
    out.push({ code: 'PLACEHOLDER_MISMATCH', message: `Placeholders differ: source has ${list_(a.placeholders)}, translation has ${list_(b.placeholders)}.` });
  const parts: [string, boolean][] = [
    ['fenced code blocks (code is never translated)', same(a.codeBlocks, b.codeBlocks)],
    ['inline code spans', same(a.inlineCode, b.inlineCode)],
    ['math expressions', same(a.math, b.math)],
    ['image targets', same(a.images, b.images)],
    ['link count', a.links === b.links],
    ['heading levels', a.headings === b.headings],
  ];
  for (const [what, ok] of parts) if (!ok) out.push({ code: 'STRUCTURE_MISMATCH', message: `The translation changes the ${what}; keep them as in the source.` });
  return out;
}
const list_ = (values: string[]) => values.length ? values.map(v => `{{${v}}}`).join(', ') : 'none';

// ------------------------------------------------------------------ validation

const LOCALE_SUFFIX = /[-_.:]([a-z]{2,3})$/;

/** Semantic locale and translation checks for a schema-valid course (called by validateCourse). */
export function localizationIssues(course: CourseManifest): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const report = (code: string, path: string, message: string) => issues.push({ code, path, message });
  const unsupported = (tag: string, path: string) => {
    const canonical = canonicalLocale(tag);
    const hint = canonical !== undefined && canonical !== tag && isSupportedLocale(canonical) ? ` Write it as "${canonical}".` : '';
    report('UNSUPPORTED_LOCALE', path, `"${tag}" is not a supported locale. Supported: ${SUPPORTED_LOCALES.join(', ')} (optionally with a region, such as en-GB).${hint}`);
  };
  if (!isSupportedLocale(course.locale)) unsupported(course.locale, '/locale');
  const declared = course.locales ?? [];
  const seen = new Set<string>([course.locale]);
  for (const [i, tag] of declared.entries()) {
    if (!isSupportedLocale(tag)) unsupported(tag, `/locales/${i}`);
    if (seen.has(tag)) report('DUPLICATE_LOCALE', `/locales/${i}`, tag === course.locale ? `${tag} is the source locale; list only additional locales.` : `${tag} is listed twice.`);
    seen.add(tag);
  }
  const translations = course.translations ?? {};
  for (const tag of Object.keys(translations))
    if (!declared.includes(tag)) report('UNDECLARED_LOCALE', `/translations/${escape(tag)}`, `There is a bundle for ${tag}, but ${tag} is not listed in locales.`);
  const sources = courseTextKeys(course);
  for (const tag of declared) {
    if (tag === course.locale) continue;
    const bundle = Object.hasOwn(translations, tag) ? translations[tag] : undefined;
    if (!bundle) { report('MISSING_TRANSLATIONS', '/translations', `Locale ${tag} is declared but has no bundle in translations.`); continue; }
    const base = `/translations/${escape(tag)}`;
    const fallback = new Set(bundle.fallback ?? []);
    for (const [key, text] of Object.entries(bundle.texts)) {
      const path = `${base}/texts/${escape(key)}`;
      const source = sources.get(key);
      if (!source) { report('UNKNOWN_TEXT_KEY', path, `${key} is not a localizable text of this course. Keys come from author IDs; a translation cannot add items or IDs.`); continue; }
      if (text.trim() === '') report('BLANK_TRANSLATION', path, `The ${tag} text for ${key} is blank; translate it or list the key in fallback.`);
      else for (const difference of structureDifferences(source.text, text)) report(difference.code, path, `${key} (${tag}): ${difference.message}`);
      if (fallback.has(key)) report('TRANSLATION_FALLBACK_CONFLICT', path, `${key} is both translated and listed in fallback.`);
    }
    for (const [j, key] of (bundle.fallback ?? []).entries())
      if (!sources.has(key)) report('UNKNOWN_TEXT_KEY', `${base}/fallback/${j}`, `${key} is not a localizable text of this course.`);
    for (const [key, source] of sources)
      if (!Object.hasOwn(bundle.texts, key) && !fallback.has(key))
        report('MISSING_TRANSLATION', `${base}/texts`, `Locale ${tag} has no text for ${key} (source ${source.path}). Translate it, or list it in fallback to show the ${course.locale} text.`);
  }
  if (declared.length) {
    const tags = new Set([course.locale, ...declared, ...SUPPORTED_LOCALES].flatMap(tag => [tag.toLowerCase(), tag.split('-')[0]!.toLowerCase()]));
    forEachId(course, (id, path) => {
      const suffix = LOCALE_SUFFIX.exec(id)?.[1];
      if (suffix !== undefined && tags.has(suffix))
        report('LOCALE_SPECIFIC_ID', path, `ID ${id} names a locale. IDs are shared by every locale; translate the item's text in translations instead of adding a per-locale item.`);
    });
  }
  return issues;
}

/** Every author `id` in a course, outside translations. */
function forEachId(course: CourseManifest, fn: (id: string, path: string) => void): void {
  const visit = (value: unknown, path: string): void => {
    if (Array.isArray(value)) { value.forEach((item, i) => visit(item, `${path}/${i}`)); return; }
    const object = record(value);
    if (!object) return;
    for (const [key, item] of Object.entries(object)) {
      if (path === '' && key === 'translations') continue;
      if (key === 'id' && typeof item === 'string') fn(item, `${path}/id`);
      else visit(item, `${path}/${escape(key)}`);
    }
  };
  visit(course, '');
}

// ------------------------------------------------------------------ coverage and display

export interface LocaleCoverage {
  locale: string;
  direction: TextDirection;
  /** True for the source locale. */
  source: boolean;
  /** Localizable texts in the course. */
  texts: number;
  translated: number;
  /** Keys deliberately shown in the source locale. */
  fallback: string[];
  /** Keys neither translated nor listed in fallback (a validation error). */
  missing: string[];
  /** True when every text is translated (no fallback, nothing missing). */
  complete: boolean;
}
/** Per-locale coverage, source locale first. Reports fallbacks; does not validate. */
export function localeCoverage(course: Pick<CourseManifest, 'locale' | 'locales' | 'translations'>): LocaleCoverage[] {
  const sources = courseTextKeys(course);
  const coverage: LocaleCoverage[] = [{ locale: course.locale, direction: localeDirection(course.locale), source: true, texts: sources.size, translated: sources.size, fallback: [], missing: [], complete: true }];
  for (const tag of course.locales ?? []) {
    if (tag === course.locale) continue;
    const bundle = course.translations && Object.hasOwn(course.translations, tag) ? course.translations[tag] : undefined;
    const fallback = new Set(bundle?.fallback ?? []);
    const entry: LocaleCoverage = { locale: tag, direction: localeDirection(tag), source: false, texts: sources.size, translated: 0, fallback: [], missing: [], complete: false };
    for (const key of sources.keys()) {
      if (bundle && Object.hasOwn(bundle.texts, key) && bundle.texts[key]!.trim() !== '') entry.translated++;
      else if (fallback.has(key)) entry.fallback.push(key);
      else entry.missing.push(key);
    }
    entry.complete = entry.translated === sources.size;
    coverage.push(entry);
  }
  return coverage;
}

/** The fields of a course (or of its learner projection) that localization reads. */
export interface LocalizableCourse { locale: string; locales?: string[]; translations?: Record<string, LocaleBundle> }
export interface LocalizedCourse<T> {
  /** The locale the text is shown in: the request, the closest shipped locale, or the source locale. */
  locale: string;
  direction: TextDirection;
  /** A display copy with texts substituted. `translations` is removed: never compile, digest or grade it. */
  course: Omit<T, 'translations'>;
  /** Keys that show source-locale text in this locale (declared fallbacks). */
  fallbacks: string[];
}

/** The locales a course ships, source first. */
export function courseLocales(course: LocalizableCourse): string[] {
  return [course.locale, ...(course.locales ?? []).filter(tag => tag !== course.locale)];
}

/**
 * A display copy of a validated course or learner projection in the best shipped locale for
 * `preferences` (a tag or a learner's ordered tags). Grading, IDs and structure are unchanged, so
 * hosts grade and record evidence against the original course and use this copy only to show text.
 */
export function localizeCourse<T extends LocalizableCourse>(course: T, preferences: string | readonly string[]): LocalizedCourse<T> {
  const wanted = typeof preferences === 'string' ? [preferences] : preferences;
  const locale = negotiateLocale(wanted, courseLocales(course), course.locale);
  const { translations, ...rest } = structuredClone(course);
  const copy = rest as Omit<T, 'translations'>;
  const fallbacks: string[] = [];
  if (locale !== course.locale) {
    const bundle = translations && Object.hasOwn(translations, locale) ? translations[locale]! : { texts: {} };
    forEachTextSite(copy, ({ key, holder, field: name }) => {
      const target = holder as Record<string | number, unknown>;
      if (typeof target[name] !== 'string' || (target[name] as string).trim() === '') return;
      if (Object.hasOwn(bundle.texts, key)) target[name] = bundle.texts[key];
      else fallbacks.push(key);
    });
  }
  return { locale, direction: localeDirection(locale), course: copy, fallbacks };
}

/** One text of a course in a shipped locale, falling back to the source text. Undefined for an unknown key. */
export function courseText(course: LocalizableCourse, locale: string, key: string): string | undefined {
  const source = courseTextKeys(course).get(key);
  if (!source) return undefined;
  const bundle = course.translations && Object.hasOwn(course.translations, locale) ? course.translations[locale] : undefined;
  return bundle && Object.hasOwn(bundle.texts, key) ? bundle.texts[key] : source.text;
}

/** Keeps only the bundle entries whose keys `course` still has (used for the learner projection). */
export function filterTranslations(translations: Record<string, LocaleBundle>, course: unknown): Record<string, LocaleBundle> {
  const keys = new Set(courseTextKeys(course).keys());
  return Object.fromEntries(Object.entries(translations).map(([tag, bundle]) => {
    const filtered: LocaleBundle = { texts: Object.fromEntries(Object.entries(bundle.texts).filter(([key]) => keys.has(key))) };
    if (bundle.fallback !== undefined) filtered.fallback = bundle.fallback.filter(key => keys.has(key));
    return [tag, filtered];
  }));
}

// ------------------------------------------------------------------ inline LocalizedText

/** True for a plain object of locale tag → string (a LocalizedText), not for other data. */
export function isLocalizedText(value: unknown): value is LocalizedText {
  const object = record(value);
  if (!object || Object.getPrototypeOf(object) !== Object.prototype) return false;
  const entries = Object.entries(object);
  return entries.length > 0 && entries.every(([tag, text]) => canonicalLocale(tag) !== undefined && typeof text === 'string');
}

/** The LocalizedText values held at the text sites `sites` visits. */
export function localizedTextSites(value: unknown, sites: (value: unknown, visit: Visit) => void): (TextSite & { text: LocalizedText })[] {
  const found: (TextSite & { text: LocalizedText })[] = [];
  sites(value, site => {
    const text = (site.holder as Record<string | number, unknown>)[site.field];
    if (isLocalizedText(text)) found.push({ ...site, text });
  });
  return found;
}

// ------------------------------------------------------------------ authoring input types


/** 0.6: a data binding whose value labels may be LocalizedText. */
export type DataBindingInput = Omit<DataBinding, 'labels'> & { labels?: TextInput[] };
/** 0.6: an interaction whose label (and value labels) may be LocalizedText. */
export type InteractionInput = Omit<Interaction, 'label' | 'binding'> & { label: TextInput; binding: DataBindingInput };
/** 0.6: a pane whose title, column labels and formula label may be LocalizedText. */
export type VisualPaneInput =
  | (Omit<Extract<VisualPane, { kind: 'table' }>, 'title' | 'columns'> & { title: TextInput; columns: TextInput[] })
  | (Omit<Extract<VisualPane, { kind: 'code' }>, 'title'> & { title: TextInput })
  | (Omit<Extract<VisualPane, { kind: 'formula' }>, 'title' | 'label'> & { title: TextInput; label: TextInput });
/** 0.6: a scene layer whose label (its text alternative) may be LocalizedText. */
export type SceneLayerInput = Omit<SceneLayer, 'label'> & { label?: TextInput };
/** 0.6: a scene whose node and layer labels may be LocalizedText. */
export type SceneInput = Omit<Scene, 'semanticNodes' | 'layers'> & {
  semanticNodes: (Omit<Scene['semanticNodes'][number], 'label'> & { label: TextInput })[];
  layers: SceneLayerInput[];
};
/** 0.6: a visual whose description, interaction and pane text may be LocalizedText. */
export type VisualExperienceInput = Omit<VisualExperience, 'accessibility' | 'interactions' | 'panes'> & {
  accessibility: Omit<VisualExperience['accessibility'], 'description'> & { description: TextInput };
  interactions?: InteractionInput[];
  panes?: VisualPaneInput[];
};
/** 0.6: an extension whose text alternative may be LocalizedText. */
export type ExtensionManifestInput = Omit<ExtensionManifest, 'accessibility'> & {
  accessibility: Omit<ExtensionManifest['accessibility'], 'textAlternative'> & { textAlternative: TextInput };
};
/**
 * 0.6: a course before `assembleCourse`: visuals, scenes and extensions (typed) — and at run time any
 * text field — may hold LocalizedText, which assembly moves into `translations`.
 */
export type CourseDraft = Omit<CourseManifest, 'visuals' | 'scenes' | 'extensions'> & {
  visuals: VisualExperienceInput[];
  scenes?: SceneInput[];
  extensions: ExtensionManifestInput[];
};
