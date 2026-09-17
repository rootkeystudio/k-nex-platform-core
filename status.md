# Project Status

- **Updated:** 2026-09-17
- **Phase:** Phase 13 — CRM-First Productization and Pilot Readiness
- **Active task:** P13.10 — Gate 13 limited-beta closeout (re-review response)
- **State:** In progress

## Last completed

PR #35's immutable `1.0.0`, coordinated `1.1.0` train, transition attestation, Sales boundary, upload budget, ADR identity, and real generated-repository upgrade blockers are closed. P13.9 executes the accepted Phase 12 factory from its frozen 1.0 closure, preserves the full source manifest/customer/template state, materializes deterministic isolated 1.1 worktrees, and proves the shipped factory's exact byte-stable nine-migration 1.0 prefix plus its eight 1.1 additions. The attested transition policy now derives that registry from the shipped compiler boundary instead of the hand-maintained fixture lineage, which had silently omitted `20260906_000029_attachment_upload_admissions` from the signed migration set. Focused Gate 13 now builds the fixture's exact transitive workspace prerequisites in clean checkouts before building the fixture.

## Review findings closed

From the first review round:

- `create-knex-app` supplied no reporting currency and had no flag for one, while readiness requires the settings the factory seeds from it, so the default invocation could never report ready.
- The current compiler generated applications pinned to the frozen 1.0.0 release whose packages lack the Phase 13 CRM exports, so `create-knex-app --release-version 1.0.0` produced an application that failed at `payload migrate`. Generation now fails closed for any release but this compiler's own.
- The generated users collection allowed a session to rewrite its own sign-in credentials with no current-password challenge, verified reset, or administrative recovery anywhere in the product.
- Hosted attestation calls let `gh` check only the repository; they now pass `--signer-workflow` and `--deny-self-hosted-runners` so the signer identity is enforced by the verifier rather than re-derived from its output.
- Pull requests ran no unit suites at all. A fast unit job now runs every package and module suite; three suites had been failing unnoticed behind version literals a release bump left behind.

From the exact-head re-review:

- The attested transition policy was authored from the hand-maintained fixture migration lineage rather than the registry the factory ships, so the signed migration set omitted `20260906_000029_attachment_upload_admissions`. It now derives from the shipped compiler boundary, and a release-authority input check walks the import graph so no attested input can read that lineage again.
- An application upgraded from 1.0 could never report ready: readiness exact-matches the release identity in `k_nex_release_revision`, the append-only 1.0 bootstrap still named 1.0.0, and nothing advanced it. Each release now emits its own release-revision migration, and a real PostgreSQL proof shows an upgraded and a fresh database converging on the same record.
- The deployment proof rewrote the transition's offline-required steps as overlap-safe online expansions and claimed zero-downtime eligibility. That reclassification is what opened the promotion path at all, so the proof now asserts the refusal the supervisor actually returns for the accepted set, and the promotion journey is labelled as the hypothetical online transition it is.
- Generated-file ownership, release locks, and the transition policy named `@k-nex/runtime` as the generator while the factory and upgrade compiler live in `@k-nex/composition`, so the managed-output contract digest bound bytes that generate nothing.
- The Sales-reference expiry guard read the generated customer `package.json`, whose version the factory hard-codes, and so could never fire; it is bound to the platform release.
- `gate:13:focused` failed on a missing `dist` before reaching any evidence; it now builds the workspace it reads.
- Corpus outcomes were literals the gate then asserted; they are derived from the executed-proof set, and the gate re-verifies that linkage through a tested module.

## Validation

Node 24.19/pnpm 11.9: every workspace unit suite PASS (Contracts 244, Composition 188, Runtime 596, Payload adapter 320, Sales 83, themes/UI, plus Sales boundary and pack reproducibility checks). Real PostgreSQL/Chromium proofs run individually on this head: P13.9 repository preparation, P13.9 backup/restore and source protection, the release-revision convergence proof, P13.3 packed shutdown, P12.9 generated application journey, P12.10 generated theme profiles, the packed customer boot, and the previous-release upgrade all PASS. The 1.1 closure chain was regenerated and all 17 archive integrities plus both factory lock digests match the release manifest.

A focused Gate 13 run passed end to end on `34334e5`; the head has moved since, so it must be rerun before the evidence is claimed. `pnpm gate:13` still requires network and an authenticated `gh` through the Phase 8 evidence check, so the cumulative chain has not completed on this head.

## Out of Phase 13 acceptance

Phase 13 claims the CRM product, its generated application, and the compiled, attested upgrade preparation. It does not claim a supervised production upgrade. These four are named here rather than implied by the proofs:

1. **No shipped upgrade/deployment coordinator.** DeploymentSupervisor, the trusted build authority, backup orchestration, the migration adapter, gateway convergence, and the administration operator server are assembled only under `fixtures/customer-gate-1/static-deployment/`. There is no `k-nex app upgrade apply/status/rollback` and no System Updates flow.
2. **No maintenance-window promotion.** `DeploymentSupervisor.deploy` refuses any plan containing an offline-required step, and every step of the accepted 1.0→1.1 set is offline-required, so the shipped supervisor cannot promote this transition at all. The P13.9 promotion journey exercises a hypothetical online transition.
3. **The protection journey is the fixture lineage.** It proves physical backup, restore, fencing, and failure recovery against the hand-maintained fixture database, not against a database created by the generated 1.0 application and migrated by the generated 1.1 one.
4. **Backup receipts are process-local and not application-bound.** `executeDatabaseBackup`/`executeCleanRestore` authorize through module-level `WeakMap`s, so a receipt cannot be re-authorized after an operator restart, and the proof uses a separate `backup.customer-gate-1` resource identity rather than the application's own.

Durable worker effects are also still claimed by fence snapshot rather than `claimEffect`, so an old generation can begin work near promotion; that is a runtime hardening item rather than an acceptance claim.

## Blockers

Limited beta remains blocked by five consecutive business days, two active human users, closed Sev-1/Sev-2 evidence, observed RTO/RPO, and product/Sales/security/operations sign-offs. The four items above must either ship or stay excluded by explicit decision before any claim of a supervised customer upgrade.
