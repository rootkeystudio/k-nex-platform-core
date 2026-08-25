# Deployment and Operations

## Deployment model

Each customer application is independently built, migrated, deployed, backed up, monitored, and upgraded.

```text
customer repository
  → frozen lockfile and deterministic resolved graph
  → validation, tests, migration fixtures
  → immutable artifact/container
  → SBOM + signed provenance
  → migration job with advisory lock/revision fence
  → web/worker/realtime deployment
  → deployment receipt + runtime inventory
```

## Baseline resources

```text
customer Postgres database and credentials
object storage boundary
application/signing/integration secrets
optional Redis namespace/instance
customer domains/TLS
backups and retention
logs/metrics/traces/alerts by application/release
```

Physical managed infrastructure can be shared by a provider, but logical credentials and data ownership remain customer-scoped.

## Process topology

Small application without realtime:

```text
web + optional worker
Postgres
object storage
```

Memory realtime:

```text
one process owns HTTP/socket connections and every invalidation publication path
```

Separate worker or multiple web instances:

```text
web/worker/gateway
  → Redis Socket.IO adapter or Postgres outbox relay
```

Readiness rejects an incompatible memory topology.

## Deterministic artifact and release evidence

Committed generated files are timestamp-free. CI separately emits:

```text
source commit and workflow identity
manifest/resolved graph/lockfile digests
package integrity and SBOM
artifact/container digest
signed build provenance
migration revision
```

Deployment records:

```text
application/environment
artifact digest
migration revision
provider/process topology
deployment time and approved actor/workflow
smoke/readiness outcome
```

Runtime exposes a protected non-secret inventory endpoint. These records are authoritative for fleet queries.

## CI pipeline

```text
checkout exact commit
install frozen lockfile with restricted scripts
architecture/schema/fixture checks
k-nex generate --check and clean double-generation
package integrity and declared/actual inventory checks
lint/typecheck/unit/contract/security/accessibility tests
real Postgres clean and previous-release migration tests
builder/theme/source/realtime fixtures as their gates mature
packed-package export/type checks
build immutable artifact
SBOM/provenance generation
container/process smoke tests
```

No floating customer dependency or lockfile rewrite.

## Reusable workflows

Reusable workflow calls must use a reviewed full commit SHA and explicit least-privilege inputs/secrets:

```yaml
jobs:
  validate:
    uses: rootkeystudio/k-nex-workflows/.github/workflows/validate.yml@<full-commit-sha>

  deploy:
    needs: validate
    permissions:
      contents: read
      id-token: write
    uses: rootkeystudio/k-nex-workflows/.github/workflows/deploy.yml@<full-commit-sha>
    with:
      environment: production
    secrets:
      registry-token: ${{ secrets.REGISTRY_READ_TOKEN }}
```

Use OIDC for cloud authentication where supported. Do not inherit every repository secret.

## Deployment sequence

1. verify approved artifact, provenance, SBOM, and exact inventory;
2. validate environment/provider/process readiness;
3. verify backup policy for migration risk;
4. obtain migration advisory lock and predecessor revision;
5. run customer-owned migration/backfill;
6. deploy compatible web/worker/realtime order;
7. drain/reconnect sockets;
8. verify readiness and runtime inventory against artifact;
9. run authenticated/public smoke and publication fixtures;
10. emit deployment receipt and monitor.

## Backup and restore

Backups include business data plus CMS drafts/versions, workspace layouts, theme profiles, permissions/users, runtime settings, jobs/outbox/idempotency/audit according to policy. Object storage and specialized stores have explicit consistent backup or reproducibility classification.

A backup is valid only after restore testing. Restore tests disable or redirect external integrations and verify migration/inventory, published renders, protected media, orphan reports, job/outbox replay safety, and authentication/signing behavior.

## Fleet inventory

Fleet state is generated from verifiable deployment evidence:

```text
application/repository/environment
artifact/container digest
source and workflow identity
resolved graph + lockfile + SBOM digest
Payload/core/plugin/provider/builder/theme versions
migration revision
backup/restore freshness
runtime readiness
```

A manual operations repository can store ownership, support tier, domains, and desired targets; it cannot override observed deployed versions.

Fleet tooling must answer which deployed customers use an affected package/range and open customer-specific upgrade PRs.

## Supply chain

Before production package distribution:

- protected source and publishing workflows;
- immutable exact package versions/integrity;
- install-script review policy;
- dependency/license/vulnerability scanning;
- SBOM;
- signed provenance from hosted build infrastructure;
- signed/protected release identity;
- artifact digest and deployment receipt;
- incident/fleet impact workflow.

Target: verifiable provenance equivalent to SLSA Build L2 before claiming that maturity.

## Repository governance

`main` should be PR-only with required architecture-contract check, required owner review for contracts/schemas/ADRs/workflows, branch deletion restrictions, and protected release tags. CODEOWNERS and CI are source-controlled; GitHub branch/ruleset enforcement is a separate required repository setting.
