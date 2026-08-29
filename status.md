# Project Status

- **Updated:** 2026-08-29
- **Phase:** Phase 9 — Dynamic Application Runtime and Zero-Downtime Delivery
- **Active task:** P9.1 — Freeze extension classes, manifests, bundle/generation contracts, and kill criteria
- **State:** Ready to start

## Last completed

Project-manager review selected a Two-Path Extension Model before RBAC. Hot Applications and Theme Skins will stage verified immutable bundles and activate live through isolated generations; existing full Platform Plugins will use verified blue/green Docker delivery. Raw package-manager installation or downloaded-code injection into the main Payload/Next process is rejected. The prior RBAC plan is retained and adapted as Phase 10.

## Validation

Gate 8 remains accepted on Node 24.19.0 with its PostgreSQL, browser, package, provenance, restore, and fleet evidence. This roadmap decision changes documentation only; no Phase 9 contract, package, migration, runner, remote UI, Docker supervisor, or executable gate has run yet.

## Next

Implement P9.1 only: machine-readable Platform Plugin/Hot Application/Theme Skin taxonomy; `app.*` and `skin.*` identities; closed app/skin/bundle/generation, capability, budget, install-plan/receipt, and zero-downtime eligibility schemas; deterministic generation and invalid fixtures.

## Blockers

None.
