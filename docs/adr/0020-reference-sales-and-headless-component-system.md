# ADR-0020: Sales Is the Sole Reference Domain Plugin and K-Nex Owns the Headless Component System

- Status: accepted
- Date: 2026-08-27
- Decision owners: K-Nex platform maintainers
- Evidence: design-only
- Related: [Plugin platform hardening](../33-plugin-platform-hardening-and-reference-sales.md), [Headless component system](../34-headless-component-system.md), [Theme and design system](../18-theme-and-design-system.md)

## Context

K-Nex now has executable foundations for deterministic Payload composition, authenticated sources, agent tools/MCP, transactional outbox/realtime, and a Puck adapter. Expanding immediately into logistics, restaurant, inventory, budgeting, and other domain modules would force multiple modules to discover missing plugin/UI contracts independently and would create incompatible first-party examples.

The platform also needs a much broader component catalog than the deliberately small theme primitive ABI. Treating the full component catalog as a theme ABI would require every theme to reimplement complex behavior such as tables, calendars, tree navigation, forms, overlays, virtualization, and rich-text editing.

## Decision

1. `module.sales` is the only first-party domain module used to design and prove the pre-v1 plugin authoring contract until the platform-foundation program passes Gate 8.
2. New logistics, restaurant, inventory, budgeting, driver, dispatch, live-tracking, QR-menu, and similar first-party modules are deferred. Architecture blueprints may remain as backlog context but do not select implementation work.
3. Sales becomes the executable reference for every supported plugin contribution category: schema, migrations, domain behavior, permissions, settings, sources, actions, tools, events, jobs, realtime, UI, Puck blocks, routes, navigation, default pages, lifecycle, observability, localization, and testing.
4. A contribution category is not considered part of the plugin platform until Sales exercises it and the plugin conformance suite proves it.
5. K-Nex owns a comprehensive style-agnostic component system. The Component Gallery inventory is the minimum coverage checklist, supplemented by K-Nex data, form, page, and builder utilities.
6. The small theme primitive ABI remains small. Themes provide tokens, slots, recipes, and bounded structural CSS; they do not reimplement complex component behavior.
7. Complex components such as DataTable/DataGrid, date/calendar controls, tree view, virtualization, and rich-text editing are platform-owned versioned adapters built from or styled through the primitive ABI.
8. Established headless libraries may be used behind K-Nex adapters when they reduce complexity. Their types and lifecycle do not become persisted/public K-Nex contracts.
9. Plugin UI consumes K-Nex components and standard query/action factories. It does not create a parallel fetch/cache/form/table stack where the platform provides one.
10. Customer reuse before domain expansion is proved with two Sales-based customer compositions, not Cargo and Restaurant modules.

## Consequences

- Platform work is slower to appear broad but faster to become reusable and consistent.
- Sales may contain small proof features that exist primarily to exercise a platform surface; the phase result must distinguish reference proof from full CRM product scope.
- A future module should mostly supply domain schema, policies, descriptors, render compositions, and migrations while reusing platform behavior.
- The component program is large and must be delivered in layers with explicit inventory, maturity, accessibility, performance, and bundle gates.
- Themes remain practical to author because complex behavior is centralized.
- The future second-customer proof validates application-factory reuse without creating premature vertical products.

## Alternatives considered

### Build multiple domain modules in parallel

Rejected because each module would create its own provisional UI, query, settings, default-page, and lifecycle patterns before the plugin contract is stable.

### Use Sales only for backend proof and create separate UI demo modules

Rejected because the reference plugin must prove the complete server-to-builder-to-customer experience through one coherent package boundary.

### Expand the theme ABI to every component

Rejected because every theme would become a full component-framework implementation and behavioral drift would be unavoidable.

### Adopt one third-party component kit as the K-Nex public contract

Rejected because K-Nex requires stable semantic contracts, theme portability, and control over accessibility, package boundaries, data authority, and migrations. Third-party engines remain implementation details.

### Keep Cargo and Restaurant as Gate 7 fixtures

Rejected for the foundation program. Two Sales-only customer compositions are sufficient to prove package reuse and independent release cadence without adding domain breadth.

## Validation

ADR-0020 remains `design-only` until all of the following are evidenced:

```text
Gate 6
  complete plugin contribution taxonomy
  Sales reference completeness
  plugin conformance command

Gate 7
  component coverage matrix
  standard DataTable/forms/pages/Puck integration
  accessibility, theme, SSR, bundle, and performance evidence

Gate 8
  lifecycle/upgrade/restore safety
  create-knex-app application factory
  two independent Sales-based customer deployments/fixtures
  verifiable release and fleet evidence
```

The ADR is promoted atomically only after its complete normative scope is proven. Individual gate results may record partial evidence without promoting the ADR.