# Project Status

- **Updated:** 2026-09-18
- **Phase:** Phase 13 — CRM-First Productization and Pilot Readiness
- **Active task:** P13.10 — Gate 13 limited-beta closeout (re-review response)
- **State:** In progress

## Last completed

PR #35's immutable `1.0.0`, coordinated `1.1.0` train, transition attestation, Sales boundary, upload budget, ADR identity, and real generated-repository upgrade blockers are closed. P13.9 executes the accepted Phase 12 factory from its frozen 1.0 closure, preserves the full source manifest/customer/template state, materializes deterministic isolated 1.1 worktrees, and proves the shipped factory's exact byte-stable nine-migration 1.0 prefix plus its ten 1.1 additions. The attested transition policy now derives that registry from the shipped compiler boundary instead of the hand-maintained fixture lineage, which had silently omitted `20260906_000029_attachment_upload_admissions` from the signed migration set. Focused Gate 13 now builds the fixture's exact transitive workspace prerequisites in clean checkouts before building the fixture.

## Review findings closed

From the first review round:

- `create-knex-app` supplied no reporting currency and had no flag for one, while readiness requires the settings the factory seeds from it, so the default invocation could never report ready.
- The current compiler generated applications pinned to the frozen 1.0.0 release whose packages lack the Phase 13 CRM exports, so `create-knex-app --release-version 1.0.0` produced an application that failed at `payload migrate`. Generation now fails closed for any release but this compiler's own.
- The generated users collection allowed a session to rewrite its own sign-in credentials with no current-password challenge, verified reset, or administrative recovery anywhere in the product.
- Hosted attestation calls let `gh` check only the repository; they now pass `--signer-workflow` and `--deny-self-hosted-runners` so the signer identity is enforced by the verifier rather than re-derived from its output.
- Pull requests ran no unit suites at all. A fast unit job now runs every package and module suite; three suites had been failing unnoticed behind version literals a release bump left behind.

From the exact-head re-review:

- The attested transition policy was authored from the hand-maintained fixture migration lineage rather than the registry the factory ships, so the signed migration set omitted `20260906_000029_attachment_upload_admissions`. It now derives from the shipped compiler boundary, and a release-authority input check walks the import graph so no attested input can read that lineage again.
- An application upgraded from 1.0 could never report ready: readiness exact-matches the release identity in `k_nex_release_revision`, the append-only 1.0 bootstrap still named 1.0.0, and nothing advanced it. A release is now one canonical record, written last as a completion receipt once the applied ledger is exactly the declared set, so a fresh installation and an upgraded database carry the identical tuple; a real PostgreSQL proof covers both histories, every refused state, and the predecessor the next release would name.
- The deployment proof rewrote the transition's offline-required steps as overlap-safe online expansions and claimed zero-downtime eligibility. That reclassification is what opened the promotion path at all, so the proof now asserts the refusal the supervisor actually returns for the accepted set, and the promotion journey is labelled as the hypothetical online transition it is.
- Generated-file ownership, release locks, and the transition policy named `@k-nex/runtime` as the generator while the factory and upgrade compiler live in `@k-nex/composition`, so the managed-output contract digest bound bytes that generate nothing.
- The Sales-reference expiry guard read the generated customer `package.json`, whose version the factory hard-codes, and so could never fire; it is bound to the platform release.
- `gate:13:focused` failed on a missing `dist` before reaching any evidence; it now builds the workspace it reads.
- Corpus outcomes were literals the gate then asserted; they are derived from the executed-proof set, and the gate re-verifies that linkage through a tested module.

From the third exact-head re-review:

- A completed release bypassed the exact-ledger proof forever: both release steps returned on the canonical tuple before reading `payload_migrations`, and readiness checked two scalar fields. A release row that was correct once is no longer treated as evidence that the database still matches it - the completion step validates the ledger before accepting an already-complete tuple, and readiness reads the canonical tuple, the recorded migration-set digest, and the applied ledger together.
- The exact migration set bound names, not bytes: a migration changed under its own filename executed different SQL, recorded the expected name, and collected the receipt. The generated application now carries the digest of its own migration sources, records it in the completion receipt, and verifies it against the sources on disk before any declared step's first statement.
- Payload only runs pending migrations, so a canonical database whose ledger lost a row would have had that step re-executed against a schema already past it. Every declared step is now admitted against the exact ledger prefix it was ordered against, inside its own transaction, so a refusal leaves schema, data, and ledger unchanged.
- `executeMigrationJob` finalized by setting `predecessor_revision = revision`, which would have recreated the lineage-dependent tuple the canonical release record removes. It now refuses platform release identities outright; it remains the plugin migration primitive.
- The "next release" claim compared the same canonical row twice. It is narrowed to what is proved: both 1.1 histories converge on one record, and a release names its predecessor by that predecessor's canonical record. A three-release proof needs a declared 1.2.0.

From the fourth exact-head re-review:

- The migration digest covered leaf migration filenames only, so `src/migrations/index.ts` - the registry that decides which implementation runs under each ledger name, and whether it is admitted at all - could be re-pointed while every hashed file stayed identical. The digest is now a closure over every migration source, the registry, and the verified package release manifest that identifies the archives those implementations execute from.
- The guard was generated into the application it guarded and verified a constant in its own file. It now ships in `@k-nex/runtime`; the generated tree carries only the declaration, and the durable authority is the closure the database recorded before any later edit.
- `assertMigrationSetIntegrity` memoized its first success, so within one `payload migrate` process only the first step actually re-read the files, and the proof hid this by re-evaluating the function body with a fresh cache. The guard no longer caches, and the proofs import the real module and mutate between calls in one process.
- `assertPlatformReleaseReadiness` read the release row and `payload_migrations` in two statements, which a concurrent restore could cross. Both are now read in one statement, and a unit test asserts exactly one query.
- The settled-rejection worker proof injected its failure into a worker whose shutdown watchdog the previous phase had shortened to 150ms, so it raced the watchdog and both outcomes exit nonzero; CI lost that race on this head. It now injects into the unshortened worker, where reporting the failure in under two seconds can only mean the shutdown did not wait for its 30s deadline.

## Validation

Node 24.19/pnpm 11.9: every workspace unit suite PASS (Contracts 244, Composition 188, Runtime 601, Payload adapter 320, Sales 83, themes/UI, plus Sales boundary and pack reproducibility checks). Real PostgreSQL/Chromium proofs run individually on this head: the release-state proofs (canonical receipt for both histories, and a completed release that keeps proving its migration set), P13.9 repository preparation, P13.9 backup/restore and source protection, and the P13.4 generated configuration journey - which builds, migrates, boots, and serves a real generated application through the new per-step admission - all PASS. The 1.1 closure chain was regenerated and all 17 archive integrities plus both factory lock digests match the release manifest. The release-state proofs now run inside focused Gate 13 rather than only under `test:postgres`.

`pnpm gate:13` still requires network and an authenticated `gh` through the Phase 8 evidence check, so the cumulative chain has not completed on any head.

## Out of Phase 13 acceptance

Phase 13 claims the CRM product, its generated application, and the compiled, attested upgrade preparation. It does not claim a supervised production upgrade. These four are named here rather than implied by the proofs:

1. **No shipped upgrade/deployment coordinator.** DeploymentSupervisor, the trusted build authority, backup orchestration, the migration adapter, gateway convergence, and the administration operator server are assembled only under `fixtures/customer-gate-1/static-deployment/`. There is no `k-nex app upgrade apply/status/rollback` and no System Updates flow.
2. **No maintenance-window promotion, and no executable release transition.** `DeploymentSupervisor.deploy` refuses any plan containing an offline-required step, and every step of the accepted 1.0→1.1 set is offline-required, so the shipped supervisor cannot promote this transition. The generated migration command refuses it too, by design: it cannot hold the database authority across the whole set, so a database still on the predecessor is refused before any target migration rather than transitioned unfenced. Fresh installs record their own release directly and are unaffected. The P13.9 promotion journey exercises a hypothetical online transition.
3. **The protection journey is the fixture lineage.** It proves physical backup, restore, fencing, and failure recovery against the hand-maintained fixture database, not against a database created by the generated 1.0 application and migrated by the generated 1.1 one.
4. **Backup receipts are process-local and not application-bound.** `executeDatabaseBackup`/`executeCleanRestore` authorize through module-level `WeakMap`s, so a receipt cannot be re-authorized after an operator restart, and the proof uses a separate `backup.customer-gate-1` resource identity rather than the application's own.

Durable worker effects are also still claimed by fence snapshot rather than `claimEffect`, so an old generation can begin work near promotion; that is a runtime hardening item rather than an acceptance claim.

## Blockers

Limited beta remains blocked by five consecutive business days, two active human users, closed Sev-1/Sev-2 evidence, observed RTO/RPO, and product/Sales/security/operations sign-offs. The four items above must either ship or stay excluded by explicit decision before any claim of a supervised customer upgrade.
