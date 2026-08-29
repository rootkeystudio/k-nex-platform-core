# Detailed Implementation Plan — Phase 9 RBAC, Authorization, and Plugin Bootstrap

- **Status:** accepted execution plan
- **Entry:** Gate 8 is accepted on `main`
- **Architecture decision:** [`ADR-0021`](../adr/0021-rbac-authorization-and-plugin-role-templates.md)
- **Purpose:** finish the system authorization and administration core before CRM/CMS expansion
- **Deployment assumption:** Docker/container-first with PostgreSQL; package add, upgrade, and removal remain immutable release/deployment operations
- **Reference plugin:** `module.sales`
- **Out of scope:** CRM/CMS breadth, new first-party domain modules, marketplace UI, Docker deploy agent, runtime package loading, and a general identity-provider product

## 1. Accepted model

```text
trusted platform authorization registry
  → system.* permission descriptors and protected-role baselines
  → platform-owned policy bindings

plugin package
  → plugin-owned permission descriptors
  → bounded executable policy bindings
  → optional versioned role templates

platform services
  → roles and normalized grants
  → user/service role assignments
  → first-owner bootstrap and lockout protection
  → plugin authorization generations
  → template bootstrap/adoption and uninstall cleanup
  → audit and monotonic revisions

customer database
  → mutable roles, grants, assignments, and template lineage
```

Protected resources require stable permission IDs, never role labels. `Sales Manager`, `Manager`, and `Superadmin` are editable administration labels; they cannot become authorization checks.

Authorized administrators see every permission exposed by the trusted platform registry and every installed, enabled, ready, supported, dependency-available plugin. Disabled-plugin permissions/templates are hidden by default, while persisted grants, roles, assignments, adoption baselines, tombstones, receipts, and audit lineage remain in PostgreSQL as dormant state.

## 2. Authority and ownership

Canonical owner reference:

```ts
type AuthorizationOwnerRef =
  | { readonly kind: "platform"; readonly namespace: "system" }
  | { readonly kind: "plugin"; readonly pluginId: PluginId };
```

The existing pre-v1 `ownerPluginId`-only permission shape is replaced atomically; no compatibility alias is retained.

| Artifact | Authority | Runtime mutable | Lifecycle behavior |
|---|---|---:|---|
| Platform permission descriptor/binding | trusted static platform registry | no | always subject to platform readiness |
| Plugin permission descriptor | trusted plugin package | no | effective only while owner plugin is enabled/ready |
| Plugin permission policy hook | trusted plugin server code | no | unavailable while owner plugin is disabled |
| Role-template descriptor | trusted plugin package | no | hidden/inactive while owner plugin is disabled |
| Permission display snapshot | platform database, derived from trusted descriptor | platform-managed | diagnostic only after disable/removal |
| Plugin authorization generation | platform lifecycle authority | platform-managed | stable across disable/upgrade; retired on removal |
| Role | customer database | yes | retained across disable/re-enable |
| Role-permission grant | customer database | yes | plugin grant effective only for matching generation |
| Role assignment | customer database | yes | retained across disable/re-enable |
| Template adoption/baseline | customer database | explicit compare/adopt | retained across upgrade and disable/re-enable |
| Bootstrap/cleanup receipt | platform database | no ordinary edits | idempotency and audit |
| Authorization revision | platform database | platform-managed | advances on authority changes |
| Audit record | existing platform audit boundary | append-only | customer retention policy |
| Uninstall cleanup plan | verified current/target release evidence | no | schema-less cleanup authority only |

Plugins cannot claim the platform owner, create users, assign roles, grant `system.*`, modify protected roles, or overwrite customer-edited roles.

## 3. Permission and policy semantics

Phase 9 uses RBAC for application-level grants plus trusted application/record/field policy.

```text
session/principal
→ active assignments
→ roles
→ normalized grants
→ owner and plugin-generation match
→ effective platform/plugin catalog
→ policy hook
→ record scope and permitted fields
→ source/action/Payload/tool/job/realtime/UI execution
```

Example IDs:

```text
system.roles.read
system.roles.manage
system.role-assignments.manage
system.permissions.read
system.plugins.manage

sales.tasks.read
sales.tasks.write
sales.tasks.private-note.read
sales.opportunities.read
sales.opportunities.write
sales.settings.write
```

### 3.1 Ownership rules

- platform descriptors use `{ kind: "platform", namespace: "system" }` and IDs beginning `system.`;
- plugin descriptors use `{ kind: "plugin", pluginId }` and the existing plugin contribution namespace;
- platform descriptors/bindings are static generated source, not database content and not a fake optional plugin;
- a normal plugin role template may grant only permissions owned by that same plugin;
- plugin contributions cannot declare the platform owner or `system.*` IDs;
- cross-plugin templates are deferred until an integration-specific decision;
- database content cannot create permission IDs, descriptors, templates, or executable policy code.

A plugin action may recommend a default role template in documentation, but the executable requirement remains a permission ID. For example, Sales kanban stage editing requires a Sales permission; an administrator may grant it through the Sales template, add it individually to an existing `Manager` role, or create another customer role.

### 3.2 Policy binding

Application-scoped permissions may resolve from the effective permission set. Record/field-scoped descriptors require an executable binding:

```ts
type AuthorizationDecision =
  | { readonly allowed: false; readonly reasonCode: string }
  | {
      readonly allowed: true;
      readonly recordScope?: unknown;
      readonly permittedFields?: readonly string[];
      readonly policyRevision: string;
    };
```

Platform bindings are reconciled against the static platform registry. Plugin bindings are reconciled declared-versus-actual through plugin registration. `recordScope` is opaque and accepted only by the owning gateway/adapter. Missing, duplicate, undeclared, wrong-owner, wrong-phase, or incompatible bindings fail generation/boot. Timeout, cancellation, or exception fails closed with bounded errors and safe audit metadata.

## 4. Roles, templates, and bootstrap

A plugin may contribute:

```text
sales.role-template.viewer
sales.role-template.representative
sales.role-template.manager
sales.role-template.administrator
```

Descriptor fields:

```text
stable ID and positive version
plugin owner
localized name/description message IDs plus bounded fallback
exact canonical same-plugin permission IDs
bootstrap: automatic-if-absent | manual
bounded upgrade/adoption metadata
descriptor digest
```

Template and permission counts are bounded. Protected system roles are platform bootstrap definitions, not plugin role-template contributions.

### 4.1 Role editing

Authorized administrators may:

```text
create a customer role
add/remove any active exposed platform/plugin permission individually
instantiate a plugin template as a new customer-owned role
copy selected same-plugin template permissions into an existing role
assign one or more roles to a validated user/service
```

Copying template permissions into an existing role is a reviewed one-time bulk grant operation. It does not silently enroll that mixed role in future template updates. A role instantiated from a template may retain adoption lineage for explicit three-way upgrades.

### 4.2 Template bootstrap rules

1. Automatic templates create a role only when no adoption/tombstone exists.
2. No template assigns users automatically.
3. Adoption stores the exact canonical old baseline permission snapshot and matching digest.
4. The created role/grants become customer-owned and editable.
5. Upgrade/re-enable never overwrites customer edits.
6. Deleted bootstrap roles retain a tombstone and are not resurrected.
7. Template upgrades compare `stored old baseline → current same-plugin grants → new trusted template`.
8. Digest-only history is insufficient; the bounded baseline snapshot remains available after old package bytes disappear.
9. Customized roles receive no silent additions/removals.
10. Admins explicitly adopt changes, keep customization, restore defaults, dismiss the update, or leave a manual template uninstantiated.

## 5. Plugin lifecycle integration

### 5.1 Package operations

Package add/upgrade/removal changes executable bytes and requires:

```text
verified release selection
→ dependency/schema/permission/template/reference impact plan
→ immutable Docker image build
→ migration/readiness checks
→ verified deployment and runtime inventory
```

Running containers do not download packages.

### 5.2 Plugin authorization generation

Each installed plugin lineage has a platform-issued positive authorization generation:

```text
existing plugin at Phase 9 migration  authoritative generation 1 backfill
first later install                    next allocated generation
ordinary disable/re-enable             same generation
compatible package upgrade             same generation
verified uninstall/purge               generation retired
later reinstall                        next generation
```

The Phase 9 customer migration derives initial generations only from the verified installed runtime/release inventory; database assertions cannot invent an installed plugin.

Plugin-owned grants and template adoptions bind the active generation when created. Effective authorization requires the grant generation to equal the current installed generation.

This is a safety fence, not package version identity. Upgrades preserve grants; removal ends the old authority lineage. Orphaned old-generation grants cannot reactivate merely because the same plugin ID is installed again. Rebinding retained grants to a new generation requires an explicit admin-reviewed migration/adoption operation.

### 5.3 Live enable of a preinstalled plugin

Phase 9 replaces the current blanket `requiresDeployment: true` enable assumption:

```text
package add/upgrade/removal  release/deployment
preinstalled enable          live transaction when fully ready
preinstalled disable         live transaction
preinstalled re-enable       live transaction when fully ready
```

Enable transaction:

```text
authorize system.plugins.manage
lock lifecycle/setup/generation state
verify exact package/release and active generation
verify database migration revision
verify settings/providers/dependencies
reconcile permission, policy, template, and display snapshots
bootstrap automatic templates idempotently for current generation
write receipt
mark setup ready and enabled
advance authorization/lifecycle revisions
write audit + outbox invalidation
commit
```

Failure leaves the plugin disabled. A schema-owning plugin can enable live only when its schema is already composed into the running release and the database is at the reviewed required revision.

### 5.4 Disable

Disable is reversible and non-destructive:

```text
executable contributions and policies become unavailable
permissions/templates leave default active views
plugin-template roles with only inactive grants are hidden from default role catalog
mixed/customer roles stay visible with dormant counts
grants remain bound to the same non-retired generation
roles, grants, assignments, settings, data, baselines, tombstones, receipts remain
revisions advance and HTTP/cache/navigation/jobs/realtime converge
```

An explicit diagnostic toggle shows inactive/orphaned permissions and roles without restoring authority. On a user/service assignment detail, assigned inactive roles remain visible in a collapsed inactive section; an existing assignment is never silently concealed from the subject being administered.

### 5.5 Re-enable

Re-enable revalidates release, active generation, migrations, settings, dependencies, and setup; does not recreate deleted roles; preserves customer edits; previews authority impact; and reactivates retained matching-generation grants only through the current effective catalog.

### 5.6 Schema-owning purge

Generic uninstall remains unsupported. Removal requires explicit purge release/migration authority covering dependencies, references, retention, archive/backup, approval, rollback, restore, generation retirement, and authorization cleanup. Authorization cleanup cannot independently authorize schema/data destruction.

### 5.7 Schema-less uninstall

The target release carries a verified authorization cleanup plan binding:

```text
application/environment
current and target release identities
current and target plugin inventories
removed plugin and retiring authorization generation
exact permission/template/snapshot IDs
base authorization/lifecycle revisions
role/grant/assignment/adoption impact digest
cleanup mode, approval, and single-use plan ID
```

A platform-owned transaction retires the generation and applies cleanup only after target deployment verification. It needs no DDL migration solely to delete grants/adoptions, but it is revision-bound, audited, receipt-backed, and replay-safe. Generation retirement occurs even if later cleanup fails, so surviving grants are orphaned and cannot authorize or reactivate on reinstall.

Customer roles are never blindly deleted:

```text
mixed role                  retain; remove only retired-plugin grants when cleanup succeeds
customer plugin-only role   retain/archive by explicit admin choice
unmodified bootstrap role   archive/delete only after assignment/reference checks
assigned role               no silent deletion
```

### 5.8 Permission evolution

Permission rename, split, merge, removal, or semantic replacement within one installed lineage requires an explicit grant data migration. Permanent aliases are rejected.

## 6. Persistence

Phase 9 owns:

```text
k_nex_roles
k_nex_role_permission_grants
k_nex_role_assignments
k_nex_role_template_adoptions
k_nex_permission_catalog_snapshots
k_nex_plugin_authorization_generations
k_nex_authorization_state
k_nex_plugin_bootstrap_receipts
k_nex_authorization_cleanup_receipts
```

Authorization writes use the existing platform audit boundary; no parallel audit subsystem is introduced.

### 6.1 Roles

```text
id
stable slug
name/description
status: active | archived
revision
origin: system | customer | plugin-template
optional template origin pluginId/templateId/generation
created/updated actor and timestamps
```

Grants are normalized rows, not an embedded mutable JSON permission array.

### 6.2 Grants

```text
id
roleId
permissionId
ownerKind: platform | plugin
ownerId: system | pluginId
ownerAuthorizationGeneration (null for platform; positive for plugin)
origin: customer | template | protected-baseline
optional source template ID/version
revision
created/updated actor and timestamps
```

Constraints:

```text
unique(roleId, permissionId)
permission namespace must match owner
platform owner requires system.* and null generation
plugin owner requires matching plugin namespace and positive generation
effective plugin grant generation must match current active generation
dormant is derived, never a client-writable authority boolean
catalog removal never cascades into grants
```

### 6.3 Assignments

```text
id
subject: user | service
subjectId
roleId
application scope
optional active interval
revision
actor/audit reference
```

User/service existence is verified by a platform-owned subject resolver. Group assignment is deferred until a real group/directory authority exists.

Assignments to `system.role.owner` are current and non-expiring: no future `activeFrom` and no `activeUntil`. This makes the last-owner invariant enforceable rather than depending on a future clock transition.

### 6.4 Template adoptions

```text
pluginId/templateId/authorizationGeneration
roleId or deletion tombstone
adoptedVersion
baselinePermissionIds (canonical bounded snapshot)
baselineDigest
status: adopted | customized | dismissed | deleted
revision
```

Snapshot and digest must agree. An old-generation adoption does not bootstrap or update a new installation generation without explicit admin reconciliation; deletion tombstones remain visible across generations so removed roles are not silently resurrected.

### 6.5 Permission display snapshots

Persist only non-executable metadata:

```text
permissionId
ownerKind/ownerId/optional authorizationGeneration
title/description message IDs and fallback
resource/operation/scope
last-seen platform/plugin version and descriptor digest
lifecycle state and last-seen revision
```

Snapshots support disabled/orphaned diagnostics and cleanup impact. They cannot create effective permissions or policy code.

### 6.6 Plugin authorization generations

```text
pluginId
generation
state: active | retired
installedRelease
retiredRelease/reason/receipt when retired
revision
```

Only one active generation per plugin/application is allowed. Generation allocation and retirement are platform-authority operations performed under lifecycle lock.

### 6.7 Revisions and receipts

```text
k_nex_authorization_state:
  applicationId
  authorizationRevision
  pluginLifecycleRevision
  updatedAt

bootstrap receipt:
  owner/pluginId/optional authorizationGeneration
  bootstrapId/bootstrapVersion
  inputDigest/resultDigest
  appliedAuthorizationRevision/status

cleanup receipt:
  planId/pluginId/retiredGeneration
  current/target release digests
  base/final revisions
  result digest/status
```

Revisions are monotonic and update in the same transaction as authority changes. Receipts are unique and replay-safe.

### 6.8 Required database constraints

```text
unique active role slug
unique(roleId, permissionId)
unique active(subjectType, subjectId, roleId, scope)
unique(pluginId, templateId, authorizationGeneration) adoption/tombstone
unique active authorization generation per plugin
unique(pluginId, authorizationGeneration, bootstrapId, bootstrapVersion) plugin receipt
unique platform bootstrap receipt
unique cleanup plan receipt
no destructive cascade from catalog/snapshot/generation rows
optimistic role/grant/assignment/adoption revisions
rollback leaves revisions and generation unchanged
```

## 7. Protected system roles and first owner

The trusted platform registry defines:

```text
system.permissions.read
system.roles.read
system.roles.manage
system.role-assignments.read
system.role-assignments.manage
system.authorization.audit.read
system.plugins.read
system.plugins.manage
```

Protected role IDs:

```text
system.role.owner
system.role.security-admin
system.role.plugin-admin
system.role.user-admin
system.role.auditor
```

Display names are editable/localizable; protection uses stable IDs.

Invariants:

- protected roles have an immutable minimum platform grant baseline;
- at least one current non-expiring owner assignment exists after initialization;
- owner assignments cannot be scheduled or expire;
- last owner removal is rejected under transaction lock;
- plugins cannot claim the platform owner, grant `system.*`, or modify protected roles;
- plugin templates grant only same-plugin permissions;
- no hard-coded manager/superadmin label bypass;
- sensitive mutations require audit, optimistic revisions, and selected reauthentication policy.

### 7.1 One-time first-owner bootstrap

`create-knex-app`/first-run setup supplies one-time platform authority that:

```text
loads the trusted platform authorization registry
creates protected roles/grants idempotently
assigns the first authenticated customer administrator to system.role.owner
creates a current non-expiring assignment
writes a single-use receipt and audit
permanently closes the bootstrap path after commit
rejects invocation once an owner exists
```

It is not a general runtime bypass. Restore preserves owner assignments/receipts. Post-initialization readiness fails if no current owner exists.

## 8. Catalogs and default visibility

### Effective catalog

Contains ready platform descriptors/bindings plus installed, active-generation, enabled, ready, supported, dependency-available plugin descriptors/bindings. This is the sole authorization catalog.

### Administrative catalog

Current trusted descriptors plus non-executable owner/generation-bound snapshots with states:

```text
active
inactive-platform-not-ready
inactive-plugin-disabled
inactive-plugin-not-ready
inactive-generation-retired
deprecated
orphaned-after-removal
```

Default views show active entries only.

Role visibility:

```text
customer/mixed role                         visible
protected system role                       visible to authorized admins
plugin-template role with active grants     visible
plugin-template role with only inactive grants hidden in default catalog
assigned inactive role                      visible on subject detail as inactive
archived role                               hidden unless filtered
```

## 9. Live authority convergence

Role, grant, assignment, lifecycle, generation, or relevant setting transactions:

```text
update PostgreSQL
increment authorization/lifecycle revisions
write audit
write transactional outbox invalidation
commit
```

Authorization-context cache identity includes principal/session/impersonation plus current authorization and lifecycle revisions. Role labels are never cache boundaries.

Web/worker processes consume invalidations, drop affected caches, refresh snapshots, and reauthorize realtime sessions. Periodic revision checks recover from lost invalidation.

Browsers refetch current actor/navigation/catalogs/data and clear private cached data after revocation or authorization failure.

Long-lived JWTs do not carry authoritative permission lists. Changes apply on the next authoritative request without container restart.

## 10. Administration UI

Routes:

```text
/system/access/roles
/system/access/roles/:roleId
/system/access/permissions
/system/access/assignments
/system/access/templates
/system/access/audit
```

### 10.1 Role list/editor

Show origin, active/dormant/orphaned grant counts, assignments, template/generation state, revision, and editor. Group active permissions by platform/plugin, resource, operation, and scope. The default enabled-plugin view must expose every active permission descriptor.

Requirements:

```text
optimistic revisions
protected-role/last-owner safeguards
lifecycle, generation, and ownership visibility
inactive/orphan diagnostics only through explicit filter
impact preview for role/sensitive-grant removal
individual permission selection from platform and all enabled plugins
one-time selected-template permission copy to existing roles
no raw unknown permission ID submission
server authorization on every read/write
```

### 10.2 Assignments

Authorized admins assign one or more roles to validated users/services. Phase 9 has no direct per-user permission overrides. Inactive assigned roles remain visible on subject detail and are clearly non-effective.

### 10.3 Templates

Show not-instantiated, adopted, customized, update-available, dismissed, deleted, inactive, orphaned, and old-generation states. Render three-way differences from stored baselines and require explicit adoption/rebinding.

## 11. Reference proofs

Sales contributes its existing permissions, policy bindings, and four templates:

```text
Sales Viewer
Sales Representative
Sales Manager
Sales Administrator
```

Journey:

```text
platform registry creates protected roles and first owner
Sales installed disabled → absent from active plugin permission view
admin enables → four automatic templates bootstrap once
no automatic assignment
admin customizes/assigns representative role
admin adds a Sales permission to an existing mixed Manager role
access follows current record/field policy
role edit applies live
Sales disable → Sales-only roles hidden, mixed roles remain, grants dormant
subject detail still shows inactive assigned roles
HTTP/realtime authority revoked
Sales re-enable → same-generation edits preserved, grants reactivate
new template → stored-baseline compare/adopt, no silent overwrite
```

A mixed platform+Sales role proves unrelated authority survives Sales disable.

Schema-less uninstall uses a bounded test-only provider/plugin fixture, not a new domain module. It proves verified generation retirement/cleanup, injected cleanup failure with dormant old-generation grants, reinstall with a new generation and no accidental reactivation, explicit rebind, and safe retry.

## 12. Task order

### P9.1 — Freeze contracts

Deliver:

```text
AuthorizationOwnerRefSchema
PlatformPermissionDescriptor registry contract
Plugin PermissionDescriptor replacement using discriminated owner
RoleSchema
RolePermissionGrantSchema with owner/generation
RoleAssignmentSchema
RoleTemplateDescriptor/Adoption schemas with baseline snapshot/generation
PermissionCatalogSnapshotSchema
PluginAuthorizationGenerationSchema
Platform/plugin PermissionPolicyBinding and AuthorizationDecision
AuthorizationRevision and bootstrap/cleanup receipts
AuthorizationCleanupPlan
protected roles and first-owner bootstrap contracts
```

Acceptance: platform/plugin ownership parity; existing Sales descriptors migrated atomically; no role-label authority; no plugin claim on platform/system permissions; no runtime policy code; snapshot/digest parity; generation fencing; non-expiring owner invariant; Zod/AJV deterministic parity.

### P9.2 — Platform registry, role-template contribution, and policy binding

Implement the static platform authorization registry; add `roleTemplates`; add plugin contracts-phase descriptors, behavior-phase bindings, declared-vs-bound reconciliation, and trusted owner/generation-bound display snapshots.

Acceptance: missing/duplicate/wrong-owner/undeclared descriptors/bindings fail; plugin cannot register platform owner; disabled/retired bindings cannot execute; snapshots cannot authorize; counts/sizes are bounded.

### P9.3 — PostgreSQL/Payload storage

Implement normalized roles, owner/generation-bound grants, validated assignments, adoptions/baselines, plugin generations, revisions, snapshots, receipts, subject validation, and platform-audit integration with customer-owned migrations. Backfill generation 1 for verified already-installed plugins.

Acceptance: exact constraints, optimistic revisions, rollback, no destructive catalog cascade, no secrets, clean real-Postgres migration/boot, concurrent generation allocation/retirement safety, unverified database plugin rows cannot receive a generation.

### P9.4 — Catalogs and effective authority

Implement administrative/effective catalogs, assignment→role→grant resolution, owner/generation/lifecycle/dependency intersection, authorization fingerprint, bounded cache, impersonation context, and user/service resolver.

Acceptance: all platform and enabled-plugin permissions discoverable; cross-actor isolation; dormant/retired/orphan grants ineffective; unrelated grants survive; client forgery fails; revisions/generation change cache identity.

### P9.5 — Policy hooks across boundaries

Connect application/record/field decisions to sources, actions, Payload access, tools, jobs, realtime, routes/navigation, pages, components/blocks, and settings.

Acceptance: required bindings; server-owned scope; no unauthorized value in query/cache/log/error; scoped services; timeout/failure closed; next-request revocation.

### P9.6 — Protected roles and bootstrap

Implement protected platform roles, non-expiring one-time owner setup, automatic/manual plugin templates, tombstones, receipts, stored baselines, new-role instantiation, one-time copy to existing roles, three-way compare, and explicit adoption.

Acceptance: owner bootstrap once; replay fails; idempotent retries; no owner expiry; no resurrection; no overwrite; customized changes require review; existing-role copy has no silent future updates.

### P9.7 — Lifecycle integration

Implement ready preinstalled live enable, disable/re-enable visibility/dormancy, generation preservation/retirement, schema-less cleanup plan, reinstall fence, and schema-owning purge integration.

Acceptance: package changes deploy; ready enable does not; setup failure stays disabled; state preserved; no silent role deletion; stale/tampered/replayed cleanup fails; cleanup failure and reinstall remain dormant; explicit rebind required; permission evolution requires migration.

### P9.8 — Live revision/convergence

Implement transactional revisions, outbox invalidation, web/worker refresh, session/realtime reauthorization, and lost-message recovery.

Acceptance: next-request role change; private browser state clears; web/worker converge; polling recovers loss; stale permission tokens cannot retain authority; no restart for role/grant/assignment or ready lifecycle changes.

### P9.9 — Access administration UI

Implement roles, permissions, assignments, templates, audit, filters, impact previews, owner/generation diagnostics, inactive-assignment visibility, and protected safeguards using standard K-Nex gateways/actions/components.

Acceptance: keyboard/focus/validation; platform and all active plugin permissions grouped; inactive plugin-only entries hidden by default; mixed/subject/diagnostic views truthful; unknown IDs rejected; current authority/revision required.

### P9.10 — Gate 9 closeout

Create:

```text
docs/implementation/phase-9-result.md
pnpm gate:9
```

Gate 9 runs all previous gates plus contract parity, real PostgreSQL owner/bootstrap/lifecycle, multi-process convergence, Sales integration, schema-less generation cleanup/reinstall, ownership/lockout attacks, and real Chromium admin journeys.

## 13. Required attacks

```text
role label used as authority
client-forged permission/owner/subject/record scope
plugin descriptor claims platform owner or system.*
plugin template grants system/foreign permission
plugin assigns user
missing/duplicate/wrong-owner policy binding
disabled or retired-generation policy execution
cross-actor or cross-generation cache reuse
stale session after revocation
lost invalidation
unverified database plugin row receives generation
missing initial owner after initialization
owner assignment with future start or expiry
last owner removal
first-owner replay
duplicate plugin bootstrap
deleted role resurrection
upgrade without stored old baseline
template overwrite of customer edits
existing-role template copy silently following upgrades
permission rename without migration
assigned/mixed role deletion
schema-owning uninstall without purge
tampered/stale/replayed schema-less cleanup
cleanup failure followed by reinstall and old-grant reactivation
old-generation template bootstrap after reinstall
orphan grant accidental reactivation
inactive permission shown active
inactive plugin-only role polluting default list
inactive assigned role hidden from subject detail
runtime content creating permission/template/policy code
```

## 14. Non-goals

```text
runtime package installation
fake module.system plugin
GitHub plugin/theme catalog UI
Docker build/deploy agent
role inheritance
explicit deny
per-user direct grants
customer-authored policy code
arbitrary persisted policy expressions
group assignments before group authority
organization/branch/territory assignment scope
full SSO/identity-provider product
CRM/CMS breadth
```

## 15. Exit decision

Exit requires trusted platform plus enabled-plugin permission discovery, customer-owned normalized owner/generation-bound roles/grants/assignments, safe template bootstrap/evolution, dormant disable behavior, uninstall/reinstall fencing, first-owner/last-owner safety, live convergence, and Sales PostgreSQL/Chromium proofs.

```text
GO SYSTEM SETTINGS, PLUGIN/THEME ADMINISTRATION, AND DOCKER CATALOG
REWORK RBAC OR PLUGIN BOOTSTRAP
REJECT LIVE PREINSTALLED-PLUGIN ENABLE SEMANTICS
```

No CRM/CMS product expansion begins before Gate 9 PASS.
