# Multi-locale courses

SDK 0.6 lets one course ship in several locales. This guide covers how to declare them, where translated
text lives, what may and may not change between locales, how validation reports gaps, and how to write
right-to-left (RTL) text such as Hebrew that also contains code and math.

The example course in [`examples/mean-starter`](../examples/mean-starter) ships English and Hebrew. It is
the `course init` starter course, extended with a visual, panes, a rubric-graded explanation and a math
and code lesson block so that every kind of localizable text appears once.

## Declaring locales

```json
{
  "locale": "en",
  "locales": ["he"],
  "translations": { "he": { "texts": { "course#title": "איך מחשבים ממוצע" }, "fallback": [] } }
}
```

| Field | Meaning |
| --- | --- |
| `locale` | Required. The source (default) locale. Every text field in the manifest is written in it. |
| `locales` | Optional. The additional locales the course ships. The source locale is not repeated here. |
| `translations` | Optional. One bundle per entry of `locales`, and no others. |

Tags are BCP 47 language tags in canonical case: a supported language, optionally with a region
(`en`, `en-GB`, `he`, `he-IL`). The SDK supports `en` and `he` today (`SUPPORTED_LOCALES`). Adding a
language is an additive SDK change.

**Direction is derived, not authored.** `localeDirection('he')` is `rtl`; `en` is `ltr`. There is no
`direction` field: a course can't get it wrong, and a host can't be told to lay out Hebrew left to right.

**Migration.** `locale` was already required and every known course uses `"en"`, which stays valid. 0.6
validates the value (`UNSUPPORTED_LOCALE`). A course that spelled a supported tag another way (`EN`,
`en_US`) fails with a hint, and `course migrate` rewrites it (`en`, `en-US`). A course in a language the
SDK does not support yet fails validation until that language is added. Courses without `locales` are
otherwise unchanged and compile to byte-identical output.

## Where translated text lives, and why

The source text stays inline in the manifest, exactly as before. Each additional locale is a **bundle**
that maps **text keys** to text:

```text
my-course/
  course.json        source locale text, "locale": "en", "locales": ["he"]
  locales/he.json    { "texts": { "<text key>": "<Hebrew text>", ... }, "fallback": [ ... ] }
```

The `course` CLI assembles a course directory: it reads `course.json`, adds each `locales/<tag>.json` to
`translations`, and validates, compiles or packs the result. In TypeScript, `assembleCourse(course,
{ translations: { he } })` does the same and validates like `defineCourse`.

We chose parallel bundles keyed by stable IDs over the alternatives:

- **Inline `{ "en": …, "he": … }` objects in every field** would change the type of every text field,
  break every 0.4 and 0.5 consumer that reads `title` as a string, and put grading data and translations
  in the same objects, where a translator's edit can touch an answer key. Translators would also have to
  work in the full manifest.
- **A full manifest per locale** would duplicate IDs, answer keys and structure, so the copies drift: an
  option added in English but not in Hebrew, or a different correct option. That is the bug class the
  design must prevent.
- **Bundles keyed by stable text keys** keep one structure and one set of answer keys. A bundle can only
  add text for keys the course already has. Validation compares each bundle with the source and reports
  exactly what is missing. Translators get a flat file. A translation change shows up in `course diff` as
  `translations:he`.

For short labels written next to code, inline text is still convenient. The visual helpers and
`assembleCourse` accept `LocalizedText` (`{ en: '…', he: '…' }`) at text fields, and assembly moves each
variant into the bundle under the field's key (see [Visuals](#visuals)). The stored manifest always uses
bundles.

### Text keys

A key is built from author IDs, so it survives reordering: `<kind>:<id>[/<kind>:<id>]#<field>`. IDs never
contain `/` or `#`. Array positions are used only where items have no ID (table columns and value labels).

| Text | Key |
| --- | --- |
| Course title, summary, chapter label | `course#title`, `course#summary`, `course#chapterLabel` |
| Objective description | `objective:<id>#description` |
| Stage and chapter title, summary, subtitle | `stage:<id>#title`, `chapter:<id>#summary`, ... |
| Episode title | `episode:<id>#title` |
| Text block | `episode:<episodeId>/block:<blockId>#markdown` |
| Assessment prompt and feedback | `assessment:<id>#prompt`, `assessment:<id>#explanation` |
| Choice option | `assessment:<id>/option:<optionId>#text` |
| Trace step | `assessment:<id>/step:<stepId>#prompt` |
| Inline rubric criterion | `assessment:<id>/criterion:<criterionId>#description` |
| Rubric title and criterion (learner-facing) | `rubric:<id>#title`, `rubric:<id>/criterion:<criterionId>#description` |
| Versioned gate readiness criterion | `gate:<id>/criterion:<criterionId>#description` |
| Concept title | `concept:<id>#title` |
| Activity title and text alternative | `activity:<id>#title`, `activity:<id>#textAlternative` |
| Learning step action label | `step:<id>#actionLabel` |
| Extension text alternative | `extension:<id>#textAlternative` |
| Visual description | `visual:<id>#description` |
| Interaction label and value labels | `visual:<id>/interaction:<id>#label`, `visual:<id>/interaction:<id>/value:<n>#label` |
| Pane title, formula label, table column | `visual:<id>/pane:<id>#title`, `…#label`, `visual:<id>/pane:<id>/column:<n>#label` |
| Scene node and layer labels | `scene:<id>/node:<id>#label`, `scene:<id>/layer:<id>#label` |
| Media text alternative | `media:<id>#alternative` |
| Source title | `source:<id>#title` |
| Storyboard script line (captions) | `storyboard:<id>/script:<id>#text` |
| Study arm label | `studyArm:<id>#label` |
| Concept-mapping note | `conceptMapping:<id>#note` |
| Numerical recipe prompt | `recipe:<id>#promptTemplate` |

`courseTextKeys(course)` lists every key with its JSON pointer and source text. A blank source field has
nothing to translate and has no key.

### What is never localized

IDs, answer keys (`correctOptionId`, `expected`, tolerances, trace answers), units, starter code and test
fixtures, numeric values, state keys, renderer data (table cells, formula TeX, scene geometry) and every
reference stay the same in every locale. So do author- and staff-facing texts that learners never see:
hypothesis statements, tool and agent descriptions, admin sections, debug inspectors, visual invariant
descriptions, storyboard frame notes and research queries. Their keys don't exist, so a bundle cannot
translate them (`UNKNOWN_TEXT_KEY`).

## Validation

`validateCourse` checks every declared locale. All codes are stable; messages are English.

| Code | Where | Meaning |
| --- | --- | --- |
| `UNSUPPORTED_LOCALE` | `/locale`, `/locales/i` | Not a supported, canonical tag. The message suggests the canonical spelling. |
| `DUPLICATE_LOCALE` | `/locales/i` | The source locale or a repeated tag. |
| `MISSING_TRANSLATIONS` | `/translations` | A declared locale has no bundle. |
| `UNDECLARED_LOCALE` | `/translations/<tag>` | A bundle for a locale not in `locales`. |
| `MISSING_TRANSLATION` | `/translations/<tag>/texts` | A key is neither translated nor in `fallback`. The message names the key and its source path. |
| `UNKNOWN_TEXT_KEY` | `/translations/<tag>/texts/<key>`, `/fallback/j` | The key isn't a localizable text of the course, such as a new ID, an answer key or a removed item. |
| `BLANK_TRANSLATION` | `/translations/<tag>/texts/<key>` | Whitespace only. Translate it or list it in `fallback`. |
| `TRANSLATION_FALLBACK_CONFLICT` | `/translations/<tag>/texts/<key>` | Both translated and in `fallback`. |
| `PLACEHOLDER_MISMATCH` | `/translations/<tag>/texts/<key>` | `{{name}}` placeholders differ. |
| `STRUCTURE_MISMATCH` | `/translations/<tag>/texts/<key>` | Fenced code, inline code, math, image targets, the number of links or heading levels differ. |
| `LOCALE_SPECIFIC_ID` | the `id` | An ID ends in a locale tag (`intro-he`) in a course that declares `locales`. IDs are shared by every locale. |

**Fallback is explicit.** A locale is complete when every key is translated. A key may instead be listed
in the bundle's `fallback`: learners in that locale then see the source text. Use it for text that is the
same in every language (numerals, proper names, a citation title), or to ship before a translation is
ready. Fallbacks are always reported: by `localeCoverage(course)` and `course locales`, as
`TRANSLATION_FALLBACK` (info) by `course lint`, and as a `warning` in the `locales` check of `course test`.
There is no silent fallback: a key that is neither translated nor listed is a validation error.

**Structure must survive.** Code is never translated, so fenced blocks must match exactly. Inline code,
math (`$…$`, `$$…$$`, `\(…\)`, `\[…\]`), image targets and placeholders must match as sets, in any order,
since word order changes between languages. Link targets may differ (for example to a Hebrew page), but
the number of links may not. Heading levels must match in order.

## Grading does not depend on locale

Answer keys and IDs are shared by all locales, and a bundle can't address them. A choice option is
graded by its ID whatever its text says. Numeric, prediction and code items are graded on values and
tests.

Hosts show a learner `localizeCourse(course, learnerLocales)`, a display copy. They grade, record
evidence and compute digests against the original course. The display copy has no `translations`, so it
fails validation if a host mistakenly compiles it.

Free text depends on language:

- An `Attempt` record may carry `locale`, the locale the item was shown in. Rubric evaluators, human
  reviewers and conversation judges read the response in that locale. Rubric criteria are translated
  through the bundle (`rubric:<id>/criterion:<id>#description`), so a reviewer can see the criterion in
  the learner's language. The criterion ID and its requirement are what count.
- `trace` items match answers exactly, case-insensitively or with normalized whitespace. Those answers
  are not localized, so use numbers, symbols or code there. Where the answer is a word, use a rubric
  item, which an evaluator judges in the attempt's locale.
- Evaluator definitions keep their version across locales. If an evaluator can't judge a locale, it must
  report uncertainty (`pending_review`). A host must not count an unjudged answer as evidence.

## Packaging and digests

The course manifest in a package (`course.json`) carries every locale's bundle, so the compiler digest
(`courseDigest`) covers all locales. A changed Hebrew word changes the digest. The learner projection
(`learner.json`) carries the bundles filtered to the texts learners can see. Assessment prompts,
options, feedback, rubrics and server-only sections stay server-side in every locale. The package
listing format is unchanged (course-package v1). Packing is deterministic: `assembleCourse` orders
bundles by `locales` and sorts keys, so the order of keys in `locales/he.json` doesn't change the bytes.

## Visuals

The visual helpers accept `LocalizedText` for every learner-visible label and text alternative:

<!-- docs-example: skip -->
```ts
const pick = defineInteraction({
  id: 'pick', kind: 'tap', target: 'marker', alternative: { kind: 'control' },
  label: { en: 'Choose what to mark', he: 'בחרו מה לסמן' },
  binding: bindData('show', { values: ['mean', 'sum'], labels: [{ en: 'Mean', he: 'ממוצע' }, { en: 'Sum', he: 'סכום' }] }),
});
const plot = defineVisualExperience({ ...visual, interactions: [pick],
  accessibility: { description: { en: 'A dot plot of the readings.', he: 'תרשים נקודות של המדידות.' }, reducedMotion: {} } });
const course = assembleCourse({ ...draft, visuals: [plot] }, { translations: { he } });
```

`defineInteraction`, `defineVisualPane`, `defineVisualExperience`, `defineScene`, `defineExtension` and
`bindData` validate the value once per locale, with every text in that locale. A blank Hebrew label is
reported as `[he] …`. Every `LocalizedText` in one value must name the same locales
(`INCONSISTENT_LOCALIZED_TEXT`). `bindData`'s new `labels` name each discrete value for learners, so a
selector shows "ממוצע" while the bound state stays `"mean"`. `defineCourse` refuses unassembled text
(`UNASSEMBLED_LOCALIZED_TEXT`). Assembly reports `MISSING_SOURCE_TEXT`, `UNDECLARED_LOCALE` and
`DUPLICATE_TRANSLATION` (the same key both inline and in a bundle).

## Text the SDK generates

The SDK generates some text itself: gate-decision reasons and action labels, `course init` scaffolds and
`course migrate` readiness criteria. All of it comes from a message catalog (`SDK_MESSAGES`, with `en` and
`he` and the same IDs and parameters in each).

- `decideGate(…, { locale })` renders reasons and labels in the learner's locale (default: the course's
  source locale). It records the message IDs: `learnerVisibleReasonMessages`, each criterion's
  `reasonMessages`, each action's `messageId` and the decision's `locale`. A host can render the same
  decision again in another locale with `formatSdkMessages(refs, locale)`.
- In RTL locales, `formatSdkMessage` wraps each parameter in Unicode isolates (U+2068 … U+2069), so an
  objective ID or a number cannot reorder the sentence around it.
- `course init --locale he --locales en` writes a Hebrew course with an English bundle, both from the
  catalog.
- `course migrate` writes new readiness criteria in the source locale and adds them to every bundle.

Author-facing validation and CLI errors stay in English. Each has a stable `code` (the tables above, and
`PACKAGE_*` for packages), which tools should match on and may translate.

## Command line

```sh
npx --no-install course init my-course --locales he      # course.json + locales/he.json
npx --no-install course locales my-course                # coverage, fallbacks, missing keys with source text
npx --no-install course validate my-course               # a directory assembles locales/*.json
npx --no-install course pack my-course --out my-course-1.0.0.course.tgz
```

`validate`, `lint`, `test`, `compile`, `inspect`, `locales`, `diff` and `pack` take a course directory or a
manifest file. Bundle files are named by canonical tag (`he.json`, `en-GB.json`). Other files in
`locales/` are ignored.

## Writing right-to-left text

Hebrew runs right to left; code, math, numbers and Latin names inside it run left to right. Renderers
apply the Unicode bidirectional algorithm, and a few habits keep the result readable:

- **Put code in backticks and math in `$…$`.** Hosts should render them as isolated left-to-right runs.
  Bare code inside a Hebrew sentence, such as `values.sort()`, can show its punctuation on the wrong
  side. Structure checks require the same code and math as the source, so the Hebrew text can't drift
  from the English.
- **Code blocks stay identical.** Translate the sentence around a block, never the block or its
  comments. Code always reads left to right, even inside RTL text.
- **Don't end a Hebrew sentence with a left-to-right run if you can help it.** A sentence ending in code
  or a Latin word can put the final period or colon on the visually wrong side. Rephrase ("מחשבים בעזרת
  הביטוי `sum(values) / len(values)`, למשל:") so that Hebrew comes last.
- **Join prefixes to numbers with a maqaf.** Write "ו־6" and "ל־30" (U+05BE) rather than "ו-6"; an ASCII
  hyphen next to a digit can be read as a minus sign.
- **Use Western digits and keep units as in the source.** Numbers are not localized, and graded values
  never are.
- **Don't add bidi control characters.** Embeddings and overrides (U+202A–U+202E) make text display
  differently from how it is stored. `course lint` warns about them (`BIDI_OVERRIDE`). If you must force a
  direction, use isolates (U+2066–U+2069), which the SDK itself uses.
- **Tables and panes mirror.** In an RTL locale a host should mirror table column order and layout.
  Translate column labels; cell values and formulas are data and stay as they are.
- **Formula text alternatives read naturally.** The TeX of a formula pane is shared, but its `label` is
  what a screen reader says: write it the way a Hebrew speaker would read the formula aloud ("איקס בר
  שווה ל…").
- **Write naturally, not word for word.** Hebrew UI text usually addresses learners in the plural
  imperative ("בחרו", "גררו"), which avoids choosing a gender. Restructure sentences freely, as long as the
  placeholders, code and math are kept.
