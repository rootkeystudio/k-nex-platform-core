# Architecture Decision Register

Decision status and evidence maturity are separate. See [ADR index](./adr/README.md) and machine-readable [evidence registry](./adr/evidence-registry.json).

## Accepted product decisions

### D-001 — Independent customer applications

Separate repository, Payload/Postgres database, storage, secrets, deployment, migrations, and release cadence per customer.

### D-002 — Package composition, not copied core

Generated customer shell consumes exact shared packages and owns only customer composition/extensions/assets/migrations/infrastructure.

### D-003 — Separate customer repositories

No long-lived customer branches of one core repository.

### D-004 — Payload is strategic V1 framework

Payload is not treated as a casually replaceable provider. The executable gates validate sustainable K-Nex composition on Payload.

### D-005 — Plugin taxonomy

Module, provider, builder, theme, integration, preset. Payload database adapter is framework configuration.

### D-006 — Capability dependencies only where substitution matters

Direct domain dependency remains direct; realtime/storage/email/builder implementations can use capabilities.

### D-007 — Build-time executable composition; runtime validated settings

Runtime panel cannot install packages or change schema/import graph.

### D-008 — Manifest plus hermetic customer config

`k-nex.app.json` is desired graph; `k-nex.config.ts` is static source-controlled registration/fingerprint input within its proven boundary.

### D-009 — CLI application compiler

Plan/apply, exact package resolution, deterministic graph/registries, migration/reference/topology diagnostics.

### D-010 — Deterministic generated graph committed

No timestamps/paths/host/random/secrets; provenance and deployment metadata are separate signed evidence.

### D-043 — Sales is the sole pre-v1 reference domain plugin

Until Gate 8 passes, `module.sales` is the only first-party domain module used to shape and prove plugin contracts. Logistics, restaurant, inventory, budgeting, driver, dispatch, live-tracking, QR-menu, and similar modules are deferred product work.

### D-044 — Platform gaps are solved through Sales before domain expansion

A supported plugin contribution category is accepted only when Sales exercises it and the common conformance suite proves it. A second module may not be introduced merely to discover another missing platform abstraction.

## Accepted contract decisions

### D-011 — Canonical hierarchical IDs

Dot-separated namespaces, optional hyphen inside one semantic segment, package location independent.

### D-012 — One plugin manifest schema and fixture system

Machine-readable schema/fixtures are normative over copied prose snippets.

### D-013 — Canonical registration phases

```text
manifest → contracts → providers → schema → behavior → jobs
→ data-handlers → ui → admin → validate → freeze
```

### D-014 — Formal deterministic resolver

Explicit single provider, no optional auto-install, exact prerelease request, golden corpus, canonical resolved graph.

### D-015 — Declared-versus-actual inventory and scoped services

Undeclared contribution/capability access fails; no ambient plugin service locator.

### D-016 — ADR status and evidence separate

Accepted can remain design-only; executable/production proof requires linked evidence.

### D-045 — Complete plugin contribution taxonomy and conformance

Settings, sources, actions, tools, events, jobs, realtime topics, components, blocks, routes, navigation, default pages, localization, lifecycle, and testing metadata are explicit contribution categories. Sales and one plugin conformance command define the reference implementation.

## Accepted data/runtime decisions

### D-017 — Plugin-owned bounded data sources

No automatic collection exposure or builder-authored query language.

### D-018 — Standard authenticated source gateway pipeline

Independent auth, authorization, budget, dispatch, validation, redaction, cache, observability stages.

### D-019 — Hybrid output contracts and one primary projection

Canonical Metric/Table/Category/Time contracts plus namespaced plugin contracts; exact source schema conforms.

### D-020 — Stable opaque table field IDs

Internal Payload paths are not persisted builder contracts.

### D-021 — Required versus optional fields

Missing required authority is explicit; no silently incomplete authoritative component.

### D-022 — Safe cache classes

`no-store`, `actor`, `authorization-context`, explicit `public`; role name is not a cache boundary.

### D-023 — Event durability classes

Durable integration/workflow requires transactional outbox. Reconstructible invalidation requires convergence.

### D-024 — Realtime capability and topology validation

`provider.realtime.socketio` is the first accepted provider. Current memory mode is one socket-owning web process with compatible deployment/relay constraints.

### D-025 — Payload Postgres scaffold

Postgres only in V1; customer owns final migrations.

### D-041 — Explicit agent tools and safe execution gateway

Plugins may explicitly expose selected registered sources/actions as typed agent tools. Discovery is actor/delegation-filtered, every invocation is reauthorized, writes require declared approval/idempotency, and runtime content cannot create tools. MCP is an interoperability adapter and cannot weaken K-Nex policy or become a persisted core contract.

### D-042 — Official Payload plugins are bounded adapters

Prefer official Payload plugins when they materially reduce implementation and maintenance work, but keep their types, schema, routes, domain assumptions, and lifecycle behind K-Nex/Payload adapters. Adoption is exact-pinned and gate-specific; no official plugin becomes a baseline dependency before executable evidence. `@payloadcms/plugin-mcp` is the accepted bounded MCP transport candidate; unrelated official plugin decisions remain gate-scoped.

## Accepted UI decisions

### D-026 — Fixed shell, composable canvas

Authentication/router/system/security remain fixed; CMS/dashboard/overview/report surfaces compose.

### D-027 — One canonical document, separate profiles

CMS and workspace share document architecture but not authority policy.

### D-028 — Separate public/workspace authority IDs

Static renderers can be shared; privileged and public source/action/block IDs are distinct.

### D-029 — Puck behind a narrow adapter

Engine adapter, document runtime, and Payload repository are separate. Puck does not own persisted documents or runtime rendering.

### D-030 — Theme package plus runtime profile

Installed code package and validated database publication are separate; admin/public profiles independent.

### D-031 — Small stable theme primitive ABI

The theme ABI stays small. Complex DataTable/DataGrid, dates, tree, rich text, command, virtualization, map, chart, and advanced layout behavior is implemented by versioned platform adapters and styled through tokens/slots/recipes.

### D-032 — WCAG 2.2 AA target

Evidence requires automated and manual keyboard/focus/drag/target/motion/high-contrast/screen-reader gates.

### D-046 — Comprehensive platform-owned headless component system

K-Nex owns style-agnostic accessible components, data/form/page utilities, and Puck bridges. The Component Gallery list is the minimum coverage inventory, not an external API contract. Plugins use K-Nex components rather than third-party behavior engines where coverage exists.

### D-047 — Standard plugin query/action and default-page composition

Plugin browser UI uses platform-owned source-query/action-mutation factories and canonical result states. Default pages are immutable versioned templates instantiated idempotently into customer-owned documents; upgrades never overwrite customer edits.

## Accepted lifecycle/operations decisions

### D-033 — Schema-owning V1 lifecycle is disable/re-enable or purge

Retained-schema package uninstall is not a generic V1 promise; archive/export is explicit project work.

### D-034 — Migration advisory lock and revision fence

Customer migration job obtains Postgres advisory lock, verifies predecessor, records revision; stale artifact fails readiness.

### D-035 — Verifiable release/fleet evidence

SBOM, lock/resolved graph/artifact digests, signed provenance, deployment receipt, runtime inventory.

### D-036 — Full-SHA workflows and explicit secrets

No mutable workflow reference or blanket inherited secrets; OIDC preferred.

### D-037 — RFC 9457 external API errors

Safe problem details with stable K-Nex code/correlation extensions.

### D-038 — Central gateway abuse budgets

Depth/fields/page/points/bytes/time/concurrency/rate/cost bounded.

### D-039 — Security control mapping

NIST SSDF, OWASP ASVS/API Security and K-Nex test IDs map requirements to evidence.

### D-040 — Independent falsifiable gates through platform foundation

Contract, composition, source, agent-tool, realtime, builder, UI/publication, plugin-authoring, component-system, and application-factory/lifecycle proofs are separated.

### D-048 — Two Sales-only customers prove reuse before vertical breadth

The fleet/application-factory gate uses two independent customers with the same platform and Sales packages but different themes, settings, permissions, layouts, lockfiles, and release cadence. Cargo and Restaurant are not foundation fixtures.

## Provisional implementation choices

- Exact Payload/Next/React/Node/pnpm compatibility tuple remains pinned per gate.
- React Aria Components remains the preferred common interaction/accessibility foundation behind K-Nex components.
- TanStack Table is the preferred DataTable/DataGrid state-engine candidate.
- TanStack Virtual is the preferred large-list/table virtualization candidate.
- TanStack Form and React Hook Form are bounded candidates for the Sales form spike; only one is adopted if it reduces complexity.
- Lexical is the preferred rich-text adapter candidate and must remain behind a versioned K-Nex contract.
- Official Payload Import/Export is evaluated in Gate 8 as a bounded transfer/archive adapter, not as backup or migration.
- Payload Sentry is an optional deployment adapter while Pino/OpenTelemetry remain platform contracts.
- Stripe and Ecommerce remain deferred explicit vertical accelerators.
- Layout assignment/snapshot and constrained user patch representation remain the accepted workspace direction.

## Open product decisions

- final first-party monorepo/package split after Gate 6 authoring freeze;
- final private package scope/registry;
- external distribution/license model;
- first production deployment platform;
- exact form engine after the Sales create/edit spike;
- rich-text persisted-state and sanitization contract;
- AI model-provider and conversation-retention policy;
- whether any customer needs intra-customer tenant segmentation after Gate 8;
- which real domain module follows the platform-foundation program;
- whether any schema-owning compatibility package is worth supporting after V1.

## Deferred product backlog

```text
full CRM breadth
CMS hierarchy/search/forms/redirect productization
logistics, dispatch, driver, live tracking
restaurant, QR menu, inventory, budgeting
AI assistant productization
commerce/payments
third-party plugin marketplace
```

## Rejected approaches

- initial shared tenant runtime/database;
- Payload Multi-Tenant as customer-level isolation;
- customer branches or copied core;
- K-Nex ORM/database provider above Payload;
- installing the complete Payload official plugin catalog by default;
- Payload/plugin/library private types as persisted K-Nex contracts;
- automatic raw collection exposure;
- automatic exposure of all sources/actions/collections as AI tools;
- direct model access to Payload, plugin services, or ambient service containers;
- arbitrary builder JavaScript/SQL/query/CSS/imports;
- WebSocket as sole business truth;
- permanent ID aliases instead of migration;
- ambient plugin service locator;
- generic schema-owning retained-data uninstall promise;
- timestamps inside committed deterministic graph;
- manual fleet YAML as deployed truth;
- parallel first-party domain modules before the Sales reference/conformance gate;
- making every theme reimplement the entire component catalog;
- allowing each plugin to create its own fetch/cache/table/form infrastructure where K-Nex provides one;
- using Cargo and Restaurant modules merely to prove customer composition.