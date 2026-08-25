# ADR-0002: Package Composition Instead of Copied or Forked Core Source

- Status: accepted
- Date: 2026-08-25
- Decision owners: K-Nex platform maintainers
- Related: [System architecture](../02-system-architecture.md), [Customer applications](../06-customer-applications.md), [Plugin lifecycle](../19-plugin-lifecycle-and-package-management.md)

## Context

Each customer needs a distinct product shell and may need customer-specific extensions. A literal fork of the full platform core for every customer initially appears flexible, but long-lived source divergence makes shared fixes, framework upgrades, security patches, and reusable feature extraction progressively expensive.

Customer branches inside one repository create similar problems while also coupling access, CI/CD, releases, secrets, and issue history.

## Decision

Generate a separate customer application repository from a starter/CLI, but keep shared core and plugins as exact versioned package dependencies.

```text
shared packages
  @k-nex/core
  @k-nex/module-*
  @k-nex/provider-*
  @k-nex/builder-*
  @k-nex/theme-*

customer repository
  k-nex.app.json
  k-nex.config.ts
  customer components/theme assets
  customer extensions
  generated registries
  final migrations
  infrastructure
```

The customer repository is the composition root and can contain genuine custom code. It must not contain an editable copy of shared core source or patch files inside installed packages as the normal customization strategy.

Separate private repositories are preferred over long-lived customer branches.

## Consequences

### Positive

- Shared bug/security fixes are released once as package versions.
- Customer upgrades become explicit dependency pull requests rather than source merges.
- Exact versions and compatibility can be inventoried.
- Customer-specific behavior remains visible and auditable.
- Core/module source ownership stays clear.
- Customers can have different package versions and release schedules.

### Costs

- Public package contracts and semantic versioning require discipline.
- Package registry/authentication/release tooling must be maintained.
- Customer extensions need documented extension points rather than unrestricted source edits.
- A breaking framework change can require coordinated releases across several packages.

### Escape hatch

When a customer truly needs behavior that current contracts cannot express:

1. implement a local extension or documented override in the customer repository;
2. add a stable extension point to the shared package when justified;
3. promote behavior into a reusable module/integration after repeated need;
4. avoid permanent package patching or copied source.

Emergency temporary patches must be tracked with an issue, removal plan, and clear inventory; they are not the standard architecture.

## Alternatives considered

### Fork platform core for each customer

Rejected because upstream fixes become repeated merge/conflict work and customer variants stop being comparable.

### Customer branch per product

Rejected because dependency versions, access, secrets, CI/CD, tags, issues, and deployments become entangled in one repository.

### One shared customer shell repository with runtime config only

Rejected as the universal model because customer applications can require real code, UI, mobile apps, integration adapters, and infrastructure differences.

## Validation or revisit trigger

Revisit package boundaries—not the reuse principle—if registry friction or coordinated release overhead becomes excessive. Possible changes include a larger first-party monorepo or bundled release train, while customer repositories still consume versioned artifacts rather than copied core source.
