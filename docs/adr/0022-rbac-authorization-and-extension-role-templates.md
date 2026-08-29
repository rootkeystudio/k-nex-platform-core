# ADR-0022: Central RBAC, Extension Policy Ownership, and Customer-Owned Role Templates

- Status: accepted
- Date: 2026-08-29
- Decision owners: K-Nex platform maintainers
- Evidence: design-only
- Entry: Gate 9 dynamic application runtime and zero-downtime delivery PASS
- Related: [Phase 10 plan](../implementation/phase-10-rbac-and-authorization-control-plane.md), [ADR-0021](./0021-dynamic-application-runtime-and-zero-downtime-delivery.md), [Permissions, events, actions, and jobs](../09-permissions-events-and-jobs.md)

## Context

Once K-Nex can install Hot Applications, activate Theme Skins, and deploy full Platform Plugins without user-visible outage, customer administrators need one authorization model for:

```text
platform system administration
extension discovery and lifecycle
settings and themes
plugin/app sources, actions, tools, jobs, and UI
customer roles and assignments
extension-provided role defaults
live revocation across web, worker, runner, browser, and realtime
```

Role labels are customer-editable and cannot be security identities. Extension disable must preserve customer role data without preserving authority. Uninstall/reinstall must not resurrect grants from an old executable generation.

## Decision

1. K-Nex uses central RBAC for application-level grants plus trusted platform/extension application, record, and field policy hooks.
2. Protected behavior references stable permission IDs, never role labels.
3. Permission ownership is explicit:

```ts
type AuthorizationOwnerRef =
  | { readonly kind: "platform"; readonly namespace: "system" }
  | { readonly kind: "extension"; readonly extensionId: ExtensionId; readonly generation: number };
```

4. The static platform registry owns `system.*` permissions and protected role baselines. It is not a fake plugin.
5. Platform Plugins and Hot Applications may expose permission descriptors and versioned role templates. Theme Skins do not execute authority-bearing behavior.
6. An extension owns only its permission namespace. It cannot grant platform or foreign-extension permissions, create users, assign roles, or modify protected roles.
7. Roles, normalized per-permission grants, and explicit `active | revoked` user/service assignments are customer-owned PostgreSQL data.
8. Phase 10 has no scheduled or expiring assignments. Every authority change occurs through a transaction, monotonic revision, audit, and invalidation.
9. A permission grant binds its extension authorization generation. Disable/re-enable and compatible update preserve the generation; uninstall retires it; reinstall gets a new generation.
10. Old-generation grants remain diagnostically visible but cannot reactivate without explicit reviewed adoption.
11. An extension role template is a default, not an executable role. It may contain only same-extension permissions and never assigns users.
12. Instantiated roles are customer-owned and editable. Template adoption stores the canonical old permission baseline and digest.
13. Upgrade comparison is `stored old baseline → current customer role → new template`; customer edits are never silently overwritten.
14. An administrator may add active permissions individually to any editable role, instantiate a template as a new role, or copy selected template permissions once into an existing role. One-time copy does not subscribe the role to future template updates.
15. The effective catalog contains ready platform permissions plus enabled/current-generation extension permissions and bindings. It is the only authorization source.
16. The administrative catalog may include non-executable disabled, retired, deprecated, and orphaned snapshots. Default views hide plugin-only inactive noise, while mixed roles and assigned inactive roles remain truthful.
17. Protected stable role IDs include owner, security administrator, extension administrator, user administrator, and auditor.
18. First-run setup creates protected baselines and one active owner assignment, records a single-use receipt, and permanently closes bootstrap authority.
19. The last active owner cannot be revoked.
20. Long-lived JWTs do not contain authoritative permission lists. Current session/principal plus current authorization/lifecycle revision determine authority.
21. Role, grant, assignment, lifecycle, generation, and relevant settings transactions publish outbox invalidations. Web, worker, extension runner, gateway, browser, and realtime sessions reauthorize and converge.
22. PluginManager and DeploymentSupervisor requests require current `system.extensions.*` permissions and risk-appropriate approval/reauthentication.
23. Runtime content cannot create permission descriptors, role-template descriptors, or executable policies.

## Consequences

- Administrators see every permission exposed by enabled extensions and can build customer-specific roles without plugin-defined role-name coupling.
- Sales can provide Viewer/Representative/Manager/Administrator templates while a customer's existing `Manager` role can selectively receive Sales permissions.
- Disabling Sales hides its default-only roles/permissions and revokes their effect without deleting database state.
- Re-enable restores current-generation grants and preserves customer edits.
- Hot Application runner capabilities cannot exceed the current principal/delegation authorization.
- User-operated live install is unavailable until this gate passes; Phase 9 uses only a narrow injected operation-authorizer boundary.

## Alternatives considered

### Authorize by `superadmin` or plugin role names

Rejected. Labels are mutable presentation, not stable authority.

### Let each extension own roles and assignments

Rejected. Mixed roles, lockout prevention, lifecycle dormancy, and consistent audit/revocation require one platform service.

### Delete roles/grants when an extension is disabled

Rejected. Disable is reversible and must preserve customer-owned data.

### Store only role JSON permission arrays

Rejected. Normalized grants provide relational constraints, per-grant audit, impact queries, migration, generation fencing, and cleanup.

### Allow time-based assignments immediately

Rejected. Clock transitions would bypass transactional revision and invalidation until a durable scheduler is designed.

## Validation

ADR-0022 remains `design-only` until Gate 10 proves:

```text
platform/extension owner and generation contracts
normalized roles/grants/assignments in real PostgreSQL
permission/policy and role-template reconciliation
first-owner/last-owner safety
Sales and Hot Application role templates
individual and template-copy role editing
lifecycle dormancy and uninstall/reinstall fencing
PluginManager/DeploymentSupervisor authorization
multi-process/runner/realtime revocation
real Chromium access and extension administration journeys
```
