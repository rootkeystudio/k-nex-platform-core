# Domain Blueprints — Deferred Product Backlog

These blueprints describe possible future module boundaries. They are **not active implementation plans**, do not select a gate task, and are not customer fixtures for the active core program.

During Phase 9:

```text
implemented first-party reference domain module: module.sales
new CRM/CMS breadth: prohibited
new logistics/restaurant/inventory/budgeting modules: prohibited
```

Missing permission, role-template, policy, administration, plugin, component, query, page, lifecycle, CLI, or fleet capabilities are solved through the platform and Sales first. Bounded test-only fixtures may prove generic lifecycle behavior only when the active plan explicitly requires them; they are not product modules.

## Logistics graph — future candidate

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

Possible collaboration:

```text
command: logistics.shipment.assign
event:   logistics.assignment.created
source:  logistics.dispatch.board
source:  logistics.driver.tasks
public:  logistics.public-tracking
```

A future driver client should receive an invalidation and then fetch its authoritative permitted task projection. Another driver must not subscribe to or fetch it.

### Tracking storage

Business/control records would remain in Payload/Postgres. High-frequency positions may use a separate current-position store and partitioned/PostGIS history only after measured workload evidence. Precision, retention, public delay, and privacy are domain policy.

## Restaurant graph — future candidate

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

A future inventory model should be movement/ledger based rather than one mutable quantity field. Budget approval and stock adjustment are commands with permission, transaction, audit, and idempotency rules.

Public menu sources must never expose internal cost, supplier, margin, or stock-control data.

## Cross-domain rules

- Modules own their facts and public contracts.
- One module does not read another module's private Payload collection.
- Immediate behavior uses a service/command contract; completed facts use events.
- Substantial optional collaboration belongs in an integration plugin.
- Customer-specific policy begins in the customer repository.
- Generic Metric/Table/Chart blocks consume output contracts, not domain storage.
- Realtime transport never owns domain truth.
- Public and workspace sources/actions use separate authority-specific IDs.
- Plugins declare stable permission IDs and bounded policy hooks; role names never authorize.
- Plugin role templates may grant only same-owner permissions and never assign users.
- Every future module starts from the Sales package layout and passes plugin, component, lifecycle, authorization, release, and customer-upgrade conformance.

## Preconditions for selecting a blueprint

The foundation gates are complete:

```text
Gate 6  plugin authoring contract and Sales conformance PASS
Gate 7  comprehensive component/data/form/page system PASS
Gate 8  lifecycle, application factory, release/fleet proof PASS
```

The current required precondition is:

```text
Gate 9  RBAC, plugin policy hooks, protected roles,
        role-template bootstrap, live revocation, and lifecycle integration PASS
```

After Gate 9, the roadmap first selects the necessary system settings, plugin/theme administration, and Docker catalog/deployment work. A real vertical begins only through a separate accepted product plan with an identified customer/product requirement. This blueprint alone is not authorization to write a module.
