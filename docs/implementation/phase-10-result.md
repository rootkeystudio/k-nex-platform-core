# Phase 10 Result — RBAC, Authorization, and Extension Bootstrap

- **Date:** 2026-09-02
- **Gate:** Gate 10
- **Accepted base:** `2e510d77ac9ce3e62426f136cf56c492bb6a29ce`
- **Delivery:** one Phase 10 branch and pull request; no merge or auto-merge
- **Decision:** **READY FOR PHASE REVIEW**
- **Review state:** Owner-review remediation passes the 15-test local focused Gate 10 corpus and reused Sol-xhigh review; final exact-head PR/cumulative CI remain required before merge.

## Scope proved

Phase 10 replaces role labels and trusted-automation-only lifecycle access with one customer-owned PostgreSQL RBAC model. Platform and extension permissions have explicit owners; extension grants bind authorization generations; protected roles and role templates preserve customer edits; every effective-authority change advances durable revisions and invalidates runtime boundaries. Sales remains the sole first-party domain module.

## Completed task matrix

| Task | Result |
|---|---|
| P10.1 | Closed owner, permission, role, generation-bound grant, assignment, template/adoption, protected-role, revision, receipt, and audit contracts with Zod/AJV/generated-schema parity |
| P10.2 | Reconciled static platform permissions plus Platform Plugin and Hot Application permission, policy-binding, and role-template declarations; snapshots cannot authorize |
| P10.3 | Added normalized customer PostgreSQL roles, grants, assignments, adoptions, snapshots, generations, revisions, bootstrap receipts, audit, and optimistic transactions |
| P10.4 | Resolved current effective authority by principal, application, environment, owner generation, lifecycle, scope, delegation, and live revision without client-selected permission authority |
| P10.5 | Wired current authority across source, action, Payload, tool, job, realtime, route, Remote UI, settings, theme, PluginManager, and deployment boundaries |
| P10.6 | Added version/digest-bound protected role baselines, trusted exact-predecessor reconciliation, one-time first owner, concurrent last-owner safety, Sales and Hot Application templates, tombstones, three-way comparison, and one-time selected copy |
| P10.7 | Projected disable, re-enable, update, uninstall, reinstall, quarantine, retained-grant adoption, and Platform Plugin release lifecycle into authorization generations |
| P10.8 | Added transactional authorization outbox delivery, polling recovery, signed runner revision floors, active cancellation, and browser/Remote UI/realtime cache or session invalidation |
| P10.9 | Delivered an eight-route accessible administration kill-spike with reversible grants/assignments, real template selection, durable audit time, session-bound plans, and current-authority enforcement |
| P10.10 | Added Gate 10/result artifacts, atomic static runtime/authorization convergence, nonblocking administration reads, current-v1 release evidence, and real multi-process zero-downtime proof |

## Public contracts and affected areas

- `@k-nex/contracts`: authorization owner, permission, role, grant, assignment, template/adoption, catalog snapshot, extension generation, state, bootstrap receipt, and decision audit schemas.
- `@k-nex/runtime`: platform registry, extension reconciliation, effective authority, protected roles/templates, lifecycle projection, current-authority adapters, authorization revision consumers, and system administration services.
- `@k-nex/payload-adapter`: customer PostgreSQL authorization store, lifecycle projector, transactional authorization outbox, durable audit timestamps, and current authority at Payload/theme boundaries.
- `@k-nex/extension-runner`, Remote UI, source/action/tool/settings/theme and deployment boundaries: current revision admission and active revocation.
- Browser/UI: fixed `/system/access/*` and `/system/extensions/*` pages rendered from server-authorized view models with native accessible actions.
- Customer fixture: customer-owned migrations 19–22 plus real PostgreSQL, HTTP, Chromium, lifecycle, convergence, and administration journeys.

## Executable evidence

`pnpm gate:10` remains the cumulative manual/main acceptance command and first runs every earlier gate through Gate 9. Pull requests run the same non-marker `scripts/gate-10.mjs` Phase 10 evidence directly, avoiding repeated Gates 0–9 work while preserving the focused architecture, PostgreSQL, and Chromium proofs for:

- authorization storage, customer isolation, generation fencing, bootstrap replay, and last-owner races;
- effective authority, forged input rejection, current policy boundaries, Sales and Hot Application role templates;
- template tombstones, lifecycle dormancy, uninstall/reinstall fencing, and retained-grant adoption;
- transactional outbox delivery, lost-message polling convergence, claim recovery, runner/browser/Remote UI/realtime revision behavior;
- fixed-route admission and revocation/regrant replay denial;
- real PostgreSQL/HTTP/Chromium access and extension administration, including `P10_9_SYSTEM_ADMIN_POSTGRES_CHROMIUM_EVIDENCE=PASS`.

The gate is not a marker-only assertion: it executes exact named test files, requires their TAP pass count and names, requires the Chromium evidence marker, validates the canonical authorization schema and Sales-only module boundary, and checks this task matrix and decision.

The bounded `node scripts/gate-10.mjs` evidence passes all 15 named PostgreSQL/Chromium tests on Node 24.19.0. It now includes protected-baseline evolution, atomic Sales scope admission, public-boundary delegation dominance, target-specific protected assignment admission, reversible grant/assignment authority, and nonblocking repeatable-read administration. The inherited Gate 9 static proof supplies the locked lifecycle-admission and continuous HTTP topology evidence.

### Convergence evidence boundary

The evidence is deliberately stated as a composite, not as seven independent P10 child processes. `authorization-convergence-postgres.test.mjs` uses real PostgreSQL transactions, durable outbox claims, dispatcher recovery, lost-message polling, and seven concrete boundary adapters in one fixture process. Gate 9 separately supplies the real multi-process web, worker, runner, gateway, and realtime delivery topology; Phase 10 adds current-RBAC process-gateway denial plus focused runner active-cancellation, browser/Remote UI revocation, and realtime reauthorization proofs. Gate 10 requires both layers and does not relabel the seven callback adapters as separate operating-system processes.

Convergence evidence covers seven callback boundaries, but it does not claim seven independent processes.

## Required attack outcomes

The executable corpus rejects role-label authority, hidden-UI authority, forged permission/owner/generation/scope, extension platform or foreign grants, extension-controlled assignments, first-owner replay, last-owner revocation, cross-actor/generation cache reuse, stale session/runner/subscription work, inactive-as-active display, plugin-only inactive list noise, hidden assigned inactive roles, retired-grant resurrection, unknown permission injection, unauthorized PluginManager/deployment requests, over-authorized Remote UI capability, and runtime-authored executable policy/template content.

## Known limits and deferred scope

- Role inheritance, explicit deny, direct per-user grants, temporal assignments, full SSO, and public marketplace governance remain out of scope.
- The fixed extension-detail route proves install planning/execution admission only; disable, rollback, update, and uninstall product controls remain outside this kill-spike. Deployment-specific approval and reauthentication providers remain adapters.
- Maintenance-required delivery is classified and refused safely; a production maintenance workflow is not claimed.
- Current Phase 9–10 first-party release fixtures, workspace packages, packed artifacts, customer manifests, and signed hosted evidence use `1.0.0`; no compatibility shim or supported prior product release exists. Upgrade behavior uses only neutral `@fixture` identities.
- The seven-boundary P10 convergence fixture uses in-process adapters as described above. Independent-process lifecycle delivery remains proven by Gate 9 and is composed with focused Phase 10 revocation evidence; this result makes no broader claim.
- No CRM/CMS breadth or second first-party domain starts from this phase. Sales remains the only first-party reference module.
- Static lifecycle admission remains a narrow SECURITY DEFINER boundary with a fixed search path and revoked public access; it does not grant the supervisor broad runtime-table mutation authority.

## Phase-result decision

Every P10.1–P10.10 implementation slice, the 15-test local focused Gate 10 corpus, and the reused Sol-xhigh review pass. This result does not claim a final exact-head GitHub run: the focused PR check and one cumulative Linux/AppArmor `workflow_dispatch` run on the frozen final SHA are still required before owner merge review.

**Decision:** **READY FOR PHASE REVIEW**

Gate decision on acceptance: **GO SYSTEM SETTINGS AND FULL EXTENSION ADMINISTRATION PRODUCTIZATION**.

After project-manager PASS and merge, do not begin a broad CRM/CMS module. Start the next roadmap decision for system settings and full extension administration productization from the accepted Gate 10 contracts.
