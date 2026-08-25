# Domain Blueprints

These blueprints validate module boundaries; they are not promises of complete vertical products.

## Logistics graph

```text
module.logistics.core
  owns shipments, stops, routes, drivers, vehicles,
  assignment references and logistics domain events

module.logistics.dispatch
  requires module.logistics.core
  owns dispatch policies, assignment commands, board projections

module.logistics.driver
  requires module.logistics.core
  requires realtime.gateway
  optionally integrates with module.logistics.dispatch
  owns driver devices, task projections, proof/status commands

module.logistics.live-tracking
  requires module.logistics.core
  conditionally requires realtime.gateway
  owns tracking sessions, public projections, retention/privacy policy
```

Canonical collaboration:

```text
command: logistics.shipment.assign
event:   logistics.assignment.created
source:  logistics.dispatch.board
source:  logistics.driver.tasks
public:  logistics.public-tracking
```

A driver client receives an invalidation, then fetches its authoritative permitted task projection. Another driver cannot subscribe to or fetch that projection.

### Tracking storage

Business/control records remain in Payload/Postgres. High-frequency positions can use a separate current-position store and partitioned/PostGIS history after measured workload evidence. Precision, retention, public delay, and privacy are domain policy.

## Restaurant graph

```text
module.restaurant.core
  branches, menus, categories, items, availability

module.restaurant.qr-menu
  requires module.restaurant.core
  public menu projection, locale/branch selection, QR route

module.inventory
  stock items, locations, movement ledger, recipes/consumption

module.budgeting
  budgets, periods, cost centers, allocations, variance

integration.inventory-budgeting
  consumes stable inventory/budget contracts/events
```

Inventory is movement/ledger based rather than one mutable quantity field. Budget approval and stock adjustment are commands with permission, transaction, audit, and idempotency rules.

Public menu sources never expose internal cost, supplier, margin, or stock-control data.

## Cross-domain rules

- Modules own their facts and public contracts.
- One module does not read another module’s private Payload collection.
- Immediate behavior uses a service/command contract; completed facts use events.
- Substantial optional collaboration belongs in an integration plugin.
- Customer-specific policy begins in the customer repository.
- Generic Metric/Table/Chart blocks consume output contracts, not domain storage.
- Realtime transport never owns domain truth.
- Public and workspace sources/actions use separate authority-specific IDs.

## Thin POC slices

### Cargo

```text
one shipment and driver task
one authenticated driver projection
one assignment event/outbox record
one realtime invalidation/refetch
one public tracking-safe projection
```

### Restaurant

```text
one branch/category/menu item
one explicit public menu source
one CMS page using the public source
one internal field that is provably absent publicly
```

Do not implement route optimization, full GPS history, accounting, recipe costing, or enterprise CRM until platform gates justify them.
