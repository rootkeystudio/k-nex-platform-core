# ADR-0019: Official Payload Plugins Are Bounded Implementation Adapters

- Status: accepted
- Date: 2026-08-26
- Updated: 2026-08-27
- Decision owners: K-Nex platform maintainers
- Evidence: design-only
- Related: [Payload plugin adoption plan](../32-payload-official-plugin-adoption-plan.md), [Payload strategic framework](./0016-payload-strategic-v1-framework.md), [Agent tools](./0018-agent-tool-contracts-and-safe-execution.md), [Reference Sales/component system](./0020-reference-sales-and-headless-component-system.md)

## Context

Payload maintains official plugins for MCP, forms, content hierarchy, redirects, search, observability, SEO, payments, import/export, multi-tenancy, and ecommerce.

Reimplementing mature generic functionality increases K-Nex delivery and maintenance cost. Adopting a plugin without boundaries creates the opposite risk: Payload plugin types, collections, routes, lifecycle, and domain assumptions can become accidental K-Nex public contracts.

The platform-foundation roadmap now freezes domain expansion around `module.sales`, so official plugins that imply new product modules must not bypass the Gate 6–8 focus.

## Decision

1. K-Nex prefers an official Payload plugin when it materially reduces complexity and passes the relevant executable gate.
2. An official plugin is an implementation adapter. It does not own persisted/public K-Nex contracts, plugin identity, source/action semantics, authorization, lifecycle, or product boundaries.
3. Every adopted package is exact-pinned to the tested Payload tuple and enters the resolved graph, contribution inventory, customer migration, lockfile, SBOM, and runtime inventory.
4. Third-party types, private schema, handler signatures, protocol SDK types, and collection internals remain behind K-Nex/Payload adapter packages.
5. Automatic broad exposure is disabled by default. Collections, globals, endpoints, search projections, imports/exports, MCP tools, and payment operations require explicit allowlists and K-Nex policy.
6. Current gate-scoped disposition:
   - `@payloadcms/plugin-mcp@3.88.0` is adopted only for the bounded Phase 2A transport/API-key/admin subset proven by Gate 2A;
   - SEO, Nested Docs, Redirects, Form Builder, and Search were reviewed in Phase 5 and deferred to post-Gate 8 product plans;
   - Import/Export is the preferred Gate 8 transfer/archive candidate;
   - Sentry is an optional Gate 8 deployment-observability candidate;
   - Multi-Tenant is not a customer-isolation mechanism and may be evaluated only for an explicit post-Gate 8 intra-customer requirement;
   - Stripe and Ecommerce are post-Gate 8 vertical accelerators.
7. No official plugin may be introduced in Gate 6 or Gate 7 merely to expand product breadth. Those gates are reserved for the plugin/Sales conformance contract and the platform component system.
8. A failed candidate is removed before v1.0 rather than preserved through a compatibility shim. The K-Nex contract remains and may use a smaller implementation.
9. No official plugin becomes a baseline dependency beyond the exact subset recorded by executable evidence.

## Consequences

- K-Nex can reuse Payload-maintained solutions without duplicating generic infrastructure.
- Customer repositories retain exact versions, migrations, and upgrade control.
- Gate plans test contributed collections, routes, jobs, admin components, access behavior, lifecycle, and bundle boundaries.
- Feature-rich plugins may remain deferred when they would introduce premature product modules or incompatible domain assumptions.
- The adapter may expose only a strict subset of the plugin.
- Gate 2A evidence for MCP does not promote unrelated plugin candidates.

## Alternatives considered

### Reimplement all generic functionality

Rejected because it creates avoidable maintenance, security, accessibility, admin-UI, and compatibility work.

### Make Payload official plugin schemas the K-Nex contract

Rejected because K-Nex would become coupled to package-private data shapes and upgrade decisions.

### Install the complete official plugin catalog by default

Rejected because it enlarges schema, attack surface, migration load, runtime cost, and support obligations without customer need.

### Use official CMS plugins to broaden Phase 5/6 scope

Rejected. Phase 5 proved the canonical publication/theme/runtime boundary; Gate 6 now hardens the plugin system through Sales rather than opening new product surfaces.

### Use the Multi-Tenant plugin for customer isolation

Rejected. K-Nex customers remain physically independent repositories, databases, secrets, deployments, and release cadences.

## Validation

The assigned gate records:

```text
exact package version and compatible Payload tuple
contribution inventory
security/failure/bundle tests
migration/lifecycle impact
performance where relevant
known limitations
fallback/removal path
explicit adoption or rejection
```

ADR evidence remains `design-only` until the complete cross-plugin policy is exercised. Individual candidate acceptance is recorded in its gate result without promoting unrelated candidates.