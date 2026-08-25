# ADR-0012: Hybrid Canonical and Plugin-Owned Output Contracts

- Status: accepted
- Date: 2026-08-25
- Decision owners: K-Nex platform maintainers
- Related: [Plugin data sources](../24-data-sources-state-and-binding-graph.md), [Output contracts](../25-output-contracts.md), [ADR-0010](./0010-typed-data-source-state-binding-graph.md)

## Context

K-Nex plugins expose authenticated, purpose-built data sources to reusable builder components. A Counter, DataTable, PieChart, or LineChart must be able to consume sources from Sales, CRM, Logistics, Restaurant, Inventory, or customer extensions without importing those modules or understanding their Payload collections.

Several competing designs were considered:

- every source returns one strict K-Nex canonical shape;
- every source returns arbitrary plugin JSON and the builder maps paths manually;
- a hybrid model in which generic sources implement canonical contracts while domain-specific sources can use namespaced plugin-owned contracts.

The design also needs stable field selection, source/contract evolution, actor-filtered discovery, output validation, efficient responses, and a path for future safe transformations without arbitrary JavaScript or visual SQL.

## Decision

K-Nex adopts a hybrid output-contract model.

### Canonical contracts

K-Nex owns a small initial catalog for generic components:

```text
metric.scalar@1
table.records@1
series.category@1
series.time@1
options.list@1
record.summary@1
```

The first POC must implement the first four. The final two remain accepted initial-catalog contracts and can follow after the core counter/table/chart slice.

### Plugin-owned contracts

A plugin can define a namespaced contract for domain-specific components:

```text
sales.pipeline-board@1
logistics.dispatch-board@1
inventory.stock-ledger@1
```

Generic components do not automatically consume plugin-owned contracts.

### One source, one primary projection

Each source declares exactly one primary output contract. Separate metric, table, and aggregate sources can share underlying domain query services.

### Exact source schema plus contract conformance

Every source has an exact source-specific output schema. That schema must validate against the declared canonical or plugin-owned contract. Declaring a contract ID without runtime/CI conformance is invalid.

### Stable table field IDs

`table.records@1` exposes normalized, declared field IDs. Field IDs are opaque stable identifiers, not raw nested Payload object paths. Descriptor metadata is separate from paginated result data.

### One metric family

Metrics use a discriminated `metric.scalar@1` value family for number, integer, decimal, money, percentage, duration, and text values. Unit/currency/scale semantics travel with the raw value; customer formatting remains in the UI/theme layer.

### Canonical chart series

Generic charts primarily consume `series.category@1` or `series.time@1`. V1 does not transform unrestricted raw records into charts. Future transforms must be trusted, registered, versioned, bounded adapters with explicit schemas.

### Descriptor/response separation

Actor-filtered source descriptors are discovered separately and identified by a deterministic descriptor hash. Query responses use a standard envelope containing source identity, source version, output-contract identity/version, descriptor hash, and validated data.

### Independent versioning

Source major version, output-contract major version, descriptor hash, and npm package version are separate.

### No opaque canonical extensions

Canonical payloads do not expose an unrestricted `extensions` bag. Richer domain data requires a plugin-owned contract or another purpose-built source.

## Consequences

### Positive

- Generic blocks can discover compatible sources deterministically.
- Plugin storage/domain objects remain private.
- Builder column selection and component compatibility are safe and understandable.
- Source and component evolution can be diagnosed and migrated independently.
- Output validation can fail closed before undeclared fields reach the browser.
- Field-level authorization can filter descriptors and values.
- Metrics retain currency/unit semantics without multiplying contract IDs.
- Chart aggregation remains server-owned and bounded.
- Domain-specific UIs retain an escape path through explicit plugin contracts rather than arbitrary JSON.
- Editor-engine independence is preserved.

### Costs

- K-Nex must maintain canonical schemas, validators, authoring helpers, fixtures, and compatibility tests.
- Plugin authors must project Payload data into deliberate contract payloads.
- Source descriptors require actor-aware caching and hashing.
- Source and contract migrations are separate concerns.
- Generic components must implement semantic scalar/series/table formatting and constraint validation.
- Future transformation adapters require their own registry, versioning, security, and cost model.

### Required invariants

- one source declares one primary projection contract;
- every result validates against both its source-specific schema and declared contract;
- table fields use stable allowlisted IDs;
- unauthorized fields are neither described nor returned;
- null and omitted field semantics are distinct;
- source/contract/package versions are not conflated;
- canonical payloads contain no arbitrary code, SQL, imports, secrets, unrestricted URLs, or opaque extension bags;
- descriptors are separate from query data and filtered by actor/surface;
- chart series are bounded server projections;
- invalid output fails closed;
- future transforms are registered/versioned rather than embedded expressions.

## Alternatives considered

### Canonical contracts only

Not selected as the entire model because complex domain-specific components would either lose useful semantics or force an ever-growing universal contract catalog.

### Arbitrary plugin JSON plus field mapping

Rejected because compatibility, permissions, nested-path stability, migrations, preview, and runtime failure behavior become fragile.

### Raw Payload documents

Rejected because collection/storage shapes become public UI contracts and sensitive/internal fields can leak.

### One source with multiple named outputs

Rejected because it becomes implicit query negotiation with unclear payload, authorization, caching, and invalidation behavior.

### Separate metric contract for each unit

Rejected for V1 in favor of one discriminated scalar contract.

### Arbitrary chart transformations in the builder

Rejected for V1. Aggregate meaning belongs in purpose-built server sources. Repeated safe needs can later become registered transformation adapters.

### One shared version for package, source, and contract

Rejected because they evolve for different reasons and have different compatibility consequences.

## Validation or revisit trigger

Validate through the POC described in [Data-source output contracts](../25-output-contracts.md), including:

- metric, table, category-series, and time-series sources;
- generic Counter, DataTable, Pie/BarChart, and LineChart blocks;
- source-specific plus canonical output validation;
- actor-filtered field descriptors;
- independent source/contract version fixtures;
- descriptor-hash behavior for additive fields;
- invalid/undeclared output rejection;
- query sharing and realtime invalidation/refetch;
- at least one plugin-owned contract proving the hybrid path.

Revisit the initial catalog only after real modules demonstrate repeated data shapes that cannot be expressed safely. Do not respond by adding arbitrary JSON or builder-authored code.