# K-Nex Platform Core

K-Nex is a Payload/PostgreSQL application factory for independently deployed customer CRM, CMS, operations, analytics, and future vertical products.

```text
Payload + PostgreSQL
+ deterministic Platform Plugins
+ isolated live Hot Applications
+ live Theme Skins
+ customer-owned data/settings/content/authorization
+ immutable releases and verifiable operations
= independently deployable customer application
```

Each customer has a separate repository, database, storage/secrets boundary, deployment, migrations, backups, and release cadence. K-Nex is not initially a shared multi-tenant runtime.

## Current state

Gates 0–11 built and exercised the platform foundation:

```text
typed contracts and deterministic composition
authorized sources, actions, tools, outbox, and realtime
canonical UiDocument, Puck adapter, themes, and headless components
application factory, immutable releases, backup/restore, and fleet evidence
isolated Hot Applications, Remote UI, Theme Skins, and zero-downtime delivery
customer-owned RBAC, roles, grants, assignments, and revocation
system settings, catalog refresh, extension/theme administration, and operations
```

Phase 11 merged as `main@9cb386e649aca5dfa90f04f3f1e3121b5debef93`.

The selected product sequence is now:

```text
Phase 12  runnable customer workspace and custom internal dashboard builder
Phase 13  CRM-first productization and pilot readiness
```

Phase 12 closes the current product gap: `create-knex-app` must generate a real Next/Payload application that can be started, signed into, navigated, administered, and extended with safe customer-owned internal pages. See [`status.md`](./status.md) and the [post-Gate-11 roadmap](./docs/implementation/post-gate-11-product-roadmap.md).

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
credentialless Remote UI realm
allowlisted K-Nex components
namespaced quota-bound app storage
atomic generation update/rollback
```

It cannot add host Payload collections/hooks, import into the main Node process, access raw database/Docker credentials, inherit host secrets, or run unrestricted network calls.

### Theme Skin

A signed `skin.*` bundle containing data-only tokens, palettes, recipes, scoped CSS, and approved assets. It activates live. A full theme package containing JavaScript or native primitive overrides remains a Platform Plugin release.

## Workspace and custom pages

The Phase 12 direction keeps the application shell fixed and makes only the internal canvas composable:

```text
fixed authentication and application shell
collapsible permission-filtered sidebar
plugin-defined navigation and static routes
fixed K-Nex settings/access/extensions/themes/operations
one fixed /workspace/pages/:pageId custom-page route
Puck authoring over canonical workspace UiDocuments
built-in and registered plugin block/component library
server-authoritative page ACL plus underlying source/action permission
published Theme Profile with optional exact page override
```

Database/browser content never creates a Next route, import, React implementation, JavaScript, SQL, CSS program, or policy. Puck remains an editor adapter; production rendering uses the canonical K-Nex UI runtime.

## Plugin Manager outcome

The Plugin Manager exposes one product experience while preserving the real delivery path:

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

## Strategic boundaries

- Payload is the strategic V1 application framework; PostgreSQL is the V1 primary database.
- `module.sales` remains the sole first-party domain through Phase 12 and becomes the CRM product in Phase 13.
- Platform Plugin composition stays static, exact, reconciled, and frozen.
- Hot Application code runs outside the host process and behind capability contracts.
- Server authorization is authoritative; UI visibility, sidebar placement, and role labels are not authority.
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
- [Post-Gate-11 product roadmap](./docs/implementation/post-gate-11-product-roadmap.md)
- [Phase 12 runnable workspace plan](./docs/implementation/phase-12-runnable-workspace-and-dashboard-builder.md)
- [Phase 13 CRM-first plan](./docs/implementation/phase-13-crm-first-productization.md)
- [Master plan through Gate 11](./docs/implementation/codex-master-plan.md)
- [Executable gates](./docs/30-executable-poc-gates.md)
- [Decision register](./docs/21-decision-register.md)

## Readiness boundary

This repository contains a deeply exercised platform core, but it is not yet a finished CRM/CMS product or a production-observed customer fleet. Gate 12 must prove a generated runnable product shell; Gate 13 must prove one coherent CRM workflow and pilot-readiness evidence.

## License

No license has been selected. Until one is added, treat the repository and contents as proprietary.
