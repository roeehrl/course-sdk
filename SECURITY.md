# Security policy

Security fixes target the latest released `0.1.x` version. The initial `0.1.0` release must pass package and consumer verification before publication; a version declared in this repository is not evidence of a release.

## Reporting a vulnerability

Use [GitHub private vulnerability reporting](https://github.com/roeehrl/course-sdk/security/advisories/new) for this repository when enabled. Maintainers must enable this channel before the first public release. If it is unavailable, request a private reporting channel from `@roeehrl` without including vulnerability details, credentials, learner records, or unpublished course material in a public issue. No response-time guarantee is implied.

Include affected versions, expected and actual behavior, a minimal synthetic reproduction, and the security impact. Report suspected credential exposure through the same private channel and rotate affected credentials immediately.

## Trust boundaries

Course manifests and extension declarations are untrusted input. Structural and semantic validation does not by itself authorize an extension, sandbox its execution, validate remote content, or grant runtime capabilities. Applications must enforce permissions and evidence integrity at their runtime boundary.

The main package entry point is intended to remain portable. The compiler and CLI run in Node and should only receive the filesystem access appropriate to their task. Do not import Node-only tooling into browser or native entry points.

Public CI must never fetch private repositories, private course data, or learner records. It uses synthetic package-consumer input and unauthenticated public npm dependencies. Pull-request jobs have no publishing credentials. Repository automation uses read-only permissions, pinned official actions, and ephemeral hosted runners.

Package verification checks an explicit file allowlist, archive safety, dependency sources, known secret formats, and local home paths before exercising the installed package. Source and package contents may reference only `roeehrl/course-sdk` and `roeehrl/course-core` among the owner's repositories; this allowlist avoids recording private repository names in public policy code. These checks cannot identify every secret or private dataset. Maintainers must review the artifact contents before release and keep GitHub secret scanning and push protection enabled where available. Do not weaken a check to accommodate private fixtures or credentials.

The 0.2.0 working tree is an unreleased candidate until maintainer verification and publication. Adaptation data validation does not authenticate proof receipts or grant application authority; hosts must independently authenticate registered verifiers and author/server decisions before applying content.
