# Project Status

- **Updated:** 2026-09-17
- **Phase:** Phase 13 — CRM-First Productization and Pilot Readiness
- **Active task:** P13.10 — Gate 13 limited-beta closeout
- **State:** In progress

## Last completed

PR #35's immutable `1.0.0`, coordinated `1.1.0` train, transition attestation, Sales boundary, upload budget, ADR identity, and real generated-repository upgrade blockers are closed. P13.9 executes the accepted Phase 12 factory from its frozen 1.0 closure, preserves the full source manifest/customer/template state, materializes deterministic isolated 1.1 worktrees, and proves the shipped factory's exact byte-stable nine-migration 1.0 prefix plus its eight 1.1 additions. The attested transition policy now derives that registry from the shipped compiler boundary instead of the hand-maintained fixture lineage, which had silently omitted `20260906_000029_attachment_upload_admissions` from the signed migration set. Focused Gate 13 now builds the fixture's exact transitive workspace prerequisites in clean checkouts before building the fixture.

## Review findings closed since the last review

- The attested transition policy was authored from the hand-maintained fixture migration lineage, a different chain from the one the factory ships, and therefore declared seven of the eight migrations a 1.0→1.1 upgrade applies. It now derives the target registry from the shipped compiler boundary, and a release-authority input check plus Gate 13 keep any attested input from reading fixture source again.
- The current compiler generated applications pinned to the frozen 1.0.0 release whose packages lack the Phase 13 CRM exports, so `create-knex-app --release-version 1.0.0` produced an application that failed at `payload migrate`. Generation now fails closed for any release but this compiler's own; the Gate 12 proof that boots a generated application had been hiding the break behind a hard-coded 1.0.0 archive name.
- `create-knex-app` supplied no reporting currency and had no flag for one, while readiness requires the settings the factory seeds from it, so the default invocation could never report ready.
- The generated users collection allowed a session to rewrite its own sign-in credentials with no current-password challenge, verified reset, or administrative recovery anywhere in the product.
- Hosted attestation calls let `gh` check only the repository; they now pass `--signer-workflow` and `--deny-self-hosted-runners` so the signer identity is enforced by the verifier rather than re-derived from its output.
- Corpus outcomes were literals that Gate 13 then asserted; they are now derived from the executed-proof set, and the gate re-verifies that linkage through a tested module.
- Pull requests ran no unit suites at all. A fast unit job now runs every package and module suite; three suites had been failing unnoticed behind version literals a release bump left behind.

## Validation

Node 24.19/pnpm 11.9: every workspace unit suite PASS (Contracts 244, Composition 187, Runtime 596, Payload adapter 320, Sales 83, themes/UI, plus Sales boundary and pack reproducibility checks). Real PostgreSQL/Chromium proofs run individually on this head: P13.9 repository preparation, P13.9 backup/restore and source protection, P13.3 packed shutdown, P12.9 generated application journey, P12.10 generated theme profiles, and the previous-release upgrade all PASS. The 1.1 closure chain was regenerated and all 17 archive integrities plus both factory lock digests match the release manifest.

No full gate run. `pnpm gate:13` still requires network and an authenticated `gh` through the Phase 8 evidence check, and the corpus executes the full proof suite serially, so the chain has not completed end to end on this head.

## Next

Wire the generated worker's outbox lanes to the deployment fence's `claimEffect` instead of a fence snapshot, route platform migrations through the fenced migration job or retire the release-revision readiness claim, make the gate chain hermetic enough to run offline, and ship a composition root for the static release services that only the fixtures construct today.

## Blockers

There is still no shipped composition root for the deployment supervisor, builder authority, or administration operator server: the static release pipeline is complete in process but constructed only under `fixtures/customer-gate-1/static-deployment/`, so P13.9's journey is evidence for the compiler, stores, and authorities rather than for a production coordinator. Limited beta separately lacks human-operation evidence and sign-offs.
