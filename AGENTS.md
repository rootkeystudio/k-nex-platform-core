# Repository Agent Rules

Read this file, `status.md`, the active detailed plan, the master plan, and related accepted ADRs before changing the repository.

## Scope and workflow

- Work only in the phase/task selected by `status.md` and follow documented task order.
- Use one branch and one final PR for the complete phase; do not push directly to `main`.
- Keep one coherent commit per task and update `status.md` in that commit.
- Advance only to the next task inside the same phase after acceptance commands pass.
- After all tasks, the result document, and the full gate pass, mark `Ready for phase review`, refresh/open the phase PR, and stop.
- Implementation agents never merge or enable auto-merge. Only the designated reviewer/project manager may issue PASS and merge.
- Stop and report a conflict, unplanned public/persisted decision, kill criterion, weakened invariant, or blocked acceptance proof.
- During Phases 9–10, `module.sales` remains the sole first-party domain reference. Do not begin broad CRM/CMS or another vertical module.
- Test-only Hot Applications/Theme Skins/providers may prove a generic active-phase mechanism only when explicitly required; they must not become second domain products.

## Engineering rules

1. Keep modules cohesive and dependencies directed. Monolithic/spaghetti code is forbidden.
2. Build the smallest clean end-to-end increment that fully satisfies the active task.
3. Reuse established project behavior; extract shared code only at a real reuse boundary.
4. Do not create speculative abstractions or empty packages for future phases.
5. Prefer meaningful concise names and straightforward control flow.
6. Before v1, remove obsolete unreleased APIs and update all callers/fixtures/docs atomically; do not add compatibility aliases or shims.
7. Prefer maintained industry-standard libraries when they reduce complexity, but keep their types behind K-Nex contracts.
8. Check the exact installed/candidate version's official docs, source-facing types, license, maintenance, vulnerabilities, and runtime/bundle impact before adoption.
9. Pin exact approved dependencies and use the frozen lockfile.
10. Never trade a working product for unfinished complexity or knowingly merge a disposable stopgap.
11. Solve plugin, application-runtime, component, lifecycle, authorization, deployment, CLI, and fleet gaps in the platform and exercise them through bounded reference fixtures.

## Extension classes

Every extension is exactly one class:

```text
Platform Plugin
  existing module/provider/builder/theme/integration/preset package
  trusted host/container code
  static Payload/registration composition
  add/upgrade/remove by immutable release

Hot Application
  app.* signed prebuilt bundle
  isolated server runner and remote UI
  no host Payload/config/import mutation
  live generation activation

Theme Skin
  skin.* data-only tokens/recipes/scoped CSS/assets
  no JavaScript or native primitive override
  live generation activation
```

Do not make one manifest ambiguously behave as more than one class.

## Production package and code rules

- The web/worker process must never run `pnpm add`, `npm install`, package lifecycle scripts, or mutate `node_modules` for extension activation.
- Downloaded code must never be imported into the main Payload/Next process.
- Platform Plugin server/UI entrypoints remain static imports reconciled and frozen at boot.
- Hot Application production dependencies are prebundled during publication.
- Unverified/staged artifacts are neither executed nor served.
- Runtime/database content cannot create executable entrypoints, policy code, host imports, or Payload collections/hooks.
- Development-only live sync must be explicitly gated and cannot silently become a production path.

## Hot Application isolation

- Server code executes only through the extension runner boundary.
- The runner receives no Docker socket, customer DB credential, raw `req.payload`, ambient host secrets, or broad service locator.
- Host capabilities are allowlisted, versioned, actor/delegation-aware, budgeted, and runtime-enforced.
- Network is denied by default and constrained by declared destination policy.
- File access is confined to content-addressed generation assets and bounded temporary/app storage.
- CPU, memory, time, input, output, logs, and concurrency are bounded.
- Node permission flags are defense in depth, not the sole sandbox.
- Runner crash, timeout, malformed IPC, or app failure must remain app-local.

## Remote UI

- Hot Application UI runs in a Web Worker or equivalent isolated realm.
- It cannot directly access DOM, cookies, localStorage, host dynamic imports, or arbitrary network.
- It emits only the K-Nex-owned remote component/event protocol.
- The host maps allowlisted IDs to K-Nex components and owns semantics, focus, accessibility, routing, theme, data gateways, and authorization.
- Fixed host routes/slots exist before app installation; no runtime Next route injection.
- Third-party remote UI protocol/types remain behind an adapter and do not become persisted K-Nex contracts before a passing kill-spike.

## Docker and zero-downtime delivery

- The web/admin process never receives Docker socket or build/publish credentials.
- A separate deployment supervisor/orchestrator performs Platform Plugin build/pull, migration, start, warm, promotion, drain, rollback, and receipt.
- At least one old healthy generation serves during target warm-up.
- Target traffic starts only after provenance, migration revision, readiness, authenticated smoke, and runtime inventory match.
- Workers use lease/idempotency semantics and drain safely.
- Realtime reconnects and resynchronizes.
- Only expand-compatible overlap is labeled zero downtime; incompatible/destructive migration must return `maintenance-required`.
- Continuous external probes are required evidence, not a best-effort claim.

## Security and supply chain

- Catalog source is a signed versioned index pointing to immutable artifacts, never an arbitrary branch.
- Verify publisher/source/release/artifact/manifest/SBOM/provenance/compatibility/revocation before staging.
- Secure extraction rejects traversal, symlinks, duplicate paths, decompression bombs, and count/size limits.
- Content-addressed digests identify bundles and prior rollback generations.
- Secrets are references, never bundle contents, logs, events, receipts, or browser data.
- Use argument-array process execution; never concatenate shell commands.
- The application process cannot act as a general package manager or Docker control plane.

## Authority boundaries

- Phase 9's operator API uses an injected authorizer with an explicit trusted automation identity; no role-name, localhost, header, or environment-string bypass.
- Phase 10 replaces/wires that boundary to current RBAC permissions.
- UI hiding never authorizes.
- Role labels never authorize.
- Hot Application host capabilities never exceed the current actor/delegation authority.
- Every lifecycle/activation/traffic/authorization transition is expected-revision checked, idempotent, audited, and invalidated through outbox/revision convergence.

## Code boundaries

- Contracts import no Payload/Next/React/editor/protocol/orchestrator implementation types.
- Browser/remote UI exports import no server code.
- Platform modules import no customer/theme implementation.
- Do not hand-edit generated artifacts; change authoring source and regenerate.
- Do not read or commit secrets.
- Comments explain non-obvious constraints/trade-offs, not the code itself.
- Plugin/UI code uses K-Nex source/action/query/component contracts where available; no parallel transport/cache/table/form/accessibility/authorization stack.
- Themes own tokens/slots/recipes/scoped structural CSS; compound behavior stays platform-owned.

## Validation

- Add positive, failure, race, crash, replay, resource-budget, and security tests for changed behavior.
- Run the active task commands plus affected earlier gates.
- A named gate must fail if required real evidence did not run.
- Use real Postgres for transaction/migration/activation/restore claims.
- Use real Chromium for remote UI, CSP, focus, accessibility, and administration claims.
- Use real multi-process runner/web/worker fixtures for convergence/isolation.
- Use continuous external HTTP probes for zero-downtime claims.
- Never claim completion when required validation was skipped or failed; record a blocker.

## `status.md`

Every agent-authored repository commit updates `status.md` atomically. It is a snapshot, not a changelog, and remains at most 40 lines.

Record:

```text
phase
active task
state
last completed work
validation actually run
next exact task
blockers (`None` when absent)
```

Allowed active-phase states:

```text
Ready to start
In progress
Blocked
Ready for phase review
```

After project-manager PASS, the reviewer updates the branch to the next task/phase handoff, waits for required exact-head CI, and merges. `main` must not retain stale review instructions.
