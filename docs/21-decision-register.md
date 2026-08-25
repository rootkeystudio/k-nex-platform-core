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

Payload is not treated as a casually replaceable provider. POC validates sustainable K-Nex composition on Payload.

### D-005 — Plugin taxonomy

Module, provider, builder, theme, integration, preset. Payload database adapter is framework configuration.

### D-006 — Capability dependencies only where substitution matters

Direct domain dependency remains direct; realtime/storage/email/builder implementations can use capabilities.

### D-007 — Build-time executable composition; runtime validated settings

Runtime panel cannot install packages or change schema/import graph.

### D-008 — Manifest plus hermetic customer config

`k-nex.app.json` desired graph; `k-nex.config.ts` static source-controlled registrations and fingerprint.

### D-009 — CLI application compiler

Plan/apply, exact package resolution, deterministic graph/registries, migration/reference/topology diagnostics.

### D-010 — Deterministic generated graph committed

No timestamps/paths/host/random/secrets; provenance and deployment metadata are separate signed evidence.

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

`provider.realtime.socketio` is the first candidate. Memory mode is single compatible process; split topology uses backplane/relay.

### D-025 — Payload Postgres scaffold

Postgres only in V1; customer owns final migrations.

### D-041 — Explicit agent tools and safe execution gateway

Plugins may explicitly expose selected registered sources/actions as typed agent tools. Discovery is actor/delegation-filtered, every invocation is reauthorized, writes require declared approval/idempotency, and runtime content cannot create tools. MCP is an interoperability adapter and cannot weaken K-Nex policy or become a persisted core contract.

## Accepted UI decisions

### D-026 — Fixed shell, composable canvas

Authentication/router/system/security remain fixed; CMS/dashboard/overview/report surfaces compose.

### D-027 — One canonical document, separate profiles

CMS and workspace share document architecture but not authority policy.

### D-028 — Separate public/workspace authority IDs

Static renderers can be shared; privileged and public source/action/block IDs are distinct.

### D-029 — Puck first engine candidate behind narrow adapter

Engine adapter, document runtime, and Payload repository are separate.

### D-030 — Theme package plus runtime profile

Installed code package and validated database publication are separate; admin/public profiles independent.

### D-031 — Small V1 primitive ABI

Complex DataGrid/date/map/chart/command/drag-grid behavior is separate versioned adapter capability.

### D-032 — WCAG 2.2 AA target

Evidence requires automated and manual keyboard/focus/drag/target/motion/high-contrast/screen-reader gates.

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

### D-040 — Independent falsifiable POC gates

Contract, composition, source, agent-tool, realtime, builder, UI, lifecycle, and second-customer proofs are separated.

## Provisional implementation choices

- Exact Payload/Next/React/Node/pnpm compatibility tuple.
- MCP TypeScript SDK and transport choice after Gate 2A documentation/types/license review.
- Puck acceptance after Gate 4.
- Socket.IO memory/Redis adapters after Gate 3.
- React Aria/TanStack/ECharts/Zustand implementations after their boundary/accessibility/performance gates.
- Layout assignment/snapshot and user patch representation after Gate 5.

## Open product decisions

- first-party monorepo split after contract stabilization;
- final private package scope/registry;
- external distribution/license model;
- first production deployment platform;
- AI model-provider and conversation-retention policy after Gate 2A;
- driver PWA versus native client;
- high-frequency tracking storage after workload model;
- whether any schema-owning compatibility package is worth supporting after V1.

## Rejected approaches

- initial shared tenant runtime/database;
- customer branches or copied core;
- K-Nex ORM/database provider above Payload;
- automatic raw collection exposure;
- automatic exposure of all sources/actions/collections as AI tools;
- direct model access to Payload, plugin services, or ambient service containers;
- model/protocol SDK types as persisted K-Nex contracts;
- arbitrary builder JavaScript/SQL/query/CSS/imports;
- WebSocket as sole business truth;
- permanent ID aliases instead of migration;
- ambient plugin service locator;
- generic schema-owning retained-data uninstall promise;
- timestamps inside committed deterministic generated graph;
- manual fleet YAML as deployed truth.
