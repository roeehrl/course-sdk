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

`defineCourse` validates the whole course (as `validateCourse` does) and returns a detached copy; it throws `ContractValidationError` (contract `course`) with every issue. Before 0.6 it copied without checking. Publication rules (`publicationIssues`) are separate. Keep compiler imports in Node tooling:

<!-- docs-example: continue -->
```ts
import { compileCourse, verifyCompiledCourse } from '@course-core/sdk/compiler';

const compiled = compileCourse(course);
// compiled: { formatVersion: 1, digest, server, learner }
if (!verifyCompiledCourse(compiled)) throw new Error('Invalid compiled artifact');
```

The server projection retains the full course. The learner projection omits complete assessment prompts, answer keys, and hidden bank references; applications serve items only for authorized attempts. A valid digest establishes integrity, not author trust or runtime authorization.

After installation, use the local CLI with a course: a JSON file, a course directory, or (0.6) a TypeScript course module:

```sh
npx --no-install course init my-course            # scaffold a valid 0.5 course (refuses an existing directory)
npx --no-install course init my-course --locales he   # 0.6: plus locales/he.json (--locale sets the source locale)
npx --no-install course validate course.json       # or a course directory (course.json + locales/<tag>.json)
npx --no-install course locales my-course          # 0.6: per-locale coverage, fallbacks and missing keys
npx --no-install course lint course.json --strict  # errors always fail; warnings fail with --strict
npx --no-install course test course.json           # offline conformance report
npx --no-install course compile course.json compiled.json
npx --no-install course inspect course.json
npx --no-install course pack course.json bundle    # manifest, integrity map, licences, capabilities, conformance
npx --no-install course verify bundle              # or a compiled.json
npx --no-install course pack my-course --out my-course-1.0.0.course.tgz   # course-package v1 (+ .sha256)
npx --no-install course verify my-course-1.0.0.course.tgz
npx --no-install course diff old.json new.json
npx --no-install course migrate old.json new.json  # upgrade 0.4 gates; lists manual steps
npx --no-install course import bundle course.json  # recover a verified manifest
npx --no-install course init my-course --typescript   # 0.6: course.ts instead of course.json
npx --no-install course dev my-course              # 0.6: live local preview on http://127.0.0.1:4321/
npx --no-install course policy my-course fixtures.json   # 0.6: run cap, allowance, deadline and admin scenarios
npx --no-install course compat my-course --host host.json # 0.6: SDK, Core and installed-adapter compatibility
npx --no-install course replay my-course decisions.json   # 0.6: replay recorded gate decisions
```

Every command is offline and deterministic, prints JSON, and exits 0 on success, 1 on a failed check and 2 on a usage error (`course dev` runs until stopped and serves only 127.0.0.1). Commands that write refuse to overwrite an existing file or directory. Using `--no-install` avoids silently downloading a different command if the package is missing.

### TypeScript course modules (0.6)

Every command that takes a course also takes a TypeScript or JavaScript course module (`.ts`, `.mts`, `.js`, `.mjs`), or a course directory holding `course.ts` instead of `course.json` (its `locales/<tag>.json` bundles are merged the same way). The module's default export (or a `course` export) is the course data, usually built with `defineCourse`/`assembleCourse`; it compiles to exactly the bundle the equivalent `course.json` gives. `course init --typescript` scaffolds one.

The CLI evaluates the module in a separate Node process, so a course module is source code, never a plugin:

- Node's permission model lets it read files only inside its project (the nearest directory with a `package.json`) and refuses file writes, child processes, workers, native addons and the inspector.
- Network APIs (`fetch`, sockets, HTTP, DNS, WebSocket) are replaced with functions that throw `MODULE_ACCESS_DENIED` (Node 26 also denies the network in the permission model itself).
- `Math.random`, crypto randomness, `Date.now()` and `new Date()` throw `MODULE_NONDETERMINISTIC`, so the same source always builds the same course; `eval` and `new Function` are disabled.
- It runs with an empty environment (`TZ=UTC`), a 20-second limit, a 256 MiB heap and a 16 MiB output limit. Its console output goes to stderr.

TypeScript runs through Node's type stripping (Node 24 or newer), so use erasable syntax (no `enum` or `namespace`) and import other files with their `.ts` extension. Type-only imports of `@course-core/sdk` need nothing installed; value imports such as `defineCourse` need the SDK in the project. From Node, `loadCourseModule(file)` in `@course-core/sdk/compiler` returns the exported data.

### Live preview: `course dev` (0.6)

`course dev <course> [--port 4321] [--visuals <dir>]` watches the course (JSON, directory or module), rebuilds on every save and serves a preview at `http://127.0.0.1:4321/` that reloads itself. The page shows the course outline in any of its locales (right-to-left locales are laid out right to left), every validation problem, lint finding, failing conformance check and compatibility problem next to the item it is about, and the module's console output. `/build.json` and `/compiled.json` return the current build.

Visuals are drawn with the released Course Core renderer: install `course-core-visuals-<version>.tgz` from a Course Core release into the course project (`npm install ./course-core-visuals-0.4.0.tgz`; 0.4.0 or later), or pass `--visuals <package-directory>`. The SDK does not depend on it; without it, each visual shows its text alternative. The server answers only `127.0.0.1`/`localhost` host names, serves reads only, sends a strict Content Security Policy, and writes nothing.

### Policy fixtures (0.6)

`course policy <course>` prints the resolved learning policy of every scope (course, chapters, episodes). `course policy <course> fixtures.json` (or `runPolicyFixtures(course, fixtures)` from the main export) runs scenarios against it with a fixed clock and exits 1 when an outcome differs from the expectation. A scope's policy is the intersection of the course, chapter and episode policies, as Course Core resolves it: the earliest deadline binds, each work cap is the smallest declared value (zero is a real cap), extension allowances take the smallest limits, closed material access wins, and deadlines are exclusive. Calendar windows count whole local days in their time zone from the anchor the fixture gives. The report is the author's reference; Core's policy service stays authoritative for real enrollments.

```ts
import { runPolicyFixtures } from '@course-core/sdk';

const course = {
  schemaVersion: 1, id: 'fixture-demo', version: '1.0.0', title: 'Fixtures', summary: 'Synthetic.', locale: 'en', platforms: ['web'],
  objectives: [{ id: 'start', description: 'Read.', prerequisites: [] }],
  chapters: [{ id: 'one', title: 'One', episodes: [{ id: 'read', title: 'Read', objectiveIds: ['start'], blocks: [{ id: 't', type: 'text', markdown: 'Hi.' }] }] }],
  assessments: [], gates: [], extensions: [], visuals: [], media: [], sources: [],
  policy: { mode: 'bounded', window: { calendarDays: 14, timeZone: 'Asia/Jerusalem', anchor: 'enrollment_started', pauseRule: 'never' },
    work: { additionalEpisodes: 2 }, extensions: { enabled: true, calendarDays: 7, maxGrants: 1, maxDaysPerGrant: 7, learnerAcceptanceRequired: true },
    existingMaterialAccess: 'read_only' },
};
const report = runPolicyFixtures(course, { policyFixturesFormat: 1, fixtures: [{
  id: 'two-weeks', scope: 'episode:read', anchors: { enrollment_started: '2026-03-01T08:00:00Z' },
  steps: [
    { kind: 'action', action: 'submit', at: '2026-03-15T07:59:59Z', expect: 'allowed' },
    { kind: 'action', action: 'submit', at: '2026-03-15T08:00:00Z', expect: 'denied', reason: 'DEADLINE_PASSED' },
    { kind: 'action', action: 'read', at: '2026-04-01T00:00:00Z', expect: 'allowed' },
    { kind: 'work', use: { additionalEpisodes: 3 }, expect: 'denied', reason: 'WORK_CAP_EXCEEDED' },
    { kind: 'extension', days: 7, expect: 'granted' },
    { kind: 'extension', days: 1, expect: 'denied', reason: 'EXTENSION_GRANTS_EXHAUSTED' },
  ],
}] });
if (report.status !== 'passed') throw new Error(JSON.stringify(report.fixtures, null, 2));
```

Steps are `action` (`progress`, `submit` or `read` at an instant), `work` (additional episodes, minutes or remediation cycles, cumulative), `extension` (a grant of whole days, which moves the deadline) and `admin` (a setting change with the actor's permissions, checked by `checkAdminSettingChange`). Each outcome gives the rule code that denied it (`DEADLINE_PASSED`, `MATERIAL_CLOSED`, `WORK_CAP_EXCEEDED`, `EXTENSIONS_DISABLED`, `EXTENSION_TOO_LONG`, `EXTENSION_GRANTS_EXHAUSTED`, `EXTENSION_ALLOWANCE_EXHAUSTED`, `ADMIN_PERMISSION_DENIED`, …) and a plain explanation. A fixture with a malformed step, an unknown scope or a missing window anchor is reported as invalid.

### Compatibility report (0.6)

`course compat <course> [--host inventory.json] [--minimum-core-version x.y.z]` (or `compatibilityReport` from `@course-core/sdk/compiler`) puts everything that decides whether a host can run the course in one report, with the same rules as Course Core's package install preview:

- **SDK**: this SDK's version, the host SDK the course needs (0.6.0 when it uses multi-locale text, 0.6 render features, visual checks or the other 0.6 additions, with the reasons), and the host's accepted SDK range (`supported`, `older`, `newer` or `unsupported`).
- **Core**: the minimum Core version the package will declare against the host's version.
- **Adapters**: every renderer a visual needs (with its render features and declared version), every extension (version and integrity), platform adapter and required capability, each `satisfied`, `missing`, `version_mismatch`, `feature_missing` or `unknown`.

A host inventory is `{ "hostInventoryFormat": 1, "coreVersion": "0.1.50", "sdk": { "version": "0.6.0", "supported": { "min": "0.5.0", "maxExclusive": "0.7.0" } }, "renderers": [...], "extensions": [...], "platformAdapters": [...], "capabilities": [...] }`. Without one the report lists what the course needs, checks the locally installed visuals renderer (problems with it are warnings: the preview may differ from what learners see) and its status is `unknown`. The command exits 1 only when something is incompatible.

### Replaying gate decisions (0.6)

`course replay <course> decisions.json` (or `replayGateDecisions`) runs the SDK reference gate evaluator again on recorded decisions (`{ "gateReplayFormat": 1, "decisions": [{ gateId, evidence, context, decision }] }`) against the current, possibly edited, course and reports each as `reproduced`, `changed` (with the decision fields that differ) or `invalid`. It is pure: it writes nothing, grants nothing and never replaces a recorded decision, so it is safe on exported records.

Data validity and publishability are separate. `validateCourse` and `course compile` keep accepting every
0.4/0.5 manifest, but `publicationIssues(course)` lists what a host refuses to publish, and `course lint`
(as errors), `course test` (the `publishable` check) and `course pack` apply it, with Course Core's rules
(Core's codes add a `PUBLISH_` prefix). An unversioned gate's `conversationalEvaluatorId` must name an
evaluator definition bound to exactly one course rubric (`rubricIds`) that may judge a conversation: a
human or model-assisted method with `humanConfirmation: "required"`, or a deterministic method whose
installed adapter confirms quoted findings. A bare extension ID names no rubric for a judgment to cite and is
refused (`CONVERSATIONAL_GATE_UNSUPPORTED`); such a gate must still collect its declared item families and
cover its objectives with items. The rubric must require cited evidence (`CONVERSATION_RUBRIC_UNSUPPORTED`).
The conversation then counts as one item family for every gate objective, and with the listed items the gate
must still reach `minimumIndependentFamilies` (`GATE_EVIDENCE_UNREACHABLE`). A versioned gate's
`conversationalRubricRef` likewise needs an evaluator that may judge conversations and lists the rubric in
`rubricIds` (`CONVERSATION_RUBRIC_UNSUPPORTED`). `gateConversation(course, gate)`
returns the rubric and evaluator a gate's conversation is judged by. `course migrate` turns such a gate into a
versioned gate that cites the same rubric in `conversationalRubricRef`, and lists a manual step for the rest.

An evaluator definition may list `conversation` in `itemTypes` to say it judges gate conversations. It needs
`rubricIds` and a deterministic, human or model-assisted method, and lets a deterministic conversation
evaluator avoid listing a keyed item type (such as `trace`) it never scores. Hosts on SDK 0.5 reject the new
value, so publish such a course only to hosts on SDK 0.6 or later.

Lesson content must be accessible. Validation rejects a visual block whose renderer extension declares no
keyboard support (`INACCESSIBLE_VISUAL`), a legacy activity block whose extension declares none
(`INACCESSIBLE_ACTIVITY`), and a blank text alternative on a visual block's renderer, its visual description,
a legacy activity extension or required media (`MISSING_TEXT_ALTERNATIVE`).

A bundle's SHA-256 integrity map proves the files are intact. It does not prove who wrote them or that they can be trusted.

## Course packages

A course package (course-package v1) is the release artifact a host installs: a gzip-compressed POSIX
ustar archive named `<courseId>-<version>.course.tgz`, usually with a sibling `<file>.sha256` in
`sha256sum` format. The archive holds only top-level regular files (no directories, links, devices or
PAX/GNU records; names match `^[A-Za-z0-9._-]{1,128}$` and, because a ustar name field holds 100 bytes
without a directory prefix, are at most 100 bytes). Limits: 200 members, 32 MiB per member, 128 MiB
uncompressed, 64 MiB compressed. Exactly one member is `course-package.json`, published as the JSON Schema
`@course-core/sdk/package-schema`:

```json
{
  "format": "course-package", "formatVersion": 1,
  "courseId": "pendulum-lab", "courseVersion": "1.0.0",
  "courseDigest": "<64-hex digest computed by compileCourse>",
  "sdkVersion": "0.6.0", "minimumCoreVersion": "0.1.46",
  "source": { "repository": "https://…", "commit": "<40 lowercase hex>" },
  "members": [{ "name": "course.json", "bytes": 1234, "sha256": "<64-hex>", "role": "course-manifest" }]
}
```

| Role | Count | Meaning |
| --- | --- | --- |
| `course-manifest` | exactly 1 | The authored course manifest that `compileCourse` validates, never a compiled wrapper. |
| `learner-projection` | 0..1 | Must deep-equal the compiler's learner projection. |
| `adaptation-registry` | 0..1 | The release's recovery/adaptation registry JSON; a host installs it only with explicit operator approval. |
| `host-requirement` | 0..n | Files the host must already have configured (code fixtures, teaching verifiers). Never installed or executed; a host reports whether it has an identical file (SHA-256). |
| `licence`, `other` | 0..n | Carried and listed; hosts ignore them. |

Every member except `course-package.json` is listed exactly once with its byte length and SHA-256;
unlisted members, unknown roles and unknown keys (top level, `source` or member) are refused. A new key
needs a new `formatVersion`.

```sh
npx --no-install course pack my-course --out my-course-1.0.0.course.tgz \
  --registry registry.json --host-requirement verifier.py --licence LICENSE.txt \
  --repository https://example.invalid/my-course --commit <40-hex> --minimum-core-version 0.1.46
npx --no-install course verify my-course-1.0.0.course.tgz
```

`pack` takes a course directory (its `course.json`) or a manifest file, stores the manifest bytes as
given, adds the compiler's learner projection (`--no-learner` omits it), refuses a course a host would not
publish, and writes the package plus `<file>.sha256`; it refuses to replace either. `--host-requirement`,
`--licence` and `--other` repeat; members are named by their file's base name. `verify` prints a JSON
summary (course identity, digest, members and roles, whether a `.sha256` sibling was checked) and exits 1
with `{ "valid": false, "code": "PACKAGE_…" }` on any refusal. The two-argument
`course pack <course.json> <output-directory>` bundle is unchanged.

From Node (`@course-core/sdk/compiler`):

<!-- docs-example: skip -->
```ts
import { packCoursePackage, verifyCoursePackage, verifyCoursePackageChecksum, CoursePackageError } from '@course-core/sdk/compiler';

const bytes = packCoursePackage({ manifest, adaptationRegistry, hostRequirements: [{ name: 'verifier.py', bytes: verifier }],
  source: { repository: 'https://example.invalid/my-course', commit } });
const { packageManifest, courseManifest, courseDigest, learner, adaptationRegistry: registry, members } = verifyCoursePackage(bytes);
```

Packing is deterministic: members are sorted, every header has mode 0644, uid/gid 0, empty owner names and
mtime 0, and the gzip header is fixed (no name, mtime 0, OS 255). The same inputs give the same bytes on
the same Node.js zlib; the uncompressed tar stream is the same everywhere. Package checks never depend on the
archive bytes beyond the optional `.sha256`.

### How installers must verify

An installer must treat a package as untrusted data and never execute anything in it. Before using any
member it must, in this order (as `verifyCoursePackage` does):

1. If a `<file>.sha256` sibling is present, check it (one line, matching hash and file name).
2. Refuse a compressed size over 64 MiB and stop decompressing at the uncompressed limit.
3. Parse the tar strictly: valid header checksums, `ustar\0` `00` magic, only regular files, empty prefix and
   link name, no traversal, absolute or nested names, no duplicates, the member/size limits, and nothing after the
   end marker. Never extract to disk by path from the archive.
4. Parse `course-package.json` (strict UTF-8 JSON without a byte-order mark); refuse unknown formats, versions,
   keys and roles.
5. Require exact listing equality: every archive member except `course-package.json` listed once, every listed
   member present, matching `bytes` and `sha256`, and the role counts above.
6. Compile the `course-manifest` member with the SDK (a compiled wrapper is refused); its `id`, `version` and
   compiler digest must equal `courseId`, `courseVersion` and `courseDigest`.
7. If present, the `learner-projection` must deep-equal the compiler's learner output, and the
   `adaptation-registry` must be JSON.

Errors are `CoursePackageError`s with a stable `code` (listed in `COURSE_PACKAGE_ERROR_CODES`):
`PACKAGE_NOT_GZIP`, `PACKAGE_CORRUPT`, `PACKAGE_TOO_LARGE`, `PACKAGE_TOO_MANY_MEMBERS`, `PACKAGE_LINK_ENTRY`,
`PACKAGE_UNSUPPORTED_ENTRY`, `PACKAGE_UNSAFE_PATH`, `PACKAGE_INVALID_MEMBER_NAME`, `PACKAGE_DUPLICATE_MEMBER`,
`PACKAGE_LISTING_MISSING`, `PACKAGE_LISTING_INVALID`, `PACKAGE_UNSUPPORTED_FORMAT`, `PACKAGE_UNKNOWN_KEY`,
`PACKAGE_UNKNOWN_ROLE`, `PACKAGE_DUPLICATE_LISTING`, `PACKAGE_UNLISTED_MEMBER`, `PACKAGE_MISSING_MEMBER`,
`PACKAGE_MEMBER_SIZE_MISMATCH`, `PACKAGE_MEMBER_DIGEST_MISMATCH`, `PACKAGE_ROLE_COUNT`, `PACKAGE_MEMBER_NOT_JSON`,
`PACKAGE_COMPILED_WRAPPER`, `PACKAGE_COURSE_INVALID`, `PACKAGE_COURSE_ID_MISMATCH`, `PACKAGE_COURSE_VERSION_MISMATCH`,
`PACKAGE_COURSE_DIGEST_MISMATCH`, `PACKAGE_LEARNER_MISMATCH`, `PACKAGE_CHECKSUM_INVALID`, `PACKAGE_CHECKSUM_MISMATCH`;
packing adds `PACKAGE_INPUT_INVALID` and `PACKAGE_COURSE_UNPUBLISHABLE`. `verifyCoursePackage(bytes, { maxSizes })`
may lower the limits (`members`, `memberBytes`, `uncompressedBytes`, `compressedBytes`), never raise them.

A verified package proves its members match the listing and that the course compiles to the listed digest.
It does not prove who made it, that the lessons are correct, or that a host's own publication checks pass.

## SDK 0.5 contracts

All 0.5 sections are optional manifest fields, so 0.4 data is unchanged. Each new `define*`
helper validates its contract on its own (schema plus context-free rules), throws
`ContractValidationError` and returns a detached copy. `validateCourse` checks every
cross-reference. Since 0.6, `defineCourse`, `defineExtension` and `defineVisualExperience`
validate too (they copied without checking in 0.4 and 0.5).

| Helper | Manifest field | Notes |
| --- | --- | --- |
| `defineProgressionGate` | `gates[]` | Versioned gate with the design's required fields: `id, version, scope, requiredObjectives, readinessCriteria, eligibleEvidenceKinds, minimumIndependentEvidence, assistancePolicy, nextActivityId, remediationPolicyRef, capPolicyRef, appealPolicy`. Readiness needs a `transfer_success` criterion and production transfer evidence; a recognition-only gate is rejected (`RECOGNITION_ONLY_GATE`, `MISSING_TRANSFER_ITEM`). Critical misconceptions need a `no_critical_misconception` criterion and an item that exposes them. Conversational evidence requires a rubric that demands cited learner evidence. |
| `defineAssessment` | `assessments[]` | New types `prediction`, `trace`, `code_repair`, `counterexample`, `experiment_design`, `teach_back`. Optional `role`, `misconceptionIds`, `allowAbstain` ("I don't know") and `confidence`. Numeric items gain `relativeTolerance` and `unit`. Recognition items cannot be `transfer`. |
| `defineActivity` | `activities[]`, block `{ type: 'activity', activityId }` | `supportedTargets, rendererRefs, executionAdapter, capabilityRequirements, equivalentFallbacks, offlineBehavior, resourceBudget, accessibleSemantics, stateMigration`, plus `layoutInputs` and compact/medium/expanded `layouts`. Every declared course target needs support or an objective-equivalent fallback. Native execution needs a declared native module. |
| `defineAdminSection` | `adminSections[]` | Declared permissions, typed settings with checked defaults, audited mutations. Settings cannot target evidence, grading, caps or policy. `adminSettingsSchema(section)` renders the settings as a JSON Schema form, `adminSettingDefaults(section)` lists the defaults, and hosts check every change server-side with `checkAdminSettingChange(section, change, grantedPermissions)` (`UNKNOWN_SETTING`, `ADMIN_PERMISSION_DENIED`, `SETTING_SCOPE_MISMATCH`, `INVALID_SETTING_VALUE`). |
| `defineExtension` | `extensions[]` | 0.6 adds optional `stateMigration` (`migrateState`: state version, strategy and source versions; versioned state needs a `stateSchema`), `tests` (the extension's own fixtures as portable relative paths) and the full `resourceBudget` (`maxStateBytes`, `maxEventBytes`, `maxEventsPerMinute`) next to `license`, `stateSchema`, `observationSchema` and `evaluatorRef`. Lint notes observation schemas without `observation.emit` and observations without an evaluator. |
| `defineStage` | `stages[]`, chapter `stageId` | Roadmap grouping. Stages and chapters take `subtitle` and `iconAsset`; `courseRoadmap(course)` returns consecutive stage groups with the author's labels so hosts need no hard-coded "Chapter" labels or icons. Lint warns when one stage's chapters are split. |
| `defineTeachingHypothesis`, `defineDiagnosticProbe`, `defineConcept` | `hypotheses[]`, `probes[]`, `concepts[]` | Competing hypotheses per objective, and the probes that distinguish them. Probes never count as gate evidence. |
| `defineResearchTask` | `researchTasks[]` | Author bounds for dedicated research. `validateResearchRequest` and `validateResearchResult` check the request fields (`objective, episodeRevision, misconceptionHypothesis, knownPrerequisites, language, modality, remainingLearningTime, accessibilityNeeds, sourcePolicy, requiredOrOptional`) and the result fields (`sourceUrl` through `concerns`). Metadata-only results carry no claims or segments. |
| `defineAgentStrategy`, `defineTool` | `agentStrategies[]`, `tools[]` | Roles, tool references, model requirements, autonomy limits, budgets, retry and cancellation. Evaluators and verifiers only propose. |
| `defineRubric`, `defineEvaluator`, `defineAdaptationPolicy`, `defineLearningPolicy`, `definePlacementPolicy`, `defineLearningStep`, `defineEpisode`, `defineMediaResource`, `defineStoryboard`, `defineRenderer`, `defineRendererAdapter`, `definePlatformAdapter`, `defineDebugInspector`, `defineScene`, `defineTimeline`, `defineStage` | matching fields | See the TypeScript declarations and `course.schema.json`. |

Runtime records (`Attempt`, `Evidence`, `GateDecision`, `TeachingHypothesis`, `ResearchRequest`,
`ResearchResult`/`MediaCandidate` (both record kinds apply the same rules), `MediaJob`, `PlacementEvidence`, `PathExemption`, `ExtensionOffer`,
`ExtensionGrant`, `ClosureOutcome`, `DebugTrace`, `DecisionRecord` and others) are checked with
`validateRecord(kind, value)`. Host-generated IDs in records (enrollments, attempts, evidence, decisions, jobs,
users) are opaque: up to 200 characters of letters, digits and `._:-`, so UUIDs are accepted; author-defined
course IDs keep the course-ID pattern. Agent-authored answers can only be synthetic evidence.
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
concrete `nextActions`. A criterion is met only with evidence it cites: `no_critical_misconception`
needs independent evidence on its objectives as well as no open critical misconception, so every
decision it produces is a valid `gateDecision` record. `checkGateDecision` rejects stale or unlinked
decisions. Hosts must still authenticate evidence and recheck versions at commit time.

Retention `intervalsDays` may now be omitted. `resolveRetentionIntervals` and the learner
projection then use the product default `DEFAULT_REVIEW_INTERVALS_DAYS` (1, 3, 7, 21).
`windowClass(width, fontScale)` returns `compact` (<600), `medium` (600–839) or `expanded` (≥840).
`PLATFORM_CONTRACT` and `REQUIRED_ACTIVITY_FIELDS` carry the design's platform contract (six targets,
three layout classes, seven layout inputs and the nine required activity fields);
`platformContract(activity)` extracts those nine fields from an activity.

Server-only sections never reach the learner projection: hypotheses, probes, rubrics,
evaluators, tools, adaptation policies, admin sections, research tasks, storyboards, agent
strategies, debug inspectors and (0.6) study instruments and concept-mapping drafts. Versioned gates project their readable requirements, but not
their item, rubric or policy references.

TypeScript note: `ProgressionGate` is now `LegacyProgressionGate | VersionedProgressionGate`,
the activity block is a union, and `RetentionPolicy.intervalsDays` is optional. Narrow with
`isVersionedGate` or `'extensionId' in block`. Data and compiled output are unaffected.

## Multi-locale courses (0.6)

A course names its source locale in `locale` (a supported BCP 47 tag: `en` or `he`, optionally with a
region) and may ship more in `locales`, each with a bundle in `translations` that maps stable **text
keys** to text: `{ "texts": { "episode:intro#title": "…" }, "fallback": [ … ] }`. Keys come from author
IDs (`assessment:q1/option:a#text`, `visual:plot/interaction:drag#label`), so a translation can never add
items, change answer keys or reorder anything. Text direction is derived from the locale
(`localeDirection('he') === 'rtl'`), not authored. A 0.4/0.5 course in `"en"` (every published fixture and Course Core example) stays valid and
compiles byte for byte; 0.6 rejects a tag the SDK does not support (`UNSUPPORTED_LOCALE`) and
`course migrate` canonicalizes spellings such as `EN` or `en_US`.

`validateCourse` requires every declared locale to be complete or to list each untranslated key in
`fallback` (reported by `localeCoverage`, `course locales`, `course lint` and `course test`), and requires
placeholders, code, math, images, links and headings to match the source. `localizeCourse(course,
learnerLocales)` returns a display copy for the best shipped locale; hosts grade against the original.
The learner projection carries bundles filtered to learner-visible texts, and the compiler digest (and
so a package's `courseDigest`) covers every locale. A course directory with `locales/<tag>.json` files is
assembled by the CLI and by `assembleCourse`, and the visual helpers (`defineInteraction`, `bindData`
value `labels`, `defineVisualPane`, `defineVisualExperience`, `defineScene`, `defineExtension`) accept
`{ en, he }` text for labels and text alternatives. Text the SDK generates (gate decisions, `course init`,
`course migrate`) comes from the `SDK_MESSAGES` catalog by message ID; validation errors stay English
with stable codes.

See [docs/multi-locale-courses.md](docs/multi-locale-courses.md) for the authoring guide (design, key
reference, validation codes, grading and RTL authoring tips) and [examples/mean-starter](examples/mean-starter)
for an English and Hebrew course.

## SDK 0.6 contract additions

Every addition is optional, so 0.4 and 0.5 data validates and compiles as before. Hosts on SDK 0.5
reject the new values.

| Helper | Where | Rules |
| --- | --- | --- |
| `RenderFeature` | `renderers[].features`, `rendererAdapters[]`, `visuals[].requiredFeatures` | Adds `symbol`, `spring`, `stagger`, `layout_set` and `panes` (Course Core visuals 0.2/0.3), and `invariants` and `goldens` (visuals 0.4). |
| `defineVisualChecks({ invariants, goldens })` | `visuals[].invariants`, `visuals[].goldens` | Publish-time checks, run by the host. An invariant is a data-only assertion (`assert`, a renderer probe expression) checked at every layout the visual has, at its `times` (default: 0, every cue and the duration), for the initial state and each `states` override. A golden is the expected `sha256-` digest of the frame at `atMs` and `layout`, over numbers normalized by `normalizeDigestNumbers` (10 significant digits). Probes must name declared state, table cells, formula values and highlights (`MISSING_REFERENCE`); times lie within the timeline (`INVALID_TIMELINE`); a golden names a layout the visual has (`INVALID_GOLDEN`), once per time; invariants check at most `VISUAL_CHECK_LIMITS.checkFrames` (512) frames (`TOO_MANY_CHECK_FRAMES`). Once `requiredFeatures` is declared it lists `invariants` / `goldens` when they are used. |
| `defineVisualExperience` | `visuals[]` | Optional `requiredFeatures`: when a course declares `visual` renderer definitions for the visual's extension, one of them must declare each feature (`UNSUPPORTED_FEATURE`). A visual using the four-layout set or panes must list `layout_set` / `panes` once it declares `requiredFeatures` (`MISSING_REQUIRED_FEATURE`). |
| `responsiveVariant({ compact, tabletPortrait, tabletLandscape, wide, expanded? })` | `visuals[].layouts` | The four-layout set. All three of `tabletPortrait`, `tabletLandscape` and `wide`, or none (`INCOMPLETE_LAYOUT_SET`). `expanded` stays the fallback for renderers without `layout_set` and defaults to `wide`. |
| `defineInteraction`, `bindData(state, { range \| values })` | `visuals[].interactions` | The Interaction contract: `tap`, `drag`, `scrub`, `pinch`, `pan`, `hover`, `keyboard` or `stylus` on a semantic `target`, bound to one key of the visual's `state`. The key must exist (`MISSING_REFERENCE`); a `range` binds numeric state with `min < max` and a `step` within the range, or the binding lists discrete `values` (`INVALID_BINDING`). Pointer-only kinds need a keyboard or control `alternative` (`INACCESSIBLE_INTERACTION`). |
| `defineVisualPane` | `visuals[].panes` | One to eight synchronized `table`, `code` or `formula` panes. Table rows have one cell per column (`INVALID_PANE`); a formula pane needs a non-blank `label` as its text alternative. Cell, highlight and value expressions are renderer data. |
| `defineScene` | `scenes[].defs`, layers | Scene-local `defs` (`clips`, `masks`, `symbols`, each listing the layers that draw it). Layers may name a `clip` or `mask`; the new `use` layer, and only it, names a `symbol` (`INVALID_LAYER`). References must resolve (`MISSING_REFERENCE`) and a definition cannot draw itself, directly or through another one (`DEFS_CYCLE`). Layers take a `label`; an equation layer without one stays valid data, but `publicationIssues`, `course lint` and `defineScene` refuse it (`MISSING_TEXT_ALTERNATIVE`). |
| `defineAssessment` | `code` and `code_repair` items | `browserExecution: 'python' \| 'none'`. `python` needs `language: "python"` (`UNSUPPORTED_BROWSER_EXECUTION`); `none` opts the item out of in-browser practice runs. Omitted, the host decides. A browser run is practice feedback only and never creates an attempt, evidence or a gate decision. Lint warns that placement and delayed retention items never offer a run. |
| `defineStudyInstruments` | `studyInstruments` | Evaluation-study instrument sets (`pre`, `post`, optional `transfer` and `delayed`) over the course's own items, and optional `allowedArms` (2 to 6 of `{ id, label, behaviour: 'fixed' \| 'chat_only' \| 'supervisor' }`); a host offers only those arms. An item is in at most one set (`STUDY_ITEM_IN_TWO_SETS`), transfer items cannot declare another role (`STUDY_TRANSFER_ROLE`) and delayed items must be held-out retention items (`STUDY_DELAYED_NOT_RETENTION`). Lint warns when the pre-test and post-test cover different objectives (`STUDY_INSTRUMENTS_UNMATCHED`) and when an instrument item also counts toward a gate. |
| `defineLearningStep` | `learningSteps[]` | Step kind `pre_test`: it presents at least one assessment (`INVALID_STEP`), references no gate, and none of its items may count toward a gate (`PRE_TEST_GATE_EVIDENCE`), so a pre-test answer is never gate evidence. |
| `defineConceptMappingDraft` | `conceptMappingDrafts[]` | A **draft** (`status: 'draft'`) mapping between this course's objectives and a named other course's: `equivalent`, `prerequisite_of` (from → to) or `overlaps`. Each link joins one objective of each course (`CONCEPT_MAPPING_LINK_SCOPE`), once (`CONCEPT_MAPPING_DUPLICATE_LINK`), to a different course (`CONCEPT_MAPPING_SAME_COURSE`). |

The study instruments are a manifest section rather than an `instrument` tag on each assessment.
Course Core's studies name items by set (pre, post, transfer, delayed), so the section maps onto a
host's study definition one to one. The rules that span items (an item in one set only, matched
pre/post coverage) and the allowed arms live in one place. Items stay reusable across studies
without editing them, and the assessment contract is unchanged.

A concept-mapping draft is not a mapping. A host shows it to staff who administer both courses and
applies it only after one of them reviews and saves it. Nothing in a course package can create a
mapping, move evidence between courses or grant mastery.

The learning-event export has its own schema export, `@course-core/sdk/event-export-schema`
(`learning-event-export.schema.json`). It is derived at build time from `course.schema.json`, so it
cannot drift from `validateRecord('learningEventExport', …)`, which also applies the ordering rules.

## Extension points: activities, evaluators and admin sections

A course adds domain behavior through three declared contracts. Core enforces the permissions and
evidence rules around them; it never runs course-specific code outside them. The examples are
synthetic.

### Activities

An activity is an interactive unit a lesson block references (`{ type: 'activity', activityId }`).
Its code ships as an extension (`extensions[]`) with a pinned `integrity` hash. The activity contract
says where it runs and what it may do:

```ts
import { defineActivity } from '@course-core/sdk';

export const pendulumLab = defineActivity({
  id: 'pendulum-sim', version: '1.0.0', title: 'Pendulum simulator', objectiveIds: ['predict-period'],
  supportedTargets: ['web_desktop', 'web_mobile'],
  rendererRefs: [{ target: 'web_desktop', rendererId: 'sim-renderer' }, { target: 'web_mobile', rendererId: 'sim-renderer' }],
  executionAdapter: 'sandboxed_web',
  capabilityRequirements: [{ capability: 'state.patch', required: true }, { capability: 'observation.emit', required: true }],
  equivalentFallbacks: [{ target: 'ios_phone', kind: 'text_block', ref: 'length-table', objectiveIds: ['predict-period'] }],
  offlineBehavior: 'queue_observations',
  resourceBudget: { timeoutMs: 2000, maxMemoryMb: 64, maxStateBytes: 8192, maxEventBytes: 2048, maxEventsPerMinute: 120 },
  accessibleSemantics: { keyboard: true, screenReader: true, reducedMotion: true, nonPointerPath: true, textAlternative: 'A table of lengths and periods.' },
  stateMigration: { stateVersion: 1, strategy: 'none', migratesFrom: [] },
  layoutInputs: ['effective_window_bounds', 'font_scale'], layouts: { compact: { stack: true }, expanded: { columns: 2 } },
  evaluatorRef: 'period-evaluator',
});
```

- Every course target needs support or an objective-equivalent fallback; native execution needs a
  reviewed app build. Capabilities are checked against `KNOWN_CAPABILITIES`; host authority
  (`FORBIDDEN_CAPABILITIES`, such as issuing grades) cannot be requested.
- An activity emits observations, never evidence. Observations become evidence only through the
  evaluator named by `evaluatorRef`.
- State is bounded by `resourceBudget` and carried across versions by `stateMigration`.
  `platformContract(activity)` returns the nine fields a host needs to place it.

### Evaluators

An evaluator turns learner work into evidence for named item types. It is server-side and its
method decides who confirms a judgment:

```ts
import { defineEvaluator } from '@course-core/sdk';

export const explainEvaluator = defineEvaluator({
  id: 'explain-evaluator', version: '1.0.0', extensionId: 'grader', method: 'rubric_model_assisted',
  itemTypes: ['teach_back', 'conversation'], rubricIds: ['explain-rubric'], humanConfirmation: 'required',
  outputs: { uncertainty: true, provenance: true },
  tests: { fixtureRef: 'fixtures/explain-v1', acceptsValidVariants: true, rejectsMisconceptions: true },
});
```

- `method` is `deterministic`, `human` or `rubric_model_assisted`. A model draft never confirms
  anything alone: model-assisted evaluators that judge gate evidence need `humanConfirmation: 'required'`.
- `itemTypes` may include `conversation` to judge gate conversations against the listed `rubricIds`;
  the rubric must require cited learner evidence.
- `tests` names the evaluator's own fixtures; they must accept valid variants and reject the
  declared misconceptions. Assessments reference the evaluator by `grading.evaluatorId`.

### Admin sections

An admin section adds course-specific settings to the staff workspace. Settings are typed, bounded
and audited, and they cannot reach evidence, grading, caps or policy:

```ts
import { defineAdminSection, adminSettingsSchema, adminSettingDefaults, checkAdminSettingChange } from '@course-core/sdk';

export const labSettings = defineAdminSection({
  id: 'lab-settings', version: '1.0.0', title: 'Lab settings',
  requiredPermissions: ['course.read', 'course.settings.write'], learnerDataAccess: 'none', audit: 'all_mutations', rendererRef: 'admin-panel',
  settings: [
    { id: 'max-length', label: 'Longest pendulum (m)', scope: 'course', mutationPermission: 'course.settings.write', type: 'number', default: 4, minimum: 1, maximum: 10 },
    { id: 'units', label: 'Units', scope: 'course', mutationPermission: 'course.settings.write', type: 'enum', default: 'metric', options: ['metric', 'imperial'] },
  ],
});

adminSettingsSchema(labSettings);  // a JSON Schema form for the settings
adminSettingDefaults(labSettings); // { 'max-length': 4, units: 'metric' }
// Server side, on every change: the actor's permissions decide, not the UI.
checkAdminSettingChange(labSettings, { settingId: 'units', scope: 'course', value: 'imperial' }, ['course.read', 'course.settings.write']); // []
```

- `requiredPermissions` gate the section; each setting names the permission that may change it.
  `learnerDataAccess` declares what learner data the section may read.
- `rendererRef` names an `admin` surface renderer. Hosts check every change server-side with
  `checkAdminSettingChange` and audit it.

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

<!-- docs-example: skip -->
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

<!-- docs-example: typecheck -->
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

<!-- docs-example: continue -->
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

<!-- docs-example: skip -->
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
