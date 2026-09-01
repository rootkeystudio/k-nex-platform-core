# Phase 8 Result — Lifecycle, Application Factory, Release, and Fleet Safety

- **Decision:** **READY — normalized v1 evidence restored**
- **Current product release:** `1.0.0` only

## Corrected scope

All current first-party K-Nex packages, Sales, providers, themes, customer manifests, locks, plans, and packed artifacts use `1.0.0`. Product-branded pre-v1 release history and security-patch artifacts were removed. Upgrade, fleet, and security-patch version behavior is represented only by the neutral `@fixture/phase-8-security-demo` fixture.

## Hosted evidence

GitHub Actions run `33552368033` generated and verified the normalized `1.0.0` Customer Alpha and Customer Beta application bundles. The committed `phase-8-v1` artifact contains both provenance bundles and verification records, one release-manifest bundle/record, both CycloneDX SBOM bundles/records, and deterministic current-v1 runtime, deployment, restore, and fleet evidence. Missing hosted evidence still fails closed.

## Validation

Packed release closure, neutral synthetic history, hosted attestation verification, deterministic evidence regeneration, both customer builds, and real PostgreSQL backup/restore pass on Node 24.19.0. Product version transitions remain absent; only neutral `@fixture` identities exercise upgrade behavior.
