# Project Status

- **Updated:** 2026-08-27
- **Phase:** Phase 8 — Lifecycle, Application Factory, Release, and Fleet Safety
- **Active task:** P8.6 — Two independent Sales-only customer applications
- **State:** In progress

## Last completed

P8.5 added deterministic `create-knex-app` plan/apply for the Sales reference preset. It selects Minimal or Neobrutalism, local Docker or external Postgres, emits exact dependencies plus a valid application manifest and Payload config, records customer-owned migration/readiness/default-page/lifecycle plans, runs explicit source-time install commands, applies idempotently, and refuses customer-file overwrite. It introduces no runtime package installation.

## Validation

Node 24.19.0 / pnpm 11.9.0: composition build and 77 tests PASS. Real CLI apply smoke PASS for an external-Postgres Sales/Minimal application with installation intentionally disabled for the isolated smoke target.

## Next

Generate and prove two independent Sales-only customer fixtures with different theme/profile, settings, default pages, permissions/layouts, lockfile, and release cadence.

## Blockers

None. Phase 8 is stacked on the preserved Phase 7 branch per explicit project-manager instruction; Phase 7 PR #22 remains open.
