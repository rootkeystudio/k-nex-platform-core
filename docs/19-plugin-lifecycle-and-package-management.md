# Extension Lifecycle and Package Management

## Independent dimensions

```text
extension class
catalog/support/revocation status
artifact/package presence and verification
staged/active/rollback generation
application enabled state
configuration/capability readiness
migration/data compatibility
retention/archive/purge state
host deployment and traffic generation
```

One boolean cannot represent lifecycle safely.

## Platform Plugin lifecycle

A Platform Plugin is part of the host application artifact.

### Add or upgrade package

```text
catalog/release selection
→ exact dependency/provider resolution
→ static graph and migration/reference/topology plan
→ immutable image build and verification
→ expand migration when eligible
→ green start/warm/readiness
→ gateway promotion
→ drain/rollback receipt
```

The site remains available only when zero-downtime eligibility passes. Otherwise the plan is `maintenance-required`.

### Enable or disable preinstalled code

A plugin already present in the host image may change enabled state at runtime only when its manifest semantics, schema presence, migration revision, dependencies, settings, jobs, routes, references, and authorization readiness make this safe.

Disable does not remove bytes/schema/data. It revokes behavior, hides default UI, stops bounded schedules/subscribers, advances lifecycle/authorization revisions, and preserves retained state.

### Re-enable

Revalidates current artifact, migration, dependencies, configuration, references, and setup without reinstalling or overwriting customer state.

### Schema-owning removal

Generic remove-code/retain-readable-schema remains unsupported.

```text
reversible path  disable → re-enable
destructive path explicit purge migration/release
optional path    explicit archive/export project
```

Purge requires dependency/reference/retention/export/backup/approval/rollback evidence.

### Schema-less removal

Still requires a new host release because package bytes/static graph change. Data/reference cleanup is explicit, revision-bound, audited, and cannot silently delete mixed/assigned customer roles or referenced documents.

## Hot Application lifecycle

### Install

```text
catalog-available
→ planning
→ background download
→ verified
→ staged
→ waiting configuration/approval
→ warming
→ active
```

No package manager or install scripts run during customer activation.

### Update

Stage generation N+1 beside active N, validate/warm, atomically switch pointer, drain N, and retain compatible rollback data/artifact.

### Disable

Stop new routes/execution/schedules and hide default navigation while preserving artifact reference, settings, app storage, role/grant state, and rollback metadata according to policy.

### Re-enable

Revalidates artifact support/revocation, capabilities, settings, storage schema, runner health, permissions, and generation before restoring authority.

### Rollback

Restores a prior immutable generation only when its host ABI and data migration state are compatible. Otherwise rollback is explicitly unavailable.

### Uninstall

Retires the active generation first so no further execution is possible. Then applies reviewed retention policy:

```text
retain disabled state
archive/export app storage
purge storage and metadata
remove artifact references after rollback/retention window
```

A failed cleanup cannot restore execution authority. Reinstall of the same app ID creates a new authorization/runtime generation; old grants/data are not silently rebound.

## Theme Skin lifecycle

```text
install/update  verify, parse, preview, stage, atomic profile/generation activation
rollback        compatible prior generation pointer
remove          active-profile/reference checks, retirement, bounded cleanup
```

A skin contains no executable code. A full Theme Package follows Platform Plugin lifecycle.

## PluginManager states

```text
catalog-available
planning
downloading
verified
staged
waiting-configuration
waiting-approval
warming
active
disabled
update-available
rollback-available
quarantined
retirement-pending
removed
```

Every transition uses expected revision, operation ID, actor/automation identity, exact artifact/generation, idempotency, audit, and outbox.

## Runtime manager capabilities

The manager may:

```text
list catalog/inventory/health
produce impact and availability plan
download and verify immutable artifacts
stage/warm Hot Applications and Theme Skins
activate/update/rollback/disable/uninstall runtime generations
submit bounded Platform Plugin change requests to deployment supervisor
observe progress and receipts
```

It may not:

```text
run package manager inside web/worker
execute install scripts
import downloaded code into host
mutate static Payload config/registration
access Docker socket directly
bypass authorization/approval/migration fence
serve unverified artifacts
```

## Zero-downtime eligibility

A Platform Plugin plan is one of:

```text
zero-downtime-eligible
maintenance-required
unsupported
```

Eligibility requires old/new overlap, expand-compatible schema, safe writer/reader behavior, versioned/idempotent jobs/events, gateway capacity, runner/realtime convergence, target readiness, and rollback limits.

## Catalog and artifact identity

Runtime catalog points only to immutable signed artifacts. Identity includes publisher, source commit, release asset, manifest/artifact/SBOM/provenance digests, ABI/framework compatibility, requested capabilities, support, and revocation.

Arbitrary branch URLs and moving tags are not installable production sources.

## Failure behavior

- Download/verification failure leaves active state unchanged.
- Stage/warm failure quarantines/deletes target generation.
- Crash before activation/promotion leaves old active.
- Crash after commit recovers from persisted pointer/revision.
- Runner failure affects one app generation.
- Green host failure receives no traffic.
- Cleanup failure leaves retired authority and retryable hygiene state.
- Incompatible migration never enters zero-downtime promotion.

## Required tests

```text
catalog/digest/provenance/revocation failures
archive traversal/symlink/size bomb
no package-manager/install-script execution
host dynamic-import denial
runner/capability/storage/network escape
remote UI generation/CSP failure
activation/update/rollback races and crashes
multi-process revision convergence
continuous-traffic blue/green promotion
failed target keeps blue serving
maintenance-required refusal
schema-owning purge evidence
backup/restore exact generation inventory
```
