# ADR-0010: Typed Data Sources, UI State, and Declarative Binding Graph

- Status: accepted
- Date: 2026-08-25
- Decision owners: K-Nex platform maintainers
- Related: [Data sources, state, and binding graph](../24-data-sources-state-and-binding-graph.md), [UI composition runtime](../16-ui-composition-runtime.md), [Builder engine and profiles](../17-builder-engine-and-profiles.md), [Permissions, events, actions, and jobs](../09-permissions-events-and-jobs.md)

## Context

K-Nex modules should be able to export style-agnostic components while customer applications and end users compose CMS/workspace pages visually. Generic components such as pie charts, bar charts, metrics, tables, maps, filters, and selectors need data without importing every domain module or embedding one hard-coded endpoint.

Enabled plugins should be able to expose reusable data and UI state contracts. A builder user should be able to select a source such as “CRM opportunities by stage,” bind its date-range parameter to page state, render it through a generic chart, and connect chart selection to another table or action.

Providing that power through arbitrary JavaScript, SQL, raw URLs, unrestricted global state, or browser-side database access would violate the platform's security, migration, support, and deterministic-composition goals.

## Decision

K-Nex owns a visual-editor-independent, typed binding model containing:

```text
data-source definitions
runtime-context definitions
UI state definitions
block input/output ports
registered actions
serializable bindings
versioned data contracts
binding graph validation and execution
```

Enabled plugins can register these contracts. The CLI composes static registries. Stored CMS/workspace documents contain stable IDs, versions, validated parameters, field mappings, and graph connections only.

A data source is normally a bounded, server-executed, permission-aware query that returns a purpose-specific projection. It is distinct from UI state.

UI state is a typed coordination value with an explicit scope and persistence policy. It is distinct from database records, cached query results, and arbitrary application-global state.

Generic components declare accepted data contracts through typed input ports. The builder lists only compatible sources available from enabled plugins for the current surface, audience, and editor context.

V1 allows:

```text
static values
read-only runtime context
page/component/user-approved state
plugin-defined server data sources
field mapping
component event → state update
component event → registered action
realtime invalidation and selected stream use cases
```

V1 rejects:

```text
arbitrary JavaScript expressions
SQL or unrestricted query languages
raw endpoint/import/function references
unbounded client-side aggregation
public pages bound to private workspace sources
runtime executable connector installation
```

The same canonical contracts are used by CMS and workspace builder profiles, but each profile filters sources, actions, states, and components according to surface/audience policy.

## Consequences

### Positive

- Generic visualization components can consume CRM, logistics, restaurant, inventory, or budget data.
- Modules remain independent from one another and from the editor engine.
- Cross-component filters and interactions are possible without arbitrary code.
- Server authorization remains authoritative.
- Stored layouts remain reviewable, migratable, and portable between themes.
- Source/action/state ownership and versioning are explicit.
- Missing plugins or breaking upgrades can produce deterministic orphan/migration diagnostics.
- Realtime transport can remain a replaceable capability.

### Costs

- K-Nex must define and maintain data contracts, state scopes, ports, and binding serialization.
- The runtime needs graph validation, cycle detection, caching, invalidation, error isolation, and migration support.
- Plugin authors must publish bounded projections rather than exposing raw database documents.
- Builder UX must include source selection, parameter binding, field mapping, and interaction configuration.
- Preview behavior must preserve permissions and redact sensitive data.
- Generic transformation capability must remain deliberately limited until a safe server-side model exists.

### Required invariants

- data sources enforce server-side authorization on every execution;
- public pages use explicitly public-safe sources/actions only;
- layouts never contain secrets, SQL, executable code, package imports, or live result snapshots;
- every persisted source/state/block/action reference has a stable ID and version;
- source output and block input contracts are schema-compatible;
- binding graphs reject direct/indirect synchronous cycles;
- cache keys include authorization-relevant scope;
- realtime subscriptions use the same permission/record policy;
- plugin removal does not silently delete stored references;
- publication/readiness fails for invalid or unsafe bindings.

## Alternatives considered

### Hard-code data fetching inside every component

Rejected because components become tied to one module/backend and cannot be reused across domains or customer compositions.

### Expose one global mutable application state object

Rejected because ownership, schema, persistence, permissions, migrations, and dependencies become implicit and collision-prone.

### Store arbitrary JavaScript expressions in builder documents

Rejected due to remote-code, migration, debugging, determinism, and support risks.

### Provide raw SQL or unrestricted visual query building in V1

Rejected because authorization, query cost, schema coupling, and cross-plugin data leakage would be difficult to contain. V1 uses plugin-defined projections and controlled field mapping.

### Fetch raw records and aggregate in the browser

Rejected as the default because it can over-fetch sensitive data, weaken authorization boundaries, increase payload cost, and produce inconsistent business calculations.

### Depend on Puck-native data binding directly

Rejected as the platform contract because K-Nex must remain editor-engine independent and support CMS/workspace-specific policy, versioning, permissions, and module lifecycles.

## Validation or revisit trigger

Validate with a POC that proves:

- CRM and logistics register independent sources;
- a generic pie/bar chart selects compatible sources;
- page date-range state controls both chart and table sources;
- chart selection updates state consumed by another component;
- unauthorized/manual source calls fail server-side;
- public CMS publication rejects internal sources;
- realtime invalidation works through `realtime.gateway`;
- missing source/plugin handling does not crash the whole page;
- migrations preserve stored fixture documents;
- direct/indirect cycles are rejected.

Revisit the model if realistic dashboards require so much custom adapter code that a canonical contract becomes less maintainable than module-owned fixed screens. The accepted fallback remains controlled module-owned operational screens; arbitrary code in builder documents is not the fallback.