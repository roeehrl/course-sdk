# Course SDK

`@course-core/sdk` provides portable TypeScript contracts, course validation, and authoring helpers. The Node compiler and `course` CLI are separate from the portable main export.

The initial package version is **0.1.0**. This repository contains release verification scaffolding; the presence of a version or workflow does not imply that a package has been published.

Use Node.js 24 or newer for development, compilation, and the CLI. CI checks Node.js 24 and 26. Browser and native consumers should import the main entry point and supply their own runtime integration; this SDK is not a native UI runtime.

| Entry point | Purpose |
| --- | --- |
| `@course-core/sdk` | Types, `defineCourse`, and `validateCourse` |
| `@course-core/sdk/compiler` | Node-only `compileCourse` and `verifyCompiledCourse` |
| `@course-core/sdk/schema` | Standalone course JSON Schema |
| `course` | Node command-line interface |

After the package has been published, install the explicit version:

```sh
npm install @course-core/sdk@0.1.0
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
npx --no-install course validate course.json
npx --no-install course compile course.json compiled.json
```

Compilation refuses to overwrite an existing output file. Using `--no-install` avoids silently downloading a different command if the package is missing.

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

- Explicit metadata, export targets, Apache-2.0 license, executable CLI, and package file allowlist.
- Public npm tarball URLs and SHA-512 integrity in the lockfile; no Git dependencies, alternate registries, local links, workspaces, or bundled `node_modules`.
- Archive traversal, links, duplicates, special records, oversized files, binary content, common credentials, and local home paths. Owner repository URLs in source and package contents are limited to `roeehrl/course-sdk` and `roeehrl/course-core`; other owners' public dependency references are unaffected.
- Main-export import and validation with Node builtins denied, `process`/`Buffer` unavailable, and string code generation disabled, plus TypeScript consumption without ambient Node types. Static validators under `dist/generated/` are allowed.
- Compiler and schema exports, compiled artifact verification and tamper detection, and removal of assessment prompts/answer keys/bank references from the learner projection.
- Installed CLI validation and compilation, invalid-input rejection, refusal to overwrite an existing output, and failure for an unknown CLI option.

The portability smoke covers the exercised import and validation paths, including a CSP-like prohibition on `eval` and `new Function`. It does not replace testing under an application's full browser Content Security Policy or on a native device. Sensitive-content checks use a strict file policy and recognizable patterns; a maintainer must still inspect content for private data that pattern matching cannot identify.

To retain a verified candidate and its file inventory and hashes, choose an empty output directory outside this checkout:

```sh
node scripts/check-packed.mjs --expect-version 0.1.0 --output-dir ../sdk-candidate-0.1.0
```

Missing compiler, validator, schema, declarations, or CLI output is a failure. No missing implementation is replaced by a stub or counted as a pass. The checker does not rebuild implicitly: run the build command first.

## CI and release verification

Pull requests, pushes to `main`, and manual CI runs execute the same Node 24/26 checks. Workflows have read-only repository permissions, use official actions pinned to full commit SHAs, do not persist checkout credentials, and receive no npm or other publishing secrets. Dependency installation disables lifecycle scripts. Public CI checks out only this repository and must never fetch private course repositories or data.

The public repositories are [roeehrl/course-sdk](https://github.com/roeehrl/course-sdk) and [roeehrl/course-core](https://github.com/roeehrl/course-core). This SDK's CI does not fetch either a sibling checkout or private fixtures.

`Release verification` runs for version tags such as `v0.1.0`. A manual run must also select an existing version tag. The tag must match `package.json` and the lockfile. Both Node jobs must pass; the Node 24 job retains its exact verified tarball and `verification.json` for seven days. An uploaded artifact by itself does not establish that the other matrix job passed.

There is deliberately no publish or GitHub Release step. Repository visibility, protected branches/tags, npm scope ownership, publication authorization, and any later trusted-publishing setup are maintainer integration tasks. See [CONTRIBUTING.md](https://github.com/roeehrl/course-sdk/blob/main/CONTRIBUTING.md) for the exact release checklist and [SECURITY.md](https://github.com/roeehrl/course-sdk/blob/main/SECURITY.md) for vulnerability reporting.

Original SDK code is licensed under [Apache-2.0](LICENSE). The same file preserves MIT notices for the runtime helpers included in the generated validator.
