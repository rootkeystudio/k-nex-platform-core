# Detailed Implementation Plan — Phase 11 System Settings and Extension Operations

- **Status:** accepted next-phase plan
- **Entry:** Gate 10 RBAC, authorization, and extension bootstrap accepted
- **Architecture decision:** [`ADR-0024`](../adr/0024-system-settings-and-extension-operations.md)
- **Purpose:** productize system settings, complete extension/theme administration, consume the official catalog, and expose deployment/backup/health operations without moving privileged execution into the web process
- **Reference extensions:** `module.sales`, the existing bounded Hot Application fixture, and existing Theme Skin fixtures
- **Out of scope:** CRM/CMS breadth, public marketplace governance, catalog publication, arbitrary repositories/URLs, direct web-process Docker/GitHub/backup authority, full SSO, and a general maintenance orchestrator

## 1. Product boundary

```text
static trusted registrations
  → settings definitions and executable extension/theme declarations

official signed catalog
  → immutable reviewed extension releases

customer PostgreSQL
  → settings values, profiles, operation state, audits, receipts, revisions

authenticated web administration without privileged operator credentials
  → current-authority reads and bounded operation requests

separate trusted operators
  → catalog network fetch, source/build/deploy, Docker, backup, restore drill
```

Runtime or browser content never creates code, schemas, policies, permissions, imports, routes, capabilities, deployment topology, or trust roots.

## 2. Settings identity and behavior

Settings documents bind:

```text
application ID
environment
static settings descriptor ID
platform owner or extension authorization generation
schema version
document revision
canonical validated values
```

Rules:

1. Platform and Platform Plugin definitions come only from static trusted registration. A Hot Application may contribute only a closed data-only settings descriptor file named by its signed generation manifest and read from verified artifact bytes; it contains no entrypoint or executable migration.
2. Values are bounded canonical JSON and validate against the exact registered schema.
3. Secret fields contain references only and are never returned by general administration reads.
4. Disable retains current-generation values diagnostically but makes them ineffective.
5. Re-enable may reuse the same retained generation after validation.
6. Uninstall/reinstall gets a new generation; value adoption is explicit and reviewed.
7. An immediate descriptor writes its effective document, safe field-change metadata, audit, settings revision, and outbox invalidation atomically.
8. A generation-validated descriptor writes a pending candidate and mutable resumable settings-operation record while the prior effective document remains authoritative. The exact owner generation validates the candidate before one transaction promotes it, advances settings revision, audits, publishes invalidation, terminalizes the operation, and emits an immutable success receipt. Failure terminalizes an immutable failure receipt without changing the effective document; replay resumes pending work or returns the exact terminal receipt.
9. Disable/uninstall or generation change invalidates pending promotion. Rollback restores the retained effective document for the exact retained generation; reinstall requires explicit adoption.
10. Settings revision is separate from authorization/lifecycle revision. Only successful pending promotion may trigger explicit lifecycle readiness reconciliation.
11. Hot Application schema evolution uses no downloaded migration code. The host projects retained values onto declared keys, applies declared data-only defaults, validates all types/bounds, and enters `waiting-configuration` when a required value remains unresolved.

## 3. Official catalog

The production catalog adapter:

```text
deployment-configured exact GitHub release URL
→ bounded credentialless HTTPS fetch
→ complete signed snapshot verification
→ durable staged snapshot plus anti-replay checkpoint CAS
→ fail-closed active-release security reconciliation
→ accepted mirror pointer CAS
→ safe health and refresh receipt
```

It does not accept browser/customer repository, ref, URL, signer, public key, or workflow input. Invalid refresh leaves the prior accepted mirror and active runtime unchanged. A valid snapshot is first durable `staged`; the prior accepted pointer remains unchanged, while current security admission immediately intersects accepted and staged policy. Removal, immutable-evidence change, publisher-key mismatch, revocation, or compromised status therefore denies new work and resumes Gate 9's durable quarantine receipt/audit/outbox reconciliation after a crash. Only after every exact impacted active release is terminally reconciled does one transaction CAS the accepted pointer and immutable refresh receipt. Catalog publication remains outside the customer application.

## 4. Full extension and theme administration

The existing fixed routes grow into complete product controls:

```text
/system/settings
/system/settings/:settingsId
/system/extensions
/system/extensions/:extensionId
/system/themes
/system/themes/profiles/:profileId
/system/operations
/system/operations/:operationId
```

Extension detail may expose only server-authorized actions valid for current inventory:

```text
install
update
re-enable presentation mapped to retained-generation `install`
disable
rollback
uninstall
```

Every action shows canonical impact, execution class, availability, approval requirement, current progress, result receipt, health, and audit identity. Theme controls preserve the Package/Skin/Profile separation and reference only verified ready generations.

## 5. Operations center

The web process may:

```text
read protected inventory and safe health
request catalog refresh
submit an approved extension/deployment/backup/restore-drill request
observe progress and immutable receipts
```

It may not:

```text
open the Docker socket
write a customer repository
build/publish an image
read database superuser or backup credentials
decrypt backup content
run pg_dump/restore itself
choose an arbitrary catalog/artifact target
```

Maintenance-required delivery and destructive restore remain explicit external procedures with exact approval and inventory binding. Operations-center records are read-only projections/references over the authoritative settings operation, catalog refresh receipt, PluginManager operation, deployment/fence receipt, theme publication, or backup/restore-drill authority. They never form a second lifecycle or status state machine.

## 6. Permission and risk matrix

Every scope below is server-derived `{ kind: "application", resource: <listed resource> }`. A service principal uses the same permission; automation identity never bypasses RBAC.

| Server action | Permission | Resource | Reauthentication | Approval |
|---|---|---|---|---|
| settings list/detail | `system.settings.read` | `system.settings` | no | no |
| settings change/propose | `system.settings.manage` | `system.settings` | yes | no |
| catalog list/detail | `system.extensions.read` | `system.extensions` | no | no |
| catalog refresh | `system.catalog.refresh` | `system.catalog` | no | no |
| extension status/operation read | `system.extensions.read` | `system.extensions` | no | no |
| extension impact plan | `system.extensions.plan` | `system.extensions` | no | no |
| Hot Application or Theme Skin install | `system.extensions.install-live` | `system.extensions` | yes | canonical plan |
| retained-generation re-enable via `install` | `system.extensions.enable` | `system.extensions` | yes | canonical plan |
| update | `system.extensions.update` | `system.extensions` | yes | canonical plan |
| disable | `system.extensions.disable` | `system.extensions` | yes | canonical plan |
| rollback | `system.extensions.rollback` | `system.extensions` | yes | canonical plan |
| uninstall | `system.extensions.uninstall` | `system.extensions` | yes | yes |
| Platform Plugin deployment | `system.extensions.deploy-platform-plugin` | `system.extensions` | yes | yes |
| theme/profile list/detail | `system.themes.read` | `system.themes` | no | no |
| profile edit/preview | `system.themes.manage` | `system.themes` | no | no |
| profile publish/rollback | `system.themes.manage` | `system.themes` | yes | no |
| operations/health list/detail | `system.operations.read` | `system.operations` | no | no |
| backup request | `system.operations.backup` | `system.operations` | yes | no |
| clean restore-drill request | `system.operations.restore-drill` | `system.operations` | yes | yes |

`canonical plan` means the existing server-issued immutable `approvalRequired` decision; the browser cannot change it. Phase 11 replaces unreleased `system.extensions.install-hot` with `system.extensions.install-live` and updates every caller/fixture atomically; no alias remains.

Protected baseline release v3 recognizes exact v2 as its only direct predecessor:

```text
Owner                  all platform permissions
Security administrator unchanged v2 security permissions
Extension administrator all system.extensions.*, system.catalog.refresh,
                        system.operations.read, system.themes.read/manage
User administrator     unchanged v2 user-administration permissions
Auditor                existing audit/read permissions plus
                        system.operations.read and system.themes.read
```

Only Owner receives `system.operations.backup` and `system.operations.restore-drill` through a protected baseline. Customer roles may receive them only through the existing Owner-bounded delegation rules. Reconciliation is v2 digest → v3 digest, audited/outbox-invalidated, last-owner safe, and covered by the existing transferable-owner path.

## 7. Task order

### P11.1 — Freeze settings, catalog, operation, health, and receipt contracts

Add closed contracts for settings owner/generation identity, immediate versus generation-validated pending/effective state, resumable settings operations and immutable terminal receipts, redacted administration views, settings revision/invalidation, staged/accepted catalog refresh observation, projection-only operations-center references, requests/receipts, the exact permission/risk matrix, and complete extension/theme action presentation. Add five permissions (`system.catalog.refresh`, `system.themes.read`, and three `system.operations.*` IDs), replace `system.extensions.install-hot` with `.install-live`, and ship protected baseline v3 with exact v2 predecessor. Update authoring contracts directly for pre-v1; add no aliases.

Acceptance:

- strict schemas and Zod/AJV/generated-schema parity;
- exact action/permission/scope/reauthentication/approval and protected-baseline mapping;
- client cannot supply owner, permission, signer, trust key, repository, ref, URL, execution class, or Docker/backup authority;
- raw secret/reference values fail administration/audit/receipt schemas;
- first-party versions remain `1.0.0`.

### P11.2 — Implement customer PostgreSQL settings storage

Add customer-owned migrations and a Payload adapter for application/environment/descriptor/owner-generation scoped effective documents, pending candidates, mutable resumable operation records, immutable terminal receipts, settings state revision, safe audit metadata, and transactional outbox invalidation. A success transaction promotes the candidate and terminalizes its receipt with revision/audit/outbox; a failure transaction terminalizes only the failure receipt and leaves the effective document unchanged.

Acceptance:

- real PostgreSQL clean migration and constraints;
- application/environment/generation isolation;
- optimistic races and replay are deterministic;
- document, revision, audit, and outbox roll back together;
- pending generation-validated values never become effective before exact-generation validation and lifecycle convergence;
- response loss/replay/crash resumes the pending operation; after atomic terminalization, replay returns the exact immutable success/failure receipt while the correct effective document remains authoritative;
- schema migration failure preserves the last valid document;
- no settings value appears in audit/outbox/log output.

### P11.3 — Productize settings service and convergence

Connect static Platform/Platform Plugin descriptors plus verified data-only Hot Application descriptor files, PostgreSQL store, current RBAC policies, lifecycle/generation state, host-owned data-only Hot Application value projection, cache invalidation, and lost-message polling. Add server-projected list/detail/change view models.

Acceptance:

- denied reads touch neither DB values nor callbacks;
- forged IDs/owners/permissions/generations/revisions fail;
- disabled/retired values are diagnostic only;
- re-enable and explicit reinstall adoption follow current generation;
- Hot Application updates execute no downloaded migration code and enter `waiting-configuration` when deterministic projection cannot satisfy the new schema;
- web/worker/runner consumers converge after lost invalidation.

### P11.4 — Implement official GitHub catalog consumption

Add the bounded network reader and durable staged/accepted mirror around the existing signed catalog verifier and PostgreSQL checkpoint. Keep transport types behind K-Nex interfaces.

Acceptance:

- exact configured GitHub release endpoint only;
- deadline, bytes, redirects, content type, and response bounds;
- signature, signer, sequence, expiry, completeness, release, artifact, SBOM, provenance, support, review, security, and revocation checks;
- restart/race/replay/downgrade/partial-response failures preserve the prior accepted pointer;
- every valid complete snapshot reconciles active releases through the existing `release-missing`, `release-evidence-mismatch`, `publisher-key-mismatch`, revocation, and security quarantine receipt/audit/outbox path;
- staged policy immediately fails closed for affected active releases; restart after checkpoint/stage CAS and before quarantine completion resumes reconciliation;
- accepted-pointer CAS and immutable refresh receipt occur atomically only after every impacted active release has a terminal quarantine receipt;
- refresh emits a safe audit/health receipt and cannot activate an extension.

### P11.5 — Complete extension lifecycle administration

Productize plan, validate, execute, progress, receipt, retry, disable, retained-generation re-enable, update, rollback, and uninstall controls across Hot Applications and Platform Plugins. Reuse PluginManager, current RBAC, approval adapters, and DeploymentSupervisor; do not create a second lifecycle state machine. UI re-enable maps to the existing exact-retained `install` operation with `system.extensions.enable`; no new `enable` or `re-enable` operation value is added.

Acceptance:

- action availability derives from current inventory and catalog;
- operation/session/actor/approval/idempotency/revision bindings survive refresh and restart;
- stale or cross-actor execution fails;
- maintenance-required is explicit and non-executable as zero downtime;
- web has no source/build/Docker authority.

### P11.6 — Complete Theme Package, Skin, and Profile administration

Expose installed/available themes, skin lifecycle, profile edit/preview/publish/rollback, reference impact, and accessibility state through the existing theme stores and extension lifecycle.

Acceptance:

- Package/Skin/Profile classes cannot be confused;
- only verified ready generations can publish;
- concurrent profile publication is atomic and rollback-safe;
- active references block unsafe disable/removal;
- invalid/accessibility-failing preview never publishes;
- remote UI follows the host profile without app-owned native UI.

### P11.7 — Implement deployment, backup, and health operations control plane

Add a narrow authenticated request/status adapter between current-authority administration and separate trusted deployment/backup operators. Operations pages project/reference authoritative catalog-refresh, PluginManager, runtime, worker-fence, deployment, theme-publication, backup-freshness, migration, and restore-drill state; they persist no duplicate phase/result state.

Acceptance:

- request target and expected inventory are server derived;
- approval, idempotency, revision, audit, outbox, and immutable receipt binding;
- response-lost/replay/operator-restart convergence;
- backup receipt requires clean-environment restore proof;
- forged/client health and stale receipts are rejected;
- web/worker/runner/extension containers have no Docker, repo, DB-superuser, or backup-key authority.

### P11.8 — Deliver fixed accessible administration journeys

Implement the fixed settings, extension, theme, and operations routes with server-rendered current-authority view models and no-JavaScript POST paths. Reuse K-Nex components and form conventions.

Acceptance:

- owner, limited, revoked, and unauthenticated journeys;
- correct 403/404/409 behavior and refresh recovery;
- keyboard, focus, semantic name/state, forced-colors, and reduced-motion proof;
- confirmation and approval UX for risky operations;
- no secret/reference value, credential, raw operator error, or hidden authority in HTML/client state.

### P11.9 — Prove convergence and attack corpus

Join settings, catalog, extension/theme, and operations revisions across real web, worker, runner, browser, gateway, and operator processes. Add bounded failure injection and replay corpus.

Acceptance:

- loss of every invalidation still converges by polling;
- catalog/permission/lifecycle/settings revocation cancels or denies affected work;
- process crash before/after request commit preserves one logical operation;
- SSRF, trust-root forgery, arbitrary artifact, Docker/API escape, secret exfiltration, stale approval, cross-customer, and generation resurrection attacks fail closed;
- unrelated customer/runtime remains healthy.

### P11.10 — Gate 11 closeout

Create `docs/implementation/phase-11-result.md` and `pnpm gate:11`.

Gate 11 runs all earlier gates plus real PostgreSQL settings/operation evidence, bounded real HTTP catalog proof, multi-process operator/convergence evidence, Docker authority denial, backup/restore-drill proof, and Chromium settings/extension/theme/operations journeys. Pull requests run a focused Phase 11 command; one explicit exact-head Linux/AppArmor cumulative Gate 0–11 run is required before merge.

## 8. Required attacks

```text
database/browser-authored settings descriptor or executable value
raw secret or reference value in browser/audit/outbox/log/receipt
cross-application/environment/generation settings read or adoption
client-selected permission/owner/signer/repository/ref/URL/artifact
catalog redirect, oversized body, stale/replayed/downgraded/partial snapshot
invalid catalog refresh replacing the last accepted mirror
hidden UI or role label used as authority
cross-actor/session operation replay or stale approval
maintenance-required relabeled as zero downtime
Theme Package/Skin/Profile class confusion
profile publication against unverified, stale, or inaccessible generation
web/worker/runner/extension Docker, repository, DB-superuser, or backup-key access
forged health, inventory, backup, restore, or deployment receipt
lost invalidation preserving stale settings/lifecycle/catalog authority
uninstall/reinstall resurrecting old settings, profile, grants, or runtime generation
```

## 9. Stop and kill criteria

Stop for review when work would require:

- arbitrary settings JSON, DB-authored definitions, executable policy, or topology;
- browser-selected trust roots or network targets;
- web-process Docker, GitHub-write, image-build, database-superuser, or backup-key authority;
- direct live destructive restore without a maintenance plan;
- a second settings, lifecycle, theme, transport, authorization, or deployment stack;
- a public marketplace or another first-party domain;
- weakened Gate 9/10 isolation, source/build, authorization, revision, or evidence invariants;
- a compatibility shim for an unreleased pre-v1 contract.

## 10. Gate decision

```text
GO EXPLICIT CRM/CMS PRODUCTIZATION DECISION
REWORK SYSTEM ADMINISTRATION OR OPERATIONS AUTHORITY
REJECT WEB-OWNED PRIVILEGED OPERATIONS
```
