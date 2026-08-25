# Research Plan and Proof of Concept

## Objective

The research phase should prove that K-Nex can compose reusable backend packages into independently styled and deployed customer applications without creating upgrade or dependency chaos.

The goal is not to implement complete CRM, logistics, restaurant, or live-tracking products. The goal is to validate the architecture's riskiest assumptions with thin vertical slices.

## Key research questions

### Platform foundation

- Can Payload plugins/config contributions be composed deterministically from K-Nex modules?
- Can duplicate collection slugs, endpoints, permissions, and providers be detected before boot?
- What stable abstraction should K-Nex place above direct Payload config mutation?
- Which Payload APIs must remain exposed to advanced modules?

### Packaging

- Should core/contracts/testing live in this monorepo?
- Should initial modules use dedicated repositories or a modules monorepo?
- Which private registry and authentication flow is least painful for local development and deployment?
- Can exact versions, peer ranges, and Changesets produce understandable customer upgrades?

### Customer applications

- Can two completely different applications consume the same backend packages without shared styling?
- Does a template-generated repository upgrade more cleanly than a literal core fork?
- Where is the boundary between customer config, extension, and reusable module?

### Realtime

- Can the driver module declare WebSocket as a required dependency and fail clearly when missing?
- Can domain modules register typed channels and authorization without importing transport internals?
- Is Payload/Next.js process hosting sufficient for the first WebSocket implementation?
- What deployment adapter is needed for local versus multi-instance use?
- What delivery semantics are actually required for driver tasks and live tracking?

### Data and migrations

- Can a module publish migration helpers while the customer app owns final migration files?
- Can clean-install and previous-version upgrade tests be automated?
- How do module uninstall and purge remain safe?
- How should high-frequency location history be stored separately from ordinary CRUD?

### Page builder

- Does the selected Payload–Puck integration support customer-provided component catalogs and styles cleanly?
- Can component IDs and data migrations be validated before deployment?
- Can two customer applications share editor/storage logic while rendering completely different designs?

## POC scope

Build three small repositories/applications:

```text
k-nex-platform-core
client-acme-cargo-poc
client-mamma-restaurant-poc
```

Initial reusable packages:

```text
@k-nex/contracts
@k-nex/core
@k-nex/module-cms
@k-nex/module-page-builder
@k-nex/module-websocket
@k-nex/module-logistics-core
@k-nex/module-driver
@k-nex/module-restaurant-core
@k-nex/module-qr-menu
```

CRM, full dispatch, inventory, budgeting, and production GPS infrastructure can remain architecture stubs until the foundation works.

## Thin slice A: Cargo customer

### Installed capabilities

- core;
- CMS;
- page builder;
- WebSocket;
- logistics-core;
- driver backend.

### Customer-specific work

- cargo visual theme;
- tracking/marketing page components;
- minimal driver frontend;
- one local extension such as a shipment-number policy.

### End-to-end scenario

1. Admin creates a shipment.
2. Admin assigns it to a driver through a minimal command.
3. Transaction commits and emits `logistics.assignment.created`.
4. Driver projection is updated.
5. WebSocket sends a task notification to the authorized driver.
6. Driver app fetches authoritative task data.
7. Driver marks task accepted through an authenticated API command.
8. Dispatcher/admin state updates.
9. Another driver is unable to subscribe to or fetch the task.

This validates module dependencies, permissions, events, realtime, customer UI separation, and deployment.

## Thin slice B: Restaurant customer

### Installed capabilities

- core;
- CMS;
- page builder;
- restaurant-core;
- QR menu.

### Customer-specific work

- completely different restaurant theme;
- menu page-builder components;
- public QR menu route;
- local extension for a customer-specific menu availability rule.

### End-to-end scenario

1. Admin creates dishes and categories.
2. Editor composes a page using restaurant-specific Puck components.
3. Draft preview is visible only to authorized users.
4. Page and QR menu are published.
5. Public menu renders with restaurant styling.
6. Cargo components are absent and cannot be selected.
7. Shared CMS/page-builder backend packages are unchanged.

This validates style isolation, customer component catalogs, module selection, drafts, and shared page-builder logic.

## Deliberate failure tests

A platform POC is incomplete without proving failure behavior.

### Missing dependency

Remove WebSocket from the cargo application while driver remains installed.

Expected:

```text
Build/startup fails before Payload boot with a clear dependency error.
```

### Duplicate schema contribution

Create two modules that register the same collection slug.

Expected:

```text
Composition fails and names both owning modules.
```

### Unauthorized realtime subscription

Driver B attempts to subscribe to Driver A's channel.

Expected:

```text
Subscription denied, audit/security event recorded, no data leaked.
```

### Transaction rollback

Force assignment transaction failure after preparing an event.

Expected:

```text
No driver realtime message and no externally processed domain event.
```

### Missing builder component

Remove a component renderer still referenced by stored page data.

Expected:

```text
Validation/build or deployment readiness check fails before production release.
```

### Incompatible version

Install a driver module requiring WebSocket `^2` with WebSocket `1.x`.

Expected:

```text
Dependency resolver prints installed/required versions and remediation.
```

## Acceptance criteria

### Architecture

- Core contains no customer CSS or vertical domain model.
- Customer applications contain no copied/modified core source.
- Modules register through a documented contract.
- Dependency graph is deterministic and inspectable.
- Core never imports a business module.

### Packaging

- Private packages install in local development and CI.
- Customer lockfiles pin exact versions.
- One shared package can be upgraded in cargo without upgrading restaurant.
- Compatibility errors occur before deployment.

### Payload integration

- Final config boots from composed module contributions.
- Duplicate collection/endpoint registrations are rejected.
- Types generate correctly for each different customer composition.
- Fresh and upgrade migrations run in CI.

### Security

- Module permissions are registered centrally.
- Customer roles compose permission keys.
- API, admin, and WebSocket reuse the same domain access policy.
- Public routes expose projections rather than internal documents.

### Realtime

- Driver requires WebSocket through manifest metadata.
- Authenticated connection and subscription authorization work.
- Reconnect can recover authoritative state through API.
- Local adapter works without Redis.
- Domain code is unchanged when a distributed adapter is substituted.

### Customer differentiation

- Cargo and restaurant UIs share no required design system.
- Page-builder component catalogs are customer-owned.
- Both apps use the same CMS/page-builder logic package.
- A local customer extension works without patching a shared package.

### Operations

- Each customer uses separate database, storage, secrets, and deployment.
- Each release exposes package/module inventory.
- Backup and restore are tested for at least one POC environment.
- Previous image and migration rollback limitations are documented.

## Research phases

### Phase 0 — Decisions and scaffolding

Deliverables:

- package naming and registry decision;
- core monorepo scaffold;
- lint/test/build conventions;
- customer starter repository;
- first Architecture Decision Records;
- minimal CI.

Exit condition: a versioned hello-world core package can be installed by two customer applications.

### Phase 1 — Module graph

Deliverables:

- contracts package;
- manifest and resolver;
- required/optional/conflict validation;
- service provider registry;
- platform inventory command;
- module contract test harness.

Exit condition: deliberate dependency and duplicate-registration failures behave correctly.

### Phase 2 — Payload composition

Deliverables:

- Payload contribution contract;
- deterministic collection/endpoint/plugin composition;
- auth actor context;
- permission registry/access helpers;
- clean database boot and type generation.

Exit condition: two customer configs produce different valid Payload applications from the same core.

### Phase 3 — Events, jobs, and WebSocket

Deliverables:

- domain event envelope;
- after-commit/outbox experiment;
- job wrapper;
- WebSocket local adapter;
- typed channel registration and authorization;
- driver dependency proof.

Exit condition: cargo assignment thin slice works securely end to end.

### Phase 4 — CMS and page builder

Deliverables:

- CMS module;
- Payload–Puck adapter spike;
- customer-provided component catalog;
- component compatibility validation;
- draft/preview/publish flow.

Exit condition: cargo and restaurant render different sites from shared backend packages.

### Phase 5 — Migration and operations proof

Deliverables:

- module migration helper convention;
- customer-owned migration generation;
- previous-version upgrade fixture;
- reusable deployment workflow;
- release inventory;
- backup/restore exercise.

Exit condition: upgrade only one POC customer and leave the other on its previous versions.

## Decision log backlog

Create ADRs for at least:

1. Payload as the initial application foundation.
2. Separate customer repositories instead of long-lived customer branches.
3. Package dependency instead of copied/forked core source.
4. Customer-owned final migrations.
5. Build-time module composition versus runtime feature flags.
6. WebSocket as an optional infrastructure module and required driver dependency.
7. Domain services instead of business logic concentrated in Payload hooks.
8. Event/outbox durability level for the first production customer.
9. Modules monorepo versus repository per module.
10. Private package registry and release tooling.

## First implementation backlog

A sensible first coding sequence:

```text
contracts
  → module manifest
  → dependency resolver
  → service registry
  → core createPlatform()
  → Payload contribution merger
  → permission registry
  → test module and contract suite
  → customer starter
  → WebSocket local adapter
  → logistics-core thin model
  → driver thin slice
  → CMS
  → page-builder spike
  → second customer application
```

Do not begin with full CRM, full dispatch, inventory accounting, budgeting, or production-grade GPS history. Those modules depend on proving the product platform first.

## Research output

At the end of the POC, produce:

- working repositories;
- architecture decision records;
- module authoring guide;
- customer application guide;
- package/version compatibility report;
- migration and deployment runbook;
- measured limitations and rejected approaches;
- a go/no-go decision for using Payload as the long-term base.