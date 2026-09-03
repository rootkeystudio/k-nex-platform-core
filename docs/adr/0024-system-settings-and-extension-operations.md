# ADR-0024: System Settings and Extension Operations

- Status: accepted
- Date: 2026-09-02
- Decision owners: K-Nex platform maintainers
- Evidence: design-only
- Entry: Gate 10 RBAC, authorization, and extension bootstrap PASS
- Related: [Phase 11 plan](../implementation/phase-11-system-settings-and-extension-operations.md), [ADR-0021](./0021-dynamic-application-runtime-and-zero-downtime-delivery.md), [ADR-0022](./0022-rbac-authorization-and-extension-role-templates.md), [ADR-0023](./0023-phase-9-production-isolation-and-static-delivery-hardening.md)

## Context

Gate 10 proved current RBAC and a bounded administration kill-spike. The next product layer must turn existing settings, catalog, lifecycle, theme, deployment, backup, and health mechanisms into one usable administration surface without moving code, Docker, repository, backup, or secret authority into the web process.

The current repository has strict static settings descriptors, a runtime settings service, a signed catalog verifier with a PostgreSQL checkpoint, PluginManager and DeploymentSupervisor boundaries, theme profiles, and fixed system administration pages. It does not yet have a customer PostgreSQL settings-document store, a production official-catalog reader, complete lifecycle/theme controls, or an operations-center request/receipt surface.

## Decision

1. Phase 11 productizes four connected surfaces:

```text
system settings administration
full Plugin Manager and theme administration
official GitHub catalog consumption
deployment, backup, and health operations center
```

2. Platform and Platform Plugin settings definitions remain static trusted registrations. A Hot Application may contribute only a closed data-only descriptor file referenced by its signed generation manifest and read from verified artifact bytes. It contains no entrypoint or executable migration. Database or browser content cannot create definitions, schemas, permissions, policy, imports, routes, capabilities, or executable behavior.
3. A settings document is scoped by customer application, environment, static descriptor identity, and current platform or extension owner generation. Uninstall/reinstall cannot silently bind retained values to a new extension generation.
4. Settings values are closed, bounded, canonical JSON validated by the registered schema. Secret-like fields contain references only. Secret values and reference identifiers are absent from browser reads, audit payloads, events, receipts, logs, and health output.
5. Immediate settings writes use expected document and settings-state revisions. The effective document, safe changed-field metadata, audit record, monotonic settings revision, and transactional outbox invalidation commit atomically.
6. A generation-validated settings write first persists a pending candidate and mutable resumable operation record. The previous effective document remains authoritative until the exact owner generation validates readiness. One transaction then promotes the candidate, advances settings revision, audits, invalidates, terminalizes the operation, and emits an immutable success receipt. Failure terminalizes an immutable failure receipt without changing the effective document. Replay resumes pending work or returns the exact terminal receipt.
7. Hot Application settings updates execute no downloaded migration code. The host performs only deterministic data projection onto declared keys, declared defaults, and type/bound validation; unresolved required values enter `waiting-configuration`.
8. Settings revision is distinct from authorization and lifecycle revision. Settings cannot author policy; only successful pending promotion may trigger explicit lifecycle readiness reconciliation.
9. Disabled or retired settings remain diagnostic customer data. They cannot affect execution. Re-enable uses the current retained generation; reinstall requires explicit reviewed adoption into the new generation.
10. The official catalog is consumed from one deployment-configured HTTPS GitHub release endpoint. Customer/browser input cannot choose a repository, branch, tag, URL, signer, or trust key.
11. Catalog reads are byte-, time-, redirect-, content-type-, and response-count-bounded. A valid complete snapshot first advances a durable anti-replay checkpoint and staged record while the prior accepted pointer remains. Current admission intersects staged policy immediately. Gate 9 quarantine reconciliation resumes after crash, and only after every impacted active release has a terminal receipt does one transaction advance the accepted pointer and immutable refresh receipt. Invalid refresh leaves the prior accepted pointer and runtime unchanged.
12. Catalog administration means refresh, inspect, and plan from accepted immutable releases. Customer application processes do not publish catalog entries or write GitHub.
13. Full extension administration exposes install, update, retained-generation re-enable, disable, rollback, uninstall, quarantine status, operation progress, impact, approval, audit, and receipts through current RBAC and expected revisions. Re-enable is presentation mapped to the existing exact-retained `install` operation; no compatibility operation is added. UI state never authorizes.
14. Phase 11 freezes server-owned action/permission/scope/reauthentication/approval mappings. It replaces unreleased `system.extensions.install-hot` with `system.extensions.install-live`, adds `system.catalog.refresh`, `system.themes.read`, `system.operations.read`, `system.operations.backup`, and `system.operations.restore-drill`, and ships protected baseline v3 with exact v2 predecessor and no alias.
15. Theme administration distinguishes executable Theme Packages, data-only Theme Skins, and customer Theme Profiles. A profile may reference only installed, verified, ready package/skin generations and publishes atomically with rollback history.
16. The operations center is an authenticated web control plane without privileged operator credentials. Its records project/reference existing authoritative settings, catalog, PluginManager, deployment/fence, theme, and backup/restore-drill state rather than duplicating a lifecycle/status machine. It submits bounded revision-bound requests to separate operators and receives no Docker socket, repository write credential, image-publish credential, database superuser credential, backup encryption key, or raw secret.
17. Platform Plugin delivery continues through customer source change, trusted build evidence, and DeploymentSupervisor. Maintenance-required work remains explicit and cannot be relabeled zero downtime.
18. Backup operations produce immutable request, backup, clean-restore verification, inventory, and freshness receipts. Live destructive restore is not a normal web action; it requires an external maintenance procedure, current approval, and exact target inventory.
19. Health is derived from authoritative runtime, deployment, worker-fence, catalog, backup, and migration observations. Database-authored desired state and client-reported health are not authoritative.
20. Every mutation is server-targeted, current-authority checked, expected-revision bound, idempotent, audited, and convergent through outbox plus polling.
21. Phase 11 adds no backward-compatibility aliases or migrations for unreleased APIs. Every first-party package and fixture remains `1.0.0`; changed pre-v1 callers, schemas, fixtures, and generated artifacts update atomically.
22. A staged Hot Application with generation-validated settings reserves its final numeric authorization generation in `pending-configuration` state, bound to exactly one verified runtime generation ID. This state exists only as a settings foreign-key fence: it grants no permission, contributes no policy/template, and is ignored by every effective-authority resolver.
23. The settings coordinator leases one pending operation, validates the candidate through the exact staged generation, and either terminally fails it or promotes the settings document. Missing required fields remain non-effective and keep the runtime operation in `waiting-configuration`. Activation may proceed only with the exact immutable success receipt; the activation/lifecycle transaction changes the reserved generation to `current`. Crash replay returns the same receipt and resumes from PostgreSQL authority.
24. Reinstall always reserves a new authorization generation. Retained values move only through a current-authority, server-derived old/new adoption operation that projects onto the new data-only descriptor, requires exact revisions, and emits audit, receipt, and invalidation atomically. It cannot copy executable content or expose secret-reference identifiers to the browser.

## Consequences

- Existing platform mechanisms become usable without creating a second settings, lifecycle, theme, transport, authorization, or deployment stack.
- Customer administrators can see truthful delivery class, availability, health, approval, and maintenance outcomes.
- Catalog and operations credentials remain outside customer/browser authority.
- Settings and profile data survive reversible disable while generation fencing prevents unsafe resurrection.
- Phase 11 remains an administration-core phase; CRM/CMS breadth stays deferred.

## Rejected alternatives

### Store arbitrary system JSON

Rejected. It would create an untyped runtime control plane capable of bypassing static registration and review.

### Reuse runtime generation activation JSON as the settings store

Rejected. Activation metadata has different identity, lifecycle, backup, mutation, and audit semantics.

### Let the browser choose catalog or artifact URLs

Rejected. It creates SSRF, trust-root, moving-target, and replay ambiguity.

### Give web/admin direct Docker, GitHub-write, or backup credentials

Rejected. Compromise of a browser, route, plugin, or web process would become host or supply-chain compromise.

### Put every revision into authorization state

Rejected. Settings do not author policy. Independent revision domains avoid unnecessary privilege-cache churn while lifecycle-affecting changes remain explicit.

### Store pre-activation settings under a second provisional identity

Rejected. Reserving a non-authorizing final generation reuses the existing settings owner fence and avoids a second identity/binding protocol. Database constraints and effective-authority filtering make `pending-configuration` inert until activation.

## Validation

ADR-0024 remains `design-only` until Gate 11 proves:

```text
real PostgreSQL settings transactions, isolation, migration, audit, and outbox
current-authority and generation-bound settings behavior
bounded signed GitHub catalog refresh and durable restart/replay behavior
complete extension and theme operation controls
authenticated deployment/backup/health request boundary without privileged operator credentials
real Chromium administration, denial, stale-state, focus, and secret-redaction journeys
multi-process lost-invalidation convergence and exact operation receipts
no Docker/GitHub/DB/backup authority in web or extension processes
```
