# Repository Agent Rules

These rules apply to the whole repository. Before changing anything, read this file, `status.md`, and the active plan under `docs/implementation/`.

## Scope and workflow

- Work only inside the active phase recorded in `status.md` and follow its documented task order.
- Follow the active implementation plan and accepted architecture contracts; do not invent a public or persisted contract inside an implementation task.
- Use one branch and one pull request for the complete active phase. Do not push directly to `main`.
- Keep each task as a coherent, reviewable commit and update `status.md` in that commit.
- After a task's acceptance commands pass, an implementation agent may advance `status.md` to the next task **within the same phase** and continue on the same branch.
- Do not advance to the next phase. When every task, phase result, and full phase gate pass, set the state to `Ready for phase review`, open or refresh the phase PR, and stop.
- Implementation agents must not merge their own PR or enable auto-merge. Only the designated reviewer/project manager may issue PASS and merge.
- Stop and report when requirements conflict, an accepted invariant cannot be met, a kill criterion fires, or the task needs an unplanned architecture decision.
- Until Gate 8 passes, `module.sales` is the sole first-party reference domain module. Do not implement logistics, restaurant, inventory, budgeting, dispatch, driver, live-tracking, QR-menu, or another domain module to discover a missing platform abstraction.

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
10. Use existing project dependencies before adding packages or reimplementing common behavior. Check official documentation, source-facing types, and the exact installed/candidate version before assuming a capability is missing.
11. Make durable architectural decisions. Do not merge a disposable stopgap that is knowingly intended to be replaced later.
12. Solve generic plugin, component, query, builder, lifecycle, CLI, and fleet gaps in the platform and exercise them through Sales before creating domain breadth.

## Code boundaries

- Preserve package and server/browser/editor boundaries defined by the architecture docs.
- Do not expose third-party implementation types as K-Nex public or persisted contracts.
- Do not edit generated artifacts by hand; change their authoring source and regenerate them.
- Do not read or commit secrets. Use declared environment-variable names or secret references only.
- Comments should explain non-obvious intent, constraints, or trade-offs, not restate the code.
- Split files or functions when they contain independent responsibilities; do not split only to satisfy an arbitrary line count.
- Plugin UI must use K-Nex source/action/query/component contracts where coverage exists; do not create a parallel transport, cache, table, form, or accessibility stack inside a module.
- Themes own tokens, slots, recipes, and bounded structural CSS. They do not reimplement platform-owned compound component behavior.

## Dependencies

Before adding a dependency:

1. Confirm the current dependency set cannot solve the requirement cleanly.
2. Check official documentation and types for the exact installed/candidate version.
3. Verify maintenance, license, security posture, bundle/runtime impact, and compatibility with current decisions.
4. Prefer an adapter boundary when the library is an implementation detail.
5. Pin the exact approved version and update the lockfile.
6. Add the dependency only when the active task has a real consumer; do not create empty adapter packages or install a future catalog speculatively.

## Validation

- Add or update tests for changed behavior and failure paths.
- Run the acceptance commands from the active task plus affected repository checks.
- Run the full phase gate before marking the phase ready for review.
- Never claim completion when required validation was skipped or failed; record it as a blocker.
- Keep diagnostics deterministic and actionable.
- A named conformance/gate command must fail when required evidence did not actually run.

## `status.md` protocol

Every agent-authored commit that changes repository content must update `status.md` in the same commit.

`status.md` is a current snapshot, not a changelog:

- keep it at 40 lines or fewer;
- replace stale information instead of appending history;
- record phase, active task, state, last completed work, validation, next task, and blockers;
- make **Last completed** describe the work included in that commit;
- do not include verbose logs, secrets, speculative plans, or the hash of the commit being created;
- use `None` when there is no blocker.

Allowed task states inside an active phase:

```text
Ready to start
In progress
Blocked
Ready for phase review
```

After one task passes, update the active task to the next task in the same phase. Do not use `Ready for phase review` until every task, the phase result, and the complete phase gate pass.

After project-manager PASS, the reviewer updates the PR branch to the next phase/task and post-merge state, waits for required CI, and merges. `main` must not retain stale instructions such as “review and merge this phase”.

A commit is incomplete when its implementation and `status.md` disagree.

## Phase completion report

At phase closeout, report:

- completed task matrix;
- files/packages and public contracts affected;
- commands, tests, failure evidence, and CI result;
- known limitations and deferred scope;
- phase-result decision;
- the exact next phase/task that would follow reviewer PASS.
