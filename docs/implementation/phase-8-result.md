# Phase 8 Result — Lifecycle, Application Factory, Release, and Fleet Safety

- **Date:** 2026-08-28
- **Gate:** Gate 8
- **Accepted base:** `7e89949e17c0edcded2fe67e41b518d31ada4ba1`
- **Delivery:** one Phase 8 pull request based directly on `main`; no merge or auto-merge
- **Decision:** **READY FOR PHASE REVIEW**
- **Review state:** PR 23 project-manager blockers remediated; final designated review pending

## Scope proved

Phase 8 delivers release boundaries, upgrade planning, customer-owned migration fencing, lifecycle evidence, purge authority, physical backup/restore, deterministic application generation, two independent Sales customers, hosted release attestations, deployment inventory, and full-release fleet patch transitions.

Sales remains the only first-party domain module. No Cargo, Restaurant, or other domain plugin was introduced.

## Completed task matrix

| Task | Result |
|---|---|
| P8.1 | Exact framework tuple, canonical package manifests, immutable packed closure |
| P8.2 | Ordered upgrade targets and reviewed customer migrations |
| P8.3 | Database-session-derived advisory locks, rollback, receipts, stale readiness |
| P8.4 | Bounded archive/backup streams, content storage, lifecycle-issued purge authority |
| P8.5 | Deterministic Sales application factory with verified immutable package staging |
| P8.6 | Independent Alpha/Beta manifests, locks, settings, themes, and Postgres modes |
| P8.7 | Deterministic deployable bundle, CycloneDX SBOM, GitHub/Sigstore attestations |
| P8.8 | Protected runtime inventory, deployment receipt, hosted release trust adapter |
| P8.9 | Verified full-release patch transitions, prior upgrade, clean restore |
| P8.10 | Hosted evidence ingestion, complete Gate 8, phase closeout |

## Lifecycle and migration safety

- Upgrade preflight rejects regressions, gaps, duplicate targets, invalid predecessors, unknown dependencies, cycles, stale inputs, and failed dry runs.
- Sales exercises customer schema, source, action, tool, block, theme, template, and settings migrations while preserving customer-owned state.
- Migration execution owns one PostgreSQL session and derives the lock identity from `pg_database` on that session. Callers cannot split the lock using connection labels. Two equivalent pool descriptions contend on the same real database; interrupted DDL and revision updates roll back together.
- Archive and backup content use bounded async byte streams. Archive plans limit documents, bytes per document, and total bytes. Content-addressed receipts bind digest, object key, byte length, and encryption-key reference; clean restore reads the exact receipt-addressed object.
- Purge inputs are obtained by an injected server-side authority: reference scanner, dependency scanner, retention evaluator, migration registry, database revision, and actor/session approval evaluator. Issued plans bind those revisions and archive/backup digests, consume approval once, and revalidate before any transaction begins.
- Physical `pg_dump`/`pg_restore` evidence restores Sales data, CMS versions, layouts, settings, outbox, and migration state into a clean database with external effects disabled.

## Application and customer proof

`create-knex-app` generates the Sales reference application, exact Payload/Postgres configuration, customer-owned migrations, typed boot/readiness entrypoints, default pages, frozen dependency policy, and Docker or external Postgres mode.

The composition library—not only the CLI—opens every packed artifact, verifies manifest integrity and embedded package identity, captures immutable bytes in its authority-issued plan, and stages those exact bytes under `.k-nex/packages`. A post-plan mirror replacement cannot alter the installed app; missing, tampered, wrong-identity, cloned-plan, symlink, partial-promotion, and customer-overwrite paths fail closed.

Customer Alpha uses external Postgres, Minimal, current platform release 0.2.0, and Sales 1.0.0. Customer Beta uses Docker Postgres, Neobrutalism, supported prior platform release 0.1.0, and Sales 0.9.0. Fresh generated current/prior applications install from their selected release closures, compile, migrate, boot, register both Sales collections, instantiate default pages, and resolve K-Nex packages from their own packed trees.

## Release, deployment, and fleet proof

- Sales 0.9.0, 1.0.0, and 1.0.1 build from separate committed immutable package-source snapshots. The prior snapshot exposes revision-1 behavior. The 1.0.0 snapshot reproduces `CVE-KNEX-2026-0001` export-key traversal; 1.0.1 rejects traversal and accepts bounded basenames.
- The release subject is a deterministic, self-contained customer application bundle, not a single plugin tarball. It carries generated sources, build output, application manifest, dedicated frozen lock, release manifest, and all artifacts in the exact K-Nex release closure.
- The signed provenance materials bind the application manifest, lock, resolved plan, CycloneDX SBOM, canonical package-release manifest, release closure, generated tree, and build output.
- GitHub-hosted run `33190357411` issued application-provenance, package-manifest, and SBOM attestations from source `b77ab19b5bafa1be8a5fd683321c8f0bdc2cf038`. The workflow downloaded and reverified both custom bundles before publishing them. Gate 8 re-runs `gh attestation verify --bundle`, constrains repository, source SHA, and GitHub-hosted runner identity, and reconciles every bundle entry and material digest.
- Runtime production APIs consume an opaque hosted-attestation verifier and authority-issued package-manifest token. They no longer accept caller-provided release PEMs. The in-process fixture signer is explicitly test-only.
- Fleet accepts only deployment evidence and package manifests issued by its configured authorities. Patch plans bind base inventory, target release-manifest digest, exact framework digest, full K-Nex release closure, customer deployment closure, migrations, and readiness operations.
- Applying a patch requires a fresh verified deployment whose application/environment, release, complete installed closure, readiness, and advanced migration revision match the issued plan. Base drift, incomplete closure, stale receipt, vulnerable target, foreign authority, and cloned/replayed plan fail.
- Beta boots the genuine prior Sales artifact and exercises the reviewed 0.9.0 → 1.0.0 upgrade. Alpha's clean restore reproduces its expected operational inventory.
- Deterministic fleet evidence generator marker: `P8_9_FLEET_EVIDENCE_PASS`.

## Public contracts and affected areas

- `@k-nex/runtime`: hosted release/package authority, fleet transition authority, database-derived migration fencing, streamed lifecycle storage, purge authority.
- `@k-nex/composition`: packed-mirror verification and immutable application-factory staging.
- `releases/`: immutable Sales release sources and regenerated canonical package manifests.
- `release-evidence/phase-8/`: deployable bundle, SBOM, predicates, Sigstore bundles, and GitHub verification results.
- Customer fixtures: refreshed frozen locks, runtime/deployment evidence, patch plans, and restore proof.
- CI/gates: deployable release workflow and exact hosted-bundle Gate 8 verification.

## Validation

Required closeout commands:

```bash
pnpm gate:8
pnpm audit --audit-level high
git diff --check
```

The complete `pnpm gate:8` passed at the final working-tree state: Gates 1–8, 152 contract tests, 84 composition tests, 235 runtime tests, five customer PostgreSQL proofs, the 18-package immutable release closure, generated-evidence mutation checks, and committed Sigstore bundle verification all passed. Focused remediation evidence also includes deterministic bundle reproduction and hosted release-evidence run `33190357411`.

`pnpm audit --audit-level high` passed with no high or critical findings (two low and three moderate findings remain), and `git diff --check` passed.

## Known limits and deferred scope

- This is executable platform-foundation evidence, not production-observed customer fleet operation.
- No SLSA level is claimed.
- Sales is the sole reference architecture and test case, not a complete CRM.
- Payload Import/Export remains uninstalled until a customer selects and proves a bounded adapter.
- Broader domain plugin production remains deferred until the platform gates are accepted.

## Phase-result decision

Every Phase 8 task and review blocker has an executable closure path, and no kill criterion fired.

**Decision:** **READY FOR PHASE REVIEW**

After project-manager PASS, the exact next task is the first task of the next phase recorded in the master plan. **DO NOT START DOMAIN EXPANSION**; continue using Sales to harden platform infrastructure.
