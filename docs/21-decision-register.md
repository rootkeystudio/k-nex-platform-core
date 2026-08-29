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

Payload is not treated as a casually replaceable provider. Executable gates validate sustainable K-Nex composition on Payload.

### D-005 — Plugin taxonomy

Module, provider, builder, theme, integration, preset. Payload database adapter is framework configuration.

### D-006 — Capability dependencies only where substitution matters

Direct domain dependency remains direct; realtime/storage/email/builder implementations can use capabilities.

### D-007 — Build-time executable composition; runtime validated state

Runtime panels cannot install packages or change the schema/import graph. Validated settings, lifecycle, roles, grants, assignments, and publications may change at runtime within installed code.

### D-008 — Manifest plus hermetic customer config

`k-nex.app.json` is desired graph; `k-nex.config.ts` is static source-controlled registration/fingerprint input within its proven boundary.

### D-009 — CLI application compiler

Plan/apply, exact package resolution, deterministic graph/registries, migration/reference/topology diagnostics.

### D-010 — Deterministic generated graph committed

No timestamps/paths/host/random/secrets; provenance and deployment metadata are separate signed evidence.

### D-043 — Sales remains the core roadmap domain reference

`module.sales` is the first-party domain module used to shape and prove plugin contracts while the active core roadmap freezes domain breadth. Logistics, restaurant, inventory, budgeting, driver, dispatch, live-tracking, QR-menu, and similar modules remain deferred product work.

### D-044 — Platform gaps are solved through Sales before domain expansion

A supported plugin contribution category is accepted only when Sales or a bounded non-domain test fixture exercises it and the common conformance suite proves it. A second domain module may not be introduced merely to discover another missing platform abstraction.

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

Settings, sources, actions, tools, events, jobs, realtime topics, components, blocks, routes, navigation, default pages, localization, lifecycle, and testing metadata are explicit contribution categories. Sales and one plugin conformance command define the reference implementation. Phase 9 adds bounded `roleTemplates` and migrates first-party fixtures atomically.

### D-049 — Permission IDs and policy bindings, not role labels

Protected platform/plugin behavior references stable permission IDs. Application, record, and field policy bindings are trusted executable source reconciled against static descriptors; role labels never authorize.

### D-050 — Plugin role templates are bounded defaults

A plugin may expose versioned role templates containing only its own permissions. Templates never assign users, never grant platform/foreign permissions, and instantiate customer-owned roles through platform-controlled idempotent bootstrap. Selected permissions may be copied once into an existing role without silently subscribing that role to future template updates.

### D-055 — Authorization owner is explicitly platform or plugin

Permission descriptors use a discriminated owner: trusted platform namespace `system`, or one plugin ID. `system.*` descriptors and protected-role baselines live in a static platform registry, not a fake `module.system` plugin. Plugin contributions cannot claim platform ownership.

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

Plugins may explicitly expose selected registered sources/actions as typed agent tools. Discovery is actor/delegation-filtered, every invocation is reauthorized, writes require declared approval/idempotency, and runtime content cannot create tools. MCP is an adapter and cannot weaken K-Nex policy or become a persisted core contract.

### D-042 — Official Payload plugins are bounded adapters

Prefer official Payload plugins when they materially reduce implementation and maintenance work, but keep their types, schema, routes, domain assumptions, and lifecycle behind K-Nex/Payload adapters. Adoption is exact-pinned and gate-specific; no official plugin becomes a baseline dependency before executable evidence. `@payloadcms/plugin-mcp` is the accepted bounded MCP transport candidate; unrelated decisions remain gate-scoped.

### D-051 — Customer-owned normalized roles, grants, and assignments

Roles, per-permission grant rows, and user/service assignments live in the customer database with optimistic revisions, audit, and platform-owned subject validation. Plugin grants bind their active authorization generation. Plugin upgrades and re-enable preserve customer edits. Template adoptions retain a canonical old baseline snapshot plus digest for reproducible three-way comparison.

### D-052 — Effective and administrative authorization catalogs are separate

Authorization uses ready platform descriptors/bindings plus enabled/ready/current-generation plugin descriptors/bindings. Administration may also display persisted non-executable disabled/orphaned snapshots. Disabled plugin grants remain dormant and plugin-only roles are hidden by default without deleting customer data; assigned inactive roles remain visible on subject detail.

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

### D-040 — Independent falsifiable gates through active core roadmap

Contract, composition, source, agent-tool, realtime, builder, UI/publication, plugin-authoring, component-system, application-factory/lifecycle, and authorization proofs are separated.

### D-048 — Two Sales-only customers prove reuse before vertical breadth

The application-factory/fleet gate uses two independent customers with the same platform and Sales packages but different themes, settings, permissions, layouts, lockfiles, and cadence.

### D-053 — Docker/container-first immutable package lifecycle

V1 customer applications are container-first. Plugin package add, upgrade, and removal rebuild and redeploy a verified immutable release; running containers never download executable packages. A preinstalled plugin may enable/disable/re-enable live only when release, schema, migration, configuration, dependency, setup, and authorization readiness are current.

### D-054 — Authorization cleanup follows plugin lifecycle safety

Schema-owning removal remains explicit purge release/migration work. Schema-less removal may apply a verified revision-bound cleanup plan without DDL migration. Cleanup never blindly deletes assigned, mixed, or customer-edited roles; failure leaves retired-generation grants dormant.

### D-056 — Plugin authorization generations fence uninstall/reinstall

Disable/re-enable and compatible upgrades preserve one plugin authorization generation. Uninstall/purge retires it; later reinstall allocates a new generation. Plugin grants/templates/snapshots bind the generation, so failed cleanup cannot resurrect old authority. Explicit reviewed reconciliation is required to rebind retained old-generation state.

## Provisional implementation choices

- Exact Payload/Next/React/Node/pnpm compatibility tuple remains pinned per gate.
- React Aria Components remains the preferred common interaction/accessibility foundation behind K-Nex components.
- TanStack Table is the preferred DataTable/DataGrid state-engine candidate.
- TanStack Virtual is the preferred large-list/table virtualization candidate.
- TanStack Form and React Hook Form are bounded candidates for the Sales form spike; only one is adopted if it reduces complexity.
- Lexical is the preferred rich-text adapter candidate and remains behind a versioned K-Nex contract.
- Official Payload Import/Export remains a bounded transfer/archive candidate, not backup or migration.
- Payload Sentry is an optional deployment adapter while Pino/OpenTelemetry remain platform contracts.
- Stripe and Ecommerce remain deferred vertical accelerators.
- Layout assignment/snapshot and constrained user patch remain the accepted workspace direction.
- A global authorization revision is the conservative Phase 9 baseline; granular invalidation may follow without changing persisted IDs.

## Open product decisions

- final private package scope/registry;
- external distribution/license model;
- first managed/self-hosted container platform and operations product;
- exact form engine after a Sales create/edit spike;
- rich-text persisted-state and sanitization contract;
- AI model-provider and conversation-retention policy;
- whether any customer needs intra-customer tenant segmentation;
- which real domain product follows the authorization/administration core;
- whether any schema-owning compatibility package is worth supporting after V1;
- group/directory authority and group-scoped role assignment;
- final SSO/identity-provider product scope.

## Deferred product backlog

```text
system settings and plugin/theme administration
verified GitHub package/theme catalog and Docker release controller
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
- runtime package download/import;
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
- role-label authorization or a universal `superadmin` string bypass;
- fake optional `module.system` ownership for fixed platform permissions;
- plugin-controlled user assignment;
- plugin templates granting platform or foreign-plugin permissions;
- reusing plugin ID alone as uninstall/reinstall grant lineage;
- embedding mutable permission arrays as the sole role-grant persistence model;
- deleting customer roles/grants on ordinary plugin disable;
- expiring/scheduled owner assignments;
- parallel first-party domain modules before the active roadmap permits them;
- making every theme reimplement the component catalog;
- allowing each plugin to create its own transport/cache/table/form/authorization infrastructure;
- using Cargo or Restaurant merely to prove customer composition.
