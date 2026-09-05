# ADR-0025: Runnable Workspace Shell, Customer Pages, and Builder

- Status: accepted
- Date: 2026-09-03
- Decision owners: K-Nex platform maintainers
- Evidence: design-only
- Entry: Gate 11 system settings and extension operations PASS
- Related: [Phase 12 plan](../implementation/phase-12-runnable-workspace-and-dashboard-builder.md), [ADR-0005](./0005-unified-builder-fixed-shell.md), [ADR-0010](./0010-typed-data-source-state-binding-graph.md), [ADR-0020](./0020-reference-sales-and-headless-component-system.md), [ADR-0022](./0022-rbac-authorization-and-extension-role-templates.md)

## Context

Gate 11 leaves a generated artifact tree, not a runnable customer product. K-Nex needs one generated application that boots into an authenticated workspace, exposes static plugin navigation, and lets authorized users build internal pages without giving PostgreSQL or browsers code, route, component, policy, or data authority.

## Decision

1. The generated customer repository is the runnable deployment unit. The generator owns deterministic Next/Payload source, static registries, migrations, commands, environment names, health/readiness, worker wiring, and the selected PostgreSQL topology.
2. The platform owns one fixed shell and exactly these route classes: `/system/*`, `/apps/:appId/*`, registered static Platform Plugin routes, `/workspace/pages/:pageId`, and `/workspace/pages/:pageId/edit`.
3. Database and browser data can select only canonical page, document, navigation placement, Theme Profile revision, and registered definition identities. It cannot create paths, imports, JavaScript, JSX, React elements, SQL, CSS, handlers, policy, credentials, or network targets.
4. The server resolves one closed navigation tree from fixed platform nodes, active static plugin descriptors, and customer page placements. Duplicate IDs, cycles, missing or foreign parents, fixed-section shadowing, inactive owners, and cross-application placement fail closed.
5. A custom page has one immutable `pageId` and one immutable canonical `UiDocument.id`. Its document uses the existing `workspace` profile and only registered K-Nex blocks, sources, and actions.
6. Static platform permissions authorize operation classes. Normalized role/user page ACL rows authorize only `view` or `edit` on an exact page. Page ACL never grants source, field, record, action, theme, publish, or access-management permission.
7. Phase 12 adds `system.workspace-pages.read`, `.create`, `.edit`, `.publish`, and `.access.manage`. Protected owner authority contains every current platform permission; other protected roles remain least-privilege unless explicitly changed by a later accepted decision.
8. High-frequency editing uses one mutable expected-revision working copy and idempotency binding. Stale writes fail; Phase 12 performs no implicit structural merge.
9. Publishing creates an immutable document, metadata, ACL, Theme Profile, and dependency snapshot; atomically advances one publication pointer; records audit/outbox; and returns an immutable receipt. Rollback creates a new pointer transition after current dependency and authority validation.
10. Puck is an authoring adapter only. K-Nex owns the canonical document, catalog, validation, persistence, preview, and production renderer. Production page rendering does not depend on Puck.
11. Registered Platform Plugin code remains statically imported from the verified application release. A missing, disabled, quarantined, updated, or incompatible dependency renders a fixed unavailable state; stale implementation code is never resurrected.
12. Page Theme Profile overrides reference one exact published `admin`-surface revision. They never copy tokens or CSS.
13. First-owner bootstrap is out-of-band, one-use, expiring, application/environment-bound, and unavailable after an owner exists. No public signup is introduced.
14. Every page, ACL, publication, navigation, source, action, theme, and session operation re-enters current authority and converges through revision plus outbox invalidation.
15. Phase 12 attack IDs are frozen in `contracts/phase-12-attack-map.v1.json`. Gate 12 must bind every ID to an exact executed denial proof.
16. All packages remain `1.0.0`. Pre-release contracts change atomically; no compatibility alias or shim is added.

## Consequences

- Customer pages are durable data at fixed platform routes, not runtime code generation.
- Navigation presentation stays separate from authorization.
- Page sharing cannot widen Sales or other domain authority.
- Editing stays responsive without turning each keystroke into publication history.
- Published truth is restart-safe, auditable, dependency-bound, and reversible when current dependencies remain valid.

## Rejected alternatives

### Database-authored routes or React

Rejected. It would turn customer data into host code and bypass static release, review, CSP, and authorization boundaries.

### One permission per page

Rejected. Static permission inventory would grow with customer data and confuse operation authority with record ACL.

### Persist Puck state as the product contract

Rejected. It would bind production rendering and migrations to one editor implementation.

### Publish every autosave

Rejected. It creates noisy immutable history and does not solve stale-tab conflicts.

## Validation

ADR-0025 remains `design-only` until Gate 12 proves the generated packed application, authenticated shell, current-authority navigation, real PostgreSQL page/ACL/publication transactions, Puck isolation, Sales Kanban action, real Chromium journeys, restart/rollback, and every mapped attack denial.
