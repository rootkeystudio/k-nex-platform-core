# Architecture Decision Register

Decision status and evidence maturity are separate. See the [ADR index](./adr/README.md) and machine-readable [evidence registry](./adr/evidence-registry.json).

## Product and deployment

### D-001 — Independent customer applications

Each customer owns a separate repository, Payload/Postgres data boundary, storage, secrets, deployment, migrations, backups, and release cadence.

### D-002 — Package composition, not copied core

Customer applications consume exact shared packages and own bounded customer composition/extensions/assets/migrations/infrastructure.

### D-003 — Payload is the strategic V1 framework

Payload is not treated as a casually replaceable provider. Replacing it is a platform migration.

### D-004 — Docker/container-first customer runtime

V1 deployment is container-first. Web, worker, extension runner, database, storage, realtime/backplane, and deployment-supervisor topology are explicit.

### D-005 — Two extension delivery paths

```text
Hot Application / Theme Skin  live generation activation
Platform Plugin               immutable blue/green release
```

Both can preserve user-visible availability, but they have different contracts and risk boundaries.

### D-006 — No host-process package mutation

The main web/worker process never performs runtime `pnpm add`, `npm install`, install scripts, downloaded-code dynamic import, or `node_modules` injection.

### D-007 — Zero downtime is conditional and evidenced

Compatible expand/contract releases may promote blue/green with continuous availability. Incompatible/destructive migration yields `maintenance-required`; availability is never falsely claimed.

### D-008 — Deployment authority is external

The application does not receive Docker socket or build/publish credentials. A separate supervisor or supported orchestrator builds/pulls, validates, migrates, warms, promotes, drains, and emits receipts.

### D-009 — Sales remains the core domain reference

`module.sales` remains the sole first-party domain reference through active core-productization gates. Test-only apps/providers may prove generic infrastructure but cannot become a second domain product.

## Identity, contracts, and composition

### D-010 — Canonical hierarchical IDs

Dots express namespace hierarchy; optional hyphens are allowed inside one segment. Package paths are not persisted identity.

### D-011 — Extension identities are class-specific

```text
Platform Plugin  existing module/provider/builder/theme/integration/preset IDs
Hot Application  app.*
Theme Skin       skin.*
```

A persisted rename requires explicit migration; aliases are not permanent compatibility.

### D-012 — Static and hot manifests are separate

Platform Plugins use the existing plugin manifest. Hot Applications and Theme Skins use separate closed manifests that cannot declare host Payload schema or arbitrary executable contributions.

### D-013 — Deterministic static composition

`k-nex.app.json`, exact lockfile/package integrity, static package manifests, hermetic customer config, and generated resolved registries must reconcile exactly.

### D-014 — Canonical registration lifecycle

```text
manifest → contracts → providers → schema → behavior → jobs
→ data-handlers → ui → admin → validate → freeze
```

This lifecycle applies to Platform Plugins and remains immutable after boot.

### D-015 — Declared-versus-actual inventory and scoped services

Undeclared contribution/capability access fails. Plugins do not receive an ambient service locator.

### D-016 — Runtime extension generation, not registry mutation

Hot Applications/Skins stage immutable generations and atomically switch a database-backed active pointer. They do not patch the Platform Plugin registry.

### D-017 — ADR status and evidence are separate

Accepted design may remain `design-only`; executable and production-observed maturity require linked evidence.

## Data, authorization, events, and runtime

### D-018 — Plugin-owned bounded data sources

No automatic raw collection exposure or builder-authored query language.

### D-019 — Standard source/action gateways

Authentication, audience/surface, authorization, budget, dispatch, validation, redaction, cache, observability, and RFC 9457 errors are separate stages.

### D-020 — Hybrid output contracts

Canonical Metric/Table/Series and bounded namespaced contracts use exact source-specific runtime schemas.

### D-021 — Required versus optional fields

Missing required authority is explicit; authoritative components do not silently render incomplete business meaning.

### D-022 — Safe cache classes

`no-store`, `actor`, `authorization-context`, and explicit `public`. Role labels are never cache identity.

### D-023 — Event durability classes

Durable integration/workflow uses transactional outbox. Reconstructible invalidation requires revision-based convergence.

### D-024 — Realtime is a hint, not truth

Subscriptions are authenticated/authorized/bounded. Clients refetch authoritative sources and recover through revision/resync.

### D-025 — Postgres and customer-owned migrations

Payload Postgres is the V1 persistence base. Customer repositories own final Platform Plugin schema/data migrations.

### D-026 — Explicit agent tools

Only static source/action-backed tools are discoverable. Every call is reauthorized, budgeted, audited, approval/idempotency-aware, and MCP is only an adapter.

### D-027 — Hot Application storage is namespaced and generic initially

The first runtime store is a platform-owned schema-validated document/KV capability with quotas, revisions, bounded indexes, backup/restore, and no cross-app reads. Arbitrary dynamic relational schema is deferred.

### D-028 — Hot Application server execution is isolated

Downloaded server code runs in an extension runner process/service with short-lived identity and capability-scoped RPC. It receives no raw Payload request, customer DB credential, Docker authority, ambient host environment, or unrestricted network.

### D-029 — Remote UI is host-rendered from an allowlisted protocol

Hot Application UI runs in a Web Worker/equivalent realm. The host owns DOM, components, routing, theme, accessibility, authorization, and data/action gateways.

### D-030 — Runtime extension state is durable and convergent

Install/activation generations, revisions, receipts, audit, outbox invalidation, artifact references, and backup/restore are authoritative. Lost messages converge through revision polling.

## UI, builder, and themes

### D-031 — Fixed shell, composable canvas

Authentication, router, system/security surfaces, global navigation hosts, and extension route hosts are fixed. CMS/dashboard/report canvases compose within explicit authority.

### D-032 — Canonical UI document and profile separation

CMS and workspace share document architecture but not public/authenticated policy. Puck remains behind a narrow adapter.

### D-033 — Public and internal authority IDs are distinct

Shared rendering does not merge public and privileged source/action/block identities.

### D-034 — Small stable theme primitive ABI

Complex table/date/tree/editor/map/chart behavior is platform-owned and styled through tokens/slots/recipes.

### D-035 — Theme package versus Theme Skin

```text
Theme Package  executable JS/React/schema/migrations; Platform Plugin release
Theme Skin     data-only tokens/recipes/scoped CSS/assets; live generation
Theme Profile customer-owned validated runtime values/publication history
```

### D-036 — WCAG 2.2 AA target

Supported surfaces require keyboard/focus/drag alternative/target/motion/high-contrast/screen-reader evidence according to scope.

### D-037 — Comprehensive platform-owned headless components

Plugins/apps compose K-Nex components and standard data/form/page utilities; they do not invent parallel transport/table/form/accessibility stacks.

## Lifecycle, release, and supply chain

### D-038 — Schema-owning Platform Plugin lifecycle

Reversible: disable/re-enable. Destructive: explicit purge migration/release. Archive/export is explicit work. Generic remove-code/retain-schema is not promised.

### D-039 — Migration lock and stale-artifact fence

Customer migration obtains Postgres advisory lock, verifies expected predecessor, records revision, and readiness rejects stale artifacts.

### D-040 — Verifiable release and fleet evidence

Exact package/artifact/lock/resolved graph/SBOM/provenance/deployment receipt/runtime inventory bind deployed truth.

### D-041 — Full-SHA workflows and explicit secrets

No floating shared workflow reference or blanket secret inheritance; OIDC preferred.

### D-042 — Official catalog is signed immutable metadata

Catalog entries bind publisher, source commit, immutable release asset, manifest/artifact/SBOM digests, provenance, compatibility, support, and revocation. Runtime never clones an arbitrary branch.

### D-043 — Production bundles are prebuilt

Hot Application dependencies are bundled during publication. Customer activation executes no package-manager lifecycle scripts.

### D-044 — Content-addressed staging and atomic promotion

Unverified artifacts are neither served nor executed. New generations warm beside active ones and promote through one revision-checked pointer/traffic switch.

### D-045 — Docker Compose is not itself a zero-downtime guarantee

Continuous availability needs a gateway and separate deployment supervisor or supported orchestrator, at least one old healthy generation during warm-up, compatible migrations, safe worker overlap, and measured probes.

### D-046 — Official plugin adoption remains bounded

Official Payload/third-party libraries remain behind K-Nex adapters; their private types and lifecycle do not become persisted K-Nex contracts.

## Phase 10 authorization direction

### D-047 — Stable permission IDs, not role labels

Platform and extension behavior requires permissions plus record/field policy. `Manager`, `Sales Manager`, and `Superadmin` labels never authorize.

### D-048 — Central customer-owned roles and normalized grants

Roles, per-permission grants, and explicit active/revoked user/service assignments live in the customer database with optimistic revisions and audit.

### D-049 — Extension role templates are bounded defaults

Platform Plugins and Hot Applications may provide versioned same-owner templates. They never assign users or grant platform/foreign permissions. Customer edits are preserved through stored old-baseline comparison.

### D-050 — Extension authorization generation fences reinstall

Disable/re-enable and compatible update preserve one generation. Uninstall retires it; reinstall allocates a new generation. Old grants cannot reactivate without explicit reviewed reconciliation.

### D-051 — Protected platform roles and first owner

Stable owner/security/extension-admin/user-admin/auditor roles have platform baselines. First-run bootstrap is single-use; last owner revocation fails. Temporal assignments are deferred.

### D-052 — Effective and administrative permission catalogs differ

Authorization uses only ready platform and enabled/current-generation extension descriptors/bindings. Diagnostic snapshots may show disabled/retired/orphaned entries without restoring authority.

## Active phase order

```text
Gates 0–8  accepted executable platform foundation
Phase 9    Dynamic Application Runtime and Zero-Downtime Delivery
Phase 10   RBAC, Authorization, and Extension Bootstrap
next       System Settings and Full Extension Administration Productization
then       explicit CRM/CMS product roadmap
```

## Rejected approaches

```text
shared customer database as initial isolation
copied/forked core per customer
runtime npm/pnpm install in host
host dynamic import of downloaded extension code
web process Docker socket
raw unverified Git branch as catalog artifact
Hot Application adding Payload collections/hooks
Node permission flags as sole sandbox
remote app React executing in host realm
false zero-downtime claim for incompatible migrations
role-label authorization
plugin-controlled user assignment
runtime database content creating executable descriptors/policies
permanent ID aliases
WebSocket as business truth
arbitrary builder JavaScript/SQL/import/network/CSS
```

## Open product decisions

```text
final official catalog repository/registry topology
local runner process versus stronger per-app container pool implementation
remote-component engine selected after kill-spike
first managed Docker/orchestrator platform
public third-party marketplace certification and commercial policy
richer dynamic object/data model after generic app storage proof
SSO/group/directory authority
the CRM/CMS product scope after administration core
```
