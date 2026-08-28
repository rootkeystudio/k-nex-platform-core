# Phase 7 Result — Comprehensive Headless Component System

- **Date:** 2026-08-28
- **Gate:** Gate 7
- **Baseline:** accepted Phase 6 on `main` (`e05b1e68`)
- **Delivery:** Phase 7 pull request rebased onto `main`; draft/open with no merge or auto-merge
- **Decision:** **GO Phase 8**
- **Review state:** all project-manager blockers remediated; acceptance evidence is tracked against the immutable PR head

## Scope proved

K-Nex now owns a style-agnostic component system with 60 Component Gallery families and 71 additional K-Nex utilities: **131 executable families** total. Every inventory entry has an explicit owner, package, behavior source, disposition, maturity, slots, applicable states, delivery task, and truthful test classes. An independently maintained family-to-test-class evidence map explicitly lists 49 stateful families and 82 default-only families without deriving entries or specialized proof classes from the inventory. The two-theme executable sweep fails if a family disappears, cannot render, lacks exact evidence coverage, or claims a server-observable state whose DOM marker cannot be proved; browser-only interaction states fail closed instead of receiving synthetic credit. Mutation tests prove a new inventory family or test-class claim cannot manufacture its own evidence.

The primitive theme ABI remains small. Native semantics handle simple structures; React Aria 1.20.0 and FocusScope 3.22.1 remain behind K-Nex navigation/overlay/focus adapters; TanStack Table 8.21.3 and TanStack Virtual 3.14.9 remain behind data adapters; Lexical 0.49.0 remains behind the optional rich-text editor. Their public/persisted types do not escape the adapters.

Sales remains the only first-party domain module. It is the real consumer for forms, registered sources/actions, authorized DataTable, page templates, four default pages, six component definitions, six Puck blocks, and the complete workspace builder profile. No additional domain plugin was introduced.

Project-manager remediation closes the exact authority and product-proof gaps: renderer action dispatch is scoped to the accepted immutable node/action binding; generic DataTable covers every declared source input kind; generic Form accepts only an explicitly configured valid registered action while its unconfigured default stays disabled; checkbox and date-range invalid semantics belong to the actual controls; and form controllers publish observable pending state, coalesce duplicate submissions, advance the clean baseline after save, and drive a rendered Sales opportunity edit form from registered async source options.

The follow-up review is also closed in executable paths. DataTable action visibility and execution re-resolve the current catalog revision; authorized projections are identical in cache identity and transport; filter, projection, page, cursor, and bulk limits fail closed. Sales proves an opaque cursor advancing between real pages. DataGrid retains one roving tab stop while nested controls use explicit action mode. Concurrent form submissions preserve newer edits and order their saved baseline. Labels, descriptions, errors, invalid, and read-only state reach the actual controls. VirtualList preserves keyed focus through reorder and shrink without stealing focus on mount. Nested Puck containers render their children through the same production presentation boundary. Sales exported descriptor aggregates use explicit public contract types, preventing host-dependent inferred union ordering from changing emitted declarations or the packed fixture.

The latest review closes the remaining vertical gaps. Standard gateway budgets accept exactly one table pagination mode, reject pagination on metrics, charge cursor size, and key cache identity by the full controls. Sales continuation tokens bind source/version, filters, sorts, and page size; an authenticated gateway proof advances page one to page two and rejects changed-query replay. Filter, sort, and search fields must belong to the effective authorized projection across UI, query identity, transport, and server enforcement; source-query overrides cannot expand the definition projection. Oversized bulk actions stop at an explicit 100-row ceiling and return constant-size rejection metadata. DataGrid exposes select-all outside its composite, reaches multiple actions with keyboard-only action mode, and returns to the owning cell. Form duplicate work is keyed by logical revision. VirtualList covers empty repopulation, removed-key replacement, off-viewport keyed reorder, and deterministic duplicate-key rejection; focus handoff reruns after active-key reconciliation so the result is stable across browser scheduling speeds.

The final remediation makes pagination authority source-owned. Every descriptor declares supported pagination modes; the runtime rejects offset/cursor mismatches before handler dispatch, and DataTable definitions cannot advertise a broader client preset. Sales tasks declare offset and cursor support, opportunities remain offset-only, and metrics declare no pagination. Malformed or query-mismatched Sales continuation tokens now produce bounded `INVALID_CURSOR` 400 problems while the authenticated page-one-to-page-two proof remains intact. The Socket.IO connection-bound regression no longer relies on a fixed 20 ms delay: it waits for each observable denial counter transition, passes a 20-run focused stress proof, and remains inside the complete Gate 7 chain.

The nested-runtime identity follow-up is closed at the presentation boundary. Canonical child presentations carry their immutable `UiNode.id` through the React-free runtime, while the React adapter applies those IDs as stable keys in a canonical-child fragment and preserves Puck-injected children in a separate keyed fragment. Canonical and injected keys may therefore share text without colliding or rewriting Puck-owned keys. A stateful regression renders two children of the same component type, gives each distinct local state, reverses canonical order, and proves the values stay with their node IDs in both production and Puck after serialize/reload. The same proof captures `console.error` and fails on React's missing-key warning.

The final sibling-boundary correction extends that identity contract beyond composable containers. Region roots, fallback-preserved children, and non-composable children now remain immutable identity-bearing lists whenever the presentation is not string-only. `@k-nex/ui-runtime` stays React-free and recognizes only lists it created; `@k-nex/ui-components` owns the shared React host adapter, which applies canonical node keys and keeps leading, canonical, and injected namespaces separate. Builder preview accepts that host adapter and wraps its root with canonical identity. Regressions prove two same-type stateful region roots, fallback children, and non-composable children keep state through reorder; production and applicable Puck serialize/reload paths pass while captured `console.error` remains free of missing-key warnings.

The Puck host contract is now explicit and fail-closed. Any configured preview must inject a presentation host when the adapter is constructed; `@k-nex/builder-puck` does not import the React presenter at runtime. Hostless legacy mode retains string-only view-model output, but an opaque runtime list becomes the stable `PRESENTATION_HOST_REQUIRED` result instead of being returned to React. The adapter also rejects a supplied host that returns the opaque list unchanged. Focused regressions cover construction-time rejection without a host, React-element success and fallback roots through the shared host, hostless and no-op-host non-string denial, and retained sibling-identity proofs.

## Completed tasks

| Task | Primary evidence |
|---|---|
| P7.1 — taxonomy, slots, package boundaries | executable inventory and package boundaries |
| P7.2 — foundation/layout/content/feedback | semantic component suites |
| P7.3 — form and input family | form and Sales action spike suites |
| P7.4 — navigation/disclosure/overlay family | unit and Chromium interaction suites |
| P7.5 — data/content/editor adapters | bounded adapter and rich-text suites |
| P7.6 — standard DataTable/DataGrid | authorization, query-state, and grid suites |
| P7.7 — page templates and Sales pages | page-template and Sales page suites |
| P7.8 — generic and Sales Puck blocks | runtime/Puck reconciliation suites |
| P7.9 — accessibility/theme/interaction matrix | independent evidence registry and browser matrix |
| P7.10 — performance, coverage, closeout | performance probe and named Gate 7 validator |

## Product and authority proof

- `@k-nex/ui-data` consumes registered `table.records@1` definitions. Descriptor metadata controls required fields, filters, facets, sorts, pagination, row identity, action visibility, query identity, URL view state, and exact-source invalidation.
- Offset and opaque cursor controls are mutually exclusive and bounded. Controlled query state changes the authorization-safe query identity; actor/record authority never enters persisted URL state.
- Required-field permission loss renders a canonical insufficient-permission state. Optional field omission, loading, empty, error, stale, refetching, selection, detail, and authorized actions have explicit surfaces. Action definitions contain mutation identity and presentation only. Row and bulk actions require an actor-bound, catalog-revision-bound receipt created through an injected authoritative resolver; raw literals, actor substitution, duplicate/unknown/incomplete results, and absent authority fail closed before display or execution.
- Semantic table is the default. ARIA grid is explicit, exposes exactly one initial tab stop, and transfers that tab stop during tested arrow-key navigation. Array-backed `in` facets remain connected to the controlled query state. TanStack types do not enter K-Nex public declarations.
- Sales create-task and rendered opportunity-stage forms submit through registered action mutations. Field errors, conflicts, invalidation, dirty/pending state, duplicate-submit coalescing, and async registered-source options are executable.
- Dashboard, index, detail, create, edit, settings, wizard, and builder templates are compositional. Sales overview/tasks/opportunities/settings pages bind immutable page-template IDs and import no Payload, customer theme, Puck, or third-party table API.
- The 13 generic and six Sales Puck bridges execute the same runtime definition in production and editor. Round-trip, profile, missing block, source, and action replacement tests fail closed. The adapter snapshot preserves both source and action policy. Generic DataTable consumes an accepted `table.records@1` binding through the standard query/data path. Generic Form has no implicit authority; composition must provide an explicit registered action identity and form schema. Sales proves that configuration through `sales.task.create@1`, the standard mutation definition, and browser transport. The Sales quick-create block renders a real title/status form and dispatches the exact registered create action through the node/action-scoped UI runtime dispatcher; it is visibly disabled when that authority is absent.

## Accessibility, SSR, themes, and interaction

The shared matrix covers default, hover, focus, pressed, selected, disabled, read-only, pending, invalid, empty, error, high contrast, reduced motion, RTL, long text, and localization through applicable components under Minimal and Neobrutalism. It does not falsely claim every state applies to every family. Checkbox and both date-range inputs prove their own `aria-invalid` and described-by error relationship rather than inheriting a descendant marker. Testing Library uses role/name queries and user-event. Real Chromium checks keyboard focus, row selection, single-tab-stop grid navigation, APG tree keyboard interaction and nested-child pointer isolation, portal/dialog behavior, ARIA snapshots, forced colors, reduced motion, nested roots, live theme switching, and a keyboard-driven 10,000-row virtual list.

React 19 server markup hydrates in real Chromium without `onRecoverableError`, then opens and dismisses a portalled dialog. Minimal also passes the existing server/client hydration proof. The [screen-reader smoke record](evidence/phase-7-screen-reader-smoke.md) documents the accessibility-tree and keyboard journey without overstating commercial screen-reader coverage.

Browser marker: `P7_COMPONENT_MATRIX_BROWSER_PASS`.

## Performance, bundle, and tree-shaking evidence

Budgets are order-of-magnitude regression fences, not production capacity claims. Observed local results on Node 24.19.0:

| Probe | Observed | Budget |
|---|---:|---:|
| component entry gzip | 17,300 B | 45,000 B |
| DataTable adapter gzip | 48,321 B | 65,000 B |
| optional rich editor gzip | 105,037 B | 120,000 B |
| Sales pages gzip | 70,640 B | 150,000 B |
| 1,000-row semantic table SSR | under 1,500 ms | 1,500 ms |
| 10,000-item virtual list keyboard scroll in Chromium | under 500 ms | 500 ms |
| 1,000 filter/search/pagination control transitions | under 500 ms | 500 ms |
| 1,000-option combobox + 1,000-node tree SSR | under 1,000 ms | 1,000 ms |
| Chromium initial matrix render | under 2,000 ms | 2,000 ms |
| dialog open / open-close | under 500 / 1,000 ms | 500 / 1,000 ms |
| 20 mount/unmount cycles retained heap | under 64 MiB | 64 MiB |

Esbuild metafiles, rather than minified identifier text, prove Lexical is absent from component, DataTable, and Sales-page dependency graphs; it appears only in the optional rich editor entry. The editor rejects structured documents it cannot edit losslessly, while the renderer preserves headings, lists, links, and marks. Rich-text validation enforces depth, node, and cumulative-byte budgets. Performance marker: `P7_COMPONENT_PERFORMANCE_PASS`.

## Validation

The phase gate runs every earlier gate, plugin conformance, full build, component package suites, package boundaries, real browser journeys, hydration, state matrix, and performance budgets:

```bash
pnpm gate:7
pnpm audit --audit-level high
git diff --check
```

The final local candidate passes `pnpm install --frozen-lockfile`, focused builder-block, Builder/Puck, and Sales suites, Builder/Puck browser accessibility, and the complete `pnpm gate:7` chain with `GATE_7_PASS`. The Builder/Puck suite now has 36 passing tests, including the mandatory-host and fail-closed legacy paths; builder blocks retain nine identity tests and Sales retains 42 tests plus boundaries and pack proof. Exact code-bearing head `15f1682076c973d3feb3884eaa28d1d9bc74d8f8` passed required workflow run `33177003075` on attempt 1, including Gate 7 and exact-head repository evidence; the subsequent docs-only evidence head/run is recorded in pull-request evidence after GitHub creates it. Pack reproducibility requires consecutive raw pack bytes to match, a canonical committed gzip marker, and identical ordered exported entry names and contents. Platform-specific gzip streams or tar headers therefore cannot hide or fabricate a package-content change. Explicit aggregate declaration types make forced clean macOS and Linux `contracts.d.ts` outputs byte-identical (`20f204c2837d78891afbb194d7805957bdcf06dff36efbf78545b390af2dbba1`). The committed Sales fixture, root file-package integrity, and Gate 1 resolved application evidence are regenerated from stable clean output and pass cross-host pack checks.

Key Phase 7 totals remain enforced by Gate 7 rather than frozen prose counts. Existing lower-gate contract/runtime/Payload/PostgreSQL and browser suites, plus the latest cursor, hidden-field, bulk, DataGrid, form, VirtualList, and complete runtime sibling-identity regressions, remain part of `gate:7`.

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
