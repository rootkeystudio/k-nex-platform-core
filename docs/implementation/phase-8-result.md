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
- Each release subject is a deterministic, self-contained customer application bundle, not a single plugin tarball. It carries generated sources, build output, application manifest, dedicated frozen lock, release manifest, all release artifacts, and the exact complete runtime closure derived from that customer lock. The current/prior bundles contain 632 resolved packages; the independently generated Alpha/Beta 0.2.1 targets contain 633.
- The signed provenance materials bind the application manifest, lock, resolved plan, CycloneDX SBOM, canonical package-release manifest, full lock-runtime closure, release closure, generated tree, and build output. Application verification exact-compares the signed bundle, SBOM, lock-runtime closure, and observed deployment inventory.
- GitHub-hosted run `33214953185` generated, installed, and built real factory-produced Alpha/Beta 0.2.1 target applications and issued seven relevant application-provenance and package-manifest attestations across Alpha/current, Beta/prior, Alpha/target, Beta/target, and their release manifests from executable source `1b85599d919482a16885a922d816d7a3a1006082`. Gate 8 re-runs `gh attestation verify --bundle` for every current, prior, and target subject and validates the signed DSSE statement, repository, workflow, source SHA, runner, certificate identity, predicate type, subject digest, and materials.
- The attested source SHA remains audit metadata, while acceptance is squash-merge safe: Gate 8 does not require PR-internal Git history. It exact-compares final-tree release manifests, all packed artifacts, customer manifests, locks, and plans with the signed application bundles; it also recomputes the signed generated-tree, build-output, resolved-plan, release-manifest, and package-closure material digests.
- Runtime production APIs turn that real GitHub verification output into authority-issued package-release and application-bundle tokens. Deployment verification consumes those exact tokens, an independently signed receipt, and a protected observation; Fleet ingests the resulting authority token. The in-process issuer remains test-only.
- Fleet patch plans derive the entire target deployment closure exclusively from a verified target application bundle and exact target lock graph. They add and upgrade target-only non-K-Nex dependencies and remove current-only dependencies instead of preserving them implicitly. Plans bind the base inventory, target manifest, framework transition, reviewed migration-plan identity, exact readiness revision, and complete customer closure.
- Applying a patch requires a fresh verified deployment whose application/environment, release, framework, exact installed closure, reviewed migration plan, readiness, and exact target revision match the issued plan. Base drift, incomplete closure, stale receipt, unrelated revision increases, vulnerable targets, foreign authorities, and cloned/replayed plans fail.
- Beta installs and boots immutable Sales 0.9.0, writes real Sales records plus descriptor-backed schema/source/action/tool/UI/theme/template/settings state, replaces the same app installation with 1.0.0, runs the target artifact's reviewed migrations against the same PostgreSQL database, and reboots with preserved data and target behavior. Alpha's clean restore reproduces its expected operational inventory.
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

The complete `pnpm gate:8` passed at final HEAD with pinned Node 24.19.0: Gates 1–8, 152 contract tests, 84 composition tests, 238 runtime tests, five customer PostgreSQL proofs, the 18-artifact immutable release closure, generated-evidence mutation checks, and every committed current/prior/target Sigstore subject verification all passed. The packed-export check forces a fresh TypeScript emit, preventing incremental caches from masking stale release archives. A copied release snapshot with no `.git` directory passes, while missing or modified packed artifacts fail. Focused remediation evidence includes deterministic dual-customer 0.2.1 factory generation, full runtime-closure add/remove/upgrade regressions, and hosted release-evidence run `33214953185`.

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
