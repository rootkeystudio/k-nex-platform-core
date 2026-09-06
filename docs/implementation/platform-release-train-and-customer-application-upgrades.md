# Detailed Implementation Plan — Platform Release Train and Customer Application Upgrades

- **Status:** selected design plan; implementation evidence not yet claimed
- **Architecture decision:** [`ADR-0028`](../adr/0028-coordinated-platform-release-train-and-customer-application-upgrades.md)
- **Entry:** Gate 12 accepted runnable customer application and external administration operator
- **First required product consumer:** Phase 13 P13.9 upgrade/backup/restore evidence
- **Purpose:** let an administrator move an existing generated K-Nex application from one supported product release to another through one coherent core/plugin train, deterministic repository regeneration, reviewed customer migrations, protected deployment, and final-state backup
- **Does not block:** Phase 13 CRM product work before P13.9, provided new migrations and package contracts remain compatible with this plan
- **Out of scope:** shared-database SaaS fleet mutation, arbitrary dependency-range resolution, production package installation in the web process, automatic customer-code rewriting, automatic destructive restore, or a public marketplace certification program

## 1. Product outcome

A customer begins with an independently generated application:

```text
K-Nex platform release 1.0.0
selected Platform Plugins at the 1.0.0 train
selected provider/builder/theme packages
optional Hot Applications and Theme Skins
customer source/configuration/assets
customer PostgreSQL data and migration history
custom pages, settings, roles, Theme Profiles, and audits
```

When K-Nex `1.1.0` is published, the administrator should see one update rather than manually update every package:

```text
System → Updates

Current                 1.0.0
Target                  1.1.0
Core packages           14 exact upgrades
Platform Plugins        Sales 1.0.0 → 1.1.0
Disabled plugins        upgraded, remain disabled
Hot Applications        2 retained-compatible, 1 upgrade-required
Generated files         18 managed updates, 2 additions, 0 conflicts
Database                online-expand + resumable backfill
Downtime                zero-downtime eligible
Pre-upgrade protection  required / ready
Rollback                available until contract cleanup
Post-upgrade backup     required before protected completion
```

The user reviews one immutable plan and starts or schedules one operation. The result is either:

```text
protected-complete
running-unprotected
maintenance-required
blocked
failed-before-promotion
rolled-back
```

These labels are projections over authoritative source, build, migration, backup, deployment, and extension records. They are not a second lifecycle state machine.

## 2. Direct answers to the product questions

### Does the generated code run again?

Yes. Every target release is compiled against the existing application manifest and customer config in an isolated worktree.

It does **not** rerun `create-knex-app` over the repository. It runs the target application generator/reconciler and updates only files whose prior generated ownership is proven. Customer-owned files are untouched. A customer modification to a managed generated file becomes an explicit conflict.

### Are package and plugin versions updated together?

Yes for the official first-party train. The target release manifest contains the exact core, Platform Plugin, provider, builder, Theme Package, and tooling artifacts tested together. The application keeps its selected plugin set; it does not acquire unselected plugins automatically.

Disabled compiled Platform Plugins are moved to the target train bytes but remain disabled in runtime state.

### Are database migrations applied automatically?

They are planned and executed as part of the approved deployment, but never as a hidden `pnpm install` side effect.

The target compiler adds only new append-only customer migration identities. The deployment supervisor runs them with exact predecessor, advisory lock, compatibility, worker-fence, and receipt checks. `offline-required` work requires an explicit maintenance plan.

### Is a backup taken?

Yes. A production upgrade needs a source protection point before risky changes and always produces a target-state backup after successful stabilization.

The post-upgrade backup is the protected backup of the “final state.” The upgrade is not `protected-complete` until it exists.

## 3. Release-train publication model

### 3.1 Canonical release identity

The user-facing product version is:

```text
K-Nex 1.1.0
```

The canonical source tag is immutable, for example:

```text
k-nex-v1.1.0 → exact source commit
```

Every first-party train artifact is published with exact version `1.1.0` during the V1 lockstep policy:

```text
@k-nex/contracts@1.1.0
@k-nex/runtime@1.1.0
@k-nex/composition@1.1.0
@k-nex/payload-adapter@1.1.0
@k-nex/module-sales@1.1.0
@k-nex/builder-puck@1.1.0
@k-nex/theme-minimal@1.1.0
...
```

No package version is republished with changed bytes. Unchanged source can still produce a newly versioned, immutable, attested train artifact.

The target `PackageReleaseManifest` includes every official package available for the train, not merely the packages selected by one fixture. The customer upgrade plan takes the exact subset required by that customer’s desired composition and target generator.

### 3.2 Release publication gate

A first-party train cannot publish while any supported first-party Platform Plugin lacks:

```text
exact package artifact and integrity
exact framework tuple
manifest/contribution conformance
upgrade disposition from each supported predecessor
migration and stored-artifact compatibility metadata
settings and secret-reference compatibility
builder/component/source/action/tool compatibility
fresh-install and prior-release boot evidence
SBOM/provenance/signature/revocation record
```

This enforces the product promise that “K-Nex 1.1.0” has a coherent official plugin set.

### 3.3 Third-party and customer-private packages

Private packages keep their own semver. The train never guesses compatibility from a range.

A private Platform Plugin must supply a target artifact attested against the exact target framework tuple and declare the transition from the installed artifact. Otherwise the application update is blocked with one of:

```text
private-plugin-rebuild-required
private-plugin-replacement-required
private-plugin-removal-required
unsupported-release-path
```

The user may remain on the supported source release, rebuild the private plugin, select a replacement, or explicitly remove it through its normal lifecycle. The update never silently disables or drops it.

## 4. Signed release artifacts

### 4.1 Package release manifest

The existing package release manifest remains the immutable closure for one release:

```text
release identity
framework tuple
package artifacts and integrity
peer compatibility
factory/generator lock templates
support policy
```

### 4.2 Platform release transition manifest

Add a strict signed contract such as:

```ts
interface PlatformReleaseTransitionManifest {
  schemaVersion: 1;
  transitionId: string;
  source: {
    release: string;
    manifestDigest: `sha256:${string}`;
  };
  target: {
    release: string;
    manifestDigest: `sha256:${string}`;
  };
  directPredecessors: readonly string[];
  packages: readonly {
    package: string;
    role: "core" | "plugin" | "provider" | "builder" | "theme" | "tooling";
    sourceVersion?: string;
    sourceIntegrity?: string;
    targetVersion: string;
    targetIntegrity: string;
    disposition: "upgrade" | "add-for-generator" | "remove" | "replacement-required";
  }[];
  generators: {
    sourceSchemaVersion: number;
    targetSchemaVersion: number;
    targetPackage: string;
    targetVersion: string;
    managedOutputContractDigest: `sha256:${string}`;
  };
  migrations: {
    graphDigest: `sha256:${string}`;
    phases: readonly ("online-expand" | "online-backfill" | "post-retirement-contract" | "offline-required")[];
  };
  liveCompatibility: {
    hostAbiFrom: string;
    hostAbiTo: string;
    catalogDigest: `sha256:${string}`;
  };
  protection: {
    preUpgradeBackup: "fresh-required" | "restore-verified-within-window";
    maximumBackupAgeSeconds: number;
    cleanRestoreDrill: "required" | "risk-policy";
    postUpgradeBackup: "required";
  };
  availability: {
    default: "zero-downtime-eligible" | "maintenance-required";
    rollbackWindowSeconds: number;
    irreversibleBoundary: string;
  };
}
```

The final schema must be closed, bounded, generated, and Zod/AJV equivalent. It must not contain executable migration source, repository credentials, image pull secrets, arbitrary URLs, or browser-selected digests.

### 4.3 Application release lock

Add a committed generated lock such as `.k-nex/release-lock.json`:

```text
application ID
current platform release
release-manifest digest
framework tuple digest
selected exact package closure
selected Platform Plugin identities and integrities
generator package/version/schema
generated ownership manifest digest
migration-set digest
last accepted transition chain
```

This lock is distinct from `pnpm-lock.yaml`:

- `pnpm-lock.yaml` records package-manager resolution;
- the K-Nex release lock records product-level release and generator authority.

Both must agree.

### 4.4 Generated ownership manifest

Add `.k-nex/generated-files.json` with canonical entries:

```ts
interface GeneratedFileRecord {
  path: string;
  mode: "managed" | "append-only" | "template";
  producer: {
    package: string;
    version: string;
    generatorId: string;
  };
  digest: `sha256:${string}`;
}
```

It contains no absolute path, timestamp, hostname, secret, or uncommitted state.

## 5. Application update commands

### 5.1 Self-hosted/local CLI

```bash
k-nex app upgrade check
k-nex app upgrade plan --to 1.1.0
k-nex app upgrade prepare --plan .k-nex/upgrades/<planId>.json
k-nex app upgrade apply --plan .k-nex/upgrades/<planId>.json
k-nex app upgrade status --operation <operationId>
k-nex app upgrade rollback --operation <operationId>
```

Command semantics:

- `check` reads signed release metadata and reports availability only;
- `plan` is read-only and produces the complete immutable impact plan;
- `prepare` creates an isolated worktree/branch with target source changes and runs dry-runs;
- `apply` is allowed only in an explicitly configured source/build operator or local development context; it never mutates a live web container;
- production migration/deployment remains supervisor-owned;
- `rollback` requests the accepted rollback class rather than running arbitrary git/database commands.

### 5.2 Managed product UI

`System → Updates` uses the existing current-authority and external operator pattern.

The web process may submit closed commands such as:

```text
application-upgrade-plan
application-upgrade-prepare
application-upgrade-execute
application-upgrade-rollback
```

Each command carries only an actor envelope, exact expected revisions, target release identity, opaque plan/operation identity, idempotency, expiry, and reauthentication/approval evidence where required.

The web process cannot provide:

```text
repository URL or credentials
branch name chosen as authority
package tarball or install command
migration source or SQL
image tag/digest claims
backup file/path/key
Docker/gateway topology
generated path ownership
```

The deployment/source operator resolves those from trusted configuration and signed release artifacts.

## 6. Update planning algorithm

One plan is calculated from an exact snapshot.

### 6.1 Read current authoritative state

```text
customer repository commit and clean/dirty state
k-nex.app.json and customer config fingerprint
K-Nex release lock
pnpm lock and packed package closure
generated ownership manifest and current file digests
current deployed image/source/build evidence
database release and migration revisions
Platform Plugin runtime inventory including disabled state
Hot Application and Theme Skin generations
settings, pending configuration, and secret-reference readiness
Theme Profile and custom page dependency inventories
active background operations/backfills/imports/outbox state
pre-upgrade backup and restore-proof freshness
```

A mismatch between repository desired state and protected runtime inventory is a blocker, not an input to normalize.

### 6.2 Resolve exact transition path

For direct `1.0.0 → 1.1.0`, verify one signed transition.

For `1.0.0 → 1.2.0`:

```text
use signed direct 1.0.0 → 1.2.0
or compose 1.0.0 → 1.1.0 → 1.2.0
otherwise unsupported
```

Every hop has its own source/target manifest digests and migrations. The plan presents the combined user impact but retains hop boundaries for execution and rollback.

### 6.3 Resolve the target package graph

The target application keeps the same desired selection unless the user has separately approved a composition change.

For each selected package:

```text
current exact artifact
→ transition mapping
→ target exact artifact
→ framework/peer tuple check
→ contribution and generated-import compatibility
```

Unselected official plugins are not installed merely because they exist in the train.

### 6.4 Evaluate generated-source reconciliation

The target generator runs in an isolated clean worktree with target packages and the current application manifest/customer config.

For each target path:

| Current condition | Ownership | Outcome |
|---|---|---|
| absent | managed | add |
| digest equals prior generated digest | managed | replace with target |
| digest differs from prior generated digest | managed | conflict |
| target no longer emits and current digest equals prior | managed | delete after reference check |
| target no longer emits and current digest differs | managed | conflict |
| existing migration/history | append-only | preserve byte-identically |
| new unique migration identity | append-only | add |
| customer file occupies target path | none/customer | conflict |
| template already exists | template | preserve; expose compare/adopt if supported |

No hidden merge is attempted. The plan identifies supported override points to move customer behavior out of a managed file.

### 6.5 Evaluate customer config and custom source

`k-nex.config.ts` and customer packages are built/typechecked against the target exact closure in a sandboxed build environment.

Failures are reported as customer-source blockers. The upgrade compiler does not rewrite arbitrary TypeScript.

Checks include:

```text
removed imports/exports
changed contract/schema versions
plugin registration drift
new required environment variables
provider capability changes
route/navigation collisions
forbidden package or runtime boundary changes
```

### 6.6 Assemble migration and stored-artifact graph

The plan combines:

```text
core customer-schema migrations
selected Platform Plugin schema/data migrations
application manifest migration
generated ownership/release-lock migration
source/action/tool/block/template/settings migrations
custom page and Theme Profile dependency migrations
protected role/template baseline reconciliation
large online backfills
post-retirement contract cleanup
```

It dry-runs deterministic artifact migrations on copied values and scans every draft/published/archived revision where the relevant contract requires it.

### 6.7 Check runtime/live-extension compatibility

For every active or disabled runtime extension:

```text
current generation identity
current host ABI
source and target host ABI overlap
target or bridge generation availability
settings/storage migration readiness
rollback compatibility
```

The application plan must not produce an interval in which a required fixed page, operation, or safety service is unavailable without a declared maintenance outcome.

### 6.8 Check operational readiness

Block or classify:

```text
another application upgrade in progress
non-replayable pending operation
uncheckpointed large import/backfill
undelivered correctness-critical outbox beyond policy
stale deployment/worker fence
missing target secrets/configuration
backup/restore proof unavailable
insufficient storage for backup/artifacts
revoked target release or signer
operator/source/build/deployment incompatibility
```

## 7. Source preparation and regeneration

### 7.1 Worktree/branch isolation

Preparation uses an isolated worktree rooted at the exact current source commit. A dirty developer checkout may generate a plan, but apply is blocked until changes are committed/stashed or an explicit clean worktree is selected.

Managed production creates a deterministic branch/PR through a deployment-owned GitHub App or equivalent source authority. The browser and web application never hold repository credentials.

### 7.2 Update order inside the prepared source change

```text
1. verify source release lock and prior generated ownership
2. fetch/verify target release and transition artifacts
3. migrate application-manifest schema in memory
4. resolve exact target selected package graph
5. run target generator into staging
6. reconcile managed/template/append-only paths
7. add new customer-owned migration files
8. update k-nex.app.json exact package/plugin versions
9. update K-Nex release lock
10. update packed artifacts/package.json/pnpm lock
11. regenerate resolved graph and static registries
12. run freshness, build, migration dry-run, conformance, and security checks
13. emit canonical source-change plan and commit/PR
```

A failure leaves the original worktree untouched.

### 7.3 Migration-file immutability

Current generated wrappers import aggregate package migration exports. Before real cross-release evidence, migration emission must adopt one of these proven models:

**Preferred model:** generate reviewed concrete customer migration source into the repository.

**Permitted model:** import an immutable versioned entrypoint such as:

```ts
import { up, down } from "@k-nex/payload-adapter/migrations/20260910_000031";
```

The package must retain that entrypoint with unchanged behavior for every release that supports fresh installation or upgrade from that history.

Forbidden:

```ts
import { currentMigrations } from "@k-nex/payload-adapter/migrations";
```

when the meaning of `currentMigrations` can change after the customer migration file has been committed.

### 7.4 Customer edits and generated conflicts

A conflict report includes:

```text
path
recorded generated digest
current digest
target digest
producer release
supported customer extension point
safe resolution choices
```

Resolution is explicit:

- restore the file to prior generated bytes and move customization to a supported override;
- intentionally adopt the target file and reapply reviewed customer changes elsewhere;
- remain on the current release;
- create a new accepted generator extension point.

`--force` must not overwrite an unknown generated-file modification in production mode.

## 8. Database migration execution

### 8.1 One application migration graph

Core and all selected Platform Plugin migrations are ordered in one application graph. Package-local migration order cannot bypass cross-plugin dependencies.

Each step binds:

```text
application/environment
source and target platform release
source and target package/plugin identity
migration ID and source digest
expected predecessor release/schema revision
target revision
phase and compatibility class
transaction/backfill/checkpoint behavior
```

### 8.2 Phases

#### Online expand

Add tables/columns/indexes/dual-read/write support that both old and new generations can use.

#### Online backfill

Run bounded checkpointed work. Backfill progress is durable, idempotent, resumable, and visible. Target promotion waits only when readiness requires completion.

#### Post-retirement contract

Drop/rename/contract only after:

```text
old web and worker generations retired
rollback window deliberately closed
post-upgrade backup available
fleet/customer policy permits irreversible cleanup
```

#### Offline required

Use explicit maintenance, fresh backup, approval, quiescence, bounded execution, and post-migration smoke. Do not label this zero downtime.

### 8.3 Disabled Platform Plugins

A disabled plugin remains compiled into the target host if it remains selected. Its required schema and compatibility migrations run when needed for host correctness, while its effective routes/actions/jobs remain disabled.

Optional data backfills may remain pending only if the target plugin manifest explicitly allows `disabled-not-ready` and re-enable stays blocked until completion.

### 8.4 Large or failed migrations

- transactional failure rolls back the step and keeps old authority where possible;
- a checkpointed backfill resumes from the last committed checkpoint;
- partial external effects are prohibited unless separately idempotent and receipted;
- failure before traffic promotion keeps source generation active;
- failure after promotion follows the declared rollback/forward-fix plan;
- an executed migration is corrected by a new migration, never edited.

## 9. Backup and restore policy

### 9.1 Pre-upgrade protection point

The protection point binds:

```text
source platform release and manifest digest
source repository commit and deployed image digest
exact package/Platform Plugin graph
framework and migration revisions
runtime extension/Theme Skin generations
settings and Theme Profile revisions
custom page/publication revisions
roles/authorization state
business data and object storage checkpoint
outbox/idempotency/audit state
backup encryption/storage identity and receipt
```

Backup creation uses the existing trusted backup operator. The web application requests and observes it but cannot read credentials or backup content.

### 9.2 Backup policy matrix

| Transition | Minimum pre-upgrade protection |
|---|---|
| no schema/data/runtime tuple change | recent restore-verified backup if transition policy permits |
| additive schema or data migration | new application-consistent backup |
| framework/Node/Payload/Postgres tuple change | new backup plus compatibility smoke |
| offline/destructive/irreversible work | new backup plus clean restore drill |
| security emergency | same policy; approval timing may be shortened, protection is not bypassed |

### 9.3 Post-upgrade final-state backup

After promotion, stabilization, and target health checks:

```text
take target-state backup
verify receipt and exact target inventory
optionally run policy-required clean restore drill
mark backup as current protected baseline
retain source backup according to rollback/retention policy
```

The final status is:

- `protected-complete` when the target backup succeeds;
- `running-unprotected` when the target application is healthy but the target backup failed or is overdue.

`running-unprotected` blocks:

```text
post-retirement contract migration
source backup expiry
old generation/image deletion
next application upgrade
```

It does not automatically restore or stop a healthy target application.

### 9.4 Restore safety

A restore into a clean environment:

- verifies exact source or target release artifacts by digest;
- disables/redirects external integrations until explicitly reauthorized;
- prevents unsafe webhook, email, payment, or job replay;
- restores migration, authorization, extension, theme, page, audit, and idempotency state;
- starts workers passive until fencing authority transfers;
- produces a restore receipt and health evidence.

## 10. Deployment and promotion

### 10.1 Zero-downtime path

```text
verified source change and target image
→ pre-upgrade protection ready
→ advisory lock
→ online-expand
→ green web/worker start with zero traffic/passive worker fence
→ exact readiness and authenticated/public smoke
→ online backfill as required
→ gateway promotion
→ worker fencing-token transfer
→ socket/realtime reconnect and revision convergence
→ source generation drain
→ rollback window
→ post-upgrade backup
→ optional contract cleanup after closure
```

### 10.2 Maintenance path

```text
approved maintenance plan
→ fresh backup + required restore drill
→ announce/quiesce
→ stop correctness-relevant writers
→ offline migration
→ start target generation
→ smoke/readiness
→ resume traffic/workers/integrations
→ post-upgrade backup
```

### 10.3 Promotion invariants

- target image must bind the prepared source commit, release manifest, lock, generated graph, migrations, SBOM, and provenance;
- target readiness must observe the target release and migration revisions;
- old and new workers cannot both own correctness-relevant effects;
- a revoked or changed target artifact cannot promote;
- response loss returns the same operation/receipt;
- stale plans and parallel update operations fail before mutation.

## 11. Rollback model

### 11.1 Before contract cleanup

For overlap-compatible updates:

```text
promote retained source web generation
transfer worker fence back
retain expanded schema
drain failed target generation
record rollback receipt
```

Do not down-migrate additive schema merely to roll back code.

### 11.2 After irreversible boundary

Rollback may require:

```text
maintenance
restore of the source protection point
reconciliation/export of writes accepted after that point
explicit data-loss acceptance
external integration replay prevention
```

The UI must not display a simple “Rollback” action after the operation has crossed this boundary.

### 11.3 Forward-fix preference

If the target accepted user writes, automatic source-backup restore is forbidden. Prefer a target forward fix or compatible code rollback. Restore is a separate high-risk decision.

## 12. Plugin and customization matrix

| Installed item | Target behavior |
|---|---|
| official active Platform Plugin | exact target train artifact; state remains active after successful promotion |
| official disabled Platform Plugin | exact target train artifact; state remains disabled; settings/data retained |
| private Platform Plugin | exact rebuilt/attested target required or update blocked |
| provider/builder/executable theme | target train package and dependent graph must resolve together |
| active Hot Application compatible with both host ABIs | retain exact generation |
| active Hot Application requiring update | stage exact target/bridge generation and sequence with host promotion |
| Theme Skin compatible with target Theme Package ABI | retain generation and profile references |
| incompatible Theme Skin/Profile | migrate/preview or block; never silently publish replacement presentation |
| custom workspace page using changed block/source/action | deterministic dependency migration or explicit dependency-unavailable impact |
| customer-owned default-page instance | never overwritten; compare/adopt target template separately |
| custom object/schema extension | exact migration and target runtime compatibility required |

## 13. Edge cases and required outcomes

### Repository and generation

| Edge case | Required result |
|---|---|
| dirty repository | plan allowed; prepare/apply blocked or uses explicit clean worktree |
| modified managed file | generated-conflict; no overwrite |
| customer file collides with new generated path | path-conflict; no partial apply |
| target stops emitting a modified managed file | conflict; no deletion |
| generator crash halfway | original worktree unchanged |
| lockfile/package bytes do not match target manifest | fail before build |
| application manifest schema too old | compose signed manifest migrations or unsupported |
| target generator cannot reproduce prior managed state | upgrade blocked; no ownership guessing |

### Release and plugin graph

| Edge case | Required result |
|---|---|
| first-party plugin missing from target train | release publication fails before customers see target |
| selected private plugin has no target | customer upgrade blocked |
| plugin version exists but integrity differs | fail closed |
| moving tag changes after planning | ignored; exact resolved artifact remains authoritative |
| target release revoked after preparation | deployment blocked; prepared source is not promoted |
| user skipped several releases | signed direct path or ordered adjacent transitions only |
| disabled plugin target unavailable | host update blocked unless explicit composition removal is separately approved |
| target package removes permission/source/action used by page | migration/impact required; no silent deletion |

### Migration and runtime

| Edge case | Required result |
|---|---|
| database predecessor differs from plan | fail before migration |
| parallel migration/update | advisory/revision lock gives one winner |
| migration fails transactionally | rollback step; source generation remains authoritative |
| backfill worker crashes | resume from checkpoint |
| old/new binaries cannot overlap | maintenance-required |
| contract cleanup requested before post-backup | denied |
| required target secret missing | waiting-configuration before promotion |
| pending non-replayable operation | upgrade blocked or explicitly drained/cancelled |
| unrelated outbox lag | classify by safety policy; never ignore correctness-critical lag |
| target worker starts active early | fail deployment and retain source fence |

### Backup, failure, and retry

| Edge case | Required result |
|---|---|
| pre-upgrade backup fails | no risky migration/promotion |
| backup exists but no valid receipt/inventory binding | treated as unavailable |
| restore drill fails | high-risk update blocked |
| process crashes after source PR but before build | resume from source-change identity |
| process crashes after migration before promotion | converge from persisted migration/deployment state; source traffic remains if compatible |
| response drops after promotion commit | exact receipt replay; no second promotion |
| post-upgrade backup fails | target stays active if healthy; `running-unprotected`; retention/next-update/contract cleanup blocked |
| rollback requested after new user writes | no automatic restore; show compatible code rollback or explicit restore plan |
| concurrent rollback and next update | one application/environment operation wins; other fails stale |

### Live extensions and themes

| Edge case | Required result |
|---|---|
| current Hot Application supports only source ABI | target/bridge required or block |
| target Hot Application supports only target ABI | stage in advance but activate only at safe host boundary |
| no generation supports overlap | maintenance-required or unsupported |
| active Theme Profile references removed token/skin | draft migration/preview required; current publication remains valid until explicit switch |
| live extension operation already in progress | settle or block application upgrade; no interleaved authority ambiguity |

## 14. Security and authorization

Permissions should remain operation-specific, for example:

```text
system.updates.read
system.updates.plan
system.updates.prepare
system.updates.apply
system.updates.schedule
system.updates.rollback
system.updates.maintenance.approve
```

Suggested policy:

| Action | Reauthentication | Approval |
|---|---:|---:|
| check/read plan | no | no |
| prepare source change | yes | server-derived |
| zero-downtime apply | yes | canonical plan |
| maintenance apply | yes | explicit second approval |
| rollback inside compatible window | yes | canonical plan |
| restore-based rollback | yes | explicit high-risk approval |
| close rollback/contract cleanup | yes | explicit approval |

Every boundary re-enters current authority and exact expected revisions. A plan prepared by one actor may be executed by another only if the product explicitly supports a separate approval role and both actor identities are retained. Nobody can replace the target release, package graph, migration set, backup, source commit, or image after approval.

## 15. Operations records and UI projection

The update page aggregates references to:

```text
release transition plan
source change/PR
CI/build attestation
pre-upgrade backup and restore drill
migration job/backfill
static deployment and worker fence
runtime extension sequencing
post-upgrade backup
rollback/contract-cleanup state
```

It does not copy these into a mutable duplicate status table. A projection may cache display data, but authoritative IDs and revisions are re-read for mutation.

Progress should remain resumable after browser refresh, operator restart, source CI restart, and deployment supervisor restart.

## 16. Fleet behavior

Fleet inventory reports per customer:

```text
current platform release
target eligibility and exact path
selected official/private plugin blockers
generator conflict count
migration/maintenance class
pre/post backup freshness
security exposure
prepared PR/build/deployment operation
rollback-window state
```

Fleet automation may open a customer-specific upgrade PR and request approval. It cannot silently change source, runtime composition, or customer data across the fleet.

A security release may prioritize affected customers and mark deadlines, while each customer retains an independently receipted update operation.

## 17. Implementation tasks

### U1 — Freeze release-transition and application-upgrade contracts

Deliver:

```text
PlatformReleaseTransitionManifest
ApplicationReleaseLock
GeneratedFileOwnershipManifest
ApplicationUpgradePlan
ApplicationUpgradeImpact
ApplicationUpgradeReceipt/projection references
strict update permission matrix
```

Acceptance:

- Zod/AJV/generated schema parity;
- canonical digest stability;
- exact source/target manifest binding;
- no URL, shell, SQL, package script, image claim, backup path/key, or browser-authored migration authority;
- stale plan and changed payload failures.

### U2 — Publish coordinated first-party release trains

Deliver:

```text
lockstep first-party package publication
complete official plugin matrix
transition manifest publication
fresh/prior release fixtures
release tag, artifacts, SBOM, provenance, signatures
publication failure for an omitted first-party plugin
```

Acceptance:

- no version reuse with changed bytes;
- every official package binds target framework tuple;
- target manifest and transition manifest cross-verify;
- source and target releases are independently reproducible;
- revoked/expired transition is rejected.

### U3 — Add generated-file ownership and upgrade reconciliation

Deliver:

```text
.k-nex/release-lock.json
.k-nex/generated-files.json
target generator/reconciler
managed/add/delete/conflict plan
isolated worktree preparation
atomic package/lock/registry update
```

Acceptance:

- `create-knex-app` remains fresh-target only;
- unchanged app upgrades deterministically in two clean roots;
- customer files survive byte-identically;
- modified managed file blocks;
- path collision and symlink escape block;
- failed preparation leaves source untouched;
- target CI freshness succeeds.

### U4 — Make customer migrations release-stable and assemble the application graph

Deliver:

```text
append-only migration emission
versioned immutable migration entrypoints or concrete source
cross-package migration dependency graph
manifest/settings/document/theme migration dry-run
large backfill checkpointing
```

Acceptance:

- prior migration files remain byte-identical after upgrade;
- fresh target install and source→target upgrade converge to the same schema/invariants;
- exact predecessor and concurrent-lock tests;
- disabled plugin migration behavior;
- backfill crash/resume;
- no silent custom document/page deletion.

### U5 — Integrate pre/post backup protection

Deliver:

```text
transition backup policy
source protection-point receipt
restore-proof freshness reader
post-upgrade protected-baseline backup
running-unprotected status and blockers
retention/rollback-window rules
```

Acceptance:

- risky update cannot proceed without protection;
- backup binds exact source/target inventory;
- clean restore works with integrations passive;
- post-backup failure does not falsely claim completion or delete rollback assets;
- no backup credential/content reaches browser or generic logs.

### U6 — Wire CLI, System Updates, source operator, and DeploymentSupervisor

Deliver:

```text
CLI check/plan/prepare/status/rollback
fixed System Updates routes and view models
closed mTLS operator commands
customer source PR adapter
protected CI/build authority
zero-downtime and maintenance orchestration
idempotent/restart-safe receipts
```

Acceptance:

- web has no repository/build/Docker/backup authority;
- current authority and reauthentication at every mutation;
- response loss/restart returns exact operation;
- one application/environment upgrade at a time;
- green receives no traffic/worker ownership before readiness;
- maintenance cannot be mislabeled zero downtime.

### U7 — Integrate live applications, themes, custom pages, and private plugins

Deliver:

```text
host ABI compatibility resolver
bridge-generation sequencing
custom/private Platform Plugin target admission
custom page/source/action/block dependency scan
Theme Profile/Skin migration and preview
settings readiness
```

Acceptance:

- compatible live generations survive host update;
- incompatible generation blocks or follows explicit maintenance;
- custom page remains intact or has exact diagnostic/migration;
- published Theme Profile is never silently changed;
- private plugin without target blocks before source/deployment mutation.

### U8 — Prove one real product release transition

Use an actual product transition, not only neutral fixtures:

```text
K-Nex 1.0.0 → 1.1.0
all official first-party train packages
Phase 12 generated application upgraded in place
Phase 13 representative CRM state
active and disabled Platform Plugin state
custom page and Theme Profile
one retained-compatible Hot Application/Theme Skin
customer config/custom file
pre-upgrade backup and clean restore proof
zero-downtime path and one maintenance-class fixture
post-upgrade backup
compatible rollback and irreversible-boundary denial
```

The evidence must include real PostgreSQL, packed customer repository, exact generator output, protected build/source evidence, Next/Payload HTTP, Chromium, operator restart, and deployment/backup receipts.

## 18. Gate 13 integration

Phase 13 P13.9 remains the first product requirement for this plan. Its “version upgrade” proof should be interpreted as:

```text
accepted Phase 12 product release
→ actual next K-Nex product release
→ coordinated core + Sales target train
→ existing generated repository reconciliation
→ representative CRM migration
→ protected deployment
→ post-upgrade backup and restore evidence
```

A same-platform neutral plugin fixture is useful unit evidence but is not sufficient for the Gate 13 product-upgrade claim.

P13.1–P13.8 may proceed while U1–U4 are prepared, provided CRM migrations:

- are append-only;
- have exact predecessor identities;
- preserve old/new overlap where zero downtime is claimed;
- do not depend on mutable aggregate migration imports;
- expose deterministic stored-artifact migrations;
- include a target release/train compatibility declaration.

## 19. Required end-to-end journey

```text
1. Generate customer-acme at K-Nex 1.0.0.
2. Bootstrap Owner and configure Sales, roles, Theme Profile, and a custom dashboard.
3. Install/enable a compatible live extension and disable one compiled official plugin fixture.
4. Add one supported customer-owned config override and leave all managed files unchanged.
5. Seed representative CRM records, files, jobs, audit, and outbox state.
6. Publish and sign K-Nex 1.1.0 with every official plugin target.
7. Open System → Updates and resolve the exact 1.0.0→1.1.0 plan.
8. Prove a modified managed-file clone blocks without touching source/runtime.
9. Prepare the real source change/PR from a clean source commit.
10. Verify package lock, release lock, generated ownership, new migrations, build, SBOM, and provenance.
11. Take and restore-verify the source protection point.
12. Execute online-expand/backfill or show explicit maintenance classification.
13. Start green web/worker generations; keep source traffic and worker authority until ready.
14. Promote once, survive dropped responses and operator restart, and converge browser/realtime state.
15. Verify CRM data, roles, pages, themes, settings, plugin enabled/disabled states, audits, and operations.
16. Take the target-state backup and mark protected completion.
17. Prove code rollback inside the window without data restore.
18. Prove contract cleanup is denied before post-backup/rollback closure.
19. Prove stale, duplicate, revoked, unsupported, and cross-customer operations fail closed.
```

## 20. Kill/rework criteria

Rework the design if implementation requires any of the following:

```text
rerunning create-knex-app over a non-empty customer repository
mutating live node_modules or running npm/pnpm lifecycle scripts in web/worker
using runtime database rows as the desired Platform Plugin graph
selecting “latest compatible” from a broad range after plan approval
overwriting customer-owned or modified generated files
editing an executed migration
importing mutable latest migration behavior from historical files
running production migration during package installation
promoting without exact source/build/package/generator/migration evidence
performing destructive migration without required protection point
claiming completion before the target-state backup policy is satisfied
closing rollback while old generation or source backup is still required
automatically restoring old data after target writes without explicit loss approval
silently disabling/removing an incompatible plugin or custom page dependency
calling a maintenance update zero downtime
creating a second mutable lifecycle truth in the Updates UI
```
