# ADR-0028: Coordinated Platform Release Trains and Safe Customer Application Upgrades

- Status: accepted
- Date: 2026-09-06
- Decision owners: K-Nex platform maintainers
- Evidence: design-only
- Related: [ADR-0001](./0001-independent-customer-applications.md), [ADR-0004](./0004-manifest-driven-cli.md), [ADR-0017](./0017-deterministic-composition-and-registration-reconciliation.md), [ADR-0021](./0021-dynamic-application-runtime-and-zero-downtime-delivery.md), [ADR-0023](./0023-phase-9-production-isolation-and-static-delivery-hardening.md), [ADR-0027](./0027-generated-administration-operator-transport.md), [Data, migrations, and versioning](../10-data-migrations-and-versioning.md), [Deployment and operations](../11-deployment-and-operations.md), [CLI and project generation](../15-cli-and-project-generation.md), [implementation plan](../implementation/platform-release-train-and-customer-application-upgrades.md)

## Context

Phase 12 produces a runnable customer repository from an exact K-Nex package closure. The generated application can install and operate extensions, but a customer also needs a safe product-level upgrade path after the repository has accumulated:

```text
customer-owned source and configuration
committed generated files
an exact package lock
installed, disabled, and runtime extensions
customer-owned PostgreSQL migrations and data
custom pages, Theme Profiles, settings, roles, and audits
backup and deployment history
```

A user-facing update cannot be implemented as `pnpm update`, by rerunning `create-knex-app` over the repository, by editing the live container, or by applying database migrations as an incidental package-install side effect.

The current package release manifest proves one immutable release closure. The current upgrade planner proves ordered artifact migration inside one platform release fixture. Neither alone defines a product release train from K-Nex `R` to `R+1`, regeneration of an existing customer repository, coordinated first-party plugin versions, pre/post-upgrade backup policy, or full application rollback semantics.

The desired product experience is:

```text
K-Nex 1.0.0 application
+ its selected official plugins
+ customer configuration and data

→ inspect K-Nex 1.1.0
→ see the exact core/plugin/generated/migration/backup impact
→ approve one bounded operation
→ obtain a verified target application generation
→ migrate and promote safely
→ retain a truthful rollback path
→ create a protected backup of the upgraded state
```

## Decision

### 1. Official first-party packages ship as one coordinated release train

K-Nex publishes a product release identity such as `1.1.0`. For the V1 first-party line:

```text
@k-nex core packages
official Platform Plugins
official providers
official builders
executable Theme Packages
official tooling required by generated applications
```

are published, tested, and attested together for that release.

The default first-party policy is lockstep user-facing versions: the package version of every official train member equals the platform release version. An unchanged package may be republished as a new immutable version, but an existing version is never reused with different bytes.

The signed release manifest remains the canonical compatibility source. Numeric equality is a first-party publication policy, not permission to infer compatibility for third-party packages.

Publication of a first-party release fails if any supported first-party plugin lacks an exact target artifact, exact framework tuple, conformance evidence, or declared upgrade disposition.

### 2. Release closure and release transition are separate signed artifacts

`PackageReleaseManifest` continues to describe the exact package closure for one release.

A new signed `PlatformReleaseTransitionManifest` describes one supported transition between exact release manifests. It binds at least:

```text
source release and manifest digest
target release and manifest digest
allowed direct predecessors
exact package/plugin source → target mapping
generator and application-manifest schema transition
framework/runtime tuple transition
migration graph and phase classification
stored document/settings/theme compatibility
Hot Application and Theme Skin host-ABI requirements
backup and restore policy
zero-downtime, maintenance, and rollback classification
support, security, revocation, and expiry metadata
```

A moving channel or tag may discover a target, but every plan resolves it to immutable versions, commits, digests, manifests, and attestations before approval.

Skipping releases is allowed only when a signed direct transition exists. Otherwise K-Nex composes and executes the required adjacent transitions in order. It never invents a migration path from broad semver ranges.

### 3. `create-knex-app` is creation-only; existing applications use an upgrade compiler

`create-knex-app` creates a fresh repository. It is never rerun over an existing customer repository as an upgrade mechanism.

Existing applications use:

```text
k-nex app upgrade check
k-nex app upgrade plan --to <release>
k-nex app upgrade prepare
k-nex app upgrade apply
k-nex app upgrade status
k-nex app upgrade rollback
```

or the equivalent fixed System Updates UI backed by the external administration/source/build/deployment operators.

The upgrade compiler consumes the current customer source commit, current release lock, application manifest, exact previous generated-state manifest, installed package/plugin inventory, target release and transition manifests, customer config fingerprint, database migration state, runtime extension inventory, and backup state.

It produces one immutable, digest-bound plan. Stale source, lock, authority, inventory, migration, generator, or backup state invalidates the plan.

### 4. Target generation always runs, but customer-owned source is never overwritten

Every upgrade computes the complete target generated output in an isolated worktree. This is required even when the final diff is empty, because generator/schema/package compatibility must be proven.

Generated paths are tracked by a committed ownership manifest with one of these modes:

```text
managed       replace/delete only when current bytes equal the recorded prior generated digest
append-only   existing migration/history file is immutable; target may only add a new identity
template      create if absent; never overwrite an existing customer instance
customer      never generated or modified by the upgrade compiler
```

Rules:

1. A modified managed file is a conflict, not an automatic overwrite or hidden three-way merge.
2. A target managed path colliding with a customer file is a conflict.
3. Deleting a managed path is allowed only when its bytes still equal the recorded prior generated digest and reference scans pass.
4. Customer-owned files, `k-nex.config.ts`, custom extensions, secrets, assets, custom migrations, and database content are not replaced by regeneration.
5. The package lock, release lock, packed artifacts, generated registries, and managed output update atomically in the prepared source change.
6. CI regenerates the target output and verifies byte freshness before build attestation.

Generated source should remain a thin host adapter. Stable behavior belongs in versioned packages so routine upgrades minimize generated diff surface.

### 5. Desired composition is source-controlled and exact

`k-nex.app.json` remains the desired static composition. The release lock records the exact resolved train, package closure, generator identity, generated ownership digest, and transition lineage.

An application upgrade:

- updates only plugins/providers/builders/themes already selected in desired composition;
- does not silently install, enable, disable, uninstall, or replace a plugin;
- upgrades a compiled but disabled Platform Plugin to its target train artifact while preserving its disabled runtime state;
- preserves customer configuration and explicit plugin settings unless a declared migration or unresolved required setting requires review;
- rejects package or manifest drift rather than normalizing it silently.

### 6. Official, custom, and live extensions have explicit compatibility outcomes

For each selected extension, the plan returns exactly one outcome:

```text
exact-target       target train contains the required immutable artifact
retained-compatible current live generation is explicitly compatible with both hosts
upgrade-required   a target/bridge generation must be staged
replacement-required no compatible target exists; explicit replacement/removal decision needed
maintenance-required safe overlap cannot be proven
unsupported        no signed upgrade path exists
```

Official first-party Platform Plugins must have `exact-target` before a train is published.

A customer/private Platform Plugin is never assumed compatible from a version range. It must be rebuilt and attested against the target framework tuple or block the host upgrade.

Hot Applications and Theme Skins may remain on the current immutable generation only when their signed host-ABI declaration covers both source and target host generations. Otherwise an exact compatible or bridge generation is staged and sequenced. Lack of an overlap path is `maintenance-required` or `unsupported`, not a partial silent outage.

### 7. Customer migrations remain append-only, exact, and deployment-owned

Package installation does not run production migrations.

The target compiler assembles one deterministic migration plan across platform core and every selected Platform Plugin. Existing executed migration files are never edited. New migrations use unique identities and exact predecessor revisions.

A generated migration may not import a mutable “latest migration” implementation. It must either:

- contain the reviewed customer migration source; or
- import an immutable versioned migration entrypoint that future package releases retain byte-compatibly.

Migration work is classified using the existing phases:

```text
online-expand
online-backfill
post-retirement-contract
offline-required
```

The deployment supervisor owns production execution, advisory locks, predecessor checks, worker fencing, readiness, and receipts. Large backfills are resumable and checkpointed. Destructive/contract work never runs before the old generation retires and the rollback window closes.

### 8. Every production upgrade has pre- and post-upgrade protection points

Before promotion, the operation requires a protection point bound to the exact source release, deployment/image, package and extension inventory, database migration revision, object/storage state, and backup receipt.

A newly taken pre-upgrade backup is mandatory when the transition changes schema/data, changes the framework/runtime tuple, is maintenance-required, contains destructive work, or the existing verified backup is outside the transition policy’s freshness window. A no-data patch may reuse a recent restore-verified backup only when the signed transition policy explicitly permits it.

After successful target promotion and stabilization, K-Nex creates a post-upgrade backup bound to the target release and final inventory. This is the new protected baseline requested by the product experience.

An upgrade is not labeled `protected-complete` until the post-upgrade backup succeeds. If that backup fails, the application may remain healthy and active, but:

```text
status = running-unprotected
pre-upgrade backup and old generation are retained
rollback window is not closed
contract cleanup and the next upgrade are blocked
an operator alert remains active
```

Restore drills are risk/freshness-policy driven. A high-risk or maintenance transition requires a clean restore proof before irreversible work.

### 9. Promotion reuses the existing static deployment authority

The generated web application may check, display, request, and observe an upgrade. It does not gain package-manager, repository-write, build, Docker, database-superuser, backup-key, or gateway authority.

For managed production:

```text
System Updates request
→ external source operator creates an exact customer-repository change/PR
→ protected CI regenerates, tests, builds, and attests
→ backup operator produces the required protection point
→ DeploymentSupervisor runs migration phases, starts green web/worker generations,
   verifies readiness, promotes traffic and worker fences, and emits receipts
→ post-upgrade backup becomes the new protected baseline
```

For self-hosted/local workflows, the CLI prepares the same source change in an isolated worktree. Production mutation still follows the same reviewed build, migration, backup, and deployment boundaries.

No second lifecycle truth is introduced. The Updates UI is a projection over authoritative source-change, build, backup, migration, deployment, extension, and operation records.

### 10. Rollback is explicit about code, schema, and data

Before post-retirement contract work, an overlap-compatible release normally rolls back by promoting the retained old application generation while keeping the expanded schema. It does not automatically restore the pre-upgrade database.

After irreversible/offline work or contract cleanup, rollback may require maintenance and restore. The UI must show the data-loss window and require explicit approval.

K-Nex never automatically restores an old backup after users have written new target-release data. Forward repair is preferred unless a reviewed restore decision accepts the loss/reconciliation plan.

The old image, source commit, release bundle, pre-upgrade backup, and receipts are retained until rollback closure and post-upgrade backup completion.

### 11. Independent customer cadence remains intact

Each customer repository chooses when to accept a supported release. A fleet service may report eligibility, blockers, backup freshness, and security exposure, and may open upgrade PRs, but it does not mutate every customer runtime as shared tenancy.

Emergency security updates use the same immutable plan and authority chain. They may shorten approval windows, but they do not bypass artifact, migration, backup, or receipt binding.

## User experience

The fixed `System → Updates` surface shows:

```text
current release and exact deployment
available exact target release
core/framework changes
selected plugin target matrix
custom/private plugin blockers
Hot Application/Theme Skin compatibility
managed generated-file changes and conflicts
new migrations/backfills and downtime classification
required settings or secret references
pre-upgrade backup and restore-proof status
rollback window and irreversible boundary
source PR/build/deployment/post-backup progress
```

Primary actions are server-derived:

```text
Check for updates
Review plan
Prepare source change
Approve/Schedule update
Open generated PR
Observe deployment
Rollback within window
Acknowledge maintenance/restore plan
```

The browser never supplies package URLs, tags, digests, migration code, generated paths, backup IDs, image tags, or deployment topology.

## Consequences

### Positive

- One K-Nex release gives users a coherent, tested core/plugin set instead of an arbitrary dependency puzzle.
- Existing customer repositories can evolve without rerunning creation or overwriting customer code.
- Generated code stays deterministic and reviewable.
- Package, generator, migration, backup, deployment, and rollback evidence bind one operation.
- Disabled plugins, custom pages, live applications, and Theme Profiles have explicit upgrade behavior.
- Every successful upgrade leaves both a source rollback path and a protected backup of the final state.

### Costs

- Release publication must build and attest the entire supported first-party train.
- The application compiler needs generated-file ownership and upgrade reconciliation in addition to fresh creation.
- Direct predecessor transition manifests and retained migration implementations add release-maintenance cost.
- Private Platform Plugins can delay a core upgrade until rebuilt or explicitly removed.
- Post-upgrade backup and rollback retention increase storage and operational work.

## Alternatives considered

### Run `pnpm update` in the customer repository or live container

Rejected. It does not select one attested train, coordinate plugin compatibility, regenerate static registries, produce customer migrations, or bind deployment/backup evidence. Live-container mutation also violates immutable delivery.

### Rerun `create-knex-app` and copy customer files back

Rejected. It cannot distinguish generated and customer ownership safely, loses repository history, and invites silent source/configuration drift.

### Let every plugin independently choose a semver range

Rejected for the official first-party product line. Range resolution produces combinations that were not necessarily tested together. Exact train manifests are authoritative.

### Update core first and plugins later

Rejected for static Platform Plugins. The application image and frozen registration graph must be one coherent package closure. Live applications may have separately sequenced generations only through declared host-ABI compatibility.

### Automatically restore the pre-upgrade backup on failure

Rejected as the generic response. Restore can discard writes accepted after the protection point. Rollback and restore remain separate reviewed operations.

### Rewrite executed migration files during regeneration

Rejected. Historical migration meaning must not change when package versions change.

## Validation

Executable promotion from `design-only` requires at least one real direct release transition such as `1.0.0 → 1.1.0` proving:

```text
all first-party train artifacts and transition manifests are signed and exact
an existing generated customer repository is upgraded without rerunning creation
customer-owned modifications survive and modified managed files block safely
lock/package/registry/generated output is deterministic
existing migration files remain byte-identical and new migrations are append-only
representative database and stored document migrations complete from exact predecessor
active and disabled Platform Plugins reach target train versions without state confusion
compatible live applications/skins survive or upgrade with no false ABI claim
fresh pre-upgrade backup and restore proof bind the source inventory
blue/green or explicit maintenance delivery is truthful
failure before promotion leaves source generation active
rollback works inside the declared window
post-upgrade backup binds the final target inventory
response loss, restart, duplicate apply, stale plan, missing plugin, revoked target,
backup failure, migration failure, and generated-file conflict fail deterministically
```
