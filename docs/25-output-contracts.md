# Data-Source Output Contracts

## Model

K-Nex uses a hybrid contract system:

```text
canonical K-Nex contracts  generic Metric/Table/Chart/Options/Summary blocks
plugin-owned contracts     domain-specific boards/ledgers/maps
```

Every source has one primary projection contract and an exact source-specific schema conforming to that contract.

Initial canonical catalog:

```text
metric.scalar@1
table.records@1
series.category@1
series.time@1
options.list@1
record.summary@1
```

## One source, one projection

```text
sales.tasks                  → table.records@1
sales.tasks-open-count       → metric.scalar@1
sales.tasks-by-status        → series.category@1
```

These can share an internal source-family/query service to avoid duplicate authorization/query logic. One external source does not become a mini query language with unrelated outputs.

## Semantic scalar values

`metric.scalar@1` is a discriminated family:

```text
integer
number
decimal
money
percentage
duration
text
```

Exact financial/decimal values use canonical decimal strings plus currency/unit/scale/rounding metadata. They are not localized formatted strings or binary floating-point when exactness matters.

Comparison sentiment is explicit; a positive numeric delta is not automatically good.

## Table records

Descriptor defines stable field IDs, semantic value types, nullability, required/optional use, permissions, sort/filter capability, and formatting metadata.

Rows contain row key and values only for selected/authorized fields. `null` means permitted field with no value; omission means not requested/authorized/applicable.

V1 canonical table supports scalar, money/decimal, datetime/date, boolean, status/enum, and resource references. Rich grouped cells, row workflows, expandable trees, or specialized ledger semantics use plugin-owned contracts or versioned table adapters rather than an unbounded extension bag.

Resource navigation uses:

```json
{
  "kind": "resource",
  "resourceType": "user",
  "id": "user-1",
  "label": "Ali",
  "route": {
    "routeId": "system.users.detail",
    "params": { "userId": "user-1" }
  }
}
```

Canonical payloads do not carry unrestricted `href` values.

## Category and time series

Server sources aggregate/bucket data. Generic charts do not receive raw records for group-by/sum.

Series value metadata supports exact decimal strings and units/currency when precision matters. Time points use canonical RFC 3339 instants plus explicit source timezone/bucket semantics and bounded point count.

PieChart may impose additional component constraints such as one nonnegative series; those are component constraints, not alternate source contracts.

## Plugin-owned contracts

Examples:

```text
sales.pipeline-board@1
logistics.dispatch-board@1
inventory.stock-ledger@1
```

They are namespaced, schema-versioned, registered, and consumed only by compatible domain blocks. Canonical payloads have no opaque `extensions` bag.

## Descriptor identity

Separate:

```text
structuralCompatibilityHash
  schemas, fields/types/requiredness, capabilities,
  source/contract majors

presentationMetadataRevision
  localized titles, labels, descriptions, editor grouping/hints
```

Layouts persist source/contract majors, selected stable fields, and structural compatibility expectations—not localized text.

## Response envelope

```json
{
  "schemaVersion": 1,
  "source": { "id": "sales.tasks", "version": 1 },
  "contract": { "id": "table.records", "version": 1 },
  "structuralCompatibilityHash": "sha256:...",
  "data": {}
}
```

Descriptor metadata is discovered/cached separately.

## Validation order

```text
requested field authorization
permitted projection query
exact source schema
canonical/plugin contract
required field constraints
defensive redaction
envelope serialization
```

Invalid output fails closed before cache/telemetry/response contains undeclared data.

## Versioning

```text
package version                 released code artifact
source major                    one source input/output semantics
output-contract major           reusable canonical/domain shape
structural compatibility hash   compatible descriptor structure
presentation revision           labels/hints/localization
```

These are never conflated.

## Future transformations

A repeated need may justify a trusted registered bounded adapter, for example table fields to category series. It declares input/output contracts, schema, cost, permissions, version, and migration. Arbitrary JavaScript, join, SQL, expression, or unrestricted client aggregation remains rejected.

## POC

Gate 2 implements Metric/Table first and benchmarks validation/projection/caching. Category/time series follow in the same gate or a narrow extension. The hybrid plugin-owned path is proven with one small Sales-only board contract.
