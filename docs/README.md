# K-Nex Architecture Documentation

This directory records the current architecture hypothesis for K-Nex. It is intentionally implementation-oriented: each document should eventually map to code, package contracts, tests, or an Architecture Decision Record.

## Reading order

1. [Product vision and boundaries](./01-product-vision.md)
2. [System architecture](./02-system-architecture.md)
3. [Platform core](./03-platform-core.md)
4. [Module system](./04-module-system.md)
5. [WebSocket and realtime module](./05-websocket-and-realtime.md)
6. [Customer applications](./06-customer-applications.md)
7. [CMS and page builder](./07-cms-and-page-builder.md)
8. [Domain blueprints](./08-domain-blueprints.md)
9. [Permissions, events, and jobs](./09-permissions-events-and-jobs.md)
10. [Data, migrations, and versioning](./10-data-migrations-and-versioning.md)
11. [Deployment and operations](./11-deployment-and-operations.md)
12. [Research plan and POC](./12-research-plan-and-poc.md)
13. [External references](./references.md)

## Decision summary

| Area | Current decision |
|---|---|
| Product model | Independently deployed customer products, not shared multi-tenant SaaS |
| Shared code | Versioned core and module packages |
| Customer customization | Separate customer application repository |
| Styling | Customer repository only; core is style-free |
| Backend foundation | Payload is the leading implementation candidate |
| Module distribution | Private npm/GitHub Packages with explicit versions |
| Dependency handling | Required, optional, and conflicting module declarations validated before build |
| Realtime | Dedicated WebSocket module; domain modules depend on its contract |
| Data isolation | Separate database, storage, secrets, migrations, and backups per customer |
| Customer-specific behavior | Local extension first; promote to reusable module when repeated |

## Documentation conventions

The package scope `@k-nex/*` is conceptual. It can later become an organization-specific npm or GitHub Packages scope.

The words **module** and **plugin** are related but not identical:

- A **K-Nex module** is a product capability with metadata, dependencies, permissions, events, migrations, and backend registration.
- A module may internally expose a **Payload plugin** to extend the final Payload configuration.

The architecture documents describe intended contracts. Code examples are drafts until covered by integration tests.