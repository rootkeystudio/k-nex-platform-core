# Project Status

- **Updated:** 2026-09-15
- **Phase:** Phase 13 — CRM-First Productization and Pilot Readiness
- **Active task:** P13.10 — Gate 13 limited-beta closeout
- **State:** In progress

## Last completed

PR #35 review requested immutable `1.0.0` restoration, a new `1.1.0` train, a real generated-repository upgrade/protection proof, ADR renumbering, focused-gate hermeticity, bounded upload cancellation/deadlines, and an explicit bounded Sales-reference compiler exception. The first independent repair makes the customer fixture build its TypeScript project-reference graph before esbuild, so a fresh focused gate no longer depends on ignored `@k-nex/ui-runtime` output.

## Validation

Node 24.19/pnpm 11.9: with ignored `packages/ui-runtime/dist` temporarily absent, `pnpm --filter @k-nex/customer-gate-1 build` rebuilt the referenced graph and bundled the browser entry (254.3 kB) PASS; ignored output restored; `git diff --check` PASS. PR head CI run `35004386431` independently reproduces the old esbuild-first failure before this repair.

## Next

Review/commit the hermetic focused-build repair, then close upload-stream availability and ADR identity batches. Implement the reviewed immutable `1.0.0` to `1.1.0` release/upgrade/protection design before focused Gate 13 and PR rereview; do not merge or promote.

## Blockers

PR review blockers remain open: immutable release identity, real source-to-target upgrade/backup/restore, actual migration ledger, ADR collision, upload limits, Sales-reference compiler boundary, and exact-head focused/repository evidence. Limited beta separately lacks human-operation evidence and sign-offs.
