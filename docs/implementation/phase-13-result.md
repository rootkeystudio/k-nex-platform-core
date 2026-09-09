# Phase 13 Result — CRM-First Productization and Pilot Readiness

- **Date:** 2026-09-09
- **Gate:** Gate 13 — controlled-fixture closeout implemented; clean exact-head cumulative run pending
- **Accepted base:** Phase 12 / `694bd2f`
- **Hosted evidence source head:** `59db6f5` (`test(phase-13): close CRM fixture readiness`)
- **Decision:** **REWORK — automated fixture readiness only; not a limited-beta approval**
- **Review state:** P13.1–P13.10 implementation is committed and persistent review has passed. P13.10 focused PostgreSQL/generated-host proofs and hosted release-evidence run `34313478146` pass; exact-head cumulative execution remains pending.

## Scope delivered

Phase 13 turns the former Sales reference into one bounded CRM slice: daily account, contact, lead, opportunity, pipeline, activity, task, reminder, notification, import/export, communication, workflow, report, dashboard, upgrade, and restore behavior. `module.sales` remains the sole first-party domain module. It does not introduce a second vertical, public CMS, arbitrary query language, customer-authored workflow code, raw provider credentials, or dashboard-derived data authority.

## Completed task matrix

| Task | Delivered result | Focused evidence |
|---|---|---|
| P13.1 | Frozen CRM vocabulary, lifecycle, authority, metric, journey, attack, and kill-criterion contract. | `docs/adr/0028-crm-first-product-contract.md`; `contracts/phase-13-crm-product-contract.v1.json` |
| P13.2 | Canonical Account, Contact, Lead, Opportunity, Activity, Task, Note, Attachment, pipeline, permission, and exact Phase 12 cutover schema. | `fixtures/customer-gate-1/tests/p13-2-crm-core-migration-postgres.test.mjs` |
| P13.3 | Generated host routes/actions for CRM daily work, four persona authority/scopes, durable audit/outbox, and real browser journeys. | `p13-3-crm-http-postgres.test.mjs`; `p13-3-generated-crm-browser-postgres.test.mjs` |
| P13.4 | Configurable one-active-pipeline model, opaque UUIDv5 stages, Kanban, saved views, bounded custom-page embedding, and immutable stage-translation receipts. | `p13-4-pipeline-saved-views-postgres.test.mjs`; generated HTTP/Chromium pipeline suites |
| P13.5 | Closed CSV import/export, protected-field rejection, idempotent chunk recovery, dedupe/merge, and retained non-sensitive receipts. | `p13-5-data-movement-postgres.test.mjs`; `p13-5-generated-data-movement-browser-postgres.test.mjs` |
| P13.6 | Fixed email/calendar reference adapters, provider lifecycle, webhook receipts, reminders, and notifications without exposing credentials. | `p13-6-communications-postgres.test.mjs`; `p13-6-generated-communications-browser-postgres.test.mjs` |
| P13.7 | Compile-time three-rule workflow catalog, fenced worker execution, exactly-once logical effects, immutable evidence, and crash/replay isolation. | `p13-7-workflows-postgres.test.mjs`; `p13-7-generated-workflow-http-worker-postgres.test.mjs` |
| P13.8 | Seven fixed reports and dashboard blocks, exact decimal/currency/timezone execution metadata, queued delivery, and artifact authorization. | `p13-8-reports-postgres.test.mjs`; `p13-8-generated-reports-browser-postgres.test.mjs` |
| P13.9 | Exact Phase 12 predecessor migration chain, 100-Task/50-Opportunity stable-ID fixture, current-v1 package/lock attestation checks, forward-only maintenance boundary, physical clean restore, report artifact preservation, and web/worker restart. | `p13-9-upgrade-backup-restore-postgres.test.mjs`; `p13-9-generated-restore-browser-postgres.test.mjs` |
| P13.10 | Gate assembly, representative controlled fixture, 10,000-row import/replay, independent seven-metric ledger, reminder recovery, generated-host accessibility/performance/restore, and fail-closed pilot decision. | `p13-10-limited-beta-fixture-postgres.test.mjs`; `p13-10-generated-fixture-browser-postgres.test.mjs`; exact-head cumulative run pending |

## Required journey and evidence matrix

| Gate 13 journey | Automated fixture coverage at this draft | Exact-head status |
|---|---|---|
| Generated application, real PostgreSQL, real Next/Payload HTTP, real Chromium | Generated CRM fixture builds a packed application, migrates PostgreSQL, boots web and worker, and drives Chromium. | P13.10 generated-host focused proof **PASS**; cumulative Gate 13 pending. |
| Representative and manager daily CRM work | P13.3 generated browser/HTTP suites cover account, contact, lead qualification, Opportunity, authority, audit, and non-enumeration. P13.10 runs representative and manager accounts across the daily route matrix on representative data. | P13.10 two-role route/accessibility proof **PASS**; cumulative Gate 13 pending. |
| Configured pipeline and Kanban | P13.4 migration/projection suites cover exactly six ordered opaque stages, saved-view CAS, Stage transition, immutable translation evidence, and Kanban. | **Pending** exact-head combined run. |
| Activity, task, reminder, notification | P13.3 activity/task journeys plus P13.6 communication/reminder and P13.7 workflow worker suites. | **Pending** one combined recovery proof at exact head. |
| Custom dashboard | P13.8 fixed report blocks and Phase 12 custom-page embedding prove page ACL cannot widen report/source authority. | **Pending** exact-head combined run. |
| Import/export | P13.5 PostgreSQL and generated browser tests cover closed CSV admission, diagnostics, replay, fenced workers, export authority, and merge. P13.10 executes 10,000 RFC4180 rows in 40 bounded chunks, crashes/reclaims at row 125, and exact-replays one logical result. | P13.10 focused PostgreSQL proof **PASS**; cumulative Gate 13 pending. |
| Communication adapter | P13.6 fixed reference provider and webhook/secret-boundary suites. | **Pending** exact-head combined run. |
| Reports | P13.8 executes seven fixed report definitions and queues real report artifacts; P13.9 preserves a completed artifact through clean restore. P13.10 reconciles all seven metrics to an independent test-owned ledger with zero money delta and a timezone-boundary fixture. | P13.10 focused PostgreSQL proof **PASS**; cumulative Gate 13 pending. |
| Backup/restore, version upgrade, restart | P13.9 runs the registered Phase 12 predecessor through all Phase 13 migrations, uses physical PostgreSQL restore into a distinct DB, reauthenticates, restarts generated web/worker, and downloads preserved report bytes. | Focused P13.9 tests passed on `80a08b7`; Gate 13 aggregate is **pending**. |
| Worker/realtime recovery | P13.5–P13.8 worker fencing/replay/crash suites plus P13.9 web/worker restart after restore. P13.10 proves stale/current/replay reminder delivery with one notification, two events, and authorized delivery within 60 seconds. | P13.10 focused PostgreSQL proof **PASS**; cumulative Gate 13 pending. |

## Security and attack coverage

The delivery assigns every required attack family to one implementation boundary: core scope/field/stale/migration attacks in P13.2–P13.3; pipeline/view/dashboard attacks in P13.4; malformed import, export, dedupe, and merge attacks in P13.5; provider/webhook/recipient attacks in P13.6; workflow execution/replay/privilege attacks in P13.7; report recipient, record/field, decimal, currency, and timezone attacks in P13.8; and predecessor/backup/restore/rollback/restart/inventory/attestation attacks in P13.9.

Notable retained denials include cross-application and cross-team non-enumeration, hidden money-field denial, forged owner/team/pipeline/stage/revision denial, stale CAS with zero business effects, closed CSV dialect/size/formula/protected-field admission, worker-fence replay isolation, no browser/domain provider secrets, no arbitrary workflow expression/network/fan-out, and custom-page ACL non-escalation. The P13.10 corpus machine-maps these proofs, but the clean exact-head cumulative execution remains pending.

## Data, metrics, accessibility, and operations truth

- P13.10 seeds at least 100 Leads, 50 Accounts, 100 Contacts, 50 Opportunities across all six current stages, 200 Activities, and 100 Tasks in both the PostgreSQL evidence fixture and the generated-host performance fixture. Its real 10,000-row import/replay produces 10,000 unique targets, one receipt, bounded 250-row chunks, crash recovery, and a rejected-row diagnostic.
- P13.10 reconciles the seven fixed reports to an independent test-owned ledger. Exact-decimal money delta is zero and the `America/New_York` boundary fixture lands in the expected bucket.
- The generated-host proof runs representative and manager accounts through the pre-restore daily route matrix with zero serious/critical accessibility violations, then repeats dashboard, reports, and account-detail accessibility/authority smoke after physical restore.
- Declared controlled-CI profile: Apple M1 Max arm64, 10 logical CPUs, 64 GiB memory, concurrency 1, one cold browser navigation per route, and 20 warm server-observed samples after one untimed list/detail request. Observed server p95 is list **695.987 ms**, detail **843.943 ms**, action **539.149 ms** (limit 1,000 ms); browser readiness p95 is **1,227.12 ms** (limit 2,500 ms). The generated calendar proof uses Payload's exact date-range operators and paginates the 200 representative Activities through canonical 25-row pages. These are controlled-fixture beta checks, not production-capacity claims.
- P13.9 has a physical clean restore/restart fixture. It is not a customer RTO/RPO drill: no successful restore within four hours or observed recoverable-point age within 15 minutes is recorded here.

## Package, migration, and restore boundary

P13.9 verifies the exact registered Phase 12 migration prefix then applies the P13.2, P13.4, P13.5, P13.6, P13.7, and P13.8 migrations in order. It snapshots full predecessor truth, proves canonical successor records and immutable migration evidence, checks current-v1 package/lock release-manifest authority, and restores a physical PostgreSQL backup into a clean distinct database. The test rejects every `down` path as `maintenance-required`, preserving the declared forward-only/restore rollback boundary rather than simulating a destructive rollback.

The generated-host restore proof authenticates the owner after restore, verifies health/inventory, dashboard, pipeline/Kanban, account activity/timeline/audit, current permission denial, and a completed report download. It exact-compares the report run/artifact/delivery IDs, bytes, artifact digest, metadata, execution digest, and watermark before and after restore; an unrelated viewer receives no CSV bytes.

## Pilot/dogfood evidence record and sign-off classification

| Field | Recorded value |
|---|---|
| Evidence class | `controlled-fixture` |
| Application release | `1.0.0` current-v1 package closure |
| Operators | Synthetic `fixture-persona:sales-representative` and `fixture-persona:sales-manager`; human operators: none |
| Dates | 2026-09-09 to 2026-09-09; consecutive human-operation business days: 0 |
| Support owner | Not assigned |
| Incidents | No human-operation incident record; Sev-1/Sev-2 closure not observed |
| Observed results | Technical controlled-fixture readiness passed; limited-beta operations not observed |

No human dogfood/external pilot record, two active human users, five consecutive business days, incident record, support owner, RTO/RPO observation, or product/Sales-engineering/security/operations sign-off is present. Automated fixture identities are test personas, not human pilot participants.

Therefore this result is intentionally **REWORK — fixture readiness only**. It must not be relabeled `GO LIMITED CRM BETA` until all ADR-0028 limited-beta acceptance conditions and every P13 kill criterion are evidenced at the exact release head.

## Pending Gate 13 evidence

The focused P13.10 PostgreSQL and generated-host tests pass locally. Cumulative run `34310642965` exposed stale pre-Phase-13 Sales integration fixtures and a root-barrel Lexical bundle regression in Gate 0; those failures were repaired and exact `pnpm phase:0` now passes. Hosted current-v1 attestation and deployment evidence was then regenerated from repaired source head `59db6f5` by release-evidence run `34313478146`, verified, and overlaid into this result head. Cumulative run `34314226406` confirmed the functional fixes and then exposed two bounded heavy tests exceeding their 5- and 15-second limits under full Turbo CI contention. Run `34314920576` showed the first test could also exhaust an interim 10-second bound under the same contention. Both retain every assertion with reviewed 30- and 60-second per-test limits. Run `34315458015` passed those points and exposed fixed 10-millisecond MessageChannel waits in the UI-runtime tests; independent contention reproduction confirmed test synchronization races rather than a product failure, and the affected assertions now await their exact mock invocations. Run `34316690197` passed Gate 0 and exposed a tracked Gate 1 resolution left stale by the Sales manifest changes; the official generator refreshed it, and the Gate 1 check plus isolated reproducibility proof pass. The clean-worktree cumulative rerun remains pending:

```text
OBSERVED: P13.10 focused PostgreSQL and generated-host proofs
PENDING: pnpm gate:13
PASS: hosted current-v1 attestation refresh, run 34313478146, source 59db6f5
PENDING: exact-head Gate 0–13 result
OBSERVED: representative dataset/import ledger, seven-metric reconciliation,
          controlled performance profile, representative/manager accessibility, physical fixture restore
NOT OBSERVED: human-operation RTO/RPO drill and limited-beta sign-offs
```

**Current decision:** **REWORK — automated fixture readiness only.**
