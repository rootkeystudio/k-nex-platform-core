# Repository Agent Rules

Read this file, `status.md`, the active detailed plan, the master plan, mandatory active-phase review addenda, and related accepted ADRs before changing the repository.

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
- Phase 9 work must read `docs/implementation/phase-9-plan-review-hardening.md` and ADR-0023 in addition to the Phase 9 plan and ADR-0021.

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
12. Never assume a package capability or project constraint; read the related documentation, package README, or current Context7 documentation whenever unsure.
13. Before implementing or creating a plugin, check the official Payload documentation for an existing official package.

## Extension delivery classes

Every extension has exactly one `ExtensionDeliveryClass`:

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

Do not call this field `ExtensionKind`; `PluginManifest.kind` already names the Platform Plugin taxonomy. Do not make one manifest ambiguously behave as more than one delivery class.

## Production package and code rules

- The web/worker process must never run `pnpm add`, `npm install`, package lifecycle scripts, or mutate `node_modules` for extension activation.
- Downloaded code must never be imported into the main Payload/Next process.
- Platform Plugin server/UI entrypoints remain static imports reconciled and frozen at boot.
- Hot Application production dependencies are prebundled during publication.
- Unverified/staged artifacts are neither executed nor served.
- Runtime/database content cannot create executable entrypoints, policy code, host imports, or Payload collections/hooks.
- Development-only live sync must be explicitly gated and cannot silently become a production path.

## Hot Application server isolation

- Server code executes only through the extension runner boundary.
- Same-user child processes are development/test adapters only and cannot satisfy Gate 9 production isolation.
- Production execution uses an OS/container sandbox per app generation or an independently reviewed equivalent.
- App/generation sandboxes have distinct process/mount/user/network authority; cross-app readable memory, files, tokens, credentials, and temporary state are forbidden.
- The sandbox receives no Docker socket, customer DB credential, raw `req.payload`, ambient host secrets, host mounts, or broad service locator.
- Production controls include non-root identity, read-only code/root, bounded temp, dropped capabilities, no-new-privileges, reviewed syscall/MAC policy, cgroup limits, and denied default egress.
- Host capabilities are allowlisted, versioned, actor/delegation-aware, budgeted, and runtime-enforced.
- Network access, when approved, goes through a host-owned policy adapter rather than raw sockets.
- CPU, memory, process, file, time, input, output, logs, and concurrency are bounded.
- Node permission flags are defense in depth, not the security boundary.
- Runner crash, timeout, malformed IPC, OOM, or app failure must remain app-local.

## Remote UI isolation

- Hot Application UI runs in an opaque-origin sandbox or dedicated credentialless extension origin using a Web Worker/equivalent isolated realm.
- A same-origin Web Worker alone is not an accepted boundary.
- The realm receives no customer cookies/tokens, local/session storage, IndexedDB/cache authority, host origin credentials, or ambient network.
- Strict CSP/content policy denies `connect-src`, Service Worker/SharedWorker, popup, top navigation, download, nested executable frames, and unverified imports.
- Host interaction is only through a transferred K-Nex-controlled `MessagePort` or equivalent closed channel.
- Messages are schema-, generation-, sequence-, replay-, size-, depth-, rate-, and authorization-checked.
- The realm emits only the K-Nex-owned remote component/event protocol.
- The host maps allowlisted IDs to K-Nex components and owns semantics, focus, accessibility, routing, theme, data gateways, and authorization.
- Fixed host routes/slots exist before app installation; no runtime Next route injection.
- Third-party remote UI protocol/types remain behind an adapter and do not become persisted K-Nex contracts before a passing kill-spike.

## Platform Plugin static change authority

- A Platform Plugin operation starts from an expected customer source commit; runtime database state cannot become the desired static graph.
- A dedicated change authority deterministically updates the application manifest/package inputs, exact lock, resolved graph, registries, and migration plan.
- A trusted builder binds the target source commit, lock/graph, SBOM, package closure, application bundle, image digest, and builder/workflow identity in signed evidence.
- The deployment supervisor accepts only authority-issued candidates; arbitrary tags, images, uncommitted graphs, and self-asserted inventory are rejected.
- Customer repository write credentials and builder/Docker authority remain outside the web/admin process.
- Existing Gate 8 provenance/receipt/inventory invariants are preserved.

## Docker and zero-downtime delivery

- The web/admin process never receives Docker socket or build/publish credentials.
- A separate deployment supervisor/orchestrator performs Platform Plugin source change, build/pull, migration, start, warm, promotion, drain, rollback, and receipt.
- At least one old healthy generation serves during target warm-up.
- Target traffic starts only after source/build provenance, migration compatibility, readiness, authenticated smoke, and runtime inventory match.
- Migration plans use closed phases: `online-expand`, `online-backfill`, `post-retirement-contract`, or `offline-required`.
- Contract/destructive work cannot run before old-generation retirement and deliberate rollback-window closure.
- Offline/incompatible work returns `maintenance-required`.
- Green workers start passive. A PostgreSQL-backed monotonic fencing token controls active job/outbox/schedule ownership; stale owners cannot claim or complete.
- Idempotency complements but does not replace worker-generation fencing.
- Realtime reconnects and resynchronizes.
- Continuous external probes are required evidence, not a best-effort claim.

## Security and supply chain

- Catalog source is a signed versioned index pointing to immutable artifacts, never an arbitrary branch.
- Verify publisher/source/release/artifact/manifest/SBOM/provenance/compatibility/revocation before staging.
- Secure extraction rejects traversal, symlinks/hardlinks, duplicate/case-colliding paths, devices, decompression bombs, and count/size/depth limits.
- Content-addressed digests identify bundles and prior rollback generations.
- Secrets are references, never bundle contents, logs, events, receipts, or browser data.
- Use argument-array process execution; never concatenate shell commands.
- The application process cannot act as a general package manager, source repository writer, image builder, or Docker control plane.

## Authority boundaries

- Phase 9's operator API uses an injected authorizer with an explicit trusted automation identity; no role-name, localhost, header, or environment-string bypass.
- Phase 10 replaces/wires that boundary to current RBAC permissions.
- UI hiding never authorizes.
- Role labels never authorize.
- Hot Application host capabilities never exceed the current actor/delegation authority.
- Every lifecycle, generation, migration, worker-fence, traffic, and authorization transition is expected-revision checked, idempotent, audited, and invalidated through outbox/revision convergence.

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
- Use real Postgres for transaction/migration/activation/worker-fence/restore claims.
- Use real Chromium for credentialless remote UI, CSP, origin/storage/network denial, focus, accessibility, and administration claims.
- Use real isolated runner, web, worker, gateway, builder/deployer processes for isolation and convergence.
- Use continuous external HTTP probes for zero-downtime claims.
- Verify the exact customer source commit, application/image attestation, migration window, traffic generation, worker fencing token, and observed inventory in one receipt chain.
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
