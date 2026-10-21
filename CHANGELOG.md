# Changelog

## 0.6.0 (unreleased)

Backward compatible with 0.4.0 and 0.5.0 data. Every 0.4.0 and 0.5.0 fixture manifest validates
and compiles to byte-identical output, and 0.4.0/0.5.0 compiled artifacts and 0.5.0 bundles still
verify. The fixtures in `fixtures/compat-0.5.0` were produced by the released 0.5.0 package.
The 0.5.0 `rich` fixture stays valid and compiles byte for byte, but `course pack` and the
`publishable` check now refuse it (`CONVERSATION_RUBRIC_UNSUPPORTED`): its conversational rubric is
judged by a model-assisted evaluator with `humanConfirmation: "on_uncertain"`, which Course Core has
never published.

### Added
- Multi-locale courses. `locale` is the source locale and must be a supported BCP 47 tag (`en`, `he`,
  optionally with a region; `SUPPORTED_LOCALES`). The new optional `locales` lists additional shipped locales
  and `translations` holds one bundle per locale (`{ texts, fallback? }`, `LocaleBundle`) keyed by stable text
  keys built from author IDs (`episode:<id>#title`, `assessment:<id>/option:<id>#text`, ...; `courseTextKeys`).
  Direction is derived (`localeDirection`), never authored. Validation reports `UNSUPPORTED_LOCALE`,
  `DUPLICATE_LOCALE`, `MISSING_TRANSLATIONS`, `UNDECLARED_LOCALE`, `MISSING_TRANSLATION`, `UNKNOWN_TEXT_KEY`,
  `BLANK_TRANSLATION`, `TRANSLATION_FALLBACK_CONFLICT`, `PLACEHOLDER_MISMATCH`, `STRUCTURE_MISMATCH` and
  `LOCALE_SPECIFIC_ID`. An untranslated key must be listed in the bundle's `fallback`. Fallbacks are reported by
  `localeCoverage`, `course locales`, lint (`TRANSLATION_FALLBACK`) and the new `locales` conformance check.
  The compiler digest covers every locale. The learner projection carries bundles filtered to learner-visible
  text, so prompts, options and feedback stay server-side in every locale. `localizeCourse`, `courseText`,
  `courseLocales` and `negotiateLocale` give hosts a display copy; grading always uses the original course.
  See `docs/multi-locale-courses.md`.
- `assembleCourse(draft, { translations })` builds a course from a draft whose text fields may hold
  `LocalizedText` (`{ en, he }`) plus separate bundles. The CLI assembles a course directory's
  `locales/<tag>.json` files for `validate`, `lint`, `test`, `compile`, `inspect`, `diff` and `pack`. The new
  `course locales` command prints coverage with each missing key's source text. `course init` takes `--locale`
  and `--locales`. `defineLocaleBundle` and the `localeBundle` contract kind validate a bundle alone.
- The visual helpers accept `LocalizedText` for labels and text alternatives and validate once per locale:
  `defineInteraction`, `defineVisualPane`, `defineVisualExperience`, `defineScene`, `defineExtension` and
  `bindData`, whose new `labels` (`DataBinding.labels`) name each discrete value for learners. `defineCourse`
  refuses unassembled text (`UNASSEMBLED_LOCALIZED_TEXT`).
- SDK message catalog: text the SDK generates comes from `SDK_MESSAGES` (`en`, `he`) by message ID
  (`formatSdkMessage`, `formatSdkMessages`, `SDK_MESSAGE_IDS`). Gate decisions take `context.locale` (default:
  the course locale) and record `locale`, `learnerVisibleReasonMessages`, each criterion's `reasonMessages` and
  each action's `messageId`. In RTL locales parameters are wrapped in Unicode isolates. `course init` and
  `course migrate` write their default text from the catalog in the course's locales. Validation and CLI
  errors stay English with stable codes.
- `Attempt.locale` (optional): the locale an item was shown in, for graders of free-text answers.
- Lint warns about bidirectional embedding and override characters in course text (`BIDI_OVERRIDE`).
- `examples/mean-starter`: the starter course in English and Hebrew (`locales/he.json`).
- course-package v1: `packCoursePackage` and `verifyCoursePackage` (from `@course-core/sdk/compiler`) build
  and verify a deterministic `<courseId>-<version>.course.tgz` (strict top-level ustar, no dependency) listed
  by `course-package.json`, whose JSON Schema is published as `@course-core/sdk/package-schema`. Verification
  enforces archive safety, size limits, exact listing, member SHA-256, roles, the course id/version/compiler
  digest and learner projection, and refuses with stable `PACKAGE_*` codes (`CoursePackageError`).
  `coursePackageChecksum` and `verifyCoursePackageChecksum` write and check the `sha256sum` sibling.
  `course pack <course> --out <file.course.tgz>` writes the package and `<file>.sha256`; `course verify` accepts a
  package. `minimumCoreVersion` defaults to `0.1.46`, the first Course Core release with the installer.
  The existing bundle form of `course pack` is unchanged.
- `publicationIssues(course)`: rules a host applies at publication beyond data validity, matching
  Course Core's publication check (Core's codes add a `PUBLISH_` prefix). `course lint` reports them
  as errors, `course test` adds a `publishable` check and `course pack` refuses the course.
  An unversioned gate's `conversationalEvaluatorId` must name an evaluator definition bound to
  exactly one rubric that may judge a conversation (human or model-assisted with required human
  confirmation, or deterministic); otherwise `CONVERSATIONAL_GATE_UNSUPPORTED`. The rubric must
  require cited evidence (`CONVERSATION_RUBRIC_UNSUPPORTED`), and with the conversation counted as one
  item family the gate must reach its families (`GATE_EVIDENCE_UNREACHABLE`). A versioned gate's
  `conversationalRubricRef` needs an evaluator that judges conversations and lists the rubric in
  `rubricIds` (`CONVERSATION_RUBRIC_UNSUPPORTED` at `/gates/i/conversationalRubricRef`).
- `gateConversation(course, gate)` and `judgesConversation(evaluator)`: the rubric and evaluator a
  gate's conversation is judged by, resolved as Course Core resolves them.
- Evaluator `itemTypes` may include `conversation`: the evaluator judges gate conversations. It needs
  `rubricIds` and a deterministic, human or model-assisted method; a deterministic evaluator may list
  it without a keyed item type. SDK 0.5 hosts reject the new value.
- `course migrate` carries a resolved `conversationalEvaluatorId` over as `conversationalRubricRef`
  with `rubric_backed_conversation` evidence.
- Accessibility rules for lesson content: `INACCESSIBLE_VISUAL` for a visual block whose renderer has
  no keyboard support, `INACCESSIBLE_ACTIVITY` for a legacy activity block without one, and
  `MISSING_TEXT_ALTERNATIVE` for blank text alternatives on visual blocks, legacy activity blocks and
  required media.

- Extension manifests: optional `stateMigration`, `tests` and the full `resourceBudget`, with
  standalone validation (`validateContract('extension', …)` now applies semantic rules).
- `REQUIRED_ACTIVITY_FIELDS`, `PLATFORM_CONTRACT` and `platformContract(activity)`.
- Schema-driven admin settings: `adminSettingsSchema`, `adminSettingDefaults` and the server-side
  `checkAdminSettingChange`.
- Roadmap stages: stage `subtitle` and `iconAsset`, and `courseRoadmap(course)` grouping chapters by stage.
  Lint reports split (`STAGE_NOT_CONTIGUOUS`) and unused stages.
- `mediaCandidate` record kind, validated like `researchResult`.
- Record kinds `contextCapsule`, `rubricRevision` and the portable event export `learningEventExport`
  (64-bit-safe decimal sequences, strictly increasing within the cursor range).
- TypeScript generated from `course.schema.json`, with a type-level equality test against every public
  contract and record type and `CourseManifest`.
- Render features `symbol`, `spring`, `stagger`, `layout_set` and `panes` (Course Core visuals 0.2/0.3), and
  `invariants` and `goldens` (visuals 0.4), for renderer definitions and adapters (up to 17 features each).
- `VisualExperience.requiredFeatures`: checked against the course's `visual` renderer definitions for the
  visual's extension (`UNSUPPORTED_FEATURE`), and must list `layout_set` / `panes` when the visual uses them
  (`MISSING_REQUIRED_FEATURE`).
- `VisualExperience.layouts` may carry the four-layout set (`tabletPortrait`, `tabletLandscape`, `wide` next to
  `compact`; all three or none, `INCOMPLETE_LAYOUT_SET`), built with `responsiveVariant`. `expanded` stays the
  fallback for renderers without `layout_set`.
- The Interaction contract: `VisualExperience.interactions` (`defineInteraction`) bound to visual state with
  `bindData(state, { range | values })`. Bindings must name declared state (`MISSING_REFERENCE`) and be well
  formed (`INVALID_BINDING`); pointer-only interactions need a keyboard or control alternative
  (`INACCESSIBLE_INTERACTION`).
- Synchronized panes: `VisualExperience.panes` (`defineVisualPane`), one to eight `table`, `code` or `formula`
  panes. Table rows match the columns (`INVALID_PANE`) and formula panes carry a text alternative.
- Visual publish-time checks (Course Core visuals 0.4): `VisualExperience.invariants` (data-only assertions over
  state, time and probes into the frame) and `goldens` (expected `sha256-` frame digests per time and layout),
  validated alone by `defineVisualChecks`. Probes must name declared state, table cells, formula values and
  highlights (`MISSING_REFERENCE`), times lie within the timeline (`INVALID_TIMELINE`), goldens name a layout the
  visual has (`INVALID_GOLDEN`) once per layout and time, and invariants check at most 512 frames, layouts x
  (1 + distinct state overrides) x distinct times (`TOO_MANY_CHECK_FRAMES`). `VISUAL_CHECK_LIMITS` and
  `normalizeDigestNumbers` (numbers to 10 significant digits, |x| < 1e-9 as 0) match Core's digests.
- Scene `defs` (`clips`, `masks`, `symbols`), layer `clip` / `mask` references, the `use` layer kind with
  `symbol`, and layer `label`. References are checked (`MISSING_REFERENCE`, `INVALID_LAYER`) and a definition
  cannot draw itself (`DEFS_CYCLE`).
- `browserExecution: 'python' | 'none'` on `code` and `code_repair` items (Course Core's browser practice runs).
  `python` needs `language: "python"` (`UNSUPPORTED_BROWSER_EXECUTION`); lint warns that placement and retention
  items never offer a run (`BROWSER_RUN_NOT_OFFERED`).
- `studyInstruments` manifest section (`defineStudyInstruments`, server-only): `pre`, `post`, `transfer` and
  `delayed` instrument sets and optional `allowedArms`, checked as Course Core checks study definitions
  (`STUDY_ITEM_IN_TWO_SETS`, `STUDY_TRANSFER_ROLE`, `STUDY_DELAYED_NOT_RETENTION`). Lint reports unmatched
  pre/post objective coverage (`STUDY_INSTRUMENTS_UNMATCHED`) and instrument items that count toward a gate.
- Learning step kind `pre_test`: it presents at least one assessment and none of its items may count toward a
  gate (`PRE_TEST_GATE_EVIDENCE`).
- `conceptMappingDrafts` (`defineConceptMappingDraft`, server-only): draft `equivalent`, `prerequisite_of` and
  `overlaps` links between this course's objectives and a named other course's, applied by a host only after
  staff review (`CONCEPT_MAPPING_LINK_SCOPE`, `CONCEPT_MAPPING_DUPLICATE_LINK`, `CONCEPT_MAPPING_SAME_COURSE`).
- `@course-core/sdk/event-export-schema`: the learning-event export as its own JSON Schema
  (`learning-event-export.schema.json`), derived from `course.schema.json` at build time.
- README sections on the 0.6 additions and on the three extension points: activities, evaluators and admin
  sections.
- `scripts/api-baseline.json` declares 0.6.0 additive: the API check fails if an export is removed, loses its
  runtime value or changes its type-parameter count, although a 0.x minor bump would allow it.

### Changed
- `locale` is validated against the supported locales (`UNSUPPORTED_LOCALE`). Every known 0.4/0.5 course uses
  `"en"` and is unaffected. A supported language spelled differently (`EN`, `en_US`) fails with a hint, and
  `course migrate` rewrites it. A course in a language the SDK doesn't support yet must wait for that language.
- TypeScript only: `VisualInvariant.states` is `Record<string, number | string | boolean>[]`, as the schema
  already required. The type generator now types JSON Schema maps (`additionalProperties` with a schema).
- Bundle `manifest.json` lists the course's `locales` when it declares any.
- The generated validators keep shared schema definitions as functions instead of inlining every reference
  (Ajv `inlineRefs: false`). Validation results are unchanged; the course validator shrinks from about 2.0 MB to
  1.3 MB, which keeps it under the 2 MiB packed-file limit.
- `defineCourse`, `defineVisualExperience` and `defineExtension` validate (as `validateCourse` and
  `validateContract`) and throw `ContractValidationError` instead of returning an unchecked copy.
- Publication (`publicationIssues`, `course lint`, `course pack`) and `defineScene` refuse an equation layer
  without a non-blank `label` (`MISSING_TEXT_ALTERNATIVE`). Such 0.5 scenes stay valid data and compile unchanged.
- A legacy gate whose `conversationalEvaluatorId` does not resolve to an evaluator definition bound to
  exactly one rubric (for example a bare extension ID) is no longer exempt from its family and objective
  coverage checks. A gate whose conversation resolves counts it as one family; publication checks the rest.
- TypeScript only: `EvaluatorDefinition.itemTypes` is `EvaluatorItemType[]` (`AssessmentType | 'conversation'`), `AgentStrategy.autonomy.mayApply`
  is `AdaptationOperationKind[]` and `AdminCapability.permission` is `AdminPermission`, matching what the
  schema already accepted. Data validity is unchanged.
- Conformance reports gain the `publishable` check, so a 0.6 bundle's `conformance.json` differs
  from a 0.5 one. 0.5 bundles still verify (with a `DIFFERENT_SDK_VERSION` warning).

### Fixed
- Runtime records accept host-generated identifiers. Enrollment, attempt, evidence, decision, request,
  job, offer, grant, run, instance, artifact and user/actor IDs (and evidence reference lists) use the
  `opaqueId` definition: 1 to 200 characters of `A-Z a-z 0-9 . _ : -`, starting with a letter or digit,
  so UUIDs from `randomUUID()` validate even when they start with a digit. Author-defined course IDs
  (objectives, assessments, gates, episodes, activities, rubrics, tools, pools and scopes) keep the
  course-ID pattern. Every value valid before stays valid.
- `decideGate` no longer reports `no_critical_misconception` as met without evidence. The criterion is
  met only when no critical misconception is open and independent counted evidence covers its
  objectives, and it cites that evidence. Without any it is unmet with the new message
  `gate.criterion.no_critical_misconception.no_evidence` (`{objectives}`), so a decision on no or only
  assisted evidence now passes `validateRecord('gateDecision', …)` instead of failing with
  `UNLINKED_DECISION` ("A met criterion must cite evidence."). Statuses are unchanged: such a decision
  was never `ready`. This matches Course Core's own gate evaluator. Property tests check that every
  decision `decideGate` produces passes `validateRecord` and `checkGateDecision`.

## 0.5.0

Backward compatible with 0.4.0 data. Every 0.4.0 manifest validates and compiles to
byte-identical output, and 0.4.0 compiled artifacts still verify. The fixtures in
`fixtures/compat-0.4.0` were produced by the released 0.4.0 package.

### Added
- Versioned progression gates with the design's required fields, evidence modes and readiness
  criteria. Validation rejects recognition-only gates, gates without production transfer
  evidence, unchecked critical misconceptions, probes used as gate evidence and conversational
  rubrics that do not require cited learner evidence.
- `GateDecision` record, the `decideGate` reference evaluator (five statuses with next actions)
  and `checkGateDecision`.
- Assessment types `prediction`, `trace`, `code_repair`, `counterexample`, `experiment_design`
  and `teach_back`. Items gain `role`, `misconceptionIds`, `allowAbstain` and `confidence`.
  Numeric items gain relative tolerance and units. The default review schedule is 1/3/7/21 days.
- Teaching hypotheses, diagnostic probes and concepts.
- Activity contract with the nine required activity fields, layout inputs and layout classes.
- Admin sections, research tasks with research request and result validation, agent strategies,
  tools, rubrics, evaluators, adaptation policies, learning steps, storyboards, renderers,
  renderer adapters, platform adapters, debug inspectors, scenes, timelines and stages.
- 23 new validating `define*` helpers (26 with the existing three), `validateContract`,
  `validateRecord` with 26 runtime record contracts, `lintCourse` and `windowClass`.
- CLI commands `init`, `lint`, `test`, `inspect`, `pack`, `verify`, `diff`, `migrate` and
  `import`. A bundle contains a manifest, a SHA-256 integrity map, a licence inventory, the
  required capabilities and a conformance report. Output is deterministic.
- Optional extension `license`, `stateSchema`, `observationSchema`, `resourceBudget` and
  `evaluatorRef`; media `segment` and `captions`; chapter `stageId`, `subtitle` and `iconAsset`;
  placement retest, assistance and threshold inputs.

### Changed
- TypeScript: `ProgressionGate` and the activity block are unions, and
  `RetentionPolicy.intervalsDays` is optional. Data compatibility is unchanged.

### Not included
- `course dev` live preview, because preview needs a host renderer.
- Generating TypeScript types from the schema. Types are still hand-written.
