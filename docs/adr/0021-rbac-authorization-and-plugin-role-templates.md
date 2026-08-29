# ADR-0021: Central RBAC, Platform/Plugin Policy Ownership, and Customer-Owned Role Templates

- Status: accepted
- Date: 2026-08-29
- Decision owners: K-Nex platform maintainers
- Evidence: design-only
- Related: [Phase 9 implementation plan](../implementation/phase-9-rbac-and-authorization-control-plane.md), [Permissions, events, actions, and jobs](../09-permissions-events-and-jobs.md), [Plugin lifecycle](../19-plugin-lifecycle-and-package-management.md), [Runtime security and reliability](./0015-runtime-security-reliability-gates.md)

## Context

Gate 8 established deterministic customer applications, plugin lifecycle state, plugin permission descriptors, settings, source/action/tool authorization boundaries, transactional outbox, realtime convergence, release evidence, and safe upgrade/restore behavior. The foundation still lacks the user-facing authorization control plane required before CRM or CMS breadth:

```text
trusted platform system permissions
customer-owned editable roles and normalized grants
role assignments
plugin-provided default role templates
executable record/field policy bindings
disabled-plugin dormant grants
live authorization revision and revocation
protected owner/bootstrap and lockout prevention
safe uninstall/reinstall authority lineage
```

The current pre-v1 permission shape assumes every permission has `ownerPluginId`, but Phase 9 also needs genuine platform-owned `system.*` permissions. Inventing a fake optional `module.system` would misrepresent fixed platform authority and introduce lifecycle semantics where none belong. The owner contract therefore needs an explicit platform/plugin discriminant.

Using role labels directly in plugin code would couple security to mutable display names. Deleting roles/grants on ordinary disable would make re-enable destructive. Showing every disabled permission in normal administration views would create visual noise.

K-Nex is Docker/container-first. Running applications do not download package bytes. Package add, upgrade, and removal remain immutable release operations; ready preinstalled plugin lifecycle and role/grant changes may occur live through PostgreSQL-backed state.

Ordinary disable/re-enable and compatible upgrades must preserve grants, while uninstall must terminate that plugin authorization lineage. Otherwise failed cleanup followed by reinstall of the same plugin ID could reactivate old orphaned grants.

## Decision

1. K-Nex uses central RBAC for application-level grants plus trusted bounded policy hooks for application, record, and field decisions.
2. Protected behavior references stable permission IDs, never role labels such as `Sales Manager`, `Manager`, or `Superadmin`.
3. Authorization descriptors use:

```ts
type AuthorizationOwnerRef =
  | { readonly kind: "platform"; readonly namespace: "system" }
  | { readonly kind: "plugin"; readonly pluginId: PluginId };
```

4. The trusted static platform registry owns `system.*` permission descriptors, protected-role baselines, and platform policy bindings. It is generated/source-controlled platform authority, not database content and not a fake plugin.
5. Plugin permission descriptors use plugin owners and existing contribution namespaces. Plugins cannot claim the platform owner or declare `system.*` permissions.
6. The existing pre-v1 `ownerPluginId`-only permission shape is replaced atomically; no alias or compatibility shim remains.
7. Plugins declare static permission descriptors and executable policy bindings. Runtime database content cannot create descriptors, IDs, templates, or executable policy code.
8. Plugins may declare bounded versioned role templates. Templates are defaults; they never assign users automatically.
9. Administrators may instantiate a template as a new customer role, copy selected same-plugin template permissions into an existing role as a one-time reviewed operation, or select active platform/plugin permissions individually. Executable behavior still requires permission IDs.
10. Customer roles, normalized role-permission grants, and assignments are mutable customer-owned PostgreSQL data. Package upgrades and re-enable do not overwrite customer edits.
11. A plugin role template grants only permissions owned by that same plugin. It cannot grant platform or foreign-plugin permissions.
12. Template adoption retains the canonical old baseline permission snapshot and digest so three-way comparison remains reproducible after old package bytes disappear.
13. Each plugin installation lineage has a platform-issued positive authorization generation. Disable/re-enable and compatible upgrades preserve it. Uninstall/purge retires it; a later reinstall receives a new generation.
14. Existing verified installed plugins receive generation 1 during the Phase 9 migration. Database assertions alone cannot create a plugin generation.
15. Plugin-owned grants, template adoptions, and diagnostic snapshots bind their generation. Effective authorization requires a grant generation to match the current active generation.
16. Generation fencing prevents surviving old grants from reactivating after uninstall/reinstall. Rebinding old-generation state requires explicit admin-reviewed migration/adoption.
17. The effective catalog includes ready platform descriptors/bindings plus installed, active-generation, enabled, ready, supported, dependency-available plugin descriptors/bindings. Disabled, retired, or removed plugin grants cannot authorize.
18. The administration catalog combines current trusted descriptors with persisted non-executable owner/generation-bound display snapshots. Disabled and orphaned permissions can be diagnosed without restoring authority.
19. Disabled plugin-only template roles/permissions are hidden from default views. Mixed/customer roles remain visible with dormant counts. An assigned inactive role remains visible on the administered subject.
20. Authorization-affecting transactions increment monotonic revisions and publish transactional outbox invalidations. HTTP, worker, cache, navigation, browser, and realtime authority converge without code hot-loading.
21. Long-lived JWTs do not contain authoritative permission lists. Current authority is resolved from the authenticated session/principal plus current revisions.
22. Platform-owned protected role IDs and one-time first-owner bootstrap prevent initialization without an accountable owner. Owner assignments are current and non-expiring; the last current owner cannot be removed.
23. Package add, upgrade, and removal require immutable Docker releases. A preinstalled plugin may enable/disable live only when release, schema, migration, configuration, dependency, setup, and generation readiness are current.
24. Schema-owning removal remains explicit purge release/migration work. Schema-less removal retires the generation and may apply a verified revision-bound data cleanup plan; cleanup failure leaves old-generation grants dormant and safe.
25. Grants are normalized rows, not one mutable permission array embedded in a role document.
26. Phase 9 supports application-level user and service assignments. Group assignments wait for a real group/directory authority.
27. Authorization changes use the existing authoritative platform audit boundary; Phase 9 does not create a parallel audit system.

## Consequences

- System administration and plugin permissions share one resolver without pretending fixed platform authority is a plugin.
- Administrators can see/grant every active platform and enabled-plugin permission while disabled-plugin state stays out of default views.
- Plugins provide useful role templates without controlling customer users or roles.
- Customer roles may combine platform and several plugin permissions; disabling one plugin removes only its effective authority.
- Re-enable safely restores matching-generation grants.
- Uninstall/reinstall cannot silently resurrect old authority; explicit reconciliation is required.
- Permission rename/split/merge/replacement requires persisted-grant migration; permanent aliases remain rejected.
- Role/assignment writes require optimistic revisions, audit, lockout prevention, and authoritative server validation.
- A global authorization revision is the conservative first implementation; later granular invalidation need not change identities.
- The contribution taxonomy gains `roleTemplates`; registration gains plugin policy-binding reconciliation; the platform gains a separate trusted authorization registry.

## Alternatives considered

### Authorize directly by role name

Rejected. Labels are customer-editable, localizable, and unstable security identifiers.

### Create a fake `module.system`

Rejected. Fixed platform system authority is not an optional plugin lifecycle participant. A discriminated platform owner is more honest and avoids special package installation semantics.

### Let every plugin own role/assignment tables

Rejected. Cross-plugin roles, lockout prevention, auditing, user administration, and live revocation require one platform authority.

### Delete plugin roles/grants on disable

Rejected. Disable is reversible and must preserve customer-owned state.

### Keep disabled permissions visible everywhere

Rejected. Explicit diagnostic views are sufficient; assigned inactive roles remain visible where assignments are administered.

### Embed permission IDs as a JSON array on the role

Rejected. It weakens relational constraints, per-grant audit, cleanup, migration, and impact queries.

### Store only a role-template baseline digest

Rejected. A digest cannot reconstruct the old baseline for three-way comparison.

### Reuse plugin ID alone as grant lineage

Rejected. Reinstallation after removal would make old orphaned grants indistinguishable from current authority.

### Allow owner assignments to expire

Rejected. Time passing cannot execute a transaction-time last-owner safeguard. Owner assignments are current and non-expiring.

### Allow runtime package installation

Rejected. Running containers remain immutable.

### Support generic schema-owning uninstall

Rejected. V1 remains disable/re-enable or explicit purge with backup, reference, migration, and approval evidence.

## Validation

ADR-0021 remains `design-only` until Gate 9 provides executable evidence for:

```text
platform/plugin owner contract and atomic Sales migration
trusted static platform authorization registry
canonical role/grant/assignment/template/snapshot/generation contracts
platform/plugin policy-binding reconciliation
real PostgreSQL persistence and lockout protection
first-owner and plugin-template bootstrap
active platform/enabled-plugin permission discovery
live role/grant/assignment and ready-plugin lifecycle changes
HTTP/cache/realtime revocation and lost-message convergence
Sales application/record/field authorization
schema-less generation retirement/cleanup/reinstall safety
schema-owning purge refusal
real Chromium administration journeys
```

The ADR is promoted atomically only after its complete normative scope passes Gate 9.
