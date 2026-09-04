# Project Status

- **Updated:** 2026-09-04
- **Phase:** Phase 12 — Runnable Customer Workspace and Dashboard Builder
- **Active task:** P12.10 — generated Platform Plugin lifecycle binding correction
- **State:** In progress

## Last completed

Generated Sales authority now binds the immutable compiled release/package/runtime generation to the exact durable current generation and derives disable availability through the canonical lifecycle projection.

## Validation

`pnpm --filter @k-nex/composition test` PASS (118 tests); `pnpm --filter @k-nex/composition build` PASS; `pnpm --dir fixtures/customer-gate-1 test:p12:shell` PASS, including generated PostgreSQL/HTTP/Chromium disable and later recovery proof; `git diff --check` PASS.

## Next

Correct generated page dependency evaluation so Platform-only pages survive Sales lifecycle changes while Sales-dependent pages remain fail-closed.

## Blockers

None.
