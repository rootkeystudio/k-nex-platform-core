# Project Status

- **Updated:** 2026-08-27
- **Phase:** Phase 8 — Lifecycle, Application Factory, Release, and Fleet Safety
- **Active task:** P8.5 — `create-knex-app` and composition plan/apply
- **State:** In progress

## Last completed

P8.4 bounded archive/export as an access-controlled, versioned administrator-transfer adapter and documented why Payload's official Import/Export plugin is not backup, migration, retention, or disaster recovery. Purge now refuses unresolved references, dependents, retention, archive, clean-restore backup, migration, or approval evidence and rolls back failures. A physical `pg_dump`/`pg_restore` fixture proves Sales data, CMS versions, layouts, settings, outbox state, and migration revision restore into a clean Postgres database with integrations disabled.

## Validation

Node 24.19.0 / pnpm 11.9.0: runtime build and 190 tests PASS. Customer fixture build PASS. Dedicated physical backup/clean-restore Testcontainers acceptance PASS. Current Payload Import/Export documentation evaluated through Context7 against the official Payload repository.

## Next

Implement P8.5 `create-knex-app` with deterministic Sales preset planning/apply, exact package/config generation, Postgres selection, migration/readiness plan, and lifecycle planning without runtime installation.

## Blockers

None. Phase 8 is stacked on the preserved Phase 7 branch per explicit project-manager instruction; Phase 7 PR #22 remains open.
