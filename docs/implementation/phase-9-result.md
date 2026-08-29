# Phase 9 Result — Dynamic Application Runtime and Zero-Downtime Delivery

- **Date:** 2026-08-29
- **Gate:** Gate 9
- **Accepted base:** `73d1888c6b2929773604f7048810893233162ee9`
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
- `@k-nex/payload-adapter`: PostgreSQL lifecycle, activation, storage, Theme Profile, static deployment, worker-fence, effect, receipt, audit, and outbox authority.
- Browser/UI: credentialless remote UI host and data-only Theme Skin activation.
- Customer fixture: customer-owned migration revision 11 and real PostgreSQL/Docker acceptance journeys.

## Validation and failure evidence

Focused P9.9/P9.10 evidence at final task state:

```text
contracts: 155 tests
architecture-contract-tools: 25 tests; generated schemas current and reproducible
extension-bundler: 11 tests
extension-runner: 4 real Docker isolation tests
runtime: 257 tests
payload-adapter: 32 tests
ui-runtime: 53 tests
customer PostgreSQL suite: 10/10 journeys
phase attack corpus: 22 required attacks
phase:0: 45/45 tasks
```

Chromium markers: `P9_REMOTE_UI_BROWSER_PASS` and `P9_THEME_SKIN_BROWSER_PASS`.

The customer suite proves actual HTTP continuity across Hot Application update/rollback and digest-pinned Docker Platform Plugin promotion/rollback. It deliberately fails green readiness, crashes PostgreSQL fence transfer, rejects stale worker completion, preserves one logical effect, blocks contract cleanup while rollback is open, resumes bounded backfill, restores active/rollback generations, and refuses offline migration as `maintenance-required` without changing traffic.

At the final implementation head, `pnpm gate:9` passed Gates 1–8 and all mandatory Gate 9 class-specific tests. `scripts/gate-9.mjs` fails if required schemas, real Docker/PostgreSQL/Chromium anchors, packed-boundary proof, attack mappings, Sales-only scope, or this result matrix are missing.

## Known limits and deferred scope

- Phase 9 proves the external source/build/deployment authority through signed self-hosted reference adapters and digest-pinned local Docker. Production orchestrator credentials, scheduling, and customer hosting policy remain deployment-specific adapters.
- The headless mutation authority is trusted automation only. Customer users, roles, grants, approvals, permission-aware status, and role templates belong to Phase 10.
- Public marketplace governance, publisher onboarding, and broad extension production remain deferred.
- Sales is the sole Platform Plugin reference; the Gate 9 Hot Application and Theme Skin are infrastructure fixtures, not new domain breadth.
- Maintenance-required delivery is represented and refused safely; a production maintenance workflow is not claimed.

## Phase-result decision

Every Phase 9 task, acceptance journey, hardening amendment, and kill criterion has an executable closure path. No host-process code injection, live database-authored static graph, unsigned build, mixed generation, unfenced worker, or false zero-downtime path is accepted.

**Decision:** **READY FOR PHASE REVIEW**

Gate decision: **GO PHASE 10 RBAC AND AUTHORIZATION**.

After project-manager PASS, the exact next task is **P10.1 — Freeze owner, role, grant, assignment, template, and revision contracts**. Do not start domain expansion; continue using Sales and the Gate 9 extension fixtures to harden platform authorization.
