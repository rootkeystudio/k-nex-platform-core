# K-Nex Platform Core

K-Nex is a Payload-based application factory for delivering independently deployed, customer-specific CMS, CRM, operations, analytics, and future vertical products from reusable, versioned packages.

```text
Payload + Postgres
+ K-Nex contracts, composition, runtime, and plugins
+ plugin-owned authenticated sources/actions/tools/events/UI
+ canonical CMS/workspace documents and Puck adapter
+ platform-owned headless components and installable themes
+ customer-owned content, settings, migrations, and infrastructure
+ application factory, release, restore, and fleet evidence
= independently deployable customer product
```

K-Nex is not initially a shared multi-tenant SaaS. Each customer application owns a separate repository, database, storage boundary, secrets, deployment, migrations, themes, content, and release cadence.

## Foundation-program focus

Until Gate 8 passes, the only first-party reference domain module is:

```text
module.sales
```

Sales is used to make the entire plugin system complete and repeatable:

```text
manifest and package boundaries
Payload schema and migrations
permissions and settings
sources and output contracts
actions and agent tools
events, jobs, outbox, and realtime
browser queries and mutations
headless components and Puck blocks
routes, navigation, and default pages
lifecycle, upgrade, restore, and conformance tests
```

Logistics, restaurant, inventory, budgeting, dispatch, driver, live-tracking, QR-menu, commerce, and similar domains are deferred product work. Missing platform mechanisms are solved once through Sales before another domain module begins.

See:

- [Plugin platform hardening and Sales reference](./docs/33-plugin-platform-hardening-and-reference-sales.md)
- [Headless component system and data experience](./docs/34-headless-component-system.md)

## Strategic boundaries

- **Payload is the strategic V1 application framework.** K-Nex does not pretend framework neutrality.
- **Postgres is selected through Payload.** K-Nex does not add another ORM or primary-database provider abstraction.
- **Plugins are exact-version trusted packages.** Runtime data cannot download packages or create executable contributions.
- **Customer applications consume shared packages.** They do not copy or patch platform core source.
- **Server authorization is authoritative.** UI visibility, builder metadata, caches, agent catalogs, and realtime subscriptions never replace permission and record policy.
- **Builder documents are declarative.** No arbitrary JavaScript, SQL, Payload query, package import, secret, unrestricted URL, or global CSS.
- **Realtime invalidates and refetches.** Durable facts use transactional outbox semantics; WebSocket delivery is not business truth.
- **One small theme ABI, broad platform components.** Themes supply tokens, slots, recipes, and bounded CSS; K-Nex owns complex component behavior.
- **Pre-v1 obsolete paths are removed.** No compatibility shims are maintained for unreleased APIs.

## Current executable foundation

The repository is no longer documentation-only. Accepted executable gates provide:

```text
Gate 0
  typed contracts, generated JSON Schemas, fixtures,
  deterministic generation, governance, and CI

Gate 1
  deterministic package resolution/composition,
  static registries, Payload/Postgres migration and boot

Gate 2
  authenticated source gateway, record/field authorization,
  Metric/Table contracts, budgets, cache and safe errors

Gate 2A
  explicit agent tools, approval/idempotency/audit,
  bounded official Payload MCP transport adapter

Gate 3
  transactional outbox, leased idempotent processing,
  supported Socket.IO topology and convergence

Gate 4
  canonical UiDocument, editor-independent runtime,
  Puck adapter, fixed-shell policy, bundle/accessibility proof

Gate 5
  semantic primitive ABI, Minimal and Neobrutalism themes,
  atomic CMS publication/rollback, deterministic layouts,
  real PostgreSQL and Chromium evidence
```

Phase 6 / P6.1 is active; `status.md` is the current execution source.

This is a tested platform foundation, not a production-ready customer-delivery release.

## Canonical identity examples

```text
module.sales
provider.realtime.socketio
builder.puck
theme.minimal
theme.neobrutalism
sales.tasks
sales.task.create
sales.tools.create-task
sales.page.overview
sales.table.tasks
metric.scalar@1
table.records@1
```

Dots express namespace hierarchy. Package names are deployment locations, for example `@k-nex/module-sales`.

## Package direction

Existing and planned package boundaries include:

```text
@k-nex/contracts
@k-nex/composition
@k-nex/runtime
@k-nex/payload-adapter
@k-nex/ui-runtime
@k-nex/builder-puck
@k-nex/ui-design-system-contracts
@k-nex/theme-minimal
@k-nex/theme-neobrutalism
@k-nex/payload-builder-storage

created only when a real consumer exists:
@k-nex/ui-components
@k-nex/ui-data
@k-nex/ui-forms
@k-nex/ui-pages
@k-nex/ui-builder-blocks
@k-nex/ui-testing
@k-nex/plugin-testing
@k-nex/cli
```

No empty package is created merely because it appears in the target architecture.

## Plugin contribution model

A complete plugin may explicitly contribute:

```text
schema and migrations
services and permissions
settings
sources and actions
agent tools
events, jobs, and realtime topics
components and Puck blocks
routes, navigation, and default page templates
localization
health, audit, lifecycle, and testing metadata
```

Every contribution is statically declared, executable bindings are reconciled declared-versus-actual, and database/CMS content cannot create executable code paths.

Sales will become the reference implementation and must pass one clean conformance command before a second module is authorized.

## Component system

The Component Gallery's 60 component families are the minimum coverage inventory, supplemented by K-Nex-specific data, form, page, and builder utilities.

The architecture is layered:

```text
small stable theme primitive ABI
→ platform-owned style-agnostic accessible components
→ data/form/page utilities
→ plugin compositions and canonical Puck blocks
→ theme tokens, recipes, slots, and customer overrides
```

Priority product components include:

```text
QueryBoundary and canonical result states
Pagination, search, filter, facets, and sorting
semantic Table and explicit DataGrid mode
DataTable with column/selection/action utilities
forms and server-problem mapping
page templates
rich-text and visualization adapters
Puck bridges over the same runtime components
```

Style-agnostic components may include structural CSS needed for semantics, focus, overlays, virtualization, reduced motion, and forced colors. They do not include brand presentation or arbitrary persisted CSS.

## Application composition

A generated customer repository is governed by:

```text
k-nex.app.json                 desired composition
k-nex.config.ts                bounded source-controlled registration input
package.json + pnpm-lock.yaml  installed bytes and integrity
.k-nex/generated/              deterministic graph and registries
customer migrations            final schema/data evolution
runtime records                content, layouts, theme profiles, settings
signed release evidence        provenance and deployment receipt
```

The final `create-knex-app` product is Gate 8 work. Planned behavior includes exact plugin/theme selection, local Docker or external Postgres, deterministic installation, migration/readiness planning, and initial default-page instantiation. Do not assume the user-facing CLI is complete before that gate passes.

## Immediate roadmap

```text
Gate 5   themes, accessibility, atomic publication, layouts      complete

Gate 6   plugin platform hardening + complete Sales reference    active
         contribution taxonomy and authoring API
         standard query/action/page/Puck contracts
         plugin conformance command

Gate 7   comprehensive headless component system
         DataTable/forms/pages/Puck blocks
         complete Sales reference UI

Gate 8   upgrade/lifecycle/backup/restore
         create-knex-app
         two independent Sales-based customer applications
         SBOM/provenance/deployment/fleet proof
```

Only after Gate 8 project-manager PASS may the roadmap select the next domain product.

## Contract governance

Machine-readable contracts are normative:

```text
contracts/architecture-contracts.v1.json
contracts/generated-contracts.v1.json
schemas/
fixtures/
docs/adr/evidence-registry.json
```

Use the commands defined by the active phase; generated artifacts are changed only through their authoring source. ADR decision status and evidence maturity are separate.

## Documentation

Start with [the documentation index](./docs/README.md).

Execution sources:

- [Master execution plan](./docs/implementation/codex-master-plan.md)
- [Future Gates 6–8 task plan](./docs/implementation/phase-details-gates-6-8.md)
- [`status.md`](./status.md)
- [`AGENTS.md`](./AGENTS.md)

Architecture foundations:

- [Contract governance and determinism](./docs/28-contract-governance-and-determinism.md)
- [Runtime security and reliability gates](./docs/29-runtime-security-reliability-and-quality-gates.md)
- [Executable gates](./docs/30-executable-poc-gates.md)
- [Decision register](./docs/21-decision-register.md)

## Repository status

The repository contains executable contracts, packages, fixtures, real PostgreSQL and browser proofs, failure injection, and detailed future plans. It is still pre-v1 and not production ready. Plugin lifecycle/upgrade/restore, the comprehensive component catalog, the application factory, signed release evidence, and multi-customer fleet operations remain future gates.

## License

No license has been selected. Until one is added, the repository and its contents should be treated as proprietary.
