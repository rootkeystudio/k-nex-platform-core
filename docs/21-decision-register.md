# Architecture Decision Register

Decision status and evidence maturity are separate. See [ADR index](./adr/README.md) and machine-readable [evidence registry](./adr/evidence-registry.json).

Existing decision IDs are immutable historical identities. New decisions append new IDs; an accepted ID is never reused for a different meaning.

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

### D-007 — Build-time executable composition; runtime validated settings

Platform Plugin code/schema/import graph is build-time. Runtime settings cannot install Platform Plugin packages or mutate host executable composition.

### D-008 — Manifest plus hermetic customer config

`k-nex.app.json` is desired static host graph; `k-nex.config.ts` is static source-controlled registration/fingerprint input within its proven boundary.

### D-009 — CLI application compiler

Plan/apply, exact Platform Plugin package resolution, deterministic graph/registries, migration/reference/topology diagnostics.

### D-010 — Deterministic generated graph committed

No timestamps/paths/host/random/secrets; provenance and deployment metadata are separate signed evidence.

### D-043 — Sales is the sole pre-v1 reference domain plugin through Gate 8

During the platform-foundation program through Gate 8, `module.sales` is the only first-party domain module used to shape and prove plugin contracts.

### D-044 — Platform gaps are solved through Sales before domain expansion

A supported plugin contribution category is accepted only when Sales exercises it and the common conformance suite proves it. A second domain module is not introduced merely to discover another generic gap.

## Accepted contract decisions

### D-011 — Canonical hierarchical IDs

Dot-separated namespaces, optional hyphen inside one semantic segment, package location independent.

### D-012 — One Plugin Manifest schema and fixture system

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

### D-045 — Complete Platform Plugin contribution taxonomy and conformance

Settings, sources, actions, tools, events, jobs, realtime topics, components, blocks, routes, navigation, default pages, localization, lifecycle, and testing metadata are explicit Platform Plugin contribution categories. Sales and one conformance command define the reference.

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

Postgres only in V1; customer owns final Platform Plugin migrations.

### D-041 — Explicit agent tools and safe execution gateway

Plugins may expose selected registered sources/actions as typed tools. Discovery is actor/delegation-filtered, every invocation is reauthorized, writes require declared approval/idempotency, and runtime content cannot create tools. MCP is an adapter.

### D-042 — Official Payload plugins are bounded adapters

Prefer official Payload plugins when they reduce implementation/maintenance work, but keep their types, schema, routes, assumptions, and lifecycle behind K-Nex/Payload adapters. Adoption is exact-pinned and gate-specific.

## Accepted UI decisions

### D-026 — Fixed shell, composable canvas

Authentication/router/system/security remain fixed; CMS/dashboard/overview/report surfaces compose.

### D-027 — One canonical document, separate profiles

CMS and workspace share document architecture but not authority policy.

### D-028 — Separate public/workspace authority IDs

Static renderers can be shared; privileged and public source/action/block IDs are distinct.

### D-029 — Puck behind a narrow adapter

Engine adapter, document runtime, and Payload repository are separate. Puck does not own persisted documents or runtime rendering.

### D-030 — Theme Package plus runtime profile

Installed executable theme package and validated database profile publication are separate; admin/public profiles are independent.

### D-031 — Small stable theme primitive ABI

The theme ABI stays small. Complex DataTable/DataGrid, dates, tree, rich text, command, virtualization, map, chart, and advanced layout behavior is implemented by platform adapters.

### D-032 — WCAG 2.2 AA target

Evidence requires scoped automated/manual keyboard, focus, drag alternative, target, motion, high-contrast, and screen-reader gates.

### D-046 — Comprehensive platform-owned headless component system

K-Nex owns style-agnostic accessible components, data/form/page utilities, and Puck bridges. Plugins use K-Nex components where coverage exists.

### D-047 — Standard plugin query/action and default-page composition

Platform Plugin browser UI uses platform source-query/action-mutation factories and canonical states. Default pages are immutable templates instantiated into customer-owned documents; upgrades do not overwrite edits.

## Accepted lifecycle/operations decisions

### D-033 — Schema-owning V1 Platform Plugin lifecycle is disable/re-enable or purge

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

NIST SSDF, OWASP ASVS/API Security, and K-Nex test IDs map requirements to evidence.

### D-040 — Independent falsifiable gates through platform foundation

Contract, composition, source, agent-tool, realtime, builder, UI/publication, plugin-authoring, component-system, and application-factory/lifecycle proofs are separated.

### D-048 — Two Sales-only customers prove reuse before vertical breadth

The Gate 8 factory/fleet proof uses two independent customers with the same platform/Sales packages but different themes, settings, permissions, layouts, lockfiles, and cadence.

## Accepted post-Gate-8 extension-delivery decisions

### D-049 — Platform Plugin, Hot Application, and Theme Skin are distinct classes

The product may display one Plugin Manager, but manifests, plans, execution, lifecycle, receipts, and inventory identify the exact class. Platform Plugins retain existing IDs; Hot Applications use `app.*`; Theme Skins use `skin.*` after P9.1 contract acceptance.

### D-050 — Full Platform Plugin composition remains static

Payload schema, host services/routes/jobs/native UI/providers/builders/full themes remain exact build-time Platform Plugin contributions. The frozen host registry is not patched at runtime.

### D-051 — Hot Applications use a separate isolated runtime

A signed prebuilt Hot Application may activate live only through fixed host capabilities, isolated server runner, remote UI, fixed host routes, namespaced storage, and immutable generations. It cannot mutate host Payload config/imports.

### D-052 — Theme Skins are live-installable data-only artifacts

A Theme Skin contains bounded tokens, palettes, recipes, scoped CSS, and approved assets. A full executable `theme.*` remains a Platform Plugin.

### D-053 — Production activation runs no host package manager or install scripts

Dependencies are resolved/bundled in protected publication. The customer web/worker never runs npm/pnpm lifecycle scripts or imports downloaded code into its process.

### D-054 — Official catalog entries bind immutable verified artifacts

Publisher, source commit, immutable release asset, manifest/artifact/SBOM/provenance digests, compatibility, capability/permission impact, support, and revocation are verified before staging.

### D-055 — PluginManager is an orchestration façade

Catalog, artifact fetch/verification/store, planning/state, runner, remote UI, activation, deployment, traffic, authorization, audit/outbox, and inventory remain separable services. The manager is not a god class or generic package executor.

### D-056 — Runtime extension activation is generation-based and atomic

Hot Application/Theme Skin updates stage and warm immutable generations, atomically switch an active pointer, drain old calls, retain compatible rollback state, and converge through persisted revisions/outbox.

### D-057 — Hot Application execution is capability-scoped and isolated

The runner receives no raw Payload request, customer DB credential, Docker socket, ambient host secrets, broad filesystem, or unrestricted network. Node permission flags alone are not a security boundary.

### D-058 — Remote UI is worker-isolated and host-rendered

App UI runs in a Web Worker/equivalent realm and emits a K-Nex allowlisted component/event protocol. The host owns DOM, components, focus, accessibility, routing, theme, data gateways, and authorization.

### D-059 — Initial Hot Application persistence is generic namespaced storage

V1 starts with schema-validated quota-bound revisioned document/KV storage and bounded indexes. Arbitrary dynamic relational schema is deferred to a separate gate.

### D-060 — Platform Plugin availability uses external blue/green delivery

A stable gateway and separate deployment supervisor build/pull, migrate, start, warm, verify, promote, drain, and receipt a target host generation. The web application has no Docker socket.

### D-061 — Zero downtime is compatibility-gated

Only overlap-safe expand/contract changes are zero-downtime eligible. Incompatible/destructive migrations return `maintenance-required`; continuous external probes are required evidence.

### D-062 — Dynamic runtime precedes customer RBAC

Phase 9 proves the execution/delivery substrate behind a narrow injected operation-authorizer boundary. Phase 10 wires stable permissions, roles, extension templates, lifecycle generations, and user administration. No temporary role-label bypass is allowed.

## Accepted Phase 10 authorization direction

### D-063 — Permission IDs and policy, not role labels

Platform/extension behavior requires stable permissions plus application/record/field policy. Mutable labels never authorize.

### D-064 — Customer-owned normalized roles, grants, and explicit assignments

Roles, per-permission grants, and active/revoked user/service assignments are PostgreSQL data with optimistic revisions and audit. Temporal assignments are deferred.

### D-065 — Extension role templates are bounded defaults

Platform Plugins and Hot Applications may provide same-owner templates; they never assign users or grant platform/foreign permissions. Customer edits use stored old-baseline comparison and explicit adoption.

### D-066 — Authorization generations fence uninstall/reinstall

Disable/re-enable and compatible update preserve one generation; uninstall retires it; reinstall receives a new generation. Old grants cannot reactivate without explicit reviewed reconciliation.

### D-067 — Protected roles and first-owner safety

Stable owner/security/extension-admin/user-admin/auditor roles have platform baselines. First-owner bootstrap is single-use and last-owner revocation fails closed.

### D-068 — Effective and administrative authorization catalogs differ

Authorization uses ready platform and enabled/current-generation extension descriptors/bindings. Diagnostic snapshots may show inactive/retired/orphaned entries without restoring authority.

## Accepted Phase 9 project-manager hardening decisions

### D-069 — Delivery class does not overload Plugin Manifest kind

`ExtensionDeliveryClass` distinguishes Platform Plugin, Hot Application, and Theme Skin. `PluginManifest.kind` remains the existing module/provider/builder/theme/integration/preset taxonomy.

### D-070 — Remote UI has no ambient host-origin authority

A same-origin worker alone is insufficient. Production remote UI uses an opaque-origin sandbox or dedicated credentialless extension origin, strict CSP/content policy, and a transferred bounded host channel; customer credentials, browser storage, and ambient network are denied.

### D-071 — Production app execution requires per-generation OS isolation

A same-user child process is development/test-only. Gate 9 production execution uses an OS/container sandbox per app generation or equivalent, with cross-app/generation isolation, denied host/DB/Docker/secret mounts, denied default egress, and enforceable resource/security controls.

### D-072 — Platform Plugin delivery preserves static source and build evidence

A Platform Plugin change starts from an expected customer source commit, deterministically produces the exact target manifest/lock/graph/registries/migrations, and yields trusted customer-specific application/image attestations before DeploymentSupervisor may promote it. Runtime database state cannot become desired composition.

### D-073 — Migration phases and worker generations are fenced

Zero-downtime plans classify `online-expand`, `online-backfill`, `post-retirement-contract`, and `offline-required` work. Contract cleanup waits until rollback closes. Green workers start passive and gain correctness-relevant execution authority only through a persisted monotonic fencing-token transfer.

## Provisional implementation choices

- exact Payload/Next/React/Node/pnpm tuple remains pinned per gate;
- React Aria remains the preferred interaction/accessibility foundation behind K-Nex components;
- TanStack Table/Virtual remain preferred internal data/virtualization engines;
- one form engine is chosen only through a real consumer spike;
- Lexical remains a bounded rich-text candidate;
- Remote DOM or equivalent is evaluated behind a K-Nex remote UI adapter in P9.5;
- child-process runner is development/test-only; Gate 9 production proof requires enforceable per-generation OS/container isolation;
- a global extension/authorization revision is the conservative baseline before measured granular invalidation.

## Open product decisions

```text
official catalog repository/signing/root-trust operations
final extension bundle builder and archive/signature libraries
remote UI engine after credentialless-realm kill-spike
production per-app container/sandbox implementation
trusted GitHub-hosted and self-hosted build-authority adapters
first managed/self-hosted Docker/orchestrator product
public third-party marketplace certification/commercial model
richer dynamic object/data model after generic app storage
SSO/group/directory authority
CRM/CMS product scope after extension administration core
```

## Deferred product backlog

```text
system settings and full extension/theme administration
catalog publishing/revocation/operations center
full CRM breadth
CMS hierarchy/search/forms/redirect productization
logistics/driver/dispatch/live tracking
restaurant/QR menu/inventory/budgeting
AI assistant productization
commerce/payments
public third-party marketplace
```

## Rejected approaches

```text
shared customer database as initial isolation
Payload Multi-Tenant as customer-level isolation
customer branches/copied core
K-Nex ORM above Payload
runtime npm/pnpm install or downloaded host dynamic import
same-origin credential-bearing remote app realm
same-user child process as production app sandbox
runtime DB-authored Platform Plugin desired graph
arbitrary/self-asserted target image or build evidence
blue/green workers without generation fencing
contract migration before rollback-window closure
web process Docker socket
arbitrary Git branch as production catalog artifact
Hot Application Payload collection/hook injection
remote app React/DOM in host realm
Node permission flags as sole sandbox
false zero-downtime claim for incompatible migration
role-label/superadmin-string authorization
plugin-controlled user assignment
runtime content creating executable policy/contribution
permanent ID aliases
WebSocket as business truth
arbitrary builder JavaScript/SQL/import/network/global CSS
```
