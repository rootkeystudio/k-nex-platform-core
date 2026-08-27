# Phase 7 Result — Comprehensive Headless Component System

- **Date:** 2026-08-27
- **Gate:** Gate 7
- **Baseline:** `f40f377`
- **Delivery:** stacked Phase 7 pull request; no merge or auto-merge
- **Decision:** **GO Phase 8**
- **Review state:** formal exact-head review pending

## Scope proved

K-Nex now owns a style-agnostic component system with 60 Component Gallery families and 71 additional K-Nex utilities: **131 executable families** total. Every inventory entry has an explicit owner, package, behavior source, disposition, maturity, slots, applicable states, delivery task, and truthful test classes. An independently maintained family-to-test-class evidence map explicitly lists 49 stateful families and 82 default-only families without deriving entries or specialized proof classes from the inventory. The two-theme executable sweep fails if a family disappears, cannot render, lacks exact evidence coverage, or claims a server-observable state whose DOM marker cannot be proved; browser-only interaction states fail closed instead of receiving synthetic credit. Mutation tests prove a new inventory family or test-class claim cannot manufacture its own evidence.

The primitive theme ABI remains small. Native semantics handle simple structures; React Aria 1.20.0 and FocusScope 3.22.1 remain behind K-Nex navigation/overlay/focus adapters; TanStack Table 8.21.3 and TanStack Virtual 3.14.9 remain behind data adapters; Lexical 0.49.0 remains behind the optional rich-text editor. Their public/persisted types do not escape the adapters.

Sales remains the only first-party domain module. It is the real consumer for forms, registered sources/actions, authorized DataTable, page templates, four default pages, six component definitions, six Puck blocks, and the complete workspace builder profile. No additional domain plugin was introduced.

## Completed tasks

| Task | Primary commit |
|---|---|
| P7.1 — taxonomy, slots, package boundaries | `581c179` |
| P7.2 — foundation/layout/content/feedback | `5bd9c93` |
| P7.3 — form and input family | `5301d53` |
| P7.4 — navigation/disclosure/overlay family | `827fc24` |
| P7.5 — data/content/editor adapters | `aa6abf4` |
| P7.6 — standard DataTable/DataGrid | `b70815a` |
| P7.7 — page templates and Sales pages | `f3cf1c6` |
| P7.8 — generic and Sales Puck blocks | `e31af8d` |
| P7.9 — accessibility/theme/interaction matrix | `b557058` |
| P7.10 — performance, coverage, closeout | closeout commit |

## Product and authority proof

- `@k-nex/ui-data` consumes registered `table.records@1` definitions. Descriptor metadata controls required fields, filters, facets, sorts, pagination, row identity, action visibility, query identity, URL view state, and exact-source invalidation.
- Offset and opaque cursor controls are mutually exclusive and bounded. Controlled query state changes the authorization-safe query identity; actor/record authority never enters persisted URL state.
- Required-field permission loss renders a canonical insufficient-permission state. Optional field omission, loading, empty, error, stale, refetching, selection, detail, and authorized actions have explicit surfaces. Action definitions contain mutation identity and presentation only. Row and bulk actions require an actor-bound, catalog-revision-bound receipt created through an injected authoritative resolver; raw literals, actor substitution, duplicate/unknown/incomplete results, and absent authority fail closed before display or execution.
- Semantic table is the default. ARIA grid is explicit, exposes exactly one initial tab stop, and transfers that tab stop during tested arrow-key navigation. Array-backed `in` facets remain connected to the controlled query state. TanStack types do not enter K-Nex public declarations.
- Sales create-task and opportunity-stage forms submit through registered action mutations. Field errors, conflicts, invalidation, dirty state, and async registered-source options are executable.
- Dashboard, index, detail, create, edit, settings, wizard, and builder templates are compositional. Sales overview/tasks/opportunities/settings pages bind immutable page-template IDs and import no Payload, customer theme, Puck, or third-party table API.
- The 13 generic and six Sales Puck bridges execute the same runtime definition in production and editor. Round-trip, profile, missing block, source, and action replacement tests fail closed. The adapter snapshot preserves both source and action policy. The Sales quick-create block renders a real title/status form and dispatches the exact registered create action through the injected UI runtime dispatcher; it is visibly disabled when that authority is absent.

## Accessibility, SSR, themes, and interaction

The shared matrix covers default, hover, focus, pressed, selected, disabled, read-only, pending, invalid, empty, error, high contrast, reduced motion, RTL, long text, and localization through applicable components under Minimal and Neobrutalism. It does not falsely claim every state applies to every family. Testing Library uses role/name queries and user-event. Real Chromium checks keyboard focus, row selection, single-tab-stop grid navigation, APG tree keyboard interaction and nested-child pointer isolation, portal/dialog behavior, ARIA snapshots, forced colors, reduced motion, nested roots, live theme switching, and a keyboard-driven 10,000-row virtual list.

React 19 server markup hydrates in real Chromium without `onRecoverableError`, then opens and dismisses a portalled dialog. Minimal also passes the existing server/client hydration proof. The [screen-reader smoke record](evidence/phase-7-screen-reader-smoke.md) documents the accessibility-tree and keyboard journey without overstating commercial screen-reader coverage.

Browser marker: `P7_COMPONENT_MATRIX_BROWSER_PASS`.

## Performance, bundle, and tree-shaking evidence

Budgets are order-of-magnitude regression fences, not production capacity claims. Observed local results on Node 24.19.0:

| Probe | Observed | Budget |
|---|---:|---:|
| component entry gzip | 17,300 B | 45,000 B |
| DataTable adapter gzip | 47,375 B | 65,000 B |
| optional rich editor gzip | 105,037 B | 120,000 B |
| Sales pages gzip | 69,502 B | 150,000 B |
| 1,000-row semantic table SSR | 70.66 ms | 1,500 ms |
| 10,000-item virtual list keyboard scroll in Chromium | under 500 ms | 500 ms |
| 1,000 filter/search/pagination control transitions | 7.02 ms | 500 ms |
| 1,000-option combobox + 1,000-node tree SSR | 44.54 ms | 1,000 ms |
| Chromium initial matrix render | under 2,000 ms | 2,000 ms |
| dialog open / open-close | under 500 / 1,000 ms | 500 / 1,000 ms |
| 20 mount/unmount cycles retained heap | under 64 MiB | 64 MiB |

Esbuild metafiles, rather than minified identifier text, prove Lexical is absent from component, DataTable, and Sales-page dependency graphs; it appears only in the optional rich editor entry. The editor rejects structured documents it cannot edit losslessly, while the renderer preserves headings, lists, links, and marks. Rich-text validation enforces depth, node, and cumulative-byte budgets. Performance marker: `P7_COMPONENT_PERFORMANCE_PASS`.

## Validation

The phase gate runs every earlier gate, plugin conformance, full build, component package suites, package boundaries, real browser journeys, hydration, state matrix, and performance budgets:

```bash
pnpm gate:7
git diff --check
```

Key Phase 7 totals: design-system 11 tests, components 11 tests, UI data 14 tests, forms 5 tests, pages 1 test, builder Puck 31 tests, UI builder blocks 1 test, UI testing 6 tests, Sales 22 Node tests plus 17 Vitest tests. Existing lower-gate contract/runtime/Payload/PostgreSQL and browser suites remain part of `gate:7`.

## Limits and deferred scope

- Sales is a platform reference and test harness, not a complete CRM product.
- Non-Sales first-party domain plugins remain deferred through Gate 8.
- Experimental families remain explicitly marked; Sales/matrix consumers are `reference`, not falsely labeled stable-pre-v1.
- Performance numbers are deterministic regression fences on local fixtures, not load, capacity, mobile-device, or production-SLA claims.
- Exhaustive manual testing across every screen reader/browser pair remains outside this automated smoke record.
- Gate 8 owns lifecycle/upgrade/restore safety, application generation, two independent Sales-based customer fixtures, release provenance, and fleet evidence.

## Gate decision

No Gate 7 kill criterion fired. The component inventory is executable, Sales proves the platform-owned form/data/page/builder path, themes share behavior, advanced engines remain bounded adapters, and accessibility/performance gates pass.

**Decision:** **GO Phase 8**

After project-manager review, the exact next task is **P8.1 — freeze release, upgrade, restore, and generated-application contracts**.
