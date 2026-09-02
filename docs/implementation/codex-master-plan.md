# K-Nex Implementation Master Plan — Codex Execution Contract

- **Status:** active
- **Scope:** Gates 0–11 and Gate 2A
- **Execution authority:** `status.md`
- **Architecture authority:** generated contracts, accepted ADRs, and architecture documents
- **Gate definitions:** [`../30-executable-poc-gates.md`](../30-executable-poc-gates.md)
- **Dynamic runtime direction:** [`../35-dynamic-applications-and-zero-downtime-delivery.md`](../35-dynamic-applications-and-zero-downtime-delivery.md)
- **Phase 9 detail:** [`phase-9-dynamic-application-runtime.md`](./phase-9-dynamic-application-runtime.md)
- **Mandatory Phase 9 review hardening:** [`phase-9-plan-review-hardening.md`](./phase-9-plan-review-hardening.md)
- **Phase 9 decisions:** [`ADR-0021`](../adr/0021-dynamic-application-runtime-and-zero-downtime-delivery.md), [`ADR-0023`](../adr/0023-phase-9-production-isolation-and-static-delivery-hardening.md)
- **Phase 10 detail:** [`phase-10-rbac-and-authorization-control-plane.md`](./phase-10-rbac-and-authorization-control-plane.md)
- **Phase 11 detail:** [`phase-11-system-settings-and-extension-operations.md`](./phase-11-system-settings-and-extension-operations.md)

## 1. Purpose and precedence

This is the orchestration source for agentic implementation. Resolve conflicts in this order:

1. machine-readable contracts and generated schemas;
2. accepted ADRs and evidence registry;
3. architecture documents;
4. this master plan;
5. the linked active phase plan and mandatory review addenda;
6. implementation notes and PR prose.

A plan is not evidence. A gate passes only through its named command and required real fixtures.

## 2. Current focus freeze

Gates 9 and 10 are accepted. The selected next phase is:

```text
Phase 11  System Settings and Extension Operations
```

Until Gate 11 PASS:

```text
module.sales remains the sole first-party domain reference
no broad CRM/CMS implementation
no logistics/restaurant/inventory/budgeting product module
no public third-party marketplace launch
```

Phase 11 reuses the bounded Hot Application and Theme Skin fixtures. They remain infrastructure proofs and do not become new domain products.

## 3. Mandatory execution protocol

Before work:

```text
fetch latest main
read AGENTS.md and status.md
read this plan, active detailed plan, mandatory active-phase addenda, related ADRs
locate the exact active task
```

Work rules:

- one branch and one final PR per phase;
- one coherent commit per task;
- update `status.md` in every task commit;
- run task acceptance and affected repository checks;
- advance only within the active phase after acceptance;
- stop at `Ready for phase review` after the full gate and result pass;
- implementation agents never merge or enable auto-merge;
- project-manager review returns `PASS`, `REWORK`, `BLOCKED`, or `REJECT`.

Branch/PR convention:

```text
branch:   codex/phase-<number>-<slug>
PR title: <type>: complete Phase <number> <outcome>
```

Stop for decision when an invariant cannot be met, a kill criterion fires, a persisted/public contract must change outside task scope, a new dependency family lacks a bounded spike, or a proposed shortcut weakens isolation, authorization, migration, release, or evidence.

## 4. Authoritative phase order

```text
Phase 0   contract freeze and repository governance             complete
Phase 1   deterministic Payload composition                     complete
Phase 2   authenticated sources and output contracts            complete
Phase 2A  agent tools and safe execution                        complete
Phase 3   transactional outbox and realtime convergence         complete
Phase 4   builder engine kill-spike                              complete
Phase 5   themes, UI runtime, atomic publication                complete
Phase 6   plugin platform hardening and Sales reference         complete
Phase 7   comprehensive headless components                     complete
Phase 8   lifecycle, application factory, release/fleet safety  complete
Phase 9   dynamic applications and zero-downtime delivery       complete
Phase 10  RBAC, authorization, extension bootstrap              complete
Phase 11  system settings and extension operations              planned
```

Required commands:

```text
pnpm phase:0
pnpm gate:1
pnpm gate:2
pnpm gate:2a
pnpm gate:3
pnpm gate:4
pnpm gate:5
pnpm gate:6
pnpm gate:7
pnpm gate:8
pnpm gate:9
pnpm gate:10
pnpm gate:11
```

Do not add a later gate as a marker-only command. It must fail unless the complete required evidence actually runs.

## 5. Historical task index

### Phase 0 — Contract freeze

Detail: [`phase-0.md`](./phase-0.md)

```text
P0.1–P0.7  toolchain, typed contracts, fixtures, validation,
           reproducibility, governance, closeout
```

### Phases 1–5

Historical detail: [`phase-details-gates-1-7.md`](./phase-details-gates-1-7.md)

```text
P1  resolver, static registries, Payload/Postgres boot
P2  source gateway, record/field authorization, budgets/cache
P2A explicit tools, approval/idempotency/audit, MCP adapter
P3  outbox, processing, realtime topology and convergence
P4  canonical document, Puck adapter, bundle/accessibility
P5  theme ABI, atomic publication, deterministic layouts
```

### Phases 6–8

Detail: [`phase-details-gates-6-8.md`](./phase-details-gates-6-8.md)

```text
P6  complete plugin authoring surface and Sales conformance
P7  comprehensive components, forms, pages, DataTable, Puck
P8  upgrade/lifecycle/restore, create-knex-app, provenance/fleet
```

## 6. Phase 9 — Dynamic Application Runtime and Zero-Downtime Delivery

Detail: [`phase-9-dynamic-application-runtime.md`](./phase-9-dynamic-application-runtime.md)

Mandatory review correction: [`phase-9-plan-review-hardening.md`](./phase-9-plan-review-hardening.md). Every P9 task and Gate 9 acceptance applies both documents; the correction is not optional future work.

```text
P9.1   delivery classes, manifests, isolation/build/migration/fence contracts
P9.2   prebuilt bundle, signed catalog, secure verifier/store
P9.3   persistent PluginManager state machine and operation authorizer
P9.4   production per-generation runner sandbox, host capabilities, app storage
P9.5   credentialless remote UI realm, MessagePort protocol, fixed host routes
P9.6   atomic activate/update/rollback and convergence
P9.7   live Theme Skin bundles
P9.8   static source/build authority and Docker blue/green Platform Plugin delivery
P9.9   unified manager API/status and attack corpus
P9.10  Gate 9 closeout
```

Outcome:

```text
GO PHASE 10 RBAC AND AUTHORIZATION
REWORK HOT APPLICATION OR ZERO-DOWNTIME DELIVERY
REJECT HOST-PROCESS HOT INJECTION
```

## 7. Phase 10 — RBAC, Authorization, and Extension Bootstrap

Detail: [`phase-10-rbac-and-authorization-control-plane.md`](./phase-10-rbac-and-authorization-control-plane.md)

```text
P10.1   owner, permission, role, grant, assignment, template contracts
P10.2   platform registry and extension policy/template reconciliation
P10.3   PostgreSQL authorization storage
P10.4   effective authority resolver and cache identity
P10.5   policy hooks across host/runner/manager/deployment boundaries
P10.6   protected roles, first owner, role-template bootstrap
P10.7   extension lifecycle and authorization-generation integration
P10.8   live revision and revocation convergence
P10.9   access and extension administration UI
P10.10  Gate 10 closeout
```

Outcome:

```text
GO SYSTEM SETTINGS AND FULL EXTENSION ADMINISTRATION PRODUCTIZATION
REWORK AUTHORIZATION OR EXTENSION BOOTSTRAP
REJECT USER-OPERATED LIVE INSTALL
```

## 8. Phase 11 — System Settings and Extension Operations

Detail: [`phase-11-system-settings-and-extension-operations.md`](./phase-11-system-settings-and-extension-operations.md)

```text
P11.1   settings, catalog, operation, health, and receipt contracts
P11.2   PostgreSQL settings storage
P11.3   settings service and convergence
P11.4   official GitHub catalog consumption
P11.5   full extension lifecycle administration
P11.6   Theme Package, Skin, and Profile administration
P11.7   deployment, backup, and health operations control plane
P11.8   fixed accessible administration journeys
P11.9   convergence and attack corpus
P11.10  Gate 11 closeout
```

Outcome:

```text
GO EXPLICIT CRM/CMS PRODUCTIZATION DECISION
REWORK SYSTEM ADMINISTRATION OR OPERATIONS AUTHORITY
REJECT WEB-OWNED PRIVILEGED OPERATIONS
```

## 9. Cross-phase invariants

### Determinism and supply chain

```text
exact versions and frozen lockfiles
canonical generated files
no wall-clock/path/host/random/secret in committed generation
immutable content-addressed artifacts
secure extraction and no production install scripts
SBOM, provenance, artifact/container digest, deployment receipt
```

### Static Platform Plugin boundary

```text
boot-time Payload config and static imports
complete declared-versus-actual registration
schema/migrations through customer release
change starts from expected customer source commit
exact target manifest/lock/graph/registries/migrations
trusted customer-specific application/image attestation
host code only from verified immutable artifact
no runtime mutation of frozen registry or DB-authored desired graph
```

### Hot Application server boundary

```text
separate closed manifest and app.* identity
prebuilt self-contained bundles
production OS/container sandbox per app generation
cross-app/generation memory/file/token isolation
capability-scoped RPC, short-lived identity, denied default egress
no raw DB/Docker/env/host import authority
atomic generation pointer and rollback
```

### Remote UI boundary

```text
opaque-origin or dedicated credentialless realm
no customer cookies/tokens/browser storage/ambient network
strict CSP and generation-pinned verified assets
MessagePort-only K-Nex component/event protocol
host-owned DOM/focus/accessibility/routing/data/authorization
```

### Zero-downtime delivery

```text
stable gateway and old healthy generation during warm-up
online-expand/online-backfill before or during overlap
post-retirement-contract only after rollback closes
offline-required becomes maintenance-required
verified target readiness/source/build/inventory
passive green workers and PostgreSQL fencing-token transfer
continuous external probes
```

### Authorization

```text
server/host capability authorization is authoritative
role labels never authorize
runtime content cannot create policy code
current revisions/generation in cache and runner identity
revocation reaches web, worker, runner, browser, realtime
```

### UI and accessibility

```text
small theme ABI and platform-owned components
remote UI does not execute arbitrary host React
strict props/events and app-local error boundary
keyboard/focus/origin/CSP/forced-colors/motion evidence
```

### Evidence

```text
real PostgreSQL for transactional state/migrations/worker fence/restore
real Chromium for credentialless remote UI/admin/accessibility
real isolated runner and cross-app/generation denial
real customer source-change/build-attestation chain
real continuous-traffic Docker promotion proof
failure injection at every lifecycle boundary
```

## 10. Dependency protocol

Before adding a library:

1. prove current dependencies cannot solve the active requirement cleanly;
2. inspect official docs/source/types for the exact candidate version;
3. assess maintenance, license, vulnerability, bundle/runtime, and isolation impact;
4. keep implementation types behind K-Nex contracts;
5. pin exact version and update lockfile;
6. add only with a real active-task consumer and kill criteria.

Remote UI, bundler, archive, signature, sandbox, proxy, builder, and orchestration libraries require bounded spikes rather than speculative adoption.

## 11. Post-Gate 11 boundary

CRM/CMS breadth begins only through a separate accepted product plan after the administration core is usable and evidenced by Gate 11.
