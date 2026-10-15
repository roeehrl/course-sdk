# Changelog

## 0.6.0 (unreleased)

Backward compatible with 0.4.0 and 0.5.0 data. Every 0.4.0 and 0.5.0 fixture manifest validates
and compiles to byte-identical output, and 0.4.0/0.5.0 compiled artifacts and 0.5.0 bundles still
verify. The fixtures in `fixtures/compat-0.5.0` were produced by the released 0.5.0 package.

### Added
- `publicationIssues(course)`: rules a host applies at publication beyond data validity. It refuses
  an unversioned gate's `conversationalEvaluatorId` (`CONVERSATIONAL_GATE_UNSUPPORTED`), matching
  Course Core's `PUBLISH_CONVERSATIONAL_GATE_UNSUPPORTED`. `course lint` reports it as an error,
  `course test` adds a `publishable` check and `course pack` refuses the course.
- Accessibility rules for lesson content: `INACCESSIBLE_VISUAL` for a visual block whose renderer has
  no keyboard support, `INACCESSIBLE_ACTIVITY` for a legacy activity block without one, and
  `MISSING_TEXT_ALTERNATIVE` for blank text alternatives on visual blocks, legacy activity blocks and
  required media.

### Changed
- A legacy gate with `conversationalEvaluatorId` is no longer exempt from its family and objective
  coverage checks.
- Conformance reports gain the `publishable` check, so a 0.6 bundle's `conformance.json` differs
  from a 0.5 one. 0.5 bundles still verify (with a `DIFFERENT_SDK_VERSION` warning).

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
