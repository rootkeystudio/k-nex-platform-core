# ADR-0001: Independently Deployed Customer Applications

- Status: accepted
- Date: 2026-08-25
- Decision owners: K-Nex platform maintainers
- Related: [Product vision](../01-product-vision.md), [Customer applications](../06-customer-applications.md), [Deployment and operations](../11-deployment-and-operations.md)

## Context

K-Nex is intended to support a service/product-line delivery model. A logistics company may receive CMS, CRM, dispatch, driver, and tracking capabilities; a restaurant may receive CMS, QR menu, inventory, and budgeting. Each customer can require different branding, routes, integrations, infrastructure, release schedules, and custom extensions.

The initial product does not need one centrally operated multi-tenant SaaS runtime. Building one would introduce tenant-aware schema/access rules, centralized provisioning, cross-tenant operational controls, shared upgrade coordination, and a larger data-isolation risk surface before those capabilities create business value.

## Decision

Every customer product is an independently deployed application with its own:

```text
private repository
database
object storage boundary
secret set
domain/TLS configuration
application and worker processes
optional Redis/realtime infrastructure
migration history
backups and restore process
release cadence
```

Shared behavior is distributed through versioned K-Nex packages and reusable CI/CD workflows. Operational fleet inventory can exist outside runtime applications, but it does not create shared tenancy.

## Consequences

### Positive

- Data backup, restore, export, deletion, and customer offboarding are naturally scoped.
- Customer-specific code and infrastructure do not affect other customers.
- One customer can remain on an older compatible package set while another upgrades.
- High-volume customers can receive dedicated scaling/storage providers.
- Cross-customer runtime data leakage risk is reduced.
- Customer repository access and transfer can be managed independently.

### Costs

- More deployments, databases, secrets, and backups must be operated.
- Shared security fixes require fleet inventory and coordinated per-customer upgrade work.
- Runtime configuration cannot be centrally changed unless a separate operations tool is built later.
- Per-customer infrastructure can cost more than a highly consolidated SaaS system.

### Required practices

- immutable customer release inventory;
- reusable deployment workflows;
- automated upgrade pull requests where useful;
- customer-labeled monitoring and backup checks;
- a private fleet inventory identifying package versions and migration state.

## Alternatives considered

### Shared multi-tenant application and database

Rejected for the initial architecture because it does not match the intended delivery model and introduces significant tenancy/control-plane complexity.

### Shared runtime with database per customer

Not selected initially. It may become an optimization later, but would still centralize release cadence and runtime failure domains that K-Nex currently intends to keep separate.

### Dedicated schema per customer in one database cluster

Not selected as the product model. A hosting provider may place separate databases on one managed cluster, but the application treats each customer database as an independent ownership boundary.

## Validation or revisit trigger

Revisit if the business shifts toward self-service onboarding of many small customers, centralized billing/entitlements, instant provisioning, or operational scale where per-customer applications are demonstrably unsustainable.

A future SaaS/control-plane product can use the same packages, manifests, and CLI contracts; it must not retroactively weaken current customer isolation without a separate ADR.
