/**
 * 0.6: course locales. A course names its source (default) locale in `locale` and may ship more in
 * `locales`. Tags are BCP 47 language tags in canonical case: a supported language subtag,
 * optionally followed by a region (`en`, `en-GB`, `he`, `he-IL`). Text direction is derived from the
 * language, never authored.
 */

/** Text direction of a locale. */
export type TextDirection = 'ltr' | 'rtl';

/** Languages the SDK supports, with their direction. Adding one is an additive SDK change. */
export const SUPPORTED_LANGUAGES = Object.freeze({
  en: Object.freeze({ direction: 'ltr' as TextDirection, name: 'English', nativeName: 'English' }),
  he: Object.freeze({ direction: 'rtl' as TextDirection, name: 'Hebrew', nativeName: 'עברית' }),
});
export type SupportedLanguage = keyof typeof SUPPORTED_LANGUAGES;
/** The supported language tags, in the order hosts should offer them. */
export const SUPPORTED_LOCALES: readonly SupportedLanguage[] = Object.freeze(Object.keys(SUPPORTED_LANGUAGES) as SupportedLanguage[]);
/** The locale a course written before 0.6 is assumed to use; `course init` uses it unless told otherwise. */
export const DEFAULT_COURSE_LOCALE: SupportedLanguage = 'en';

const TAG = /^([a-z]{2,3})(?:-([A-Z]{2}|[0-9]{3}))?$/;

/** The language subtag of a well-formed tag (`he-IL` → `he`), or undefined. */
export function localeLanguage(tag: string): string | undefined {
  return typeof tag === 'string' ? TAG.exec(tag)?.[1] : undefined;
}

/** True for a canonical tag whose language the SDK supports. */
export function isSupportedLocale(tag: unknown): tag is string {
  if (typeof tag !== 'string') return false;
  const language = localeLanguage(tag);
  return language !== undefined && Object.hasOwn(SUPPORTED_LANGUAGES, language);
}

/**
 * The canonical spelling of a tag (`EN_us` → `en-US`, `HE` → `he`), or undefined when it is not
 * a language tag the SDK can canonicalize. The result may still be unsupported.
 */
export function canonicalLocale(tag: string): string | undefined {
  if (typeof tag !== 'string') return undefined;
  const match = /^([A-Za-z]{2,3})(?:[-_]([A-Za-z]{2}|[0-9]{3}))?$/.exec(tag.trim());
  if (!match) return undefined;
  return match[2] ? `${match[1]!.toLowerCase()}-${match[2].toUpperCase()}` : match[1]!.toLowerCase();
}

/** The text direction of a supported tag. Unsupported tags read left to right. */
export function localeDirection(tag: string): TextDirection {
  const language = localeLanguage(tag);
  return language !== undefined && Object.hasOwn(SUPPORTED_LANGUAGES, language) ? SUPPORTED_LANGUAGES[language as SupportedLanguage].direction : 'ltr';
}

/**
 * Picks the best of `available` for a learner's ordered preferences: an exact tag, then the same
 * language (`he-IL` asks, `he` ships), then `fallback`. Matching ignores case.
 */
export function negotiateLocale(preferences: readonly string[], available: readonly string[], fallback: string): string {
  const shipped = available.map(tag => ({ tag, canonical: canonicalLocale(tag) ?? tag }));
  for (const wanted of preferences) {
    const canonical = canonicalLocale(wanted);
    if (canonical === undefined) continue;
    const exact = shipped.find(entry => entry.canonical === canonical);
    if (exact) return exact.tag;
    const language = localeLanguage(canonical);
    const sameLanguage = shipped.find(entry => localeLanguage(entry.canonical) === language);
    if (sameLanguage) return sameLanguage.tag;
  }
  return fallback;
}
