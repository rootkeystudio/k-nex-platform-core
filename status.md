# Project Status

- **Updated:** 2026-08-27
- **Phase:** Phase 8 — Lifecycle, Application Factory, Release, and Fleet Safety
- **Active task:** P8.2 — Plugin/package upgrade planning and customer-owned migrations
- **State:** In progress

## Last completed

P8.1 froze a generated package-release manifest contract. Every released package has an exact semantic version, immutable SHA-512 integrity, role, and the exact supported K-Nex/Payload/Node/pnpm/Postgres tuple. The pre-v1 support window is bounded to current plus at most the immediately preceding minor in the same major line, with security fixes required across all supported releases. Release manifests remain deterministic and exclude deployment/provenance assertions owned by later tasks.

## Validation

Node 24.19.0 / pnpm 11.9.0: contracts build and 145 tests PASS; architecture contract tooling builds; deterministic generation produced the release-manifest schema and updated generated-contract inventory. Full `pnpm phase:0` runs on the committed task head so generated-clean can compare against Git.

## Next

Commit P8.1, run its full Phase 0 acceptance, then implement P8.2 current-to-target planning and customer-owned migration artifacts using Sales as the sole schema-owning fixture.

## Blockers

None. Phase 8 is stacked on the preserved Phase 7 branch per explicit project-manager instruction; Phase 7 PR #22 remains open.
