# ADR-0023: Phase 9 Production Isolation and Static Delivery Hardening

- Status: accepted
- Date: 2026-08-29
- Decision owners: K-Nex platform maintainers
- Evidence: executable-poc
- Entry: Gate 9 closeout
- Related: [ADR-0021](./0021-dynamic-application-runtime-and-zero-downtime-delivery.md), [Phase 9 plan](../implementation/phase-9-dynamic-application-runtime.md), [mandatory review hardening](../implementation/phase-9-plan-review-hardening.md)

## Context

ADR-0021 correctly rejects mutating the live Payload/Next process and separates Hot Applications from full Platform Plugins. Independent project-manager review found five mechanisms that must be frozen before implementation to keep that direction secure and compatible with Gate 8:

```text
remote UI origin/session/network isolation
production runner OS/container isolation
static customer desired-state and build-attestation continuity
explicit online/offline migration phases
blue/green worker side-effect fencing
```

A Web Worker without an origin policy may still attempt network/storage or authenticated same-origin requests. A child Node process under the host identity does not isolate filesystem, network, credentials, or other app generations. A locally built Platform Plugin image without a customer source commit and trusted application attestation would break the existing lock/graph/SBOM/provenance source-of-truth chain. Finally, blue and green workers can duplicate jobs/outbox effects unless execution ownership is fenced independently from HTTP traffic.

## Decision

1. Delivery class is named `ExtensionDeliveryClass`, not `ExtensionKind`. Existing `PluginManifest.kind` remains the Platform Plugin taxonomy and is not overloaded.
2. Hot Application remote UI executes in an opaque-origin sandbox or dedicated credentialless extension origin with an equivalent proven security boundary.
3. The remote realm receives no customer auth cookies/tokens, browser storage authority, or ambient network access.
4. Remote UI host interaction occurs only through a transferred K-Nex-controlled `MessagePort` or equivalent closed channel. Messages are schema-, generation-, sequence-, replay-, size-, depth-, and rate-validated.
5. The extension realm uses strict CSP/content/integrity policy; direct same-origin authenticated fetch, cross-origin fetch, Service Worker/SharedWorker, popup, top-navigation, download, host import, and persistent storage attempts are executable failure cases.
6. A same-user child process is development/test-only. Gate 9 production server execution requires an OS/container sandbox per app generation or an independently reviewed equivalent.
7. Production runner isolation includes distinct process/mount/user/network boundaries, non-root identity, read-only code/root, bounded temporary storage, dropped capabilities, no-new-privileges, reviewed syscall/MAC policy, cgroup resource bounds, denied default egress, and no host/DB/Docker/secret mounts.
8. Different app and generation workloads cannot share readable memory, files, tokens, or credentials. Cross-app/generation escape is a required failure corpus.
9. A Platform Plugin operation must begin from an expected customer source commit and deterministic static composition change. Live database state cannot become the desired Platform Plugin graph.
10. A `StaticCompositionChangeAuthority` binds the exact base/target manifest, lock, resolved graph, generated registries, migration plan, source commit, package closure, and customer-specific application/image subject.
11. `DeploymentSupervisor` accepts only a change-authority/build-authority issued candidate with trusted application build evidence. It cannot accept arbitrary tags, images, uncommitted graphs, or self-asserted runtime inventory.
12. GitHub-hosted and explicitly configured self-hosted builders may be separate adapters, but both bind source, workflow/builder identity, lock/graph, SBOM, artifact/image digest, and package closure through signed evidence. Gate 8 hosted evidence is not weakened.
13. Platform migration compatibility uses closed phases: `online-expand`, `online-backfill`, `post-retirement-contract`, and `offline-required`.
14. Contract/destructive steps cannot run before old generation retirement and deliberate rollback-window closure. Offline-required work returns `maintenance-required`.
15. Old and new binaries must be exercised concurrently against the expanded schema. Readiness and receipts bind the exact compatibility window and migration revision.
16. Blue/green workers use a PostgreSQL-backed monotonic fencing token. Green starts passive; stale owners cannot claim or complete jobs/outbox/schedule effects after transfer.
17. HTTP traffic promotion, worker execution authority, runner generation pointers, and runtime revisions are separately recorded but reconciled into one deployment/activation receipt. Process timing cannot substitute for persisted authority.
18. Phase 9 plans and UI expose source-change, availability, migration, rollback-window, isolation-profile, and worker-fence outcomes truthfully.

## Consequences

- A Hot Application still installs live, but its browser and server code execute without ambient host authority.
- The first production runner proof is more expensive than a child-process demo, but it establishes a real security boundary rather than a TypeScript/process convention.
- A Platform Plugin remains one-click in the product while preserving the customer repository, exact lock, generated graph, application provenance, and rollback identity.
- Zero downtime is conditional and measurable. Contract cleanup and offline operations cannot be hidden inside a successful-looking install.
- Blue/green workers may warm before promotion, but only one generation owns correctness-relevant effects.
- The manager stays an orchestrator: remote UI isolation, runner sandbox, static source/build authority, migrations, worker fencing, and traffic routing remain specialized components.

## Alternatives considered

### Same-origin Web Worker plus API conventions

Rejected. Removing DOM access does not remove ambient origin/network/storage authority, and conventions cannot prevent credentialed host requests.

### Child process under the web/runner service account

Rejected for production. It shares too much operating-system authority and can become a cross-app/host escape path.

### Build an image from runtime database state

Rejected. It creates a second desired-state source and breaks source commit, lockfile, graph, migration, provenance, and fleet reconciliation.

### Start both worker generations and rely on idempotency alone

Rejected. Idempotency is required but does not replace an authoritative generation fence for claims, completion, schedules, and external effects.

### Run contract migrations immediately after traffic promotion

Rejected. It destroys rollback and may break still-draining old binaries.

## Validation

ADR-0023 remains `design-only` until Gate 9 proves:

```text
credentialless/opaque-origin remote UI and MessagePort-only host access
same-origin credential/network/storage escape denial in real Chromium
per-generation OS/container runner and cross-app isolation
static customer source commit → exact lock/graph → signed app/image evidence
real old/new Postgres overlap across explicit migration phases
rollback-window and post-retirement contract enforcement
single-effect blue/green worker fencing and stale completion denial
exact receipts/inventory reconciling source, image, traffic, worker, runner, and migration state
```

Promotion to `executable-poc` is atomic only after the complete normative scope passes Gate 9.
