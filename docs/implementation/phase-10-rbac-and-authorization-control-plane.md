# Detailed Implementation Plan — Phase 10 RBAC, Authorization, and Extension Bootstrap

- **Status:** accepted next-phase plan; implementation blocked until Gate 9 PASS
- **Entry:** Phase 9 dynamic application runtime and zero-downtime delivery accepted
- **Architecture decision:** [`ADR-0022`](../adr/0022-rbac-authorization-and-extension-role-templates.md)
- **Purpose:** make extension installation, settings, sources, actions, UI, and lifecycle safely administrable by customer users
- **Reference extensions:** `module.sales`, one Gate 9 Hot Application, and one Theme Skin
- **Out of scope:** broad CRM/CMS features, public marketplace governance, role inheritance, explicit deny, temporal assignments, and full SSO productization

## 1. Accepted authorization model

```text
trusted platform registry
  → system.* permissions and protected role baselines

Platform Plugin / Hot Application manifest
  → stable permission descriptors
  → bounded policy bindings where executable policy exists
  → optional versioned role templates

customer database
  → roles
  → normalized grants
  → active/revoked user/service assignments
  → template adoptions and old baselines
  → extension authorization generations
  → audit and monotonic revision
```

Role labels never authorize. A Sales kanban mutation requires a Sales permission ID; an administrator may grant it through a Sales template, add it to an existing `Manager` role, or create a new role.

## 2. Ownership

```ts
type AuthorizationOwnerRef =
  | { readonly kind: "platform"; readonly namespace: "system" }
  | { readonly kind: "extension"; readonly extensionId: ExtensionId; readonly generation: number };
```

- Platform owns `system.*`.
- An extension owns only its namespace.
- Theme skins normally expose no executable permissions; management uses platform permissions.
- Plugins/apps cannot grant `system.*`, foreign extension permissions, or user assignments.
- Database content cannot create executable policy code.

## 3. System permissions

Minimum platform permissions:

```text
system.permissions.read
system.roles.read
system.roles.manage
system.role-assignments.read
system.role-assignments.manage
system.authorization.audit.read
system.extensions.read
system.extensions.plan
system.extensions.install-hot
system.extensions.deploy-platform-plugin
system.extensions.enable
system.extensions.disable
system.extensions.update
system.extensions.rollback
system.extensions.uninstall
system.extensions.quarantine
system.settings.read
system.settings.manage
system.themes.manage
```

Risky operations may additionally require reauthentication/approval, but role names never bypass these IDs.

## 4. Roles and grants

Persist normalized rows:

```text
k_nex_roles
k_nex_role_permission_grants
k_nex_role_assignments
k_nex_role_template_adoptions
k_nex_permission_catalog_snapshots
k_nex_extension_authorization_generations
k_nex_authorization_state
k_nex_authorization_bootstrap_receipts
```

A grant binds owner and extension generation. Disable keeps the generation and makes grants dormant through effective-catalog intersection. Uninstall retires the generation. Reinstall receives a new generation, so old grants cannot reactivate without explicit reviewed adoption.

Assignments are application-scoped and explicitly `active | revoked`. Phase 10 has no clock-based activation/expiry.

## 5. Role templates

A Platform Plugin or Hot Application may publish versioned templates containing only its permissions.

```text
Sales Viewer
Sales Representative
Sales Manager
Sales Administrator
```

Rules:

1. Templates never assign users.
2. Automatic templates instantiate only if no adoption/tombstone exists.
3. Created roles are customer-owned and editable.
4. Adoption stores the canonical old permission baseline plus digest.
5. Upgrade comparison is `old baseline → current role → new template`.
6. Customer edits are never silently overwritten.
7. Selected template permissions may be copied once into an existing mixed role; that role does not silently follow later template versions.
8. Disabled extension templates/permissions are hidden by default but diagnosable.

## 6. Protected platform roles

Stable IDs:

```text
system.role.owner
system.role.security-admin
system.role.extension-admin
system.role.user-admin
system.role.auditor
```

The first-run bootstrap creates protected baselines and one active owner assignment. The bootstrap path closes permanently after commit. The last owner cannot be revoked, and owner assignments cannot be scheduled or expire.

## 7. Catalog behavior

### Effective catalog

Contains ready platform descriptors and enabled/current-generation extension descriptors and policy bindings. It is the only catalog used for authorization.

### Administrative catalog

Adds non-executable snapshots for:

```text
inactive-extension-disabled
inactive-extension-not-ready
inactive-generation-retired
deprecated
orphaned-after-removal
```

Default role editing shows active permissions only. Assigned inactive roles remain visible on the user's assignment detail. Mixed roles remain visible with dormant counts.

## 8. Live authority convergence

Role, grant, assignment, lifecycle, generation, or relevant settings transactions:

```text
write PostgreSQL state
advance authorization/lifecycle revision
write audit and transactional outbox invalidation
commit
```

Web, worker, extension runner, gateway, and browser drop affected caches and reauthorize. Lost messages converge through revision polling. Long-lived JWTs do not contain authoritative permission arrays.

## 9. Task order

### P10.1 — Freeze owner, role, grant, assignment, template, and revision contracts

Deliver closed schemas for platform/extension ownership, roles, generation-bound grants, explicit assignments, templates/adoptions with stored baselines, catalog snapshots, protected roles, receipts, and authorization decisions.

Acceptance:

- no role-label authority;
- extension cannot claim platform/foreign permissions;
- generation binding is mandatory for extension grants;
- temporal fields fail;
- Zod/AJV and generated-schema parity pass.

### P10.2 — Platform permission registry and extension permission/policy reconciliation

Implement static platform descriptors and policy bindings. Add role-template contribution to Platform Plugins and Hot Application manifests. Reconcile descriptor/binding ownership and lifecycle.

Acceptance:

- missing, duplicate, undeclared, wrong-owner, retired, or disabled executable binding fails closed;
- Hot Application policies execute only through the isolated host-capability gateway;
- snapshots cannot authorize.

### P10.3 — PostgreSQL/Payload authorization storage

Implement roles, grants, assignments, adoptions, snapshots, generations, revisions, receipts, subject validation, and platform audit integration through customer-owned migrations.

Acceptance:

- unique/canonical relational constraints;
- optimistic revisions and transaction rollback;
- no destructive catalog cascade;
- real PostgreSQL boot/migration;
- first-owner and concurrent last-owner safety.

### P10.4 — Effective authority resolver and caches

Resolve:

```text
principal/session/impersonation
→ active assignments
→ roles and grants
→ owner/generation/lifecycle intersection
→ application/record/field policy
```

Acceptance:

- cross-actor and cross-generation cache isolation;
- dormant/orphan grants ineffective;
- mixed roles preserve unrelated authority;
- direct client permission/scope forgery fails;
- extension operation authorizer uses current `system.extensions.*` permissions.

### P10.5 — Policy hooks across all boundaries

Connect current authority to sources, actions, Payload access, tools, jobs, realtime, routes/navigation, pages, remote UI, extension host capabilities, settings, PluginManager, DeploymentSupervisor requests, and theme management.

Acceptance:

- no unauthorized value/capability/artifact operation enters handler, cache, log, error, runner, or browser;
- policy failure/timeout closes safely;
- runtime extension cannot exceed principal/delegation authority.

### P10.6 — Protected roles and template bootstrap

Implement protected platform roles, one-time owner setup, automatic/manual extension templates, tombstones, receipts, old-baseline retention, three-way compare, new-role adoption, and one-time copy into existing roles.

Acceptance:

- no bootstrap replay/duplicate/resurrection;
- no automatic user assignment;
- no customer-edit overwrite;
- last owner survives races;
- copied mixed role receives no silent future update.

### P10.7 — Lifecycle and generation integration

Wire disable/re-enable/update/uninstall/quarantine to effective catalogs and generation state from Phase 9.

Acceptance:

- disable hides default entries and revokes authority while retaining data;
- re-enable restores only current-generation grants;
- uninstall/reinstall cannot revive retired grants;
- explicit adoption can rebind reviewed retained grants;
- assigned/mixed roles are never silently deleted.

### P10.8 — Live authorization revision and revocation

Implement transaction/outbox/revision convergence across web, worker, runner, gateway, browser, remote UI, and realtime.

Acceptance:

- next authoritative request uses the new role/grant state;
- active runner calls/subscriptions are reauthorized or terminated;
- private browser state clears after revocation;
- lost invalidation converges;
- no restart required for role/grant/assignment changes.

### P10.9 — System access and extension administration UI

Deliver:

```text
/system/access/roles
/system/access/roles/:roleId
/system/access/permissions
/system/access/assignments
/system/access/templates
/system/access/audit
/system/extensions
/system/extensions/:extensionId
```

The role editor groups every active platform/enabled-extension permission by owner/resource/operation. It can add permissions individually, instantiate templates, copy selected template permissions into existing roles, and show inactive diagnostics explicitly.

The extension manager shows execution class:

```text
Hot Application       install live
Theme Skin            install live
Platform Plugin       install with no-outage deployment when eligible
maintenance-required  explicit incompatible migration
```

All actions require current server authority, revision, impact preview, audit, and appropriate approval.

### P10.10 — Gate 10 closeout

Create `docs/implementation/phase-10-result.md` and `pnpm gate:10`.

Gate 10 runs all earlier gates plus real PostgreSQL role/lifecycle evidence, multi-process/runner/realtime revocation, Sales and Hot Application templates, PluginManager authorization, and Chromium access/extension administration journeys.

## 10. Required attacks

```text
role label or hidden UI used as authority
client-forged permission/owner/generation/record scope
extension template grants platform/foreign permission
extension assigns users
last owner revocation/bootstrap replay
cross-actor/generation cache reuse
stale session/runner/subscription after revocation
inactive permission shown as active
disabled plugin-only role pollutes default list
inactive assigned role hidden from subject detail
retired grant reactivates after reinstall
unknown permission ID added directly
PluginManager/deploy request without current permission
remote app capability exceeds principal authority
runtime content creates descriptor/template/policy code
```

## 11. Gate decision

```text
GO SYSTEM SETTINGS AND FULL EXTENSION ADMINISTRATION PRODUCTIZATION
REWORK AUTHORIZATION OR EXTENSION BOOTSTRAP
REJECT USER-OPERATED LIVE INSTALL
```

No CRM/CMS breadth begins before Gate 10 PASS and a following roadmap decision.
