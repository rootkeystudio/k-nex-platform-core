# Executable Proof-of-Concept Gates

## Principle

Each gate is independently falsifiable. Failure changes or rejects an assumption; it is not hidden by adding features. `module.sales` remains the sole first-party domain reference through the active core sequence.

## Gate 0 — Contract freeze and repository governance

Scope: canonical IDs, plugin/application schemas, fixtures, registration phases, output registry, ADR evidence, docs/schema/legacy checks, governance.

Exit: clean validation; invalid fixtures fail; two clean generations are byte-identical.

Kill/rework: active prose cannot be reconciled with normative contracts without changing accepted semantics.

## Gate 1 — Deterministic Payload composition

Scope: one customer, Payload/Postgres, resolver/composition/adapter, Sales collection/query, generated registries, clean migration, boot inventory.

Exit: identical inputs produce identical graph/files; graph matches package integrity/registration; undeclared contribution/capability fails; real Postgres boot passes.

Kill/rework: deterministic composition or Payload integration requires a deep fork.

## Gate 2 — Data sources, authorization, and output contracts

Scope: Metric/Table, Sales sources, source/record/field authorization, required/optional fields, bounded queries, validation, cache, RFC 9457.

Exit: manipulation denied; unauthorized data enters no result/cache/trace/error; cache isolation and budgets pass; required-authority failure is explicit.

Kill/rework: safe cache/policy identity is inexpressible or validation cost is unacceptable.

## Gate 2A — Agent tools and safe execution

Scope: explicit tool descriptors, filtered discovery, source/action execution, reauthorization, approval, idempotency, budgets, audit, MCP adapter.

Exit: only explicit tools; delegation cannot exceed principal; writes are approval/idempotency-safe; output is bounded/redacted/audited; MCP does not weaken policy.

Kill/rework: tool bypasses source/action policy, retries duplicate effects, or protocol/model types enter core contracts.

## Gate 3 — Transactions, outbox, and realtime convergence

Scope: transactional outbox, leased idempotent processing, Socket.IO topology, worker-to-web relay, revisions/resync, failure injection.

Exit: intent survives crash; rollback is silent; unsupported topology fails; clients converge after loss; subscriptions reauthorize.

Kill/rework: durability/topology cannot be stated honestly or clients can remain indefinitely stale.

## Gate 4 — Builder engine kill-spike

Scope: canonical document, editor-independent runtime, Puck round-trip, fixed shell, public/workspace policy, missing fallback, bundle boundary, keyboard operation.

Exit: no semantic loss; Puck types do not become persisted/module contracts; public/internal policy holds; runtime renders without editor; accessibility avoids deep fork.

Kill/rework: mapping, fixed shell, or accessible operation requires a deep Puck fork.

## Gate 5 — UI runtime, themes, and atomic publication

Scope: small primitive ABI, Minimal/Neobrutalism, WCAG journeys, document repository, atomic page/document publish/rollback, deterministic layouts.

Exit: same document under both themes; keyboard/focus/motion/high-contrast pass; failed/concurrent publication is safe; layout resolution is deterministic.

## Gate 6 — Plugin platform and Sales reference

Scope: complete contribution taxonomy, authoring/package boundaries, settings/permissions/routes/navigation/templates, query/action factories, UI/Puck, Sales reference, conformance, lifecycle.

Exit: every supported category is machine-readable/reconciled; Sales exercises mandatory surfaces; templates preserve customer edits; one conformance command proves boundaries.

Kill/rework: completeness requires ambient authority, duplicate stacks, runtime-created executable contributions, or multiple domain modules.

## Gate 7 — Comprehensive headless components

Scope: component family inventory, forms/navigation/overlays/media, DataTable/DataGrid, pages, Puck blocks, SSR/hydration, themes, accessibility, bundle/performance.

Exit: every family has executable disposition; Sales uses K-Nex contracts; data table and state matrix preserve authority/accessibility; performance and bundle budgets pass.

Kill/rework: themes become separate component frameworks or third-party types leak into K-Nex contracts.

## Gate 8 — Lifecycle, application factory, release, and fleet safety

Scope: package/release boundaries, upgrade/migrations, advisory lock/readiness fence, archive/purge/backup/restore, create-knex-app, two Sales customers, SBOM/provenance, deployment receipts, fleet patching.

Exit: lifecycle preserves behavior/data; stale/concurrent migrations fail; purge requires evidence; customer generation/boot is exact; independent cadence and fleet impact/restore are proven.

Kill/rework: customer upgrades cannot be deterministic/recoverable or destructive lifecycle/fleet truth remains ambiguous.

## Gate 9 — Dynamic applications and zero-downtime extension delivery

Scope:

```text
Platform Plugin / Hot Application / Theme Skin delivery classes
closed app/skin/bundle/generation/isolation contracts
prebuilt deterministic bundle and signed catalog
secure extraction, SBOM/provenance, content-addressed store
persistent PluginManager state machine
per-generation production runner sandbox and capability-scoped host API
namespaced quota-bound app storage
credentialless/opaque-origin remote UI and fixed /apps/:appId/* host routes
atomic install/update/rollback and multi-process convergence
live Theme Skin activation
static customer source-change and trusted application build authority
closed migration compatibility phases and rollback windows
PostgreSQL worker-generation fencing
Docker blue/green Platform Plugin deployment
continuous traffic and maintenance-required evidence
```

Excluded:

```text
host-process pnpm/npm install or downloaded-code import
hot Payload collection/hook injection
same-origin credential-bearing remote app realm
same-user child process as production sandbox
runtime database state as Platform Plugin desired graph
arbitrary image/tag or self-asserted build evidence
public third-party marketplace launch
arbitrary dynamic relational ORM
end-user RBAC administration
claim that every migration is zero downtime
```

Exit:

- signed official bundle downloads in background and tampering/revocation fails;
- production activation runs no package manager/install scripts;
- downloaded server code executes only in a per-generation OS/container sandbox with denied host, cross-app, DB, Docker, environment, filesystem, and raw-network escape;
- remote UI has no host-origin credentials, browser storage, ambient network, direct DOM/session/host-module authority and communicates only through the bounded host channel;
- app/skin generations activate, update, rollback, drain, and restore atomically without host restart;
- web/worker/runner/browser converge after invalidation loss;
- a Platform Plugin target starts from the expected customer source commit and produces exact lock/graph/application/image signed evidence;
- full target builds/starts/warms while old generation serves;
- compatible promotion uses only online-expand/online-backfill work and records continuous successful external probes plus exact inventory;
- post-retirement contract work cannot execute while rollback remains open;
- failed target never changes traffic;
- incompatible/offline migration produces `maintenance-required` before promotion;
- green workers remain passive until a persisted fencing-token transfer and stale owners cannot claim/complete effects;
- web/admin process cannot write the customer repo, build images, or access Docker directly.

Kill/rework:

- useful live app needs host Payload config mutation or host-realm code execution;
- browser isolation leaves ambient host cookies, authenticated fetch, storage, or network;
- production runner isolation depends only on TypeScript, Node flags, or a same-user child process;
- activation can serve mixed/unverified generations;
- a static plugin can deploy without exact source/lock/graph/application build evidence;
- continuous availability requires Docker/source-builder authority in the application process;
- static plugin schema/artifact mismatch can reach traffic;
- blue/green workers can duplicate correctness-relevant effects;
- contract/offline migration is mislabeled as zero downtime.

Decision:

```text
GO PHASE 10 RBAC AND AUTHORIZATION
REWORK HOT APPLICATION OR ZERO-DOWNTIME DELIVERY
REJECT HOST-PROCESS HOT INJECTION
```

## Gate 10 — RBAC, authorization, and extension bootstrap

Scope:

```text
platform/extension permission ownership
normalized roles, generation-bound grants, explicit assignments
extension permission/policy reconciliation
versioned role templates and stored old baselines
protected system roles and first-owner bootstrap
effective/admin permission catalogs
lifecycle dormancy and uninstall/reinstall fencing
live revision/revocation across web/worker/runner/browser/realtime
PluginManager and DeploymentSupervisor authorization
access and extension administration UI
```

Excluded: role inheritance, explicit deny, per-user direct grants, temporal assignments, full SSO, broad CRM/CMS.

Exit:

- authorized admins see all platform/enabled-extension permissions;
- roles can receive individual permissions or selected template permissions;
- role labels/client input never authorize;
- templates assign no users and never overwrite customer edits;
- disable hides plugin-only noise and makes grants dormant while preserving data;
- mixed roles keep unrelated authority and inactive assignments remain visible on subject detail;
- retired-generation grants cannot reactivate after reinstall;
- first-owner replay and last-owner revocation fail;
- current permissions protect live install, deploy, rollback, settings, and lifecycle operations;
- revocation reaches runner/realtime/browser and lost invalidation converges;
- real PostgreSQL and Chromium journeys pass.

Kill/rework: role labels or stale generation become authority, plugin controls assignments/platform grants, or user-operated live install cannot be safely authorized.

Decision:

```text
GO SYSTEM SETTINGS AND FULL EXTENSION ADMINISTRATION PRODUCTIZATION
REWORK AUTHORIZATION OR EXTENSION BOOTSTRAP
REJECT USER-OPERATED LIVE INSTALL
```

## Evidence promotion

After a gate passes, link implementation PR/commit, fixtures, CI, failure injection, benchmark, migration/restore proof, and production-observed receipt where applicable. An accepted design remains `design-only` until its complete scope is executable.
