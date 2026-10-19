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
- course-package v1: `packCoursePackage` and `verifyCoursePackage` (from `@course-core/sdk/compiler`) build
  and verify a deterministic `<courseId>-<version>.course.tgz` (strict top-level ustar, no dependency) listed
  by `course-package.json`, whose JSON Schema is published as `@course-core/sdk/package-schema`. Verification
  enforces archive safety, size limits, exact listing, member SHA-256, roles, the course id/version/compiler
  digest and learner projection, and refuses with stable `PACKAGE_*` codes (`CoursePackageError`).
  `coursePackageChecksum` and `verifyCoursePackageChecksum` write and check the `sha256sum` sibling.
  `course pack <course> --out <file.course.tgz>` writes the package and `<file>.sha256`; `course verify` accepts a
  package. The existing bundle form of `course pack` is unchanged.
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

### Changed
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
