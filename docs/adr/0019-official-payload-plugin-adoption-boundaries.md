# ADR-0019: Official Payload Plugins Are Bounded Implementation Adapters

- Status: accepted
- Date: 2026-08-26
- Decision owners: K-Nex platform maintainers
- Evidence: design-only
- Related: [Payload plugin adoption plan](../32-payload-official-plugin-adoption-plan.md), [Payload strategic framework](./0016-payload-strategic-v1-framework.md), [Agent tools](./0018-agent-tool-contracts-and-safe-execution.md)

## Context

Payload maintains official plugins for common concerns including MCP, forms, content hierarchy, redirects, search, observability, SEO, payments, import/export, multi-tenancy, and e-commerce.

Reimplementing mature generic functionality increases K-Nex delivery and maintenance cost. Adopting a plugin without boundaries can create the opposite problem: Payload plugin types, collections, routes, lifecycle, and domain assumptions may become accidental K-Nex public contracts.

K-Nex needs a consistent rule for reusing official plugins while preserving its own contracts, security model, customer-isolation model, and independently falsifiable gates.

## Decision

1. K-Nex prefers an official Payload plugin when it materially reduces complexity and passes the relevant executable gate.
2. An official plugin is an implementation adapter. It does not own persisted/public K-Nex contracts, plugin identity, source/action semantics, authorization, lifecycle, or product boundaries.
3. Every adopted package is exact-pinned to the tested Payload tuple and enters the resolved graph, contribution inventory, customer migration, lockfile, SBOM, and runtime inventory.
4. Third-party types, private schema, handler signatures, protocol SDK types, and collection internals remain behind K-Nex/Payload adapter packages.
5. Automatic broad exposure is disabled by default. Collections, globals, endpoints, search projections, imports/exports, MCP tools, and payment operations require explicit allowlists and K-Nex policy.
6. Adoption is gate-scoped:
   - `@payloadcms/plugin-mcp` is the first Phase 2A MCP adapter candidate;
   - SEO, Nested Docs, and Redirects are preferred Phase 5 CMS candidates;
   - Form Builder and Search are conditional Phase 5 candidates;
   - Import/Export is a preferred Phase 6 accelerator;
   - Sentry is an optional Phase 7 deployment adapter;
   - Multi-Tenant is not a V1 customer-isolation mechanism;
   - Stripe and Ecommerce are deferred vertical accelerators.
7. A failed candidate is removed before v1.0 rather than preserved through a compatibility shim. The K-Nex contract remains and may use a smaller implementation.
8. No official plugin becomes a baseline dependency until its assigned gate records executable evidence and an explicit adoption decision.

## Consequences

- K-Nex can reuse Payload-maintained solutions without duplicating generic CMS/operations infrastructure.
- Customer repositories retain exact versions, migrations, and upgrade control.
- Gate plans must test contributed collections, routes, jobs, admin components, access behavior, lifecycle, and bundle boundaries.
- Some plugins remain intentionally deferred even when feature-rich because their domain or tenancy model does not fit the platform foundation.
- The adapter may expose only a strict subset of a plugin's capabilities.

## Alternatives considered

### Reimplement all generic functionality

Rejected because it creates avoidable maintenance, security, accessibility, admin-UI, and compatibility work.

### Make Payload official plugin schemas the K-Nex contract

Rejected because K-Nex would become coupled to package-private data shapes and upgrade decisions.

### Install the complete official plugin catalog by default

Rejected because it enlarges schema, attack surface, migration load, runtime cost, and support obligations without customer need.

### Use the Multi-Tenant plugin for customer isolation

Rejected for V1. K-Nex customers remain physically independent repositories, databases, secrets, deployments, and release cadences.

## Validation

The assigned phase must record the exact package version, compatible Payload tuple, contribution inventory, security/failure tests, migration/lifecycle impact, performance where relevant, known limitations, and adoption/rejection decision.

ADR evidence remains `design-only` until the complete policy is exercised by the planned gate candidates. Individual plugin acceptance may be recorded in its phase result without promoting unrelated candidates.