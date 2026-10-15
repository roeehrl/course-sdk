# Course SDK

`@course-core/sdk` provides portable TypeScript contracts, course validation, and authoring helpers. The Node compiler and `course` CLI are separate from the portable main export.

This checkout targets **0.6.0**, which tightens publication and accessibility rules on top of the 0.5.0 contracts while retaining schema-1 and compiled-format-1 course compatibility: every 0.4.0 and 0.5.0 fixture manifest validates and compiles to byte-identical output, and 0.5.0 compiled artifacts and bundles still verify (see `fixtures/compat-0.4.0` and `fixtures/compat-0.5.0`). It is a release candidate until the maintainer reviews and releases the verified artifact; local success does not imply publication. See [CHANGELOG.md](CHANGELOG.md).

Use Node.js 24 or newer for development, compilation, and the CLI. CI checks Node.js 24 and 26. Browser and native consumers should import the main entry point and supply their own runtime integration; this SDK is not a native UI runtime.

| Entry point | Purpose |
| --- | --- |
| `@course-core/sdk` | Portable types, course/adaptation validation, hashes and bounded recipes |
| `@course-core/sdk/compiler` | Node-only course/adaptation compilers and integrity verification |
| `@course-core/sdk/schema` | Standalone course JSON Schema |
| `@course-core/sdk/adaptation-schema` | Proposal schema and authoring/runtime definitions |
| `course` | Node command-line interface |

After the package has been published, install the explicit version:

```sh
npm install @course-core/sdk@0.6.0
```

For a local release candidate, run the verification commands below and install the resulting `.tgz` into a separate project with `npm install /path/to/package.tgz`. Do not use a workspace link as evidence that the published package works.

```ts
import { defineCourse, validateCourse } from '@course-core/sdk';

const course = defineCourse({
  schemaVersion: 1,
  id: 'example',
  version: '1.0.0',
  title: 'A small example',
  summary: 'Synthetic course content for an authoring example.',
  locale: 'en',
  platforms: ['web'],
  objectives: [{ id: 'start', description: 'Read an example.', prerequisites: [] }],
  chapters: [{
    id: 'chapter',
    title: 'Introduction',
    episodes: [{
      id: 'episode',
      title: 'Read',
      objectiveIds: ['start'],
      blocks: [{ id: 'text', type: 'text', markdown: 'Hello, course author.' }],
    }],
  }],
  assessments: [],
  gates: [],
  extensions: [],
  visuals: [],
  media: [],
  sources: [],
  policy: {
    mode: 'bounded',
    work: { additionalEpisodes: 3 },
    existingMaterialAccess: 'read_only',
  },
});

const result = validateCourse(course);
if (!result.valid) {
  console.error(result.issues);
}
```

`defineCourse` is a typed authoring helper. Run validation before accepting or publishing content. Keep compiler imports in Node tooling:

```ts
import { compileCourse, verifyCompiledCourse } from '@course-core/sdk/compiler';

const compiled = compileCourse(course);
// compiled: { formatVersion: 1, digest, server, learner }
if (!verifyCompiledCourse(compiled)) throw new Error('Invalid compiled artifact');
```

The server projection retains the full course. The learner projection omits complete assessment prompts, answer keys, and hidden bank references; applications serve items only for authorized attempts. A valid digest establishes integrity, not author trust or runtime authorization.

After installation, use the local CLI with a JSON course file:

```sh
npx --no-install course init my-course            # scaffold a valid 0.5 course (refuses an existing directory)
npx --no-install course validate course.json
npx --no-install course lint course.json --strict  # errors always fail; warnings fail with --strict
npx --no-install course test course.json           # offline conformance report
npx --no-install course compile course.json compiled.json
npx --no-install course inspect course.json
npx --no-install course pack course.json bundle    # manifest, integrity map, licences, capabilities, conformance
npx --no-install course verify bundle              # or a compiled.json
npx --no-install course diff old.json new.json
npx --no-install course migrate old.json new.json  # upgrade 0.4 gates; lists manual steps
npx --no-install course import bundle course.json  # recover a verified manifest
```

Every command is offline and deterministic, prints JSON, and exits 0 on success, 1 on a failed check and 2 on a usage error. Commands that write refuse to overwrite an existing file or directory. Using `--no-install` avoids silently downloading a different command if the package is missing. The design's `course dev` live preview is not part of the SDK, because preview needs a host renderer.

Data validity and publishability are separate. `validateCourse` and `course compile` keep accepting every
0.4/0.5 manifest, but `publicationIssues(course)` lists what a host refuses to publish, and `course lint`
(as errors), `course test` (the `publishable` check) and `course pack` apply it. Today it refuses an
unversioned gate's `conversationalEvaluatorId` (`CONVERSATIONAL_GATE_UNSUPPORTED`): it names no rubric for a
judgment to cite, so Course Core rejects it with `PUBLISH_CONVERSATIONAL_GATE_UNSUPPORTED`. Such a gate must
still collect its declared item families and cover its objectives with items. Use a versioned gate with a
cited-evidence rubric in `conversationalRubricRef`; `course migrate` lists the step.

Lesson content must be accessible. Validation rejects a visual block whose renderer extension declares no
keyboard support (`INACCESSIBLE_VISUAL`), a legacy activity block whose extension declares none
(`INACCESSIBLE_ACTIVITY`), and a blank text alternative on a visual block's renderer, its visual description,
a legacy activity extension or required media (`MISSING_TEXT_ALTERNATIVE`).

A bundle's SHA-256 integrity map proves the files are intact. It does not prove who wrote them or that they can be trusted.

## SDK 0.5 contracts

All 0.5 sections are optional manifest fields, so 0.4 data is unchanged. Each new `define*`
helper validates its contract on its own (schema plus context-free rules), throws
`ContractValidationError` and returns a detached copy. `validateCourse` checks every
cross-reference. `defineCourse`, `defineExtension` and `defineVisualExperience` keep their
0.4 copy-only behavior; use `validateContract(kind, value)` for those.

| Helper | Manifest field | Notes |
| --- | --- | --- |
| `defineProgressionGate` | `gates[]` | Versioned gate with the design's required fields: `id, version, scope, requiredObjectives, readinessCriteria, eligibleEvidenceKinds, minimumIndependentEvidence, assistancePolicy, nextActivityId, remediationPolicyRef, capPolicyRef, appealPolicy`. Readiness needs a `transfer_success` criterion and production transfer evidence; a recognition-only gate is rejected (`RECOGNITION_ONLY_GATE`, `MISSING_TRANSFER_ITEM`). Critical misconceptions need a `no_critical_misconception` criterion and an item that exposes them. Conversational evidence requires a rubric that demands cited learner evidence. |
| `defineAssessment` | `assessments[]` | New types `prediction`, `trace`, `code_repair`, `counterexample`, `experiment_design`, `teach_back`. Optional `role`, `misconceptionIds`, `allowAbstain` ("I don't know") and `confidence`. Numeric items gain `relativeTolerance` and `unit`. Recognition items cannot be `transfer`. |
| `defineActivity` | `activities[]`, block `{ type: 'activity', activityId }` | `supportedTargets, rendererRefs, executionAdapter, capabilityRequirements, equivalentFallbacks, offlineBehavior, resourceBudget, accessibleSemantics, stateMigration`, plus `layoutInputs` and compact/medium/expanded `layouts`. Every declared course target needs support or an objective-equivalent fallback. Native execution needs a declared native module. |
| `defineAdminSection` | `adminSections[]` | Declared permissions, typed settings with checked defaults, audited mutations. Settings cannot target evidence, grading, caps or policy. `adminSettingsSchema(section)` renders the settings as a JSON Schema form, `adminSettingDefaults(section)` lists the defaults, and hosts check every change server-side with `checkAdminSettingChange(section, change, grantedPermissions)` (`UNKNOWN_SETTING`, `ADMIN_PERMISSION_DENIED`, `SETTING_SCOPE_MISMATCH`, `INVALID_SETTING_VALUE`). |
| `validateContract('extension', …)` (`defineExtension` stays copy-only) | `extensions[]` | 0.6 adds optional `stateMigration` (`migrateState`: state version, strategy and source versions; versioned state needs a `stateSchema`), `tests` (the extension's own fixtures as portable relative paths) and the full `resourceBudget` (`maxStateBytes`, `maxEventBytes`, `maxEventsPerMinute`) next to `license`, `stateSchema`, `observationSchema` and `evaluatorRef`. Lint notes observation schemas without `observation.emit` and observations without an evaluator. |
| `defineStage` | `stages[]`, chapter `stageId` | Roadmap grouping. Stages and chapters take `subtitle` and `iconAsset`; `courseRoadmap(course)` returns consecutive stage groups with the author's labels so hosts need no hard-coded "Chapter" labels or icons. Lint warns when one stage's chapters are split. |
| `defineTeachingHypothesis`, `defineDiagnosticProbe`, `defineConcept` | `hypotheses[]`, `probes[]`, `concepts[]` | Competing hypotheses per objective, and the probes that distinguish them. Probes never count as gate evidence. |
| `defineResearchTask` | `researchTasks[]` | Author bounds for dedicated research. `validateResearchRequest` and `validateResearchResult` check the request fields (`objective, episodeRevision, misconceptionHypothesis, knownPrerequisites, language, modality, remainingLearningTime, accessibilityNeeds, sourcePolicy, requiredOrOptional`) and the result fields (`sourceUrl` through `concerns`). Metadata-only results carry no claims or segments. |
| `defineAgentStrategy`, `defineTool` | `agentStrategies[]`, `tools[]` | Roles, tool references, model requirements, autonomy limits, budgets, retry and cancellation. Evaluators and verifiers only propose. |
| `defineRubric`, `defineEvaluator`, `defineAdaptationPolicy`, `defineLearningPolicy`, `definePlacementPolicy`, `defineLearningStep`, `defineEpisode`, `defineMediaResource`, `defineStoryboard`, `defineRenderer`, `defineRendererAdapter`, `definePlatformAdapter`, `defineDebugInspector`, `defineScene`, `defineTimeline`, `defineStage` | matching fields | See the TypeScript declarations and `course.schema.json`. |

Runtime records (`Attempt`, `Evidence`, `GateDecision`, `TeachingHypothesis`, `ResearchRequest`,
`ResearchResult`/`MediaCandidate` (both record kinds apply the same rules), `MediaJob`, `PlacementEvidence`, `PathExemption`, `ExtensionOffer`,
`ExtensionGrant`, `ClosureOutcome`, `DebugTrace`, `DecisionRecord` and others) are checked with
`validateRecord(kind, value)`. Agent-authored answers can only be synthetic evidence.
Assisted or reattempted work cannot be independent. "I don't know" is recorded without a
misconception signal or penalty.

0.6 adds the `contextCapsule` record (the companion's context capsule), `rubricRevision` (a versioned
rubric) and the portable learning-event export `learningEventExport` (`$defs/learningEventExport` in
`@course-core/sdk/schema`): one enrollment's events in a cursor range, with decimal-string sequences that
stay exact beyond 2^53, strictly increasing and inside the range. The export carries an opaque
`enrollmentRef`, never a name or email address; deciding who may export what stays with the host.

TypeScript declarations are also generated from `course.schema.json` (`npm run generate` writes
`src/generated/schema-types.d.ts`). `tests/generated-types.test.ts` proves that every public contract and
record type, and `CourseManifest`, accepts exactly the same values as its generated counterpart, so schema
and types cannot drift apart unnoticed. The hand-written types stay the public API because they carry the
documentation.

`decideGate(course, gateId, evidence, context)` is a transparent, deterministic reference
evaluator. It returns a `GateDecision` with one of `ready`, `needs_evidence`, `needs_help`,
`under_review` or `closed_with_gaps`, together with the criterion results, linked evidence and
concrete `nextActions`. `checkGateDecision` rejects stale or unlinked decisions. Hosts must
still authenticate evidence and recheck versions at commit time.

Retention `intervalsDays` may now be omitted. `resolveRetentionIntervals` and the learner
projection then use the product default `DEFAULT_REVIEW_INTERVALS_DAYS` (1, 3, 7, 21).
`windowClass(width, fontScale)` returns `compact` (<600), `medium` (600–839) or `expanded` (≥840).
`PLATFORM_CONTRACT` and `REQUIRED_ACTIVITY_FIELDS` carry the design's platform contract (six targets,
three layout classes, seven layout inputs and the nine required activity fields);
`platformContract(activity)` extracts those nine fields from an activity.

Server-only sections never reach the learner projection: hypotheses, probes, rubrics,
evaluators, tools, adaptation policies, admin sections, research tasks, storyboards, agent
strategies and debug inspectors. Versioned gates project their readable requirements, but not
their item, rubric or policy references.

TypeScript note: `ProgressionGate` is now `LegacyProgressionGate | VersionedProgressionGate`,
the activity block is a union, and `RetentionPolicy.intervalsDays` is optional. Narrow with
`isVersionedGate` or `'extensionId' in block`. Data and compiled output are unaffected.

## Required episodes and optional branches

An episode may declare `requirement: 'required' | 'optional'`. Omission means
`'required'`, including for existing schema-1 courses. Read this with the portable
`getEpisodeRequirement(episode)` helper after validating the course. Neither validation
nor compilation inserts the default into serialized data, so legacy manifest bytes
and compiled digests remain unchanged. Explicit declarations are preserved in both
server and learner projections and participate in the immutable base-course digest.

For an objective marked `critical: true`, or referenced by **any** objective's
`prerequisites`, declared episode coverage cannot consist solely of optional episodes.
At least one episode supplying it must be required (explicitly or by default).
Optional reinforcement alongside a required episode is valid. This includes ancestors
through the prerequisite graph and prerequisites used by optional branches. Independent,
noncritical enrichment can be optional. Validation reports `OPTIONAL_ONLY_OBJECTIVE`
at the objective declaration when this constraint fails.

This check uses explicit episode `objectiveIds`; an assessment, gate, placement item,
or generated variant does not substitute for required episode coverage. For compatibility,
existing objective declarations not assigned to any episode retain their previous
validation behavior. Coverage declarations cannot prove instructional sufficiency or
mastery. The runtime owns skip decisions, placement, dependency checks, evidence and
closure; the SDK does not apply any skip or grant credit.

Fixed episode requirements are author-owned base-course data. Adaptation proposals
cannot change them. Separate author/server `ActivityAssignmentDecision` classifications
apply only to the named generated operations, never to an existing episode. Optionality
does not exempt consumed work from caps or consent rules, and generated optional work
cannot make a required base episode optional.

## Whole personal episodes (0.4)

Authors can permit `insert_episode` on an adaptation target. A proposal then
pairs an `episode` artifact (title plus 1–12 text blocks; no new grading) with
`{ type: 'insert_episode', afterEpisodeId, artifactId }`, placing a personal
episode immediately after an existing base episode. The artifact ID becomes the
episode ID and every block ID must be new. Verifiers and generators must declare
the `episode` kind, and the host's assignment decision must meter it as at least
one additional episode (`EPISODE_COST_REQUIRED`). As with every adaptation, the
SDK validates data only; hosts authenticate proofs, enforce caps and apply it.

## Delayed retention checks (0.3)

`retention` declares delayed independent checks that can show an objective is
*retained*, not only demonstrated:

```ts
retention: {
  intervalsDays: [1, 3, 7, 21],     // strictly increasing whole days, 1–365, at most 8
  objectiveIds: ['compare'],
  assessmentIds: ['later-min'],     // held-out items, never used by a gate, placement or episode block
}
```

Validation rejects items that are not held out (`RETENTION_ITEM_NOT_HELD_OUT`),
objectives without an item (`UNCOVERED_RETENTION_OBJECTIVE`) and invalid
intervals. The learner bundle receives only the schedule; held-out item identities,
prompts and keys stay in the server bundle. Hosts decide when a check is due,
record it as independent evidence and keep demonstrated and retained states
distinct. Intervals are author defaults to validate with real learners, not a
scientific constant.

## Verify a checkout

```sh
node scripts/check-packed.mjs --self-test
node scripts/check-packed.mjs --audit-source
npm ci --ignore-scripts --registry=https://registry.npmjs.org/ --no-audit --no-fund
npm run typecheck
npm test
npm run build
node scripts/check-packed.mjs
```

The checker packs the existing build with lifecycle scripts disabled, inspects the actual compressed archive, and installs it in a temporary consumer outside the checkout. It checks:

- Explicit metadata, export targets, original-code Apache-2.0 license, exact bundled MIT notices, executable CLI, and package file allowlist.
- Public npm tarball URLs and SHA-512 integrity in the lockfile; no Git dependencies, alternate registries, local links, workspaces, or bundled `node_modules`.
- Archive traversal, links, duplicates, special records, oversized files, binary content, common credentials, and local home paths. Owner repository URLs in source and package contents are limited to `roeehrl/course-sdk` and `roeehrl/course-core`; other owners' public dependency references are unaffected.
- Main-export import and validation with Node builtins denied, `process`/`Buffer` unavailable, and string code generation disabled, plus TypeScript consumption without ambient Node types. Static validators under `dist/generated/` are allowed.
- Compiler and schema exports, compiled artifact verification and tamper detection, and removal of assessment prompts/answer keys/bank references from the learner projection.
- Installed CLI validation and compilation, invalid-input rejection, refusal to overwrite an existing output, and failure for an unknown CLI option.

The portability smoke covers the exercised import and validation paths, including a CSP-like prohibition on `eval` and `new Function`. It does not replace testing under an application's full browser Content Security Policy or on a native device. Sensitive-content checks use a strict file policy and recognizable patterns; a maintainer must still inspect content for private data that pattern matching cannot identify.

To retain a verified candidate and its file inventory and hashes, choose an empty output directory outside this checkout:

```sh
node scripts/check-packed.mjs --expect-version 0.6.0 --output-dir ../sdk-candidate-0.6.0
```

Missing compiler, validator, schema, declarations, or CLI output is a failure. No missing implementation is replaced by a stub or counted as a pass. The checker does not rebuild implicitly: run the build command first.

## CI and release verification

Pull requests, pushes to `main`, and manual CI runs execute the same Node 24/26 checks. Workflows have read-only repository permissions, use official actions pinned to full commit SHAs, do not persist checkout credentials, and receive no npm or other publishing secrets. Dependency installation disables lifecycle scripts. Public CI checks out only this repository and must never fetch private course repositories or data.

The public repositories are [roeehrl/course-sdk](https://github.com/roeehrl/course-sdk) and [roeehrl/course-core](https://github.com/roeehrl/course-core). This SDK's CI does not fetch either a sibling checkout or private fixtures.

`Release verification` runs for version tags such as `v0.2.0`. A manual run must also select an existing version tag. The tag must match `package.json` and the lockfile. Both Node jobs must pass; the Node 24 job retains its exact verified tarball and `verification.json` for seven days. An uploaded artifact by itself does not establish that the other matrix job passed.

There is deliberately no publish or GitHub Release step. Repository visibility, protected branches/tags, npm scope ownership, publication authorization, and any later trusted-publishing setup are maintainer integration tasks. See [CONTRIBUTING.md](https://github.com/roeehrl/course-sdk/blob/main/CONTRIBUTING.md) for the exact release checklist and [SECURITY.md](https://github.com/roeehrl/course-sdk/blob/main/SECURITY.md) for vulnerability reporting.

Original SDK code is licensed under [Apache-2.0](LICENSE). [NOTICE](NOTICE) preserves the exact MIT copyright and permission notices for the actually bundled validator helpers. Each generated bundle also includes the notices for its own included dependencies.

## Adaptive teaching in 0.2

`CourseAdaptation` is a constrained proposal against an immutable course release and a
specific personal-plan revision. It cannot patch the course manifest arbitrarily. Its
operation union supports appending/replacing explanation or practice text, attaching
reviewed media or declared client-renderer visuals, adding an assessment variant, and suggesting
a profile correction. There is no operation for mastery, credit, evidence issuance,
objective removal, gate changes, consent, policy, deadlines or allowance changes.

Courses opt in with the optional `CourseManifest.adaptation` authoring section. Existing
schema-1 courses without this section keep their existing validation/compiler behavior
and cannot accept adaptations. Authoring declarations identify:

- Permitted episodes/objectives, operations and replaceable existing text blocks.
- Existing canonical assessment/family bindings, generator/verifier allowlists and permitted numerical template IDs.
- Versioned generator extensions with `teaching.generate`, and server verifier extensions
  with `teaching.verify`, source references and required check IDs.
- Approved source references, non-authority profile fields, optional numerical templates,
  proposal/artifact limits and separate assignment-classification/cost bounds.

The complete public fixtures are [ordering](fixtures/ordering.adaptation.json),
[language practice](fixtures/language.adaptation.json), and
[plant observations](fixtures/plant-observations.adaptation.json). They are synthetic
repository fixtures, deliberately excluded from the package tarball. Their proof and
assignment records are example **claims**, not authenticated verification or live learner
records. The same contracts accept a nonnumerical language creator plugin; no subject or
provider branch is built into the SDK.

```ts
import {
  validateCourseAdaptation, validateAssignmentDecisions,
  type CourseAdaptation, type AdaptationValidationContext,
  type ActivityAssignmentDecision,
} from '@course-core/sdk';

// These values come from separate application trust boundaries.
// The proposal may be generated; context/decisions are loaded by the host.
declare const proposal: CourseAdaptation;
declare const context: AdaptationValidationContext;
declare const decisions: ActivityAssignmentDecision[];

const data = await validateCourseAdaptation(proposal, context);
if (!data.valid) throw new Error('Reject or rebase the proposal');
const assignments = await validateAssignmentDecisions(proposal, context, decisions);
if (!assignments.valid) throw new Error('Author/server assignment decisions required');

// Both results are data checks only. Host authentication and transaction gates
// are still required; neither result authorizes application or grants credit.
```

Validation rejects unknown fields, invented objectives/families, stale plan or target
bindings, altered hashes, duplicate/reused entity IDs, missing/failed checks, unknown
verifier versions/implementations, unapproved sources, invalid renderers, unreviewed media
and author-constraint violations. A generated variant preserves its canonical type,
objective coverage, numeric tolerance, rubric and evaluator/language standards. Code
fixture data can vary only inside the hashed artifact reviewed by its allowed verifier.
New variants retain their canonical family; renaming an item does not create a new
independent evidence family.

### Integrity, proof claims and runtime trust

`digestJson` uses canonical JSON plus SHA-256 via Web Crypto. `digestTeachingArtifact`
excludes only the artifact's own `digest` field, so grading, hidden fixtures, generator
identity, recipe inputs and provenance all affect its identity. `digestAdaptationProposal`
excludes only `proofReceipts`, avoiding a circular digest while binding all operations,
artifacts, rationale and plan fences. Each receipt also binds its artifact digest.

Receipts must match the author-declared verifier ID/version and the **host-supplied**
`registeredVerifiers` snapshot, including implementation digest and source references.
Required check IDs must all pass. This is not proof that a claimed receipt was really
issued. A model can fabricate a perfectly well-shaped record with matching hashes.
Consequently successful validation always returns `proofAuthenticity: 'not_checked'`
and `applicationAuthority: 'not_checked'`. An `authenticated: true` or similar extra
claim is rejected, not trusted. The SDK neither signs receipts nor authenticates issuers,
receipt references, source claims, the supplied registry or the caller.

The host must independently authenticate/retrieve the receipts, select trusted verifier
implementations, establish the freshness/scope of their results and reject fabricated
records before delivery/application. A review flag, model agreement, successful hash or
`valid: true` is insufficient. Local/browser verification is useful for authoring but is
not tamper-resistant assessment evidence.

`ExerciseGeneratorPort` and `ArtifactVerifierPort` are provider-neutral interfaces. The
host registers implementations and controls execution/isolation, authentication,
resource budgets and retries. A verifier returns a check report; the SDK does not turn
that report into an authenticated receipt. Generators cannot insert code into the core
application process through these data contracts. Nonnumerical creator plugins can use
these same ports with author-selected evaluators and reference fixtures.

### Separate course, plan, artifact and evidence identities

The context binds `course`, `baseCourseDigest`, a plan snapshot and scoped registered
verifiers. The plan also binds the base digest and contains current revision/digest,
occupied IDs, current replacement-target digests and canonical-family variant counts.
The host must supply a complete authoritative snapshot; model-supplied empty histories
would defeat cross-request accounting. The SDK does not load or lock a database.

The Node compiler offers `compileCourseAdaptation` and `verifyCompiledCourseAdaptation`:

```ts
import { compileCourseAdaptation } from '@course-core/sdk/compiler';
const candidate = await compileCourseAdaptation(proposal, context);
// candidate.status === 'proposal'
// candidate.proposedPlan has parentDigest, next revision and a separate digest.
// candidate.proposedPlan.baseCourseDigest is unchanged.
// candidate.server contains full grading/fixtures/proof claims.
// candidate.learner is a restricted proposed-content projection.
```

Compilation does not apply the plan. Two proposals can share the same parent; the parent
application must choose a winner transactionally using the plan revision/digest, retain
idempotent receipts and publish its outbox with the update. `verifyCompiledCourseAdaptation`
checks data integrity and projection, not authenticity or application authority.

`ObjectiveEvidenceAnchor` retains the immutable base digest and objective ID independently
of plan revision. `AssessmentVariantAnchor` adds canonical assessment/family and exact
artifact identity. Old attempts keep their item/rubric/artifact versions. A new teaching
plan need not reset unrelated objective evidence. Invalidating defective evidence is an
explicit host decision with provenance, not a side effect implemented by this SDK.
`ContextCapsule` gains optional plan revision/digest and artifact references; existing
capsules remain structurally compatible.

### Author/server classification and costs

Model proposals contain no required/optional flag or work-cost authorization. Separate
`ActivityAssignmentDecision` records bind the exact proposal and each teaching operation,
classification, planned minutes, added-episode cost and an author/server receipt reference.
The helper enforces the declared per-assignment bounds and complete, nonduplicate operation
coverage. It does not establish who issued the records or whether estimates are accurate;
success reports `authorityAuthenticity: 'not_checked'`.

The host must authenticate those decisions and enforce actual policy, quotas, consent,
resource budgets and commit-time revision checks. “Optional” text is not permission to
bypass those controls. Profile corrections are suggestions for declared fields, not
applied mutations; authority/progression field names are disallowed, and suggestions
never update assessed mastery or consent.

### Bounded numerical templates

Authors may supply `NumericalRecipeTemplate` records inside the immutable course.
Instances name a template ID/version/digest and an exact set of bounded variables.
The prompt is a source template with `{{variable}}` substitutions. The safe arithmetic
AST supports finite constants, variables, negate/abs and add/subtract/multiply/divide/
min/max. It has no eval, property access, calls, imports, loops or I/O. Unknown operations,
nonfinite values, missing/extra variables, integer/range violations, zero divisors,
excessive nodes/depth and intermediate magnitude overflow are rejected.

Hard ceilings are 256 AST nodes, depth 16, 32 variables, input/constant magnitudes up to
1e9 and an author-selected intermediate/output bound no greater than 1e12. Prompts are
bounded to 10,000 characters before interpolation. Each node is evaluated once, within
the declared step budget. This is a small arithmetic option, not a general programming
language, simulator, proof assistant or automatic subject-matter verifier.

`instantiateNumericalRecipe` returns a prompt, computed value and instance;
`evaluateNumericalRecipe` checks an existing instance. The computed value is grading data
and is not an independent correctness proof. A numerical assessment's prompt/answer
must agree with its recipe and keep its canonical tolerance. `checkNumericalReference`
invokes a separately selected `NumericalReferencePort` with variables and template digest,
without supplying the expected answer. A finite matching result is reported as a numeric
match with authenticity still unchecked. The host must ensure that the reference is
trusted and independently implemented, bound external execution, and authenticate the
subsequent verifier receipt. Non-numerical generators need no arithmetic recipe.

### Learner projection and practical limits

Base-course compilation removes the entire authoring section from the learner projection,
including numerical answer templates and verifier declarations. Adaptation compilation
uses an allowlist projection: generated assessments expose only ID/type/objective IDs,
never full prompts/options, grading, starter code, hidden fixtures, recipes or proof
receipts. Items are served only for authorized attempts. Explanation/practice text,
visual content, media alternatives and profile suggestions are intended display data.
The projection cannot detect an answer or private material deliberately embedded in
ordinary prose or arbitrary display state; the trusted verifier and host content review
must enforce that semantic boundary.

Portable helpers require `structuredClone`, `TextEncoder` and Web Crypto SHA-256.
Browser/native integrations without these standard facilities must provide suitable
implementations. The main export contains no Node compiler/CLI imports. CSP tests forbid
string/wasm code generation while exercising hashing, recipes and adaptation validation.
No database transactions, adaptation application, provider orchestration, receipt-signing,
source fetching, plugin sandbox or practical grading service is implemented by the SDK.

## Author-approved public research

Courses may declare optional `research.publicTopics`. Each `PublicResearchTopic` has
a stable `id`, nonempty existing `objectiveIds`, fixed public `queryText` (1–2048
characters, not whitespace-only), and optional `allowedDomains`. Topic IDs must be
unique. Unknown fields, duplicate/missing objectives and malformed domains fail course
validation. Existing schema-1 courses without research remain valid and cannot resolve
any research topic. The authoring schema is included in `@course-core/sdk/schema`.

```ts
import { resolvePublicResearchRequest, type ResearchAuthoring } from '@course-core/sdk';

const research: ResearchAuthoring = {
  publicTopics: [{
    id: 'ordering-reference',
    objectiveIds: ['compare'], // Must already exist in the course.
    queryText: 'Public examples of ascending and descending numerical order',
    allowedDomains: ['reference.example'],
  }],
};
// The author publishes this declaration as course.research.
// The host loads its approved, pinned course and authorizes the supervisor first.
const resolved = resolvePublicResearchRequest(trustedCourse, { topicId: 'ordering-reference' });
if (resolved.valid) {
  // Send only resolved.request to the external research port.
  // { queryText: <exact author text>, allowedDomains?: <exact author domains> }
}
```

`PublicResearchSelection` accepts only `{ topicId }`. A model-proposed query string,
private profile/history/answers, caller-supplied domains, an `approved` flag or an
invented topic ID cannot authorize or override a query. `PublicResearchRequest` is an
explicit detached projection containing only the approved text and optional domains;
it contains no objective IDs, topic ID, learner identity, context capsule or other
course data. No interpolation or query expansion takes place, even for literal template
syntax. Adaptation proposals cannot edit these author declarations. Base-course
compilation retains research in the server document and digest, and omits it from the
learner projection. A supervisor topic picker is host-owned.

The resolver reports `authorityAuthenticity: 'not_checked'`: JSON validation cannot
authenticate author approval or a supervisor, or prove that text contains no private
information. Load the declaration only from the trusted published course, never from
model output or learner context; authorize selection against that course revision and
review topic text for public disclosure. The external agent must receive **only** the
projected request, without appending private context or allowing the model to rewrite the
query. The SDK cannot constrain what a caller sends after resolution.

Domains are exact lowercase ASCII DNS names (internationalized names use punycode),
with no implicit subdomain matching, URLs, paths, ports, wildcards or IP literals.
Omission imposes no author domain restriction; an empty array is invalid. This is a
portable declaration, not a network safety check. The runtime owns domain enforcement,
redirect/DNS checks, credentials, fetching, budgets, consent, and result sanitization.
The SDK performs no web requests and carries no provider-specific configuration.

## Generated validator license audit

Build-time Ajv generation is bundled by esbuild with legal comments retained. The generator
inspects each bundle's actual esbuild input graph, records its runtime modules and exact
installed license hashes in `dist/validator-dependencies.json`, emits the applicable full
MIT notices into that bundle, and creates the package-level `NOTICE` from their union.
The current included packages are `ajv@8.20.0`, `ajv-formats@3.0.1` and
`fast-deep-equal@3.1.3`. Build tools and installed-but-unbundled dependencies are not added
as if their code were included. A new bundled package or changed license family fails the
review gate until explicitly handled.

Unit tests compare the inventory with the actual generated code and installed license
files. The packed checker requires `NOTICE`, verifies license hashes and full text in the
packed bundles, and continues to reject undeclared files. Fixtures are source-only public
test inputs; packed smoke tests stage them as data while importing implementation solely
from the isolated installed tarball. CI runs those checks on Node 24 and 26 and retains
only the exact verified artifact for maintainer-controlled release.
