# Phase 9 Result — Dynamic Application Runtime and Zero-Downtime Delivery

- **Date:** 2026-08-30
- **Gate:** Gate 9
- **Accepted base:** `73d18886c36db5fc5c0d05a1d8e44dc784e460cc`
- **Delivery:** one Phase 9 branch and pull request; no merge or auto-merge
- **Decision:** **READY FOR PHASE REVIEW**
- **Review state:** final Sol-high review and designated project-manager review pending

## Scope proved

Phase 9 delivers the accepted Two-Path Extension Model. Hot Applications and Theme Skins use verified immutable live generations; existing full Platform Plugins preserve customer source authority and use trusted customer-application builds with compatibility-gated blue/green delivery. Sales remains the only first-party domain module.

## Completed task matrix

| Task | Result |
|---|---|
| P9.1 | Closed delivery-class, manifest, generation, isolation, source/build, migration, and worker-fence contracts with Zod/AJV parity |
| P9.2 | Deterministic bundle builder, signed official catalog, provenance/SBOM verification, bounded archive attack rejection |
| P9.3 | Authorized persistent PluginManager operations, immutable generation authority, revision/outbox convergence, static-change delegation |
| P9.4 | Production Docker runner isolation per app/generation with capability-only RPC, resource limits, quarantine, and cross-app denial |
| P9.5 | Credentialless opaque remote UI realm, strict CSP/MessagePort host protocol, immutable verified assets, browser attack proof |
| P9.6 | Atomic server/UI/storage activation, update, rollback, drain leases, crash recovery, restore, and multi-process convergence |
| P9.7 | Data-only Theme Skin generations, AST-scoped CSS, immutable assets, exact profile publication and rollback, Chromium proof |
| P9.8 | Exact source/build authority, signed app/image evidence, PostgreSQL worker fencing, Docker blue/green traffic, rollback and cleanup |
| P9.9 | Unified headless catalog/operation/status API, disable/uninstall receipts, real Hot Application traffic, 22-attack corpus |
| P9.10 | Named Gate 9, mandatory evidence-falsification checks, result artifact, and phase closeout |

## Public contracts and affected areas

- `@k-nex/contracts`: extension identities and delivery classes; manifests, bundles, plans, receipts, generations, lifecycle events, runtime inventory, isolation profiles, static source/build evidence, migration compatibility, worker fence, and deployment receipt schemas.
- `@k-nex/extension-bundler`: deterministic archives, signed catalog and hosted provenance verification, immutable verified asset stores.
- `@k-nex/extension-runner`: Docker-isolated Hot Application server execution and bounded host-capability RPC.
- `@k-nex/runtime`: PluginManager, trusted source/build authority, deployment supervisor, atomic generation coordination, headless operator/status API.
- `@k-nex/payload-adapter`: PostgreSQL lifecycle, durable verified artifacts and catalog checkpoints, activation, storage, Theme Profile, static deployment, worker-fence, effect, receipt, audit, and outbox authority.
- Browser/UI: credentialless remote UI host and data-only Theme Skin activation.
- Customer fixture: customer-owned migration revision 18 and real PostgreSQL/Docker acceptance journeys.

## Validation and failure evidence

Final committed-tree Phase 9 evidence on Node 24.19.0:

```text
contracts: 155 tests; architecture-contract-tools generated schemas current, parity-tested, and reproducible
extension-bundler: 20 tests; extension-runner: 8 tests with real Docker isolation
runtime: 294 tests; payload-adapter: 40 tests
ui-runtime: 56 tests; ui-testing: full unit and real Chromium suites
customer fixture: 14 PostgreSQL/Docker tests
phase attack corpus: 22 required attacks, 12 exact proof groups, 9 recovered state/process matrix entries
phase:0 and Gates 1–8: passed transitively through Gate 9
pnpm gate:9: GATE_9_PASS
```

Chromium markers: `P9_REMOTE_UI_BROWSER_PASS` and `P9_THEME_SKIN_BROWSER_PASS`.

The real customer PostgreSQL/Docker journeys run continuous HTTP probes with zero failures during compatible delivery transitions. The Hot Application probe covers install, update, and rollback through the fixed `/apps/:appId/*` host route; four distinct web, worker, runner, and browser processes deliberately lose every outbox invalidation and autonomously converge through lifecycle-owned polling of the authoritative combined server/UI/storage generation without rebuilding the host. The static Platform Plugin probe covers install, update, rollback, and re-promotion between two Git-backed, digest-pinned customer images containing different `module.sales` package versions. The web/admin image runs the real `ExtensionOperatorApi` and `PluginManager` with only operation-planning authority. A separately credentialed supervisor process—not the test parent or web/admin process—owns trusted evidence verification, online migration, container readiness, PostgreSQL promotion, rollback, and recovery through replay-bound durable commands. Distinct packaged web and worker images implement passive start, fence-bound activation, real drain, and supervisor-restart rediscovery. The customer image compiles and boots its committed Payload composition from a source-attested local package closure, its builder trust key is provisioned independently, and its isolated non-root/read-only web/admin container proves source, package-install, Docker, and deployment-table denial. The journeys also delete and restore authoritative Hot Application bytes/state from a physical backup; reject operation replay, pointer races, untrusted signed evidence, irreversible rollback, and forged database authority; kill and restart real web/supervisor processes; deliberately fail green readiness; crash PostgreSQL fence transfer; reject stale worker completion; preserve one logical effect; block contract cleanup while rollback is open; resume bounded backfill; and refuse offline migration as `maintenance-required` without changing traffic. Every fixture-owned container, image, and network carries a run label and deterministic teardown proves zero residual resources.

The Chromium remote-realm proof additionally exercises replayed, oversized, over-depth, rate-flooded, mixed-generation, navigation, and download attempts in fresh browser sessions. Every attack fails closed, detaches the realm, leaves the host healthy, and reaches no unauthorized source, action, navigation, or download authority.

At the closeout head, `pnpm gate:9` passed Gates 0–8 and every mandatory Gate 9 class-specific proof. `scripts/gate-9.mjs` executes exact named Docker, PostgreSQL, Chromium, and unit evidence; PostgreSQL journeys emit scenario markers only after their assertions succeed; and the static journey emits each required crash-matrix key only after the corresponding process recovery. The gate fails if a proof or marker is missing, skipped, renamed, or failing, and also enforces required schemas, Sales-only scope, and this result matrix.

## Known limits and deferred scope

- Phase 9 proves the external source/build/deployment authority through signed self-hosted reference adapters and digest-pinned local Docker. Production orchestrator credentials, scheduling, and customer hosting policy remain deployment-specific adapters.
- The headless mutation authority is trusted automation only. Customer users, roles, grants, approvals, permission-aware status, and role templates belong to Phase 10.
- Public marketplace governance, publisher onboarding, and broad extension production remain deferred.
- Sales is the sole Platform Plugin reference; the Gate 9 Hot Application and Theme Skin are infrastructure fixtures, not new domain breadth.
- Maintenance-required delivery is represented and refused safely; a production maintenance workflow is not claimed.

## Phase-result decision

Every Phase 9 task, acceptance journey, hardening amendment, and kill criterion has executable final-head evidence. No host-process code injection, live database-authored static graph, unsigned build, mixed generation, unfenced worker, stale catalog replay, mutable rollback image, persistent failed realm, network-capable Skin SVG, or false zero-downtime path is accepted.

**Decision:** **READY FOR PHASE REVIEW**

Gate decision: **GO PHASE 10 RBAC AND AUTHORIZATION**.

After project-manager PASS, the exact next task is **P10.1 — Freeze owner, role, grant, assignment, template, and revision contracts**. Do not start domain expansion; continue using Sales and the Gate 9 extension fixtures to harden platform authorization.
