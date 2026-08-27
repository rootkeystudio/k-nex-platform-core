# Project Status

- **Updated:** 2026-08-27
- **Phase:** Phase 8 — Lifecycle, Application Factory, Release, and Fleet Safety
- **Active task:** P8.8 — Deployment receipts and runtime inventory
- **State:** In progress

## Last completed

P8.7 added deterministic CycloneDX 1.6 SBOM generation and canonical provenance that binds source, full-SHA workflow, application manifest, lockfile, graph/plan, SBOM, and release artifact digests. Local Ed25519 tests prove signature verification and tamper refusal. The hosted release workflow uses least-privilege GitHub OIDC plus `actions/attest` pinned to a complete SHA for provenance and SBOM attestations. No SLSA level is claimed.

## Validation

Node 24.19.0 / pnpm 11.9.0: composition build and 80 tests PASS. Release evidence generator smoke PASS against the packed Sales artifact and Customer Alpha lock/manifest/plan; emitted valid CycloneDX and digest-bound provenance. GitHub artifact-attestation configuration was checked against current official documentation.

## Next

Implement P8.8 deployment receipt and observed runtime inventory contracts, binding deployed artifacts and migration state to release evidence.

## Blockers

None. Phase 8 is stacked on the preserved Phase 7 branch per explicit project-manager instruction; Phase 7 PR #22 remains open.
