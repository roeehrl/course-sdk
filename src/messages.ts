import { localeDirection, localeLanguage, SUPPORTED_LOCALES, type SupportedLanguage } from './locale.js';
import type { SdkMessageRef } from './record-types.js';

/**
 * 0.6: text the SDK itself generates for learners or authors (gate decision reasons and actions,
 * `course init` scaffolds, `course migrate` defaults) goes through these message IDs. Records carry
 * the ID and its parameters next to the rendered text, so a host can render them again in another
 * locale. Validation and CLI errors are author-facing: they stay English and carry stable codes.
 *
 * Parameters are written `{name}`. A parameter value may be a string, a number or a list of
 * strings (joined with ", "). In right-to-left locales each value is wrapped in Unicode isolates
 * (U+2068 … U+2069) so left-to-right IDs and numbers cannot reorder the sentence around them.
 */
const en = {
  'gate.action.continue': 'Continue',
  'gate.action.attempt_check': 'Try a new check',
  'gate.action.explain_to_companion': 'Explain your reasoning to the companion',
  'gate.action.request_help': 'Ask for help or another explanation',
  'gate.action.review_material': 'Review the lesson',
  'gate.action.await_review': 'Wait for review of your answer',
  'gate.action.view_gaps': 'See what remains unproven',
  'gate.action.appeal': 'Request a review of this decision',
  'gate.action.consider_extension': 'Consider an available extension',
  'gate.criterion.independent_success.met': 'Independent success in the required item families.',
  'gate.criterion.independent_success.unmet': 'Needs independent success in {families} item families for {objectives}.',
  'gate.criterion.transfer_success.met': 'Independent transfer evidence recorded.',
  'gate.criterion.transfer_success.unmet': 'Needs independent success on a new transfer task.',
  'gate.criterion.no_critical_misconception.met': 'No unresolved critical misconception.',
  'gate.criterion.no_critical_misconception.unmet': 'A later independent check must resolve {misconceptions}.',
  'gate.criterion.no_critical_misconception.no_evidence': 'Needs independent evidence for {objectives} before any critical misconception can be ruled out.',
  'gate.criterion.rubric_criteria.met': 'Rubric criteria met with cited learner evidence.',
  'gate.criterion.rubric_criteria.unmet': 'Needs a rubric-backed explanation citing the learner.',
  'gate.criterion.practical_task.met': 'Verified practical task passed.',
  'gate.criterion.practical_task.unmet': 'Needs a verified practical task.',
  'gate.criterion.pending': 'Evidence is awaiting review.',
  'gate.reason.ready': 'All readiness criteria are met with independent evidence.',
  'gate.reason.needs_evidence': 'More independent evidence is needed.',
  'gate.reason.needs_help': 'Recent attempts did not succeed.',
  'gate.reason.under_review': 'Some evidence is awaiting review; nothing is counted against you meanwhile.',
  'gate.reason.closed_with_gaps': 'The course limit was reached before readiness.',
  'migrate.criterion.independent': 'Independent success in the required item families.',
  'migrate.criterion.transfer': 'Independent success on a new transfer task.',
  'migrate.criterion.misconceptions': 'No unresolved critical misconception.',
  'scaffold.course.title': 'Example course',
  'scaffold.course.summary': 'A starter course created by course init.',
  'scaffold.objective.description': 'Estimate the mean of a short list of numbers.',
  'scaffold.chapter.title': 'Basics',
  'scaffold.episode.title': 'The mean',
  'scaffold.block.explain': 'The mean adds the values and divides by how many there are.',
  'scaffold.choice.prompt': 'What is the mean of 2, 4 and 6?',
  'scaffold.choice.explanation': '12 divided by 3 is 4.',
  'scaffold.transfer.prompt': 'Three readings are 10, 20 and 60. What reading would make the mean of four readings equal 30?',
  'scaffold.transfer.explanation': 'Four readings totalling 120 need 30 more.',
  'scaffold.probe.prompt': 'Is the mean of 5 and 5 equal to 10?',
  'scaffold.probe.yes': 'Yes',
  'scaffold.probe.no': 'No',
  'scaffold.probe.explanation': 'The mean of 5 and 5 is 5.',
  'scaffold.criterion.independent': 'Two independent item families.',
  'scaffold.criterion.transfer': 'Solve a new transfer task.',
  'scaffold.criterion.misconceptions': 'The mean is not confused with the sum.',
  'scaffold.hypothesis.mean_is_sum': 'The mean is the total rather than the total divided by the count.',
  'scaffold.hypothesis.slip': 'A one-off arithmetic slip.',
} as const;

/** A message the SDK can generate. */
export type SdkMessageId = keyof typeof en;

const he: Record<SdkMessageId, string> = {
  'gate.action.continue': 'המשך',
  'gate.action.attempt_check': 'נסו בדיקה חדשה',
  'gate.action.explain_to_companion': 'הסבירו למלווה איך חשבתם',
  'gate.action.request_help': 'בקשו עזרה או הסבר אחר',
  'gate.action.review_material': 'חזרו על השיעור',
  'gate.action.await_review': 'התשובה שלכם ממתינה לבדיקה',
  'gate.action.view_gaps': 'מה עוד לא הוכח',
  'gate.action.appeal': 'בקשו לבדוק מחדש את ההחלטה',
  'gate.action.consider_extension': 'אפשר לבקש הארכה',
  'gate.criterion.independent_success.met': 'הצלחתם באופן עצמאי בכל משפחות השאלות הנדרשות.',
  'gate.criterion.independent_success.unmet': 'נדרשת הצלחה עצמאית ב־{families} משפחות שאלות עבור {objectives}.',
  'gate.criterion.transfer_success.met': 'נרשמה הצלחה עצמאית במשימת העברה.',
  'gate.criterion.transfer_success.unmet': 'נדרשת הצלחה עצמאית במשימת העברה חדשה.',
  'gate.criterion.no_critical_misconception.met': 'לא נותרה תפיסה שגויה מהותית שלא טופלה.',
  'gate.criterion.no_critical_misconception.unmet': 'בדיקה עצמאית מאוחרת יותר צריכה להראות שהתפיסות השגויות האלה נפתרו: {misconceptions}.',
  'gate.criterion.no_critical_misconception.no_evidence': 'נדרשת עדות עצמאית עבור {objectives} לפני שאפשר לשלול תפיסה שגויה מהותית.',
  'gate.criterion.rubric_criteria.met': 'הקריטריונים של המחוון התקיימו, עם ציטוטים מדבריכם.',
  'gate.criterion.rubric_criteria.unmet': 'נדרש הסבר שנבדק לפי מחוון ומצטט את דבריכם.',
  'gate.criterion.practical_task.met': 'עברתם משימה מעשית שנבדקה ואומתה.',
  'gate.criterion.practical_task.unmet': 'נדרשת משימה מעשית שנבדקת ומאומתת.',
  'gate.criterion.pending': 'חלק מהעדויות ממתינות לבדיקה.',
  'gate.reason.ready': 'כל תנאי המוכנות התקיימו, והעדויות הושגו באופן עצמאי.',
  'gate.reason.needs_evidence': 'צריך עוד עדויות להצלחה עצמאית.',
  'gate.reason.needs_help': 'הניסיונות האחרונים לא הצליחו.',
  'gate.reason.under_review': 'חלק מהעדויות ממתינות לבדיקה, ובינתיים שום דבר לא נזקף לחובתכם.',
  'gate.reason.closed_with_gaps': 'הגעתם למגבלת הקורס לפני שכל תנאי המוכנות התקיימו.',
  'migrate.criterion.independent': 'הצלחה עצמאית בכל משפחות השאלות הנדרשות.',
  'migrate.criterion.transfer': 'הצלחה עצמאית במשימת העברה חדשה.',
  'migrate.criterion.misconceptions': 'לא נותרה תפיסה שגויה מהותית שלא טופלה.',
  'scaffold.course.title': 'קורס לדוגמה',
  'scaffold.course.summary': 'קורס התחלתי שנוצר בפקודה course init.',
  'scaffold.objective.description': 'למצוא את הממוצע של רשימה קצרה של מספרים.',
  'scaffold.chapter.title': 'יסודות',
  'scaffold.episode.title': 'הממוצע',
  'scaffold.block.explain': 'כדי לחשב ממוצע מחברים את כל הערכים ומחלקים בכמות הערכים.',
  'scaffold.choice.prompt': 'מהו הממוצע של 2, 4 ו־6?',
  'scaffold.choice.explanation': 'הסכום הוא 12, ו־12 חלקי 3 שווה 4.',
  'scaffold.transfer.prompt': 'שלוש מדידות הן 10, 20 ו־60. איזו מדידה רביעית תביא את הממוצע של ארבע המדידות ל־30?',
  'scaffold.transfer.explanation': 'ממוצע של 30 בארבע מדידות פירושו סכום של 120, ולכן חסרות עוד 30.',
  'scaffold.probe.prompt': 'האם הממוצע של 5 ו־5 הוא 10?',
  'scaffold.probe.yes': 'כן',
  'scaffold.probe.no': 'לא',
  'scaffold.probe.explanation': 'הממוצע של 5 ו־5 הוא 5.',
  'scaffold.criterion.independent': 'הצלחה בשתי משפחות שאלות עצמאיות.',
  'scaffold.criterion.transfer': 'פתרון משימת העברה חדשה.',
  'scaffold.criterion.misconceptions': 'לא מבלבלים בין הממוצע לסכום.',
  'scaffold.hypothesis.mean_is_sum': 'הממוצע הוא הסכום עצמו, ולא הסכום חלקי מספר הערכים.',
  'scaffold.hypothesis.slip': 'טעות חישוב חד־פעמית.',
};

/** Every SDK message, by supported language. Each catalog has exactly the same IDs and parameters. */
export const SDK_MESSAGES: Readonly<Record<SupportedLanguage, Readonly<Record<SdkMessageId, string>>>> = Object.freeze({ en: Object.freeze({ ...en }), he: Object.freeze(he) });
export const SDK_MESSAGE_IDS: readonly SdkMessageId[] = Object.freeze(Object.keys(en) as SdkMessageId[]);

export type SdkMessageParam = string | number | string[];
/** A typed SdkMessageRef for one of the SDK's own messages. */
export function sdkMessage(id: SdkMessageId, params?: Record<string, SdkMessageParam>): SdkMessageRef {
  return params === undefined ? { id } : { id, params };
}

/** The catalog language used for a tag: its language when supported, otherwise English. */
export function sdkMessageLanguage(locale: string | undefined): SupportedLanguage {
  const language = locale === undefined ? undefined : localeLanguage(locale);
  return language !== undefined && (SUPPORTED_LOCALES as readonly string[]).includes(language) ? language as SupportedLanguage : 'en';
}

const FSI = '⁨', PDI = '⁩';

/** Renders one message in a locale (English when the locale has no catalog). Unknown IDs throw. */
export function formatSdkMessage(message: SdkMessageRef | SdkMessageId | (string & {}), locale?: string): string {
  const ref = typeof message === 'string' ? { id: message } : message;
  const language = sdkMessageLanguage(locale);
  if (!Object.hasOwn(SDK_MESSAGES[language], ref.id)) throw new RangeError(`Unknown SDK message ${String(ref.id)}.`);
  const template = SDK_MESSAGES[language][ref.id as SdkMessageId];
  const rtl = localeDirection(language) === 'rtl';
  return template.replace(/\{([A-Za-z][A-Za-z0-9_]*)\}/g, (match, name: string) => {
    const value = ref.params?.[name];
    if (value === undefined) return match;
    const text = Array.isArray(value) ? value.join(', ') : String(value);
    return rtl ? `${FSI}${text}${PDI}` : text;
  });
}

/** Renders several messages as one sentence run (joined by a space), as gate decisions do. */
export function formatSdkMessages(messages: readonly SdkMessageRef[], locale?: string): string {
  return messages.map(message => formatSdkMessage(message, locale)).join(' ');
}

/** The `{name}` parameters a template uses, sorted. */
export function messageParameters(template: string): string[] {
  return [...new Set([...template.matchAll(/\{([A-Za-z][A-Za-z0-9_]*)\}/g)].map(match => match[1]!))].sort();
}
