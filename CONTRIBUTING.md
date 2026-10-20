# Contributing

Read [AGENTS.md](AGENTS.md) before making changes. Keep this repository public and domain-neutral. Use synthetic examples and fixtures; never include learner records, private course material, credentials, or machine-specific paths.

Use Node.js 24 or 26 and the committed npm lockfile. Run the checks in [README.md](README.md) before opening a pull request. `npm ci` uses `--ignore-scripts`; required build work must be an explicit, reviewed command. The main export must remain usable without Node compiler or CLI imports.

Changes to validation should cover structural errors, missing references, cycles, unsupported capabilities, and legitimate alternative inputs. `tests/properties.test.ts` uses fast-check (fixed seed) to check that generated valid courses validate, compile deterministically, pack and verify, and that any one-character edit to a bundle file or any byte flip in a course package is detected.

`node scripts/api-compat.mjs` (run by the verify workflow after the build) compares the built `dist/*.d.ts` of every typed export entry with the last release named in `scripts/api-baseline.json`, a GitHub release asset pinned by SHA-512. Removed exports, runtime values that became type-only, changed type-parameter counts and signatures or types that tsc no longer finds compatible are breaking. They need a major version bump, or a minor bump while the major version is 0. Any API change needs a version bump. After a release, point the baseline at that release's tarball and integrity. Exemptions need a stated reason in the baseline file.

Release verification on a tag also runs a separate `provenance` job that generates a CycloneDX SBOM for the retained tarball (`scripts/release-sbom.mjs`) and attests build provenance for the tarball, `verification.json` and the SBOM. Only that job has `id-token: write` and `attestations: write`; it does not publish. Changes to the package boundary must also pass `node scripts/check-packed.mjs`. Its `--self-test` mode only exercises checker policy; it is not evidence that the SDK compiles or that a consumer can use it.

## Package policy

The package contains only `package.json`, `README.md`, `LICENSE`, `NOTICE`, JavaScript/declarations under `dist`, the course, adaptation, course-package and learning-event export schemas, and `dist/validator-dependencies.json`. No source maps, source trees, tests, fixtures, other JSON data, bundled `node_modules`, or hidden configuration belong in the tarball. The Apache project license does not replace bundled dependencies’ licenses. Inspect esbuild’s actual module inventory; preserve the exact applicable copyright/permission text in each generated bundle and the union in `NOTICE`. Tests compare those notices against the installed dependency licenses, and packed checks verify their hashes and presence. Do not add notices for merely installed or build-only packages as though their code were bundled. The checker also rejects links, unsafe archive paths, special tar records, oversized content, and known sensitive-content patterns. A new public asset type needs an explicit allowlist review.

Keep the `types` condition first for the main and compiler exports. Build every advertised target. The CLI must preserve its `#!/usr/bin/env node` shebang, be executable after npm installation, implement `init`, `validate`, `lint`, `test`, `compile`, `inspect`, `pack`, `verify`, `diff`, `migrate` and `import`, stay offline and deterministic, refuse output replacement, and reject invalid input and unknown options with a nonzero status. The installed smoke test uses only a synthetic manifest and calls the real compiler and verifier. Compiler behavior remains implemented in the SDK source; the smoke test does not reimplement it.

Consumer smoke failures do not print child output because it could include accidentally packed sensitive data. To diagnose one locally, run the named command with your local checkout or install a locally inspected tarball into a temporary project. Do not paste secret-bearing logs into public issues.

## Automation maintenance

All third-party action references must be official `actions/*` actions pinned to full 40-character commit SHAs. Verify tag-to-commit resolution in the official repository and inspect the commit when updating a pin. The initial pins were checked with the read-only GitHub API on 2026-10-12:

| Action | Ref | Verified commit |
| --- | --- | --- |
| `actions/checkout` | `v6` | `d23441a48e516b6c34aea4fa41551a30e30af803` |
| `actions/setup-node` | `v6` / commit version `v6.5.0` | `249970729cb0ef3589644e2896645e5dc5ba9c38` |
| `actions/upload-artifact` | `v6` / commit version `v6.0.0` | `b7c566a772e6b6bfb58ed0dc250532a479d7789f` |

Dependabot proposes GitHub Actions updates. Review them and retain SHA pins. `nightly.yml` runs `npm audit --audit-level=high` and a checksum-pinned osv-scanner over `package-lock.json` on a schedule (or by dispatch). It is not a required pull-request check, and a finding fails the run. `tests/workflows.test.ts` keeps every action SHA-pinned and every token read-only. `actionlint .github/workflows/*.yml` validates workflow syntax when actionlint is available locally.

Untrusted pull requests run on fresh GitHub-hosted runners with `contents: read` and without publishing secrets, inherited reusable-workflow secrets, persistent checkout credentials, or package-manager caches. Do not introduce `pull_request_target`, a privileged `workflow_run` consumer of PR artifacts, self-hosted runners, private checkout steps, or authentication to dependency registries. Do not fetch a private repository to make public checks pass.

The public registry audit runs before installation and rejects `.npmrc` and `.gitmodules` in the checkout. It also scans root files and `src`, `tests`, `scripts`, `fixtures`, and `.github` for owner repository URLs: only `roeehrl/course-sdk` and `roeehrl/course-core` are allowed. The same policy applies to every packed file, including Git, raw-content, API, and archive URL forms. Use synthetic names for negative checks, never names of private repositories. Workflows supply their own unauthenticated npm configuration. The packed consumer preserves the host `HOME` and isolates npm through explicit user/global configuration and cache paths. Static policy checks are not a sandbox for arbitrary contribution code; keep repository secrets out of CI and review workflow and build-script changes.

## Maintainer integration and release checklist

1. Verify the source-owned implementations and tests for static validator generation, course/adaptation validation, bounded recipes, both compilers and learner projections, schema copying, bundled-license generation, and the `course` CLI. Ensure `npm run typecheck`, `npm test`, and `npm run build` pass from a clean checkout without a private repository. Generated validators must be recreated by explicit build/typecheck scripts even with npm lifecycle hooks disabled. The checker requires all declared JavaScript, declaration, and schema targets; it fails instead of skipping unfinished integration.
2. Review the README examples and run the complete verification sequence on Node 24 and 26. Inspect the tarball inventory and contents for public suitability. The smoke checks course/adaptation compilation, data integrity, bounded recipes, exact license notices and learner projection through the installed package; source tests must cover the complete compiler behavior.
3. Keep `roeehrl/course-sdk` and `roeehrl/course-core` public. Before enabling hosted runs, configure the SDK default branch as `main`, require review for owned files, disallow direct unreviewed changes, and make both matrix checks required after their first real run. Protect version tags so only authorized maintainers can create or move them. These are repository settings, not settings applied by these files.
4. Confirm npm ownership of `@course-core`, the package name, original-code Apache-2.0 licensing plus bundled dependency notices, and public publication access. The SDK owner must review package metadata such as `repository`, `homepage`, `bugs`, and `publishConfig.access: public` before publication; this scaffolding does not edit package metadata or the lockfile.
5. With separate release authorization, choose a reviewed commit whose package and lockfile versions match, then create its `v<version>` tag. This document and workflow do not create or push tags, repositories, or releases. Run `Release verification` on that tag and require both Node jobs to succeed.
6. Download the retained candidate, confirm its SHA-512/SHA-256 against `verification.json`, and inspect its inventory. An artifact from a run with another failed matrix job is not a release candidate. The artifact expires after seven days; rerun verification if needed.
7. Publication is a separate, explicitly authorized step. Publish the exact reviewed tarball with public access; do not silently rebuild a different package. If adding npm trusted publishing later, use a protected environment and a dedicated trusted workflow, granting `id-token: write` only to that publishing job. Never give publication authority to pull-request jobs.
8. After publication, verify installation of the registry version from a new project, main and compiler exports, CLI behavior, and the registry's integrity. Record that result separately from local checks, CI checks, or a successful upload. A registry acceptance test is not performed by this scaffolding.

Contributions are provided under the repository's [Apache-2.0 license](LICENSE).
