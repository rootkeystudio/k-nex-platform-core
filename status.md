# Project Status

- **Updated:** 2026-08-27
- **Phase:** Phase 8 — Lifecycle, Application Factory, Release, and Fleet Safety
- **Active task:** P8.7 — SBOM and signed provenance
- **State:** In progress

## Last completed

P8.6 generated two independently locked Sales-only customer fixtures. Alpha uses external Postgres, Minimal, manager permissions, both default pages, monthly cadence, and page size 25; Beta uses local Docker Postgres, Neobrutalism, representative permissions, the task page, quarterly cadence, and page size 50. Both use the same exact platform/Sales release surface while their dedicated lock digests and customer-owned composition artifacts differ.

## Validation

Node 24.19.0 / pnpm 11.9.0: contracts build PASS; both customer fixture build validators PASS; combined manifest/override/dedicated-lock reconciliation emits `P8_6_CUSTOMER_FIXTURES_PASS`. Root lockfile regenerated for all 23 workspace projects and includes the current packed Sales integrity.

## Next

Implement P8.7 deterministic CycloneDX SBOM evidence and cryptographically verifiable signed provenance without claiming an unverified SLSA level.

## Blockers

None. Phase 8 is stacked on the preserved Phase 7 branch per explicit project-manager instruction; Phase 7 PR #22 remains open.
