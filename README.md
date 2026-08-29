# K-Nex Platform Core

K-Nex is a Payload/PostgreSQL application factory for independently deployed customer CMS, CRM, operations, analytics, and future vertical products.

```text
Payload + Postgres
+ deterministic Platform Plugins
+ isolated live Hot Applications
+ live Theme Skins
+ customer-owned data/settings/content/authorization
+ immutable Docker releases and verifiable operations
= independently deployable customer application
```

Each customer has a separate repository, database, storage/secrets boundary, deployment, migrations, backups, and release cadence. K-Nex is not initially a shared multi-tenant runtime.

## Current state

Gates 0–8 are accepted executable platform foundation. The active phase is:

```text
Phase 9 — Dynamic Application Runtime and Zero-Downtime Delivery
```

Phase 10 then completes central RBAC, extension permissions/policies, customer roles, role templates, and user-operated lifecycle administration.

Read [`status.md`](./status.md), [`AGENTS.md`](./AGENTS.md), and the [Phase 9 plan](./docs/implementation/phase-9-dynamic-application-runtime.md) before implementation.

## Extension model

### Platform Plugin

Existing full K-Nex packages:

```text
module.*
provider.*
builder.*
theme.*
integration.*
preset.*
```

They may add Payload collections, migrations, host services/jobs/routes, native UI, providers, builders, or executable themes. Their package add/upgrade/removal creates a new immutable customer application release.

The site can remain available through verified blue/green Docker promotion when old/new schema and behavior can overlap. Incompatible migrations are explicitly `maintenance-required`.

### Hot Application

A signed prebuilt `app.*` bundle that can be downloaded, validated, warmed, and activated without restarting the host:

```text
isolated server runner
capability-scoped host API
fixed /apps/:appId/* host route
Web Worker remote UI
allowlisted K-Nex components
namespaced quota-bound app storage
atomic generation update/rollback
```

It cannot add host Payload collections/hooks, import into the main Node process, access raw database/Docker credentials, inherit host secrets, or run unrestricted network calls.

### Theme Skin

A signed `skin.*` bundle containing data-only tokens, palettes, recipes, scoped CSS, and approved assets. It activates live. A full theme package containing JavaScript or native primitive overrides remains a Platform Plugin release.

## Plugin Manager outcome

The future Plugin Manager gives one product experience while exposing the real delivery path:

```text
Install live             Hot Application / Theme Skin
Install with live deploy Platform Plugin
Requires maintenance     incompatible migration only
```

`PluginManager` orchestrates catalog, artifact, runner, UI, registry, deployment, traffic, audit, and authorization adapters. It is not a monolithic package installer.

Production install flow:

```text
signed official catalog
→ immutable release artifact
→ background content-addressed download
→ manifest/digest/SBOM/provenance verification
→ stage and warm new generation
→ atomic app pointer or blue/green traffic promotion
→ outbox/revision convergence
→ receipt and protected runtime inventory
```

The web application never runs `pnpm add`, `npm install`, install scripts, or a downloaded dynamic import. It never receives the Docker socket.

## Twenty comparison

Twenty's application system demonstrates the live-app pattern: package resolution/download, declarative manifest synchronization, metadata migration, stored prebuilt files, isolated server logic execution, and remote UI. K-Nex adopts the architectural pattern through its own contracts while preserving static Payload composition for deep Platform Plugins.

## Accepted foundation

```text
Gate 0   typed contracts, schemas, fixtures, deterministic governance
Gate 1   exact package resolution, static registries, Payload/Postgres boot
Gate 2   source/record/field authorization, contracts, budgets, cache
Gate 2A  safe explicit tools and bounded MCP adapter
Gate 3   transactional outbox, processing, realtime convergence
Gate 4   canonical UiDocument and Puck adapter
Gate 5   theme ABI, atomic publication, deterministic layouts
Gate 6   complete plugin surface and Sales conformance
Gate 7   comprehensive components, forms, pages, DataTable, Puck
Gate 8   lifecycle, application factory, restore, provenance, fleet
```

This is not yet a finished CRM/CMS product or production-observed customer fleet.

## Strategic boundaries

- Payload is the strategic V1 application framework; Postgres is the V1 primary database.
- `module.sales` remains the sole first-party domain reference through Phases 9–10.
- Platform Plugin composition stays static, exact, reconciled, and frozen.
- Hot Application code runs outside the host process and behind capability contracts.
- Server authorization is authoritative; UI visibility and role labels are not authority.
- Realtime invalidates and refetches; transactional outbox holds durable intent.
- Builder documents and Theme Skins contain no arbitrary JavaScript, SQL, host imports, secrets, or unrestricted URLs.
- Pre-v1 obsolete APIs are removed rather than shimmed.

## Reference topology

```text
gateway / reverse proxy
blue and green web generations
worker / outbox processor
k-nex-extension-runner
PostgreSQL
object storage / content-addressed extension artifacts
optional Redis/backplane by topology
separate deployment supervisor
```

## Documentation

- [Documentation index](./docs/README.md)
- [Dynamic applications and zero-downtime delivery](./docs/35-dynamic-applications-and-zero-downtime-delivery.md)
- [Phase 9 execution plan](./docs/implementation/phase-9-dynamic-application-runtime.md)
- [Phase 10 RBAC plan](./docs/implementation/phase-10-rbac-and-authorization-control-plane.md)
- [Master plan](./docs/implementation/codex-master-plan.md)
- [Executable gates](./docs/30-executable-poc-gates.md)
- [Decision register](./docs/21-decision-register.md)

## Roadmap boundary

Before Gate 10 PASS, do not start broad CRM/CMS or another first-party domain module. After the dynamic runtime and authorization gates, the next layer is system settings, full extension/theme administration, official catalog operations, and Docker operations center.

## License

No license has been selected. Until one is added, treat the repository and contents as proprietary.
