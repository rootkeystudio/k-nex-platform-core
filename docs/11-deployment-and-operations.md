# Deployment and Operations

## Customer deployment model

Each customer application is independently built, migrated, deployed, backed up, monitored, and upgraded.

```text
customer repository
→ frozen lockfile and deterministic Platform Plugin graph
→ validation/migration fixtures
→ immutable image
→ SBOM + signed provenance
→ migration/readiness fence
→ blue/green web/worker generations
→ deployment receipt + protected inventory
```

Hot Applications and Theme Skins add a second artifact plane without mutating that host image:

```text
signed catalog
→ immutable bundle
→ content-addressed artifact store
→ isolated app/skin generation
→ atomic active pointer
→ activation receipt + runtime inventory
```

## Reference resources

```text
stable gateway/reverse proxy
blue and green K-Nex web generations
worker/outbox process generations
k-nex-extension-runner service/pool
PostgreSQL
object storage and extension artifact storage
optional Redis/backplane by topology
separate deployment supervisor
secrets/backup/logs/metrics/traces/alerts
```

The main application has no Docker socket and no image build/publish credentials.

## Continuous-availability definitions

### Live activation

Hot Application/Theme Skin generation changes without restarting the host. The old active generation remains authoritative until one activation transaction commits.

### Zero-downtime deployment

A full Platform Plugin release starts and warms a new host generation while the old generation serves traffic. The gateway promotes only after verification/readiness.

### Maintenance-required

A migration or topology change is incompatible with old/new overlap. K-Nex refuses the zero-downtime label and presents an explicit maintenance plan.

No operation is considered zero downtime merely because a command returned successfully. Continuous external probes are evidence.

## PluginManager and DeploymentSupervisor

`PluginManager` handles extension plans and runtime lifecycle. It delegates full Platform Plugin release requests to `DeploymentSupervisor` through a narrow authenticated API.

Deployment supervisor responsibilities:

```text
resolve approved target release
verify artifact/provenance/SBOM/inventory
build or pull exact image
check migration compatibility and backup policy
obtain advisory lock/predecessor revision
run expand migrations
start target web/worker generation with zero traffic
warm/readiness/authenticated/public smoke
promote gateway target atomically
drain old requests/jobs/sockets
retain rollback generation
emit deployment receipt
```

The supervisor may use Docker Engine behind an adapter, Docker Swarm, or another accepted container orchestrator. Docker Compose alone is a development topology, not a production availability guarantee.

## Blue/green compatibility

A no-outage Platform Plugin change requires:

```text
old and new binaries can use the expanded schema concurrently
no destructive rename/drop before old generation drains
new readers tolerate old writers during overlap
jobs/events are versioned/idempotent and leases prevent duplicate ownership
new generation passes exact artifact/migration inventory
realtime reconnect/resync is supported
rollback remains data-compatible for the retained window
```

Recommended migration sequence:

```text
release A→B: expand schema + dual-compatible code
promote B and drain A
later release: contract/drop obsolete schema after fleet evidence
```

An operation that cannot satisfy overlap is maintenance-required.

## Hot Application activation

```text
plan and authorize
background download
verify signature/digests/SBOM/provenance/ABI/revocation
securely extract into content-addressed store
stage runner/UI generation
warm with no traffic
validate settings/capabilities/storage migration
commit active pointer + revision + receipt + audit + outbox
new calls/sessions use target generation
drain old generation
```

The artifact store retains exact prior generations for a bounded rollback window. Staged/unverified files are not public.

## Runner operations

The extension runner is independently health-checked and resource-controlled:

```text
non-root/read-only root
no Docker or DB credential
no ambient host secrets
network deny by default
CPU/memory/time/concurrency quotas
bounded IPC/input/output/logs
generation-level quarantine and restart
```

Runner crash affects app calls, not gateway/web availability. Persistent app data remains in platform-owned storage rather than runner local disk.

## Remote UI delivery

Remote UI assets are content-addressed and generation-pinned. The host serves only verified assets with strict content types, CSP, integrity/cache headers, and no directory traversal.

The browser loads app UI in a Web Worker/equivalent isolated realm. App updates do not mutate host JavaScript chunks.

## Realtime and multi-process topology

```text
PostgreSQL transaction
→ extension/deployment revision
→ transactional outbox invalidation
→ web/worker/runner/gateway/browser refresh
→ periodic revision polling for lost-message convergence
```

Socket clients reconnect/resubscribe/resync during host generation promotion. WebSocket delivery remains a hint, not business truth.

## Backup and restore

Backups include:

```text
business/CMS data
roles/settings/layouts/theme profiles
extension install and active-generation records
Hot Application settings/storage
artifact/catalog/provenance references
outbox/idempotency/audit
migration and deployment revisions
```

Extension artifacts are either backed up or reproducibly available by immutable digest with verified source. Restore verifies exact host release, active app/skin generations, settings/storage schemas, disabled/orphan state, runner readiness, and external integration safety.

## Runtime and fleet inventory

Protected inventory combines:

```text
host artifact/container digest
static Platform Plugin graph and package integrity
framework and migration revision
active/rollback Hot Application generations and bundle digests
active Theme Skin generations/profile revisions
runner/gateway/deployment topology
SBOM/provenance/deployment and activation receipts
backup/restore freshness
```

Manual desired-state files cannot override observed deployed/active truth.

## CI and publication

Platform release pipeline:

```text
frozen install
contracts/fixtures/generation checks
lint/type/unit/security/accessibility
real Postgres clean/upgrade/restore
packed-package boundaries
image build and smoke
SBOM/provenance
blue/green compatibility plan
```

Hot Application/skin publication pipeline:

```text
exact dependency install in protected builder
bundle dependencies and inspect imports
manifest/schema/conformance tests
runner/remote UI/skin tests
artifact digest + SBOM + provenance
immutable release asset
signed catalog update
```

Customer activation never rebuilds or installs dependencies.

## Failure handling

- Failed staged app/skin generation cannot affect active generation.
- Failed green host generation cannot receive traffic.
- Crash before pointer/traffic commit leaves old active.
- Crash after commit converges from persisted revision.
- Catalog revocation can block new activation and quarantine according to security policy.
- Rollback is allowed only across declared compatible data state.
- Maintenance operation needs backup, explicit approval, bounded outage procedure, and post-readiness receipt.

## Required evidence

```text
continuous HTTP probe across compatible host promotion
in-flight request/job drain and duplicate-effect checks
socket reconnect/resync
failed target and rollback
incompatible migration refusal
app generation activation/update/rollback races
runner crash/OOM/timeout isolation
remote UI asset/CSP failure
backup/restore exact inventory
web process Docker-socket denial
```
