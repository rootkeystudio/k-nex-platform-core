# Phase 8 Result — Lifecycle, Application Factory, Release, and Fleet Safety

- **Date:** 2026-08-27
- **Gate:** Gate 8
- **Baseline:** `9056043`
- **Delivery:** stacked Phase 8 pull request; no merge or auto-merge
- **Decision:** **PLATFORM FOUNDATION ACCEPTED**
- **Review state:** Independent Sol-high PASS at corrected implementation/evidence head `d09fb4f`; designated PR review pending

## Scope proved

The platform foundation now covers immutable package-release boundaries, deterministic upgrade planning, customer-owned migrations, PostgreSQL advisory locking, stale-artifact readiness, bounded archive/export, explicit purge, physical backup/clean restore, application generation, two independent Sales customers, release evidence, deployment inventory, and fleet patch/recovery operations.

Sales remains the only first-party domain module. Customer Alpha and Customer Beta use the same platform/Sales surface with different Postgres mode, Minimal/Neobrutalism theme, Sales settings, default pages, permissions/layout, dedicated lock, platform release, and cadence. No Cargo, Restaurant, or other product plugin was added.

## Completed tasks

| Task | Primary commit |
|---|---|
| P8.1 — release and compatibility boundaries | `ff7dd3a` |
| P8.2 — upgrade planning and customer migrations | `c9992af` |
| P8.3 — advisory lock and stale readiness | `72a789e` |
| P8.4 — archive/export, purge, backup, restore | `fa328d5` |
| P8.5 — `create-knex-app` plan/apply | `55546e6` |
| P8.6 — two independent Sales customers | `e2a4589` |
| P8.7 — SBOM and signed provenance | `36edcc1` |
| P8.8 — deployment receipt/runtime inventory | `4342f47` |
| P8.9 — fleet query, patch, prior upgrade, restore | `b2fbccb` |
| P8.10 — closeout and full Gate 8 | `a8f3956` |

## Lifecycle and migration safety

- Upgrade preflight produces an ordered current-to-target graph and refuses version regression, gaps, duplicates, bad predecessors, unknown dependencies, cycles, stale inputs, and failed dry runs.
- The Sales fixture covers customer schema, source, action, tool, block, theme, template, and settings migrations while preserving customer-owned data.
- Production-style migration execution uses one dedicated PostgreSQL session, a deterministic application/database advisory lock, expected predecessor check, transaction, release-revision receipt, rollback/unlock, and stale-artifact readiness denial. Real Postgres proves concurrent refusal and interrupted DDL rollback.
- Archive/export is a versioned, permissioned, bounded administrator transfer. The official Payload Import/Export plugin was evaluated; it may be a future adapter but is not database backup, migration, legal retention, or full restore.
- Purge refuses unresolved references, dependents, retention, archive, clean-restore backup, reviewed migration, permission, or approval. Failed purge work rolls back.
- A physical `pg_dump`/`pg_restore` proof restores Sales data, CMS versions, layouts, settings, outbox, and migration state into a clean database with external effects disabled.

## Application and customer proof

`create-knex-app` deterministically plans/applies the Sales reference preset, exact dependencies, Payload Postgres mode, application manifest/config, production migrations, typed boot entrypoint, readiness steps, customer-owned default pages, and add/disable/enable/upgrade plans. Apply is atomic, idempotent, and rejects path traversal, symlink traversal, partial promotion, and customer-file overwrite; dependency installation remains a source-time CLI action, never runtime code installation.

Customer Alpha uses external Postgres, Minimal, page size 25, manager authority, tasks plus opportunities, monthly cadence, and platform release 0.2.0 with Sales 1.0.0. Customer Beta uses local Docker Postgres, Neobrutalism, page size 50, representative authority, tasks only, quarterly cadence, and supported prior release 0.1.0 with Sales 0.9.0. Both are isolated pnpm workspaces installed from an 18-artifact mirror containing the complete closure plus distinct prior/current/security-target Sales tarballs, with no workspace links. A clean PostgreSQL test also creates two fresh applications through the factory, installs each from its selected release manifest and packed mirror, compiles and boots the current and prior Payload applications, runs two production migrations, registers both Sales collections, instantiates both default pages, queries Sales, and proves every K-Nex resolution comes from the generated app's packed `.pnpm` tree.

## Release, deployment, and fleet proof

- Timestamp-free CycloneDX 1.6 SBOM and canonical provenance bind source commit, full-SHA workflow identity, manifest, lock, complete transitive graph, SBOM, and artifact digests. Corrected evidence uses release-source commit `fe2cd80`, a descendant of final Phase 7 and ancestor of the evidence head. Evidence generation and Gate 8 require exact source/current release-manifest parity, verify every packed identity and SHA512 digest, require source/current artifact byte parity, and recompute application manifest, lock, plan, subject, and derived SBOM digests. Existing non-ancestor commits and stale current bytes fail closed.
- Local Ed25519 tests reject signature/payload substitution. The hosted workflow uses GitHub OIDC and `actions/attest` pinned to a complete SHA for signed provenance and SBOM attestations. No SLSA level is claimed.
- Generated JSON Schemas validate non-secret runtime inventory and deployment receipts. Receipt reconciliation rejects artifact, migration, inventory, readiness, or smoke drift.
- Authority-issued, signature-verified fleet ingestion keeps one current and one supported-prior customer. The clean-boot proof serves inventory from a protected runtime endpoint, rejects anonymous observation, reconciles live PostgreSQL readiness, verifies signed deployment receipt and provenance, then issues the only token Fleet accepts. Sales `<1.0.1` and transitive `semver <7.8.6` identify both deployments. A trusted 0.2.1 release manifest binds the real Sales 1.0.1 tarball and generates customer-specific lock/upgrade/migration/deploy update plans for both.
- Fleet orders deployment receipts by RFC 3339 instant across timezone offsets, rejects chronological regression, and refuses a manifest-listed security target that remains inside the vulnerable range. Destructive purge consumes its authoritative plan before transaction start and binds the reviewed migration ID, predecessor revision, and target revision through execution, preventing success or failure replay.
- Beta installs and boots the actual Sales 0.9.0 prior artifact, then upgrades to the manifest-bound 1.0.0 artifact through eight reviewed migration domains. Alpha's restore/redeploy reproduces the expected inventory digest. Generator marker: `P8_9_FLEET_EVIDENCE_PASS`.

## Validation

The closeout gate runs every earlier gate, all Postgres/browser/component/plugin proofs, both customer validators, contracts/composition/runtime suites, deterministic fleet evidence, and closeout reconciliation:

```bash
pnpm gate:8
pnpm audit --audit-level high
git diff --check
```

The corrective full run on the refreshed candidate covers Phase 0 through Gate 8, five PostgreSQL scenarios including factory-generated prior/current applications, 18 packed release identities, two protected runtime observations, 151 contracts tests, 83 composition tests, and 226 runtime tests. Packed SHA512/content closure, stale-evidence rejection, generated-artifact reproducibility, browser/accessibility, plugin conformance, and `git diff --check` pass. The audit reports no high or critical findings; two low and three moderate advisories remain.

## Limits and production claims

- This is executable platform-foundation evidence, not production-observed fleet operation.
- GitHub-hosted attestation configuration is proved; a SLSA level is not claimed until independently verified.
- Sales is a reference architecture and test case, not a complete CRM.
- Customer Alpha/Beta validate independent packed composition, clean production migration/boot, and protected deployment observation; broader transactional/outbox behavior remains in Gate 1.
- Payload Import/Export remains uninstalled until a customer explicitly selects and proves the bounded adapter.

## Gate decision

The first formal review correctly rejected caller-authored lifecycle evidence, unenforced support policy, workspace-linked customer fixtures, incomplete transitive inventory, forgeable deployment state, simulated recovery, and a self-repairing gate. Corrective work now makes those paths executor/authority-issued, manifest-enforced, packed and clean-booted, transitive, signed and runtime-observed, PostgreSQL-backed, exact-source-bound, and stale-evidence rejecting. Restacking on final Phase 7 refreshed the complete packed closure, all dependent lock/static artifacts, and source-tree provenance without relying on discarded task hashes. Sol-high review at `6d44b88` then found vulnerable-target acceptance, offset-unsafe fleet freshness, and replayable purge authority; all three are corrected with focused regressions and a new complete Gate 8 PASS. Independent Sol-high re-review returned PASS at `d09fb4f`. No Gate 8 kill criterion fired; designated PR review remains pending.

**Decision:** **PLATFORM FOUNDATION ACCEPTED**

**DO NOT START DOMAIN EXPANSION** until the stacked Phase 8 pull request receives project-manager PASS. Continue using Sales to harden infrastructure and system behavior.
