# K-Nex Platform Core

K-Nex is a modular backend platform for building independently deployed, customer-specific CMS, CRM, and vertical business applications.

The platform is **not** designed as a shared multi-tenant SaaS. Each customer application is composed, styled, deployed, migrated, and operated independently. Shared behavior is delivered through versioned packages; customer repositories own presentation, module selection, and customer-specific extensions.

## Core idea

```text
versioned core + versioned modules + customer application shell
                         = independently deployed customer product
```

The core remains style-free and domain-neutral. CMS, CRM, WebSocket, page builder, logistics, restaurant, inventory, dispatch, and similar capabilities are separate modules.

## Repository status

This repository currently contains the architecture and research documentation for the platform core. Implementation will follow the contracts and decisions recorded under [`docs/`](./docs/README.md).

## Architectural principles

1. **Core is small and boring.** It owns contracts, module loading, permissions, events, jobs, audit, and shared backend infrastructure—not customer design or vertical business logic.
2. **Modules are packages.** Capabilities such as CMS, CRM, WebSocket, dispatch, live tracking, QR menu, and inventory are versioned independently.
3. **Customer applications are separate repositories.** They import exact package versions and own CSS, frontend composition, branding, infrastructure, and local extensions.
4. **Every customer is independently deployable.** Database, storage, secrets, migrations, backups, and release cadence are isolated.
5. **Dependencies are explicit.** A driver module can require WebSocket and logistics-core modules; invalid combinations fail before build or deployment.
6. **No customer conditionals in shared packages.** Customer-only behavior lives in the customer repository until it proves reusable.

## Documentation

Start with the [documentation index](./docs/README.md).

## Working package names

Examples use the conceptual package scope `@k-nex/*`. The final npm or GitHub Packages scope can be changed without altering the architecture.

## License

No license has been selected yet. Until one is added, the repository should be treated as proprietary.