# Project Status

- **Updated:** 2026-09-04
- **Phase:** Phase 12 — Runnable Customer Workspace and Dashboard Builder
- **Active task:** P12.10 — Gate 12 closeout
- **State:** In progress

## Last completed

Hardened the Phase 9 PostgreSQL Hot Application fixture’s rollback-retirement race: test-only lifecycle polling is quiesced during unrelated backup/restore and rejected-stage proof, then G2 retirement is observed and rollback begins immediately before the real 10-second deadline. Cancellation and later irreversible G3 retirement retain their existing real-browser assertions.

## Validation

Node 24.19.0 / pnpm 11.9 fixture build, Node syntax check, and `git diff --check` PASS. The isolated real-PostgreSQL target was attempted with both Docker Desktop local-test and AppArmor policies; the former is deliberately rejected before the production-runtime journey and the latter reaches Docker’s expected macOS `POLICY_UNAVAILABLE` AppArmor/proc-map boundary. Linux/AppArmor evidence remains required.

## Next

Run `fixtures/customer-gate-1/tests/runtime-extension-state-postgres.test.mjs` on Linux with the loaded AppArmor profile, then confirm the exact-head cumulative Gate 0–12 and dependent repository-evidence jobs.

## Blockers

Local macOS Docker Desktop cannot satisfy the required production AppArmor/proc-map inspection; exact Linux/AppArmor evidence is pending. npm audit transport remains intermittent on GitHub runners.
