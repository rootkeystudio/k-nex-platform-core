# Project Status

- **Updated:** 2026-08-26
- **Phase:** Phase 3 — Transactions, Durable Events, and Realtime Convergence
- **Active task:** P3.6 — Distributed publication path
- **State:** Active

## Last completed

Completed P3.5. Added a canonical realtime process-topology contract shared by manifest/config validation and `k-nex doctor`. Memory mode now fails with publication-path-specific diagnostics and remedies for multiple web instances, a separate publishing worker, a separate realtime gateway, or overlapping rolling revisions; compatible single-owner memory and distributed split topologies pass.

## Validation

On Node.js 24.19.0 and pnpm 11.9.0: frozen install, Phase 0, Gate 1, contracts and runtime builds, 84 contract tests, 137 runtime tests, valid customer-fixture doctor output, regenerated canonical schemas/static artifacts, and `git diff --check` pass.

## Next

Implement P3.6 using the simplest accepted distributed publication adapter, then prove worker-to-web delivery, adapter outage behavior, reconnect/recovery, and honest degraded health without exposing provider types through the gateway contract.

## Blockers

None.
