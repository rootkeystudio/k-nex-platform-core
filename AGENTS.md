# Repository Agent Rules

These rules apply to the whole repository. Before changing anything, read this file, `status.md`, and the active plan under `docs/implementation/`.

## Scope and workflow

- Work only on the active phase and bounded task recorded in `status.md`.
- Follow the active implementation plan and accepted architecture contracts; do not invent a new public contract inside an implementation task.
- Use a branch and pull request. Do not push directly to `main`.
- Keep each commit coherent, reviewable, and limited to one task.
- Stop and report when requirements conflict, an accepted invariant cannot be met, or the task needs an unplanned architecture decision.

## Engineering rules

1. Monolithic and spaghetti code are forbidden. Keep modules cohesive, dependencies directed, and concerns clearly separated.
2. Reuse stable behavior instead of duplicating it. Extract shared code when the reuse boundary is real; do not create speculative generic abstractions for hypothetical callers.
3. Write the smallest clean implementation that fully delivers the requested behavior. Avoid unnecessary layers, configuration, indirection, and cleverness.
4. Keep an expression on one line when it remains clear and readable. Do not compress separate steps or complex control flow merely to reduce line count.
5. Use variable, function, type, and file names that are meaningful and concise.
6. Until v1.0, do not preserve compatibility for unreleased APIs or paths. Remove obsolete code and update all callers, fixtures, tests, and docs atomically. Do not add aliases, shims, fallbacks, deprecation paths, or migrations solely to preserve pre-v1 behavior.
7. Grow the product in working vertical layers. Start with the smallest end-to-end version, then add one capability at a time on top of a working baseline.
8. Never trade a working product for unfinished complexity. A long-term design must still produce a usable, testable increment in the current phase.
9. Prefer established, well-maintained, industry-standard libraries when they reduce complexity or improve reliability.
10. Use existing project dependencies before adding packages or reimplementing common behavior. Check the library documentation, source-facing types, and installed version before assuming a capability is missing.
11. Make durable architectural decisions. Do not merge a disposable stopgap that is knowingly intended to be replaced later.

## Code boundaries

- Preserve package and server/browser boundaries defined by the architecture docs.
- Do not expose third-party implementation types as K-Nex public or persisted contracts.
- Do not edit generated artifacts by hand; change their authoring source and regenerate them.
- Do not read or commit secrets. Use declared environment-variable names only.
- Comments should explain non-obvious intent, constraints, or trade-offs, not restate the code.
- Split files or functions when they contain independent responsibilities; do not split only to satisfy an arbitrary line count.

## Dependencies

Before adding a dependency:

1. Confirm the current dependency set cannot solve the requirement cleanly.
2. Check official documentation and types for the exact installed/candidate version.
3. Verify maintenance, license, security posture, bundle/runtime impact, and compatibility with current decisions.
4. Prefer an adapter boundary when the library is an implementation detail.
5. Pin the exact approved version and update the lockfile.

## Validation

- Add or update tests for changed behavior and failure paths.
- Run the acceptance commands from the active phase plan plus affected repository checks.
- Never claim completion when required validation was skipped or failed; record it as a blocker.
- Keep diagnostics deterministic and actionable.

## `status.md` protocol

Every agent-authored commit that changes repository content must update `status.md` in the same commit.

`status.md` is a current snapshot, not a changelog:

- keep it at 40 lines or fewer;
- replace stale information instead of appending history;
- record the current phase, active task, state, last completed work, validation, next task, and blockers;
- make **Last completed** describe the work included in that commit;
- do not include verbose logs, secrets, speculative plans, or the hash of the commit being created;
- use `None` when there is no blocker.

A commit is incomplete when its implementation and `status.md` disagree.

## Completion report

At the end of a task, report:

- what changed;
- files or packages affected;
- commands/tests run and their result;
- unresolved risks or blockers;
- the exact next task recorded in `status.md`.
