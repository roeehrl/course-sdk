# Course SDK engineering rules

- This repository is public and domain-neutral. Do not add private course data, learner records, credentials or host-specific paths.
- Keep contracts serializable and portable. Browser/native exports must not import Node-only compiler or CLI code.
- Course authors control domain behavior through declared extension contracts; the runtime enforces permissions and evidence integrity.
- Validate both structural and semantic failures. Tests must include invalid references, cycles, unsupported capabilities and legitimate alternative inputs.
- Keep publication artifacts explicit and inspect packed contents before release.
- Do not add model/agent attribution to commits or generated project files.

