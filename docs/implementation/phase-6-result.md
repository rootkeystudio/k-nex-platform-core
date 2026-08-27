# Phase 6 Result — Plugin Platform Hardening and Sales Reference Module

- **Date:** 2026-08-27
- **Gate:** Gate 6
- **Baseline:** `6d9730d`
- **Delivery:** Pull request #21 open; exact-head CI pending; no merge or auto-merge
- **Decision:** **GO Phase 7**
- **Review state:** Sol-high exact-head phase review PASS at `60a58b4`; project-manager review/merge remain pending

## Scope proved

K-Nex now has one complete pre-v1 plugin authoring path. The contribution taxonomy is typed and machine-readable across all 20 categories. Static manifest declarations, installed package identity, generated customer artifacts, phased runtime registration, executable bindings, and sanitized runtime inventory reconcile deterministically. Unknown, duplicate, undeclared, wrongly phased, unbound, or capability-invalid contributions fail closed.

The package boundary is fixed at `manifest/contracts/server/browser/ui/migrations/testing`. Contracts do not leak React, Puck, Payload, MCP, or query-library types; browser/UI entrypoints do not import server or Payload code. Sales packages exactly those entrypoints and the customer fixture installs the byte-reproducible tar with exact lock integrity.

Strict settings, permission, route, navigation, default-page, browser query/action, component/block, renderer, and Puck bridge contracts are executable. Package templates instantiate idempotent customer-owned pages, preserve edits, preflight capabilities, and require explicit adoption of later versions.

`module.sales` remains intentionally small while exercising every category: tasks and opportunities; three sources and three actions; two tools; task/opportunity events and realtime invalidations; pipeline/default-page settings; six components, six blocks, four pages, routes/navigation, localization, health, lifecycle, jobs, migrations, and testing metadata.

Lifecycle state keeps support, installed bytes, enabled state, settings readiness, migration readiness, retained data, and release support independent. Source-controlled install plans seed missing templates only. Disable retains package/schema/read compatibility/data while blocking collection writes and executable source/action/tool/job/navigation/route/UI/page behavior. Re-enable restores behavior only after readiness. Schema-owning uninstall remains refused and destructive planning begins with deterministic reference scanning.

## Completed tasks

| Task | Primary commit |
|---|---|
| P6.1 — complete contribution taxonomy | `9829b1e` |
| P6.2 — authoring entrypoints | `6b32642` |
| P6.3 — settings, permissions, routes, navigation | `8506747` |
| P6.4 — default page templates and seed semantics | `480e73a` |
| P6.5 — browser query/action factories | `5d46610` |
| P6.6 — component/Puck registration | `7f20c40` |
| P6.7 — complete Sales reference plugin | `3e9be9d` |
| P6.8 — plugin conformance kit | `789937a` |
| P6.9 — install/disable/re-enable proof | `1f9b24c` |
| P6.10 — Gate 6 closeout | `e223d2d` |

Post-closeout review remediation is preserved as coherent commits `9e312fe`, `8a3d543`, `e459787`, `4df5120`, `c288f43`, `5d6e3f5`, `1076a7e`, `9e31865`, `d5b35b1`, `1a4bab3`, `a75d563`, `f4720f1`, `5ca137c`, `4c2a808`, `e1efe98`, `1bba6c7`, `7afed87`, `d2929f2`, `14f938e`, `5e90414`, `4072284`, and `60a58b4`. The final layers replace the rejected legacy lifecycle fallback, reconcile the complete exact reference graph, remove ambient Payload/action authority, make conformance evidence runner-owned, align the Gate 2A fixture, and make clean Sales declaration/package generation reproducible in CI.

## Public contracts and packages affected

- `@k-nex/contracts`: contribution registry; strict settings, permission, route, navigation, page-template, and UI contribution descriptors.
- `@k-nex/runtime`: phased registration/binding reconciliation; settings, page templates, opaque lifecycle authority, exact reference scans, and the registered action gateway.
- `@k-nex/ui-runtime`: standard source queries, action mutations, UI bindings, result states, invalidation, URL-safe view state.
- `@k-nex/builder-puck`: production/Puck reconciliation over the same canonical renderer.
- `@k-nex/payload-adapter`: lifecycle-aware composition plus collection/operation-scoped persistence capabilities; plugin handlers never receive ambient Payload Local API authority.
- `@k-nex/module-sales`: the sole reference domain module and exact packed artifact.
- Customer Gate 1: migration revision 6, exact inventory, lifecycle deployments, and real PostgreSQL data-retention proof.
- Repository tooling: `pnpm plugin:check <plugin-directory>` and `pnpm gate:6`.

## Conformance and gate evidence

The plugin command requires all 13 evidence classes and executes eleven exact proofs. Customer/Postgres boot, Sales platform execution, package boundaries, packed reproducibility, and generated reference documentation are runner-owned. Named Node proofs must live inside Sales, receive runner-owned identity, pass exactly one selected test, and cannot invoke a direct or transitively imported process runner. Public entrypoint boundaries traverse the complete local import graph. Missing/unknown/duplicate evidence, wrapper shell-outs, indirect forbidden imports, external tests, arbitrary scripts, extra fields, realpath escape, stale docs, and stale package bytes fail closed.

Acceptance observed on Node.js `24.19.0` and pnpm `11.9.0`:

```bash
pnpm build
pnpm contracts:validate
pnpm plugin:check:test
pnpm plugin:check modules/sales
pnpm --filter @k-nex/runtime test
pnpm --filter @k-nex/payload-adapter test
pnpm --filter @k-nex/customer-gate-1 test:postgres
pnpm gate:6
pnpm audit --audit-level high
git diff --check
```

Final task acceptance totals reached contracts 140, runtime 178, UI runtime 41, builder 31, Payload adapter 32, Sales 34, conformance-plan 4, and the customer unit/PostgreSQL gates. The PostgreSQL proof exercises all three Sales sources and all three actions through standard gateways, rejects out-of-scope task and opportunity IDs, boots enabled/disabled/re-enabled deployments, preserves retained data, and executes registered event/realtime/job behavior.

The complete local `gate:6` chain passed at exact head `60a58b4` with its standard commands. The high/critical audit threshold also passed; the package manager reported two low and three moderate findings, with no high or critical advisory. A Sol-high exact-head review independently returned PASS with no remaining blocker or regression.

## Plugin authoring freeze

[Plugin authoring](../plugin-authoring.md) is the entry document. It links directly to tested contracts, Sales implementations, fixtures, commands, and the runner-generated [Sales reference inventory](../generated/module-sales-reference.md). `defineSourceQuery`, `defineActionMutation`, `defineUiContributionBinding`, phased `definePluginRegistration`, settings/page-template/lifecycle helpers, and conformance schema 3 are the pre-v1 authoring surface. The provisional `definePluginQueries`/`definePluginActions` examples were removed; no aliases or compatibility shims remain.

A second module should need domain contracts and handlers, not a new package boundary, contribution category, transport, cache, permission model, page seed mechanism, UI renderer bridge, lifecycle model, or test runner.

## Failure and attack evidence

| Failure/attack | Executable evidence |
|---|---|
| undeclared/duplicate/wrong-phase contribution or missing binding | registration runtime suite and customer inventory reconciliation |
| unauthorized, stale, or schema-invalid Sales settings change | target-bound Sales settings conformance proof |
| unauthorized source/field or direct query scope manipulation | runtime authorization and authenticated customer fixture |
| forged action authorization, arbitrary record mutation, or ambient Local API access | registered action/tool decision tests, persistence-capability denial, and customer PostgreSQL action fixture |
| server import in browser/UI or third-party type leakage in contracts | runner-owned transitive Sales boundary checker |
| unavailable page-template resource or failed migration | page-template preflight/last-valid tests |
| editor/runtime renderer drift | Sales runtime/Puck parity proof |
| external/unrelated proof, wrapper shell-out, indirect forbidden import, fabricated script, duplicate evidence, or arbitrary plan field | four conformance-runner negative tests |
| stale/non-reproducible packed module | byte-level Sales pack comparison and lock integrity |
| disabled plugin write or executable surface access | lifecycle availability tests plus real PostgreSQL 403/source 404 proof |
| schema-owning uninstall or destructive operation with references | lifecycle refusal/reference-scan tests |

## Explicit limits and deferred scope

- Sales is a reference contract harness, not a mature commercial CRM.
- No second first-party domain module is permitted before Gate 8.
- Gate 7 owns the comprehensive component/form/table/page/block system and broad accessibility/theme matrix.
- Gate 8 owns package release/upgrade planning, migration locks and stale-artifact fences, archive/export, purge, backup/restore, `create-knex-app`, two independent customers, provenance, and fleet safety.
- Generic retained-schema uninstall is not promised.
- Production capacity, soak, regional failover, marketplace distribution, and third-party trust policy are not claimed.

## Gate decision

No Gate 6 kill criterion fired. Sales passes the complete authoring/conformance path; the remaining work is explicit Gate 7 component breadth and Gate 8 lifecycle/application-factory/release depth.

**Decision:** **GO Phase 7**

After project-manager PASS, the exact next task is **P7.1 — component taxonomy, slots, and package boundaries**.
