# K-Nex Platform Core

K-Nex is a modular application platform for repeatedly delivering independently deployed, customer-specific CMS, CRM, operations, and vertical business products.

It combines:

```text
versioned platform contracts
+ versioned plugins
+ a manifest-driven CLI
+ style-agnostic module UI
+ visual CMS/workspace composition
+ installed theme packages and runtime theme profiles
+ customer-owned code, migrations, and infrastructure
= an independently deployable customer product
```

K-Nex is **not** initially designed as a shared multi-tenant SaaS. Every customer application has its own repository, database, storage boundary, secrets, deployment, migration history, visual language, and release cadence.

## Core product model

Shared code is delivered as trusted, exact-version packages:

```text
@k-nex/core
@k-nex/module-*
@k-nex/provider-*
@k-nex/builder-*
@k-nex/theme-*
@k-nex/integration-*
```

A customer repository is generated and maintained through:

```text
create-k-nex-app
k-nex.app.json
k-nex.config.ts
k-nex CLI
```

The customer repository owns final composition, brand assets, customer extensions, generated registries, database migrations, tests, deployment, and infrastructure.

## Plugin model

**Plugin** is the umbrella installable concept:

| Kind | Examples |
|---|---|
| Module | CMS, CRM, dispatch, driver, inventory, budgeting |
| Provider | Postgres, WebSocket, Redis-backed realtime, S3, email |
| Builder | Puck adapter |
| Theme | Minimal, Neobrutalism, Glassmorphism |
| Integration | CRM–logistics, inventory–budgeting, ERP connectors |
| Preset | Logistics, restaurant, corporate CMS+CRM recipes |

Dependencies can target stable plugin IDs or replaceable versioned capabilities such as `realtime.gateway`, `storage.objects`, and `builder.engine`.

## UI and builder model

Enabled modules can contribute:

```text
navigation
fixed operational screens
composable blocks
data sources
actions
realtime bindings
extension slots
```

Module UI is style-agnostic. Customer appearance is provided through semantic design-system contracts, installed theme packages, runtime theme profiles, and deliberate customer overrides.

The application shell remains fixed and permission-aware. Its navigation is generated from enabled modules. The editable canvas supports two initial profiles using one canonical K-Nex document model:

- **CMS profile:** public content pages, SEO/localization, draft/preview/publish, public-safe blocks;
- **Workspace profile:** dashboards, module overviews, reports, role/user layouts, authenticated data/actions, realtime blocks.

Puck is the provisional first editor engine behind `@k-nex/builder-puck`. Domain modules do not depend on Puck types.

## Theme model

A theme has two layers:

```text
theme package
  code, token schema, palettes, semantic primitives, variants, validation, migrations

theme profile
  selected installed theme, adjustable validated tokens, revisions, publication state
```

Installing a new theme requires a package/build/deploy change. Switching among installed themes or adjusting palette/token values can happen at runtime from the customer database after validation and publication.

Admin and public themes are separate.

## Architectural principles

1. **Core is small, stable, and domain-neutral.** It owns contracts, resolution, registries, cross-cutting infrastructure, and framework composition—not CRM, logistics, customer branding, or vertical policy.
2. **Plugins are versioned packages.** Their manifests declare compatibility, capabilities, dependencies, surfaces, data ownership, and lifecycle semantics.
3. **Customer applications are separate repositories.** Generate the shell; do not copy or patch core source.
4. **Every customer is independently deployable.** Database, storage, secrets, migrations, backups, and release cadence are isolated.
5. **Composition is declarative and reviewable.** `k-nex.app.json`, exact package versions, generated registries, and customer migrations define the product.
6. **The CLI plans before it mutates.** Add/remove/upgrade/provider/theme operations produce explicit package, infrastructure, data, and UI impact.
7. **Runtime data never chooses arbitrary executable packages.** Plugin and theme imports are generated statically.
8. **UI hiding is not authorization.** Server data sources, actions, commands, and realtime subscriptions enforce permission and record policy.
9. **Builder/theme input is structured and validated.** No arbitrary JavaScript, SQL, package imports, secrets, or unrestricted CSS.
10. **Customer-specific logic begins locally.** Promote it to a reusable module/integration after repeated need proves the abstraction.
11. **Disable, uninstall, and purge are different operations.** Package removal never implies automatic data deletion.
12. **Customer repositories own final migrations.** Plugins provide schema intent and helpers; the final composition owns production evolution.

## Initial technical direction

Current implementation hypotheses:

```text
TypeScript
pnpm workspaces
Next.js + Payload
Postgres
Puck behind a K-Nex builder adapter
private package registry
Docker-compatible customer releases
```

Payload and Puck remain provisional until the proof of concept passes the acceptance and rejection criteria documented under [`docs/`](./docs/README.md).

## Documentation

Start with the [documentation index](./docs/README.md).

The most important current documents are:

- [Product vision](./docs/01-product-vision.md)
- [System architecture](./docs/02-system-architecture.md)
- [Plugin taxonomy and capabilities](./docs/13-plugin-taxonomy-and-capabilities.md)
- [Application manifest](./docs/14-application-manifest.md)
- [CLI and project generation](./docs/15-cli-and-project-generation.md)
- [UI composition runtime](./docs/16-ui-composition-runtime.md)
- [Builder engine and profiles](./docs/17-builder-engine-and-profiles.md)
- [Theme and design system](./docs/18-theme-and-design-system.md)
- [Decision register](./docs/21-decision-register.md)
- [Architecture Decision Records](./docs/adr/README.md)

## Repository status

This repository currently contains architecture, research, and decision documentation. Implementation should begin only after the Phase 0 decisions in the decision register are resolved and the repository/package topology is selected.

## Working package names

Examples use the conceptual package scope `@k-nex/*`. The final package scope depends on registry ownership and is still an open decision. The architecture uses stable plugin IDs so package location can change without changing persisted product identity.

## License

No license has been selected. Until one is added, the repository and its contents should be treated as proprietary.
