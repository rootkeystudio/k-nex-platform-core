# Architecture Decision Register

## Purpose

This document is the authoritative summary of decisions made during the research phase and the remaining questions that must be resolved by proof of concept, implementation evidence, licensing review, or deployment constraints.

Statuses:

```text
accepted      current architecture; implementation should follow it
provisional   preferred direction, but a named POC must confirm it
open          no final decision; options and selection criteria recorded
rejected      considered and intentionally not selected
superseded    replaced by a later decision
```

Accepted decisions can still change, but the change must update this register, affected documentation, and ideally an ADR.

# Accepted decisions

## D-001 — Independent customer applications, not shared multi-tenant SaaS

**Status:** accepted

Each customer receives a separate repository, database, storage boundary, secret set, deployment, migration history, and release cadence.

Rationale:

- matches the intended service/agency delivery model;
- lowers cross-customer data-leak blast radius;
- makes backup, restore, export, offboarding, and custom code easier;
- allows customer-specific infrastructure and module versions;
- avoids spending early product effort on a central tenancy/control plane.

Consequence: shared code is distributed through packages and reusable workflows rather than one shared runtime.

## D-002 — Customer repositories consume packages; they do not copy or patch core source

**Status:** accepted

The customer shell is generated. Core and reusable plugins remain exact versioned dependencies.

Rationale:

- shared fixes can be released once;
- customers can upgrade independently without long-lived merge conflicts;
- package/version inventory remains machine-readable;
- customer differences remain visible as manifest, theme, components, configuration, and extensions.

A customer repository can contain genuine customer extensions, but not an editable copy of platform core.

## D-003 — Separate repository per customer, not long-lived customer branches

**Status:** accepted

Rationale:

- independent CI/CD, access, tags, issues, secrets, release history, and dependency versions;
- easier customer transfer/archive/offboarding;
- lower accidental merge risk;
- better fit for generated scaffolds.

## D-004 — Payload is the initial application/backend foundation

**Status:** provisional

Payload is the leading foundation for authentication integration, admin, APIs, schema, access controls, jobs, migrations, versions/drafts, and plugin/config composition.

It is provisional because the POC must prove:

- deterministic composition from K-Nex plugins;
- safe collision detection;
- customer-owned migration workflow;
- UI/editor integration without deep framework forks;
- WebSocket/runtime hosting constraints;
- acceptable upgrade path.

Failure criteria are recorded in the research plan.

## D-005 — Plugin is the umbrella installable concept

**Status:** accepted

Plugin kinds:

```text
module
provider
builder
theme
integration
preset
```

A K-Nex plugin is broader than a Payload plugin and has static manifest metadata, compatibility, capabilities, lifecycle, and operational semantics.

## D-006 — Dependencies use versioned capabilities where implementation substitution matters

**Status:** accepted

Example:

```text
module.logistics-driver requires realtime.gateway@^1
provider.realtime-websocket-local provides realtime.gateway@1
```

Specific plugin-ID dependencies remain allowed when the dependency is a real domain module rather than a replaceable provider.

Rationale: driver/business code should not change when local WebSocket is replaced by Redis-backed or another compatible provider.

## D-007 — Plugin selection is build-time; runtime settings are database data

**Status:** accepted

Build-time/source-control concerns:

```text
install/remove package
select provider/builder/theme packages
schema-owning module composition
routes/imports/infrastructure
```

Runtime concerns:

```text
active installed theme
palette/token values
CRM currency
retention periods
published layouts
module feature settings that do not alter composition
```

The runtime admin panel does not install executable packages.

## D-008 — Declarative JSON manifest plus TypeScript extension config

**Status:** accepted

```text
k-nex.app.json   machine-editable desired composition
k-nex.config.ts  executable customer-specific extension code
```

`package.json` and `pnpm-lock.yaml` remain authoritative for installed artifacts. Customer migrations remain authoritative for database evolution.

## D-009 — CLI is an application compiler, not only a scaffolder

**Status:** accepted

The CLI creates projects and manages composition through plan/apply, dependency resolution, package installation, registry generation, diagnostics, upgrade planning, and migration checks.

Package/command naming:

```text
create-k-nex-app
@k-nex/cli
k-nex
```

Avoid `create-knex-app` or `knex` CLI names because of ecosystem collision.

## D-010 — Generated registries are static and committed

**Status:** accepted for V1

Generated plugin/provider/UI/theme registries and build inventory live under `.k-nex/generated/` and are committed. CI runs `k-nex generate --check`.

Rationale:

- composition diffs are reviewable;
- no runtime package-name evaluation;
- bundlers can statically discover imports;
- deployments are reproducible.

Revisit only if generated-file maintenance creates more cost than review value.

## D-011 — One UI composition contract, multiple surfaces

**Status:** accepted

Modules can contribute style-agnostic navigation, screens, blocks, data sources, actions, and extension slots for explicit surfaces:

```text
workspace
cms
public
driver
system
```

Surface declaration does not bypass audience/permission/data policy.

## D-012 — Fixed application shell, editable content canvas

**Status:** accepted for V1

Fixed/platform-controlled:

```text
sidebar host
top bar
router
authentication boundary
notification/dialog hosts
system/security screens
```

Composable:

```text
dashboards
module overviews
reports
role workspaces
personal dashboards
CMS/public pages
```

Operational transaction screens can expose extension slots but are not fully drag-and-drop in V1.

## D-013 — Same builder architecture for CMS and workspace

**Status:** accepted

One canonical K-Nex block/layout model is used with separate profiles:

```text
CMS profile       public content, SEO, draft/preview/publish, public-safe blocks
Workspace profile authenticated data/actions, scoped layouts, realtime, admin theme
```

This does not mean both profiles have the same palette or security policy.

## D-014 — Puck is the first builder adapter, behind K-Nex contracts

**Status:** provisional

`@k-nex/builder-puck` is the first implementation. Domain modules do not import Puck types.

Fallback: Craft.js if Puck fails the documented POC/rejection criteria.

Rejected as core engine:

- Builder.io, because the external editor/content dependency conflicts with independent customer operation;
- GrapesJS, because its HTML/CSS-centric model is not the primary fit for permission-aware React application blocks.

Both can still become optional integrations for appropriate customers/use cases.

## D-015 — Builder documents cannot contain arbitrary code or unrestricted styling

**Status:** accepted

Allowed: registered block/data-source/action IDs and validated serializable properties.

Forbidden:

```text
arbitrary JavaScript/TypeScript
SQL
module imports
secrets
raw server functions
unrestricted CSS/global selectors
unrestricted server-fetch URLs
```

## D-016 — Style-agnostic module UI uses semantic design-system contracts

**Status:** accepted

Modules may include structural styling required for behavior, but not customer brand styling. Rendering layers:

```text
headless logic
semantic domain component
design-system primitive adapter
runtime theme tokens
customer code overrides
```

## D-017 — Theme package plus runtime theme profile

**Status:** accepted

Theme package contains code, schema, palettes, primitives, component variants, structural CSS, and migrations. It is installed at build time.

Theme profile contains selected installed theme, adjustable tokens, variants, revision, and publication state. It is stored in the customer database.

The panel can configure/activate installed themes but cannot download new theme packages.

## D-018 — Separate admin and public themes

**Status:** accepted

A customer may use a calm/dense admin theme and a highly expressive public theme.

Initial surfaces:

```text
admin
public
```

Future driver/mobile/email/print theme surfaces require separate contracts.

## D-019 — Theme profiles are versioned collection records

**Status:** accepted for V1

Use a versioned collection with draft/publish/rollback rather than one mutable global. Enforce exactly one published default profile per surface.

## D-020 — Postgres is the supported V1 production default

**Status:** accepted

Local default: Postgres in Docker Compose.

SQLite: demo/fast POC mode.

MongoDB: not officially supported by K-Nex V1 until module and migration compatibility is tested, regardless of underlying framework support.

## D-021 — Customer application owns final migration history

**Status:** accepted

Plugins provide schema contributions, notes, readiness checks, and reusable data migration helpers. The customer repository owns final generated migrations and cross-plugin ordering.

No production auto-push; no automatic destructive cleanup when package is removed.

## D-022 — Disable, uninstall, and purge are distinct

**Status:** accepted

```text
disable    package/data retained; declared behavior gated
uninstall  package removed; data retained unless explicit migration
purge      destructive reviewed data/schema deletion
```

## D-023 — Domain services own business transactions; hooks are adapters

**Status:** accepted

Payload hooks can validate, maintain local invariants, enqueue jobs, or emit after-commit facts. Authoritative multi-step business behavior belongs in testable domain services/commands.

## D-024 — WebSocket/realtime is a provider capability, not core domain logic

**Status:** accepted

Driver requires `realtime.gateway`. Domain modules define channels and authorization. WebSocket remains transport; authoritative state remains recoverable through API/data sources.

## D-025 — Customer-specific behavior starts locally and is promoted after reuse is proven

**Status:** accepted

First customer: local extension.

Second similar need: compare policies and extract stable reusable behavior.

Customer-specific differences remain local.

# Provisional decisions requiring POC evidence

## P-001 — Canonical K-Nex document versus engine-native storage

**Current recommendation:** K-Nex owns the canonical `UiDocument`; Puck adapter translates to/from it.

**POC question:** Can Puck round-trip all required nested structures, fields, permissions, and IDs without loss or excessive adapter complexity?

**Accept when:** fixtures remain stable across edit/save/render/migration and no domain module leaks Puck types.

**Fallback:** versioned Puck metadata section or reconsider engine after documenting trade-offs.

## P-002 — Layout inheritance implementation

**Current recommendation:** immutable base revision plus explicit customer/role/user patch operations.

**Risk:** rebasing patches after a base layout changes can become complex.

**POC options:**

1. patch operations with rebase/conflict handling;
2. copy-on-write resolved snapshots with lineage;
3. hybrid: snapshots for published layouts, patches for user personalization.

**V1 fallback:** hybrid/snapshot approach if patch rebase is not robust. The architectural requirement is scoped inheritance and safe fallback, not a specific storage algorithm.

## P-003 — Third-party Payload–Puck integration usage

**Current recommendation:** use it as a spike/reference and possibly CMS accelerator; do not make K-Nex core contracts depend on it.

**POC questions:**

- storage/data model fit;
- draft/preview/publish integration;
- editor route/shell fit;
- permission hooks;
- upgrade surface;
- custom profile support.

Possible outcomes:

```text
wrap package as implementation detail
reuse selected code/patterns under license
write direct K-Nex Payload/Puck adapter
reject Puck
```

## P-004 — Payload config contribution merger

**Current recommendation:** K-Nex owns deterministic phased composition and collision checks.

**POC question:** Which Payload configuration fields/functions can be safely merged generically, and which require explicit contribution APIs?

Do not implement an unsafe universal deep merge.

## P-005 — Disabled schema-owning plugin boot behavior

**Current recommendation:** retain enough schema registration for historical data while gating active behavior.

**POC question:** How should Payload collections/tables remain compatible when the executable package is uninstalled but data is retained?

Potential patterns:

```text
installed-disabled package
retention stub package/schema snapshot
archive/export before uninstall
leave database tables outside current Payload config
```

Uninstall semantics cannot be finalized until tested.

## P-006 — WebSocket hosting topology

**Current recommendation:** local adapter inside the application process for small single-instance deployments; Redis-backed provider for horizontal scaling.

**POC question:** exact Next.js/Payload hosting/provider constraints, connection draining, and worker separation.

## P-007 — Event durability level

**POC:** in-process after-commit is acceptable for architecture proof.

**First production recommendation:** transactional outbox for externally important facts/integrations.

Final production policy depends on first customer reliability requirements.

## P-008 — Generated registries committed

**Current V1 decision:** commit them and validate freshness.

**Review after POC:** measure merge churn, developer confusion, and deterministic generation reliability.

# Open decisions

## O-001 — Repository topology for first-party plugins

Options:

1. one platform/modules monorepo;
2. core monorepo plus vertical-specific repositories;
3. repository per plugin.

**Recommendation:** begin with a first-party monorepo for core/contracts/CLI/UI foundations and early modules, while preserving package boundaries. Split only when release ownership, permissions, build time, or product separation justifies it.

Reason: cross-package contract changes and integration tests are easier early in one monorepo.

Decision trigger: before implementation scaffold is committed.

## O-002 — Private package registry

Options:

```text
GitHub Packages
private npm organization
self-hosted registry
```

**Recommendation:** GitHub Packages initially because source, Actions, and organization access are already GitHub-centered.

Must validate:

- local developer auth;
- customer CI/deployment token permissions;
- package visibility across customer repositories;
- npm scope ownership/naming;
- provenance/retention;
- operational friction.

Decision trigger: Phase 0 package publish/install spike.

## O-003 — Final npm/package scope

Working scope: `@k-nex/*`.

Open because registry ownership and naming availability must be confirmed. Architecture must not depend on this exact scope.

Decision trigger: registry setup.

## O-004 — License model

Repository currently remains proprietary/no license selected.

Questions:

- private internal product only;
- source-available components;
- open-source core with proprietary modules;
- customer redistribution/self-host terms;
- third-party package license compatibility.

Decision trigger: before distributing packages or repository access outside the owner team. Requires legal review.

## O-005 — Design-system primitive implementation

The semantic contract is accepted; concrete foundation remains open.

Options:

```text
custom primitives on accessible low-level libraries
Radix-based adapter
React Aria-based adapter
another reviewed accessible headless system
```

Criteria:

- accessibility;
- server/client compatibility;
- styling neutrality;
- bundle size;
- complex data-grid/date-picker strategy;
- long-term maintenance;
- theme adapter flexibility.

Decision trigger: UI runtime POC.

## O-006 — Workspace grid/drag layout implementation

Puck handles visual composition but dashboard resizing/grid behavior may require an additional controlled layout primitive or library.

Criteria:

- responsive deterministic serialization;
- keyboard accessibility;
- nested layout support;
- no arbitrary CSS;
- stable server/client render;
- migration behavior.

Decision trigger: realistic operations dashboard POC.

## O-007 — Theme profile data ownership package

Options:

```text
ui-runtime foundational collection
module.theme-manager
system-settings module
```

**Recommendation:** contracts/runtime resolution in `ui-runtime`; Payload collection/editor screens in an installable-but-standard `module.theme-manager` so backend-only deployments can omit management UI.

Decision trigger: package topology design.

## O-008 — CMS and workspace layout storage collections

Options:

- builder document embedded in CMS page versions; separate workspace layout collection;
- generic shared `ui_documents` collection with content references;
- both through shared storage service with surface-specific adapters.

**Recommendation:** CMS document embedded/related to page versions for atomic publication; separate workspace layout collection for scoped inheritance. Share validation/migration services, not necessarily one table.

Decision trigger: Payload/Puck storage POC.

## O-009 — UI override granularity

Open questions:

- can customer code override individual primitive, block renderer, fixed screen, or whole route;
- how overrides are inventoried and compatibility-tested;
- whether a module can declare non-overridable security-critical UI.

**Recommendation:** allow primitive and block renderer overrides through typed contracts; route/screen overrides require explicit module extension points. Authorization remains server-owned.

Decision trigger: customer differentiation POC.

## O-010 — Runtime configuration storage API

Need one convention for plugin-owned validated runtime settings.

Options:

```text
central namespaced settings collection
plugin-owned settings collection/global
hybrid central metadata + plugin-owned data
```

**Recommendation:** central registry/metadata and plugin-owned schemas/storage adapters; avoid one untyped JSON dump.

Decision trigger: first two runtime-configurable plugins (theme manager + CRM or tracking).

## O-011 — GitHub repository creation from CLI

V1 recommendation: initialize local Git only. Remote repository creation is a later optional authenticated command.

Questions:

- GitHub App/CLI auth;
- organization/team permissions;
- private repo defaults;
- repository templates and branch protection;
- non-GitHub portability.

Decision trigger: after local scaffold is stable.

## O-012 — Deployment provider targets

Docker artifact is accepted as a portable default, but first supported deployment platforms are open.

Criteria:

- Postgres/storage/Redis availability;
- WebSocket support;
- worker processes;
- migration jobs;
- secrets;
- logs/metrics;
- per-customer cost and isolation;
- backup/restore.

Decision trigger: first production customer requirements.

## O-013 — Driver frontend technology

Backend/client contracts are module-owned; customer repo owns final driver app.

Options:

```text
responsive Next.js PWA
React Native/Expo
other native shell
```

Recommendation depends on offline, camera/signature, background location, push notifications, and app-store requirements.

Decision trigger: logistics POC/customer requirements.

## O-014 — High-frequency tracking storage providers

Options for current position/history remain workload-dependent:

```text
Postgres only
Postgres + PostGIS
Redis current + Postgres/PostGIS history
specialized time-series/location storage
```

Domain contracts are accepted; provider selection follows measured rate, retention, query, and cost requirements.

Decision trigger: live-tracking load model.

## O-015 — Analytics and telemetry

No external K-Nex CLI/product telemetry by default.

Open: customer-application analytics module/provider design, consent, public-site analytics, and operational metrics.

Decision trigger: explicit customer need; must remain an optional integration/provider.

# Rejected approaches

## R-001 — Shared database/tenant model as the initial architecture

Rejected because it is not required by the delivery model and adds tenancy/data-isolation/control-plane complexity.

## R-002 — Long-lived customer branches of the core repository

Rejected because upgrades, CI, access, releases, and merge conflicts become customer-specific source divergence.

## R-003 — Copy/fork core source into every customer repository

Rejected because fixes and upgrades become manual merge work. Generate the shell; consume core as packages.

## R-004 — Make Twenty the platform core

Rejected for current architecture because CRM is only one optional module, while the platform must host CMS, builder, themes, logistics, restaurant, and other vertical capabilities with full customer UI ownership.

Twenty remains a useful CRM product/UX reference or possible isolated integration.

## R-005 — Builder.io as mandatory core editor

Rejected because the desired baseline is independently operated customer applications and data/editor infrastructure. It can be optional for customers who explicitly accept that service dependency.

## R-006 — Arbitrary CSS/JavaScript in customer-facing builder profiles

Rejected for V1 due to security, supportability, migration, and design-system consistency.

## R-007 — Runtime npm/package installation from the admin panel

Rejected for V1 due to supply-chain, migration, deployment, rollback, and executable-code risks.

## R-008 — Put CMS, CRM, and every vertical concept inside core

Rejected. Core remains cross-cutting and domain-neutral; capabilities are plugins.

# Immediate decision sequence

Before coding begins, resolve in this order:

1. O-001 repository topology.
2. O-002 package registry and O-003 scope.
3. O-005 design-system primitive POC choice.
4. P-004 Payload contribution composition spike.
5. P-001/P-003 Puck canonical-document/storage spike.
6. O-008 layout storage shape.
7. P-002 layout inheritance implementation.
8. O-012 first deployment target only when the POC needs deployment constraints.

Do not wait for every future vertical decision before implementing the platform foundation. Open decisions have explicit triggers so they are resolved when evidence becomes available.
