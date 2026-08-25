# K-Nex Platform Core

K-Nex is a Payload-based application factory for delivering independently deployed, customer-specific CMS, CRM, operations, analytics, and vertical business products from reusable, versioned packages.

```text
Payload + Postgres
+ K-Nex contracts, composition, runtime, and plugins
+ manifest-driven CLI
+ plugin-owned authenticated data sources
+ canonical and plugin-owned output contracts
+ fixed shell and visual CMS/workspace composition
+ installable themes with database-backed profiles
+ customer-owned extensions, migrations, and infrastructure
= independently deployable customer product
```

K-Nex is not initially a shared multi-tenant SaaS. Each customer application owns a separate repository, database, storage boundary, secrets, deployment, migrations, themes, content, and release cadence.

## Strategic boundaries

- **Payload is the strategic V1 application framework.** The POC tests whether the K-Nex composition model is sustainable on Payload; it does not pretend framework neutrality.
- **The Payload Postgres adapter is selected at scaffold time.** K-Nex does not add another ORM or primary-database provider abstraction.
- **Plugins are exact-version trusted packages.** Runtime data cannot download or select executable packages.
- **Customer applications consume shared packages.** They do not copy or patch platform core source.
- **Server authorization is authoritative.** UI visibility, builder metadata, cache entries, and realtime subscriptions never replace permission and record policy.
- **Builder documents are declarative.** No arbitrary JavaScript, SQL, Payload query, package import, secret, unrestricted URL, or global CSS.
- **Realtime normally invalidates and refetches.** Durable business facts use durable event semantics; WebSocket delivery is not the sole source of truth.

## Canonical identity examples

```text
module.sales
module.logistics.core
module.logistics.driver
provider.realtime.socketio
builder.puck
theme.neobrutalism
sales.tasks
metric.scalar@1
```

Dots express namespace hierarchy. Package names remain deployment locations, for example `@k-nex/module-logistics-driver`.

## Package families

```text
@k-nex/contracts
@k-nex/composition
@k-nex/runtime
@k-nex/payload-adapter
@k-nex/cli
@k-nex/ui-contracts
@k-nex/ui-runtime
@k-nex/ui-shell
@k-nex/builder-*
@k-nex/theme-*
@k-nex/module-*
@k-nex/provider-*
@k-nex/integration-*
```

`@k-nex/core` may exist as a convenience facade, but the physical packages preserve dependency direction and prevent a monolithic ambient runtime.

## Application composition

A generated customer repository is governed by:

```text
k-nex.app.json                 desired composition
k-nex.config.ts                hermetic customer registrations
package.json + pnpm-lock.yaml  installed bytes and integrity
.k-nex/generated/              deterministic resolved graph and registries
customer migrations            final schema/data evolution
runtime records                content, layouts, theme profiles, settings
signed release evidence        artifact provenance and deployment receipt
```

The CLI creates and maintains this composition:

```bash
pnpm create k-nex-app acme-cargo
pnpm exec k-nex plan
pnpm exec k-nex generate --check
pnpm exec k-nex doctor --ci
```

## Module data and visual composition

A module deliberately exposes bounded sources:

```text
sales.total-potential-revenue → metric.scalar@1
sales.tasks                   → table.records@1
sales.opportunities-by-stage  → series.category@1
sales.revenue-over-time       → series.time@1
```

Generic Metric, DataTable, and chart blocks consume output contracts rather than Sales implementation types. Source handlers use authenticated `req.payload` or domain services and enforce source, record, and field policy.

The same canonical document model supports two initial builder profiles:

- **CMS:** public-safe blocks/sources/actions, SEO/localization, draft/preview/publish, public theme.
- **Workspace:** authenticated dashboards/reports, scoped layouts, page filters, actions, realtime invalidation, admin theme.

Puck is the first engine candidate behind a narrow adapter. The editor engine, document runtime, and Payload document repository are separate boundaries.

## Theme model

```text
theme package
  executable token schema, palettes, recipes, structural styles, migrations

theme profile
  selected installed theme, validated adjustable values, revisions, publication
```

V1 uses a small semantic primitive ABI. Complex DataGrid, DatePicker, chart, map, rich-text, command, and drag-grid behavior lives in separate versioned adapters rather than being reimplemented by every theme.

## Contract governance

Machine-readable contracts are normative:

```text
contracts/architecture-contracts.v1.json
schemas/plugin-manifest.v1.schema.json
schemas/application-manifest.v1.schema.json
fixtures/plugin-manifests/
```

Run:

```bash
python3 scripts/validate_repository_contracts.py
```

ADR decision status and evidence maturity are separate. The current repository is predominantly **design-only** until executable POC gates link test, migration, benchmark, failure-injection, and deployment evidence.

## Documentation

Start with [the documentation index](./docs/README.md). Important additions from the architecture review:

- [Review disposition](./docs/27-architecture-review-remediation.md)
- [Contract governance and determinism](./docs/28-contract-governance-and-determinism.md)
- [Runtime security and reliability gates](./docs/29-runtime-security-reliability-and-quality-gates.md)
- [Executable POC gates](./docs/30-executable-poc-gates.md)

## Repository status

This repository contains architecture, schemas, fixtures, governance, and research plans. It is not yet a production platform implementation. Claims such as Payload/Puck acceptance, WCAG conformance, SLSA maturity, retained-schema uninstall support, or production readiness require linked evidence.

## License

No license has been selected. Until one is added, the repository and its contents should be treated as proprietary.
