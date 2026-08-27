# Phase 8 Result — Lifecycle, Application Factory, Release, and Fleet Safety

- **Date:** 2026-08-27
- **Gate:** Gate 8
- **Baseline:** `ad60cf9`
- **Delivery:** stacked Phase 8 pull request; no merge or auto-merge
- **Decision:** **PLATFORM FOUNDATION ACCEPTED**
- **Review state:** BLOCKED at `d34f48a`; corrective implementation active

## Scope proved

The platform foundation now covers immutable package-release boundaries, deterministic upgrade planning, customer-owned migrations, PostgreSQL advisory locking, stale-artifact readiness, bounded archive/export, explicit purge, physical backup/clean restore, application generation, two independent Sales customers, release evidence, deployment inventory, and fleet patch/recovery operations.

Sales remains the only first-party domain module. Customer Alpha and Customer Beta use the same platform/Sales surface with different Postgres mode, Minimal/Neobrutalism theme, Sales settings, default pages, permissions/layout, dedicated lock, platform release, and cadence. No Cargo, Restaurant, or other product plugin was added.

## Completed tasks

| Task | Primary commit |
|---|---|
| P8.1 — release and compatibility boundaries | `3f830ae` |
| P8.2 — upgrade planning and customer migrations | `5efea55` |
| P8.3 — advisory lock and stale readiness | `790a0df` |
| P8.4 — archive/export, purge, backup, restore | `2a38c44` |
| P8.5 — `create-knex-app` plan/apply | `d8984c6` |
| P8.6 — two independent Sales customers | `4e0a77a` |
| P8.7 — SBOM and signed provenance | `60a433b` |
| P8.8 — deployment receipt/runtime inventory | `c4117fb` |
| P8.9 — fleet query, patch, prior upgrade, restore | `6720839` |
| P8.10 — closeout and full Gate 8 | `5dfe103` |

## Lifecycle and migration safety

- Upgrade preflight produces an ordered current-to-target graph and refuses version regression, gaps, duplicates, bad predecessors, unknown dependencies, cycles, stale inputs, and failed dry runs.
- The Sales fixture covers customer schema, source, action, tool, block, theme, template, and settings migrations while preserving customer-owned data.
- Production-style migration execution uses one dedicated PostgreSQL session, a deterministic application/database advisory lock, expected predecessor check, transaction, release-revision receipt, rollback/unlock, and stale-artifact readiness denial. Real Postgres proves concurrent refusal and interrupted DDL rollback.
- Archive/export is a versioned, permissioned, bounded administrator transfer. The official Payload Import/Export plugin was evaluated; it may be a future adapter but is not database backup, migration, legal retention, or full restore.
- Purge refuses unresolved references, dependents, retention, archive, clean-restore backup, reviewed migration, permission, or approval. Failed purge work rolls back.
- A physical `pg_dump`/`pg_restore` proof restores Sales data, CMS versions, layouts, settings, outbox, and migration state into a clean database with external effects disabled.

## Application and customer proof

`create-knex-app` deterministically plans/applies the Sales reference preset, exact dependencies, Payload Postgres mode, application manifest/config, migration/readiness steps, customer-owned default pages, and add/disable/enable/upgrade plans. Apply is idempotent and refuses overwriting customer edits; dependency installation remains a source-time CLI action, never runtime code installation.

Customer Alpha uses external Postgres, Minimal, page size 25, manager authority, tasks plus opportunities, monthly cadence, and platform release 0.2.0. Customer Beta uses local Docker Postgres, Neobrutalism, page size 50, representative authority, tasks only, quarterly cadence, and supported prior release 0.1.0. Their dedicated lock digests differ and both reconcile exact manifests, inventories, and deployment receipts.

## Release, deployment, and fleet proof

- Timestamp-free CycloneDX 1.6 SBOM and canonical provenance bind source commit, full-SHA workflow identity, manifest, lock, graph/plan, SBOM, and artifact digests.
- Local Ed25519 tests reject signature/payload substitution. The hosted workflow uses GitHub OIDC and `actions/attest` pinned to a complete SHA for signed provenance and SBOM attestations. No SLSA level is claimed.
- Generated JSON Schemas validate non-secret runtime inventory and deployment receipts. Receipt reconciliation rejects artifact, migration, inventory, readiness, or smoke drift.
- Receipt-only fleet ingestion keeps one current and one supported-prior customer. Sales `<1.0.1` identifies both deployments and generates customer-specific lock/upgrade/migration/deploy update plans.
- Beta dry-runs its previous-release upgrade through eight reviewed migration domains. Alpha's restore/redeploy reproduces the expected inventory digest. Generator marker: `P8_9_FLEET_EVIDENCE_PASS`.

## Validation

The closeout gate runs every earlier gate, all Postgres/browser/component/plugin proofs, both customer validators, contracts/composition/runtime suites, deterministic fleet evidence, and closeout reconciliation:

```bash
pnpm gate:8
pnpm audit --audit-level high
git diff --check
```

Exact-head `12fbf0512d0eaea38b781d97e97cc7aaf3fd19ef` passed the complete Gate 8. The final runtime suite reported 26 files and 196 tests. `pnpm audit --audit-level high` passed with 2 low, 3 moderate, 0 high, and 0 critical advisories; `git diff --check` passed. Detailed current state is recorded in `status.md`.

## Limits and production claims

- This is executable platform-foundation evidence, not production-observed fleet operation.
- GitHub-hosted attestation configuration is proved; a SLSA level is not claimed until independently verified.
- Sales is a reference architecture and test case, not a complete CRM.
- Customer Alpha/Beta validate independent composition and evidence; Gate 1 remains the full Payload/Postgres application boot fixture.
- Payload Import/Export remains uninstalled until a customer explicitly selects and proves the bounded adapter.

## Gate decision

The first exact-head full gate passed, but formal review demonstrated that required evidence could still be simulated, caller-authored, incomplete, or repaired by the gate itself. Phase acceptance is withdrawn until every review blocker is corrected and independently re-reviewed.

**Decision:** **PLATFORM FOUNDATION ACCEPTED**

**DO NOT START DOMAIN EXPANSION** until the stacked Phase 8 pull request receives project-manager PASS. Continue using Sales to harden infrastructure and system behavior.
