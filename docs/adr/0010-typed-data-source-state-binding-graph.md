# ADR-0010: Typed Data Sources, UI State, and Declarative Binding Graph

- Status: accepted
- Date: 2026-08-25
- Decision owners: K-Nex platform maintainers
- Related: [Plugin data sources](../24-data-sources-state-and-binding-graph.md), [Output contracts](../25-output-contracts.md), [UI composition runtime](../16-ui-composition-runtime.md), [Builder engine and profiles](../17-builder-engine-and-profiles.md), [Permissions, events, actions, and jobs](../09-permissions-events-and-jobs.md), [ADR-0012](./0012-hybrid-output-contracts.md)

## Context

K-Nex modules should export style-agnostic components while customer applications and authorized users compose CMS/workspace pages visually. Generic components such as pie charts, bar charts, metrics, tables, filters, and selectors need data without importing every domain module or embedding one hard-coded endpoint.

A builder user should be able to select a source such as “Sales opportunities by stage,” bind its date-range parameter to page state, render it through a generic chart, and connect chart selection to another table or action.

Providing that power through arbitrary JavaScript, SQL, raw URLs, unrestricted global state, automatic Payload collection exposure, or browser-side database access would violate the platform's security, migration, support, and deterministic-composition goals.

## Decision

K-Nex owns a visual-editor-independent, typed binding model containing:

```text
data-source definitions
output-contract definitions
runtime-context definitions
UI-state definitions
block input/output ports
registered actions
serializable bindings
binding-graph validation and execution
```

Enabled plugins register these contracts. The CLI composes static registries. Stored CMS/workspace documents contain stable IDs, major versions, validated parameters, selected field IDs, and graph connections only.

A data source is a bounded, server-executed, permission-aware query that returns a purpose-specific projection. It is distinct from UI state.

UI state is a typed coordination value with explicit scope and persistence policy. It is distinct from database records, cached query results, and arbitrary application-global state.

Generic components declare accepted output-contract ranges through typed input ports. The builder lists only compatible sources available from enabled plugins for the current actor, surface, audience, and target publication profile.

Output compatibility follows [ADR-0012](./0012-hybrid-output-contracts.md):

```text
canonical K-Nex contracts for generic blocks
+ namespaced plugin-owned contracts for domain blocks
+ exact source-specific schemas conforming to declared contracts
```

V1 allows:

```text
static values
read-only runtime context
page/component/user-approved UI state
plugin-defined server data sources
stable selected table-field IDs
component event → state update
component event → registered action
realtime invalidation and selected stream use cases
future registered/versioned transformation adapters
```

V1 rejects:

```text
arbitrary JavaScript expressions
SQL or unrestricted query languages
raw endpoint/import/function references
raw nested Payload field paths
unbounded client-side aggregation
public pages bound to private workspace sources
runtime executable connector installation
opaque extension bags in canonical payloads
```

The same canonical contracts are used by CMS and workspace builder profiles, but each profile filters sources, actions, states, and components according to surface/audience policy.

## Consequences

### Positive

- Generic visualization components can consume Sales, CRM, Logistics, Restaurant, Inventory, Budget, or customer-extension data.
- Modules remain independent from one another and from the editor engine.
- Cross-component filters and interactions are possible without arbitrary code.
- Server authorization remains authoritative.
- Stored layouts remain reviewable, migratable, and portable between themes.
- Source/action/state/contract ownership and versioning are explicit.
- Missing plugins or breaking upgrades produce deterministic orphan/migration diagnostics.
- Realtime transport remains replaceable and authoritative state remains refetchable.
- Stable table field IDs isolate builder documents from Payload storage paths.
- Domain-specific components retain an explicit plugin-owned contract path.

### Costs

- K-Nex must define and maintain data contracts, state scopes, ports, bindings, descriptors, and migrations.
- The runtime needs graph validation, cycle detection, caching, invalidation, error isolation, and output validation.
- Plugin authors publish bounded projections instead of raw database documents.
- Builder UX includes source selection, parameter/state binding, selected field configuration, and interaction setup.
- Preview behavior must preserve permissions and redact sensitive data.
- Transformation capability remains deliberately limited and registered.

### Required invariants

- data sources enforce server-side authorization on every execution;
- public pages use explicitly public-safe sources/actions only;
- layouts never contain secrets, SQL, executable code, package imports, arbitrary URLs, or live result snapshots;
- every persisted source/state/block/action/contract reference has a stable ID and version;
- source output passes its exact schema and declared output-contract schema;
- table fields are stable allowlisted IDs, not raw nested paths;
- binding graphs reject direct/indirect synchronous cycles;
- cache keys include authorization-relevant scope;
- realtime subscriptions use the same permission/record policy;
- plugin removal does not silently delete stored references;
- publication/readiness fails for invalid or unsafe bindings;
- canonical contract payloads have no opaque executable/unknown extension bag.

## Alternatives considered

### Hard-code data fetching inside every component

Rejected because components become tied to one module/backend and cannot be reused across customer compositions.

### Expose one global mutable application state object

Rejected because ownership, schema, persistence, permissions, migrations, and dependencies become implicit and collision-prone.

### Store arbitrary JavaScript expressions in builder documents

Rejected due to remote-code, migration, debugging, determinism, and support risks.

### Provide raw SQL or unrestricted visual query building in V1

Rejected because authorization, query cost, schema coupling, and cross-plugin leakage would be difficult to contain. V1 uses plugin-defined projections.

### Fetch raw records and aggregate in the browser

Rejected because it over-fetches sensitive data, weakens authorization boundaries, increases payload cost, and duplicates business calculations.

### Use raw object-path field mapping

Rejected because internal Payload shape becomes a persisted public contract and field-level security/migrations become fragile.

### Depend on Puck-native data binding directly

Rejected as the platform contract because K-Nex must remain editor-engine independent and support CMS/workspace policy, versioning, permissions, and plugin lifecycles.

## Validation or revisit trigger

Validate with a POC that proves:

- independent Sales/Logistics sources register without component imports;
- generic metric/table/category/time-series blocks select compatible sources;
- page date-range state controls multiple source inputs;
- chart selection updates state consumed by another component;
- unauthorized/manual source or field calls fail server-side;
- public CMS publication rejects internal sources;
- realtime invalidation works through `realtime.gateway`;
- missing source/plugin handling does not crash the page;
- source and contract migrations preserve stored fixtures;
- direct/indirect cycles are rejected;
- one plugin-owned contract proves the hybrid path.

Revisit the model if realistic dashboards require so much custom adapter code that canonical contracts become less maintainable than module-owned fixed screens. The accepted fallback remains controlled module-owned operational screens; arbitrary code in builder documents is not the fallback.
