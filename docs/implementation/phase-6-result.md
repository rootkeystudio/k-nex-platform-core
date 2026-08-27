# Phase 6 Result — Plugin Platform Hardening and Sales Reference Module

- **Date:** 2026-08-27
- **Gate:** Gate 6
- **Baseline:** `6d9730d`
- **Delivery:** Pull request #21 open; project-manager remediation complete; no merge or auto-merge
- **Decision:** **Await designated project-manager PASS and merge**
- **Review state:** Remediation complete; exact-head verification and designated project-manager rereview remain

## Scope proved

K-Nex now has one complete pre-v1 plugin authoring path. The contribution taxonomy is typed and machine-readable across all 20 categories. Static manifest declarations, installed package identity, generated customer artifacts, phased runtime registration, executable bindings, and sanitized runtime inventory reconcile deterministically. Unknown, duplicate, undeclared, wrongly phased, unbound, or capability-invalid contributions fail closed.

The package boundary is fixed at `manifest/contracts/server/browser/ui/migrations/testing`. Contracts do not leak React, Puck, Payload, MCP, or query-library types; browser/UI entrypoints do not import server or Payload code. Sales packages exactly those entrypoints and the customer fixture installs the byte-reproducible tar with exact lock integrity.

Strict settings, permission, route, navigation, default-page, browser query/action, component/block, renderer, and Puck bridge contracts are executable. Package templates instantiate idempotent customer-owned pages, preserve edits, preflight capabilities, and require explicit adoption of later versions.

`module.sales` remains intentionally small while exercising every category: tasks and opportunities; three sources and three actions; two tools; task/opportunity events and realtime invalidations; pipeline/default-page settings; six components, six blocks, four pages, routes/navigation, localization, health, lifecycle, jobs, migrations, and testing metadata.

Lifecycle state keeps support, installed bytes, enabled state, settings readiness, migration readiness, retained data, and release support independent. Source-controlled install plans seed missing templates only. Disable retains package/schema/read compatibility/data while blocking collection writes and executable source/action/tool/job/navigation/route/UI/page behavior. Verified required plugin and capability-provider edges revoke dependent executable inventory transitively. Optional dependency loss preserves consumer inventory but never authority to call a disabled provider. Captured capability-service handles—including prototype methods, synchronous/async derived objects, functions, promises, and thenables—fail after freeze without authoritative scope or after provider/consumer revocation. Re-enable restores behavior only after readiness. Schema-owning uninstall remains refused and destructive planning begins with deterministic reference scanning.

## Completed tasks

| Task | Current evidence |
|---|---|
| P6.1 — complete contribution taxonomy | typed contribution registry and Sales manifest reconciliation |
| P6.2 — authoring entrypoints | Sales package exports and transitive boundary proof |
| P6.3 — settings, permissions, routes, navigation | strict contracts and Sales settings/permission proof |
| P6.4 — default page templates and seed semantics | default-page seed conformance proof |
| P6.5 — browser query/action factories | browser query/action factory conformance proof |
| P6.6 — component/Puck registration | component runtime/Puck parity proof |
| P6.7 — complete Sales reference plugin | complete Sales contribution inventory and generated reference |
| P6.8 — plugin conformance kit | runner-owned plan validation and negative tests |
| P6.9 — install/disable/re-enable proof | customer PostgreSQL lifecycle proof |
| P6.10 — Gate 6 closeout | current artifact, contract, documentation, and gate validation |

Post-closeout remediation replaces the rejected legacy lifecycle fallback, reconciles the complete exact reference graph, removes ambient Payload/action authority, makes conformance evidence runner-owned, aligns the Gate 2A fixture, and makes clean Sales declaration/package generation reproducible in CI. The project-manager remediation adds exact Vitest JSON evidence; executes Git-free squash regression inside Gate 6; persists normalized settings; atomically compares snapshot authority for initial, existing, and migrated template paths; preserves/rebinds canonical Puck action and source policy; derives executable UI props validation from the canonical descriptor with own-property semantics; and revokes required consumers plus every captured capability-service authority path when provider lifecycle authority disappears.

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

The plugin command requires all 13 evidence classes and executes eleven exact proofs. Customer/Postgres boot, Sales platform execution, package boundaries, packed reproducibility, and generated reference documentation are runner-owned. Named Node proofs must live inside Sales, receive runner-owned identity, pass exactly one selected test, and cannot invoke a direct or transitively imported process runner. The Sales Vitest proof writes a JSON report and verifies one exact file/full test name passed with zero test or suite failures. Public entrypoint boundaries traverse the complete local import graph. Missing/unknown/duplicate evidence, wrapper shell-outs, indirect forbidden imports, external tests, arbitrary scripts, extra fields, realpath escape, stale docs, and stale package bytes fail closed.

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

Final task acceptance totals reached contracts 142, runtime 200, UI runtime 43, builder 35, Payload adapter 32, Sales 34, conformance-plan 5, and the customer unit/PostgreSQL gates. The PostgreSQL proof exercises all three Sales sources and all three actions through standard gateways, rejects out-of-scope task and opportunity IDs, boots enabled/disabled/re-enabled deployments, preserves retained data, and executes registered event/realtime/job behavior.

The complete Gate 6 chain passed on the remediation tree, including frozen install, clean/squash-safe artifact validation, real PostgreSQL lifecycle execution, browser/accessibility proofs, exact machine-readable conformance, deterministic packed Sales bytes, and `GATE_6_PASS`. Final metadata-head verification, high-threshold audit, and independent exact-head review are recorded outside this immutable result before the designated project manager decides whether to PASS and merge PR #21.

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
| unavailable or migration-injected page-template resource/authority | post-migration descriptor/inventory preflight attacks and last-valid-instance tests |
| editor/runtime renderer, action-policy, or props-schema drift | immutable Puck policy snapshots and descriptor-derived runtime validator parity tests |
| external/unrelated proof, wrapper shell-out, indirect forbidden import, fabricated script, duplicate evidence, arbitrary plan field, or human-reporter formatting | five conformance-runner tests plus exact Vitest JSON result validation |
| stale/non-reproducible packed module | byte-level Sales pack comparison and lock integrity |
| disabled plugin/provider write, dependent executable access, or stale captured capability service | lifecycle dependency-closure/service-lease tests plus real PostgreSQL 403/source 404 proof |
| schema-owning uninstall or destructive operation with references | lifecycle refusal/reference-scan tests |

## Explicit limits and deferred scope

- Sales is a reference contract harness, not a mature commercial CRM.
- No second first-party domain module is permitted before Gate 8.
- Gate 7 owns the comprehensive component/form/table/page/block system and broad accessibility/theme matrix.
- Gate 8 owns package release/upgrade planning, migration locks and stale-artifact fences, archive/export, purge, backup/restore, `create-knex-app`, two independent customers, provenance, and fleet safety.
- Generic retained-schema uninstall is not promised.
- Production capacity, soak, regional failover, marketplace distribution, and third-party trust policy are not claimed.

## Gate decision

No Gate 6 kill criterion fired after project-manager remediation. Await designated project-manager PASS and merge for PR #21; no merge or auto-merge is enabled.
