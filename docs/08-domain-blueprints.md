# Domain Blueprints

These blueprints are not final schemas. They identify likely module boundaries, dependencies, and business invariants for the first vertical proofs of concept.

## Logistics blueprint

### Module graph

```text
cms                    crm
 │                      │
 └──── optional ────────┤
                        ▼
                 logistics.core
                  ▲      ▲      ▲
                  │      │      │
             dispatch  tracking driver
                  │      │      │
                  │      └──┬───┘
                  │         ▼
                  └───► transport.websocket
```

A more precise first manifest set:

| Module | Required | Optional |
|---|---|---|
| `logistics.core` | core | CRM, notifications |
| `logistics.dispatch` | logistics.core | WebSocket, maps/routing |
| `logistics.live-tracking` | logistics.core | WebSocket, notifications |
| `logistics.driver` | logistics.core, WebSocket | dispatch, notifications |
| `logistics.public-tracking` | logistics.core | live-tracking, CMS |

The final decision on whether dispatch strictly requires WebSocket should be based on product behavior. Driver is expected to require it.

### `logistics.core`

Owns stable logistics concepts:

- customer/account reference;
- shipment;
- parcel/package;
- origin and destination;
- route and stop;
- driver;
- vehicle;
- delivery attempt;
- proof of delivery;
- shipment status history;
- assignment contract, if shared by dispatch and driver.

It should not own the dispatch board UI, GPS ingestion pipeline, or customer pricing policy.

Potential events:

```text
logistics.shipment.created
logistics.shipment.status-changed
logistics.shipment.delivered
logistics.delivery-attempt.failed
logistics.assignment.created
logistics.assignment.cancelled
```

### `logistics.dispatch`

Owns operational planning and assignment behavior:

- assignment commands;
- dispatcher queues;
- route/vehicle capacity checks;
- manual or strategy-based assignment;
- reassignment and cancellation;
- dispatch-board projections;
- conflict detection;
- operational events.

Potential configuration:

```ts
dispatchModule({
  assignmentMode: 'manual',
  allowMultiVehicleRoutes: false,
  enforceVehicleCapacity: true,
})
```

Do not hard-code one customer's assignment algorithm. Custom strategies can be service providers or customer extensions.

### `logistics.driver`

The backend module owns contracts used by a driver web or mobile application:

- driver authentication/session strategy;
- device registration;
- assigned task API;
- task acknowledgement;
- pickup/delivery status commands;
- photo, signature, and proof-of-delivery upload contracts;
- offline mutation idempotency;
- push notification token registration;
- realtime channel registration.

The driver frontend itself belongs in the customer repository, for example `apps/driver/`. It may be a PWA or native application while using the same backend/client SDK.

### `logistics.live-tracking`

Separate ordinary business records from high-frequency location telemetry.

Payload/Postgres business records:

- shipment;
- route;
- vehicle;
- driver;
- assignment;
- delivery state;
- public tracking session.

Specialized tracking path:

- current position store;
- position history store;
- geospatial queries;
- retention policy;
- location precision and privacy rules;
- throttled realtime projection.

Potential provider contracts:

```ts
interface CurrentPositionStore {
  set(position: VehiclePosition): Promise<void>
  get(vehicleId: string): Promise<VehiclePosition | null>
}

interface PositionHistoryStore {
  append(position: VehiclePosition): Promise<void>
  list(query: PositionHistoryQuery): Promise<VehiclePosition[]>
}
```

Small deployments may implement both with Postgres. Larger deployments may use Redis for current position and partitioned/PostGIS tables for history.

### Logistics invariants to test

- A shipment cannot be assigned to an unauthorized driver or branch.
- Assignment changes are transactional and audited.
- Driver updates are idempotent after reconnect/offline retry.
- Realtime messages do not expose another driver's tasks.
- Public tracking tokens reveal only an approved projection.
- A delivered shipment cannot return to an earlier state without an explicit correction workflow.
- Location retention and precision policies are enforced.

## Restaurant blueprint

### Module graph

```text
cms ─────────► restaurant.qr-menu
                    ▲
                    │
             restaurant.core
               ▲          ▲
               │          │
        inventory      budgeting
               ▲          │
               └── optional integration ──┘
```

Potential modules:

| Module | Required | Optional |
|---|---|---|
| `restaurant.core` | core | CMS, CRM |
| `restaurant.qr-menu` | restaurant.core | CMS, localization |
| `restaurant.inventory` | restaurant.core | notifications |
| `restaurant.budgeting` | core | restaurant.core, inventory |
| `restaurant.recipe-costing` | restaurant.core, inventory | budgeting |

### `restaurant.core`

Owns reusable restaurant concepts:

- branch/location;
- service hours;
- menu and menu availability context;
- product/dish identity;
- category;
- allergens and dietary attributes;
- tax/service configuration references.

It should not own final website cards or one restaurant's visual menu.

### `restaurant.qr-menu`

Owns:

- public menu publication;
- QR target/route contract;
- branch-specific menu availability;
- locale selection;
- category ordering;
- price and sold-out projection;
- public caching/invalidation events;
- analytics hooks where enabled.

Customer repository owns:

- menu visual design;
- typography and imagery;
- public route composition;
- page-builder restaurant components;
- brand-specific QR artwork.

### `restaurant.inventory`

Inventory should be movement-based rather than a mutable quantity field with ad hoc hooks.

Core concepts:

- stock item/ingredient;
- unit of measure;
- warehouse/location;
- stock movement;
- purchase receipt;
- consumption;
- waste;
- adjustment;
- transfer;
- supplier reference;
- minimum stock rule;
- optional recipe and recipe ingredient.

Typical movement types:

```text
purchase
consumption
waste
adjustment-in
adjustment-out
transfer-in
transfer-out
```

Current quantity can be calculated or maintained as a transactionally safe projection. The movement ledger remains the audit source.

Domain service example:

```ts
await inventory.consumeIngredients({
  source: { type: 'order', id: orderId },
  locationId,
  lines,
  idempotencyKey,
  actor,
})
```

### `restaurant.budgeting`

Potential concepts:

- budget;
- budget period;
- branch and cost center;
- allocation;
- expense;
- revenue target;
- actual projection;
- variance;
- threshold and approval workflow.

Budgeting should consume inventory or purchasing data through events/contracts rather than reading private inventory tables.

Potential events:

```text
inventory.stock-low
inventory.movement-recorded
inventory.waste-recorded
budget.threshold-exceeded
budget.period-closed
```

### Restaurant invariants to test

- Stock mutations always produce an auditable movement.
- Repeated external/order events do not double-consume ingredients.
- Units are converted through explicit rules.
- A branch sees only its authorized stock and budget data.
- Published QR menu data contains no internal cost information.
- Sold-out/menu availability updates invalidate public projections safely.
- Closed budget periods cannot be mutated without a correction workflow.

## Horizontal modules across both blueprints

### CMS

Can power logistics marketing pages, tracking landing pages, restaurant sites, and public menu content without knowing the vertical business rules.

### CRM

Can relate contacts/companies to shipments, restaurant groups, leads, and opportunities through public integration contracts.

### WebSocket

Provides transport only. Domain modules define channels and authorization.

### Notifications

Can deliver assignment alerts, low-stock alerts, budget warnings, and customer status notifications through provider contracts.

### Files/media

Supports proof-of-delivery assets, menu imagery, documents, and uploads while domain modules define access policy.

## Blueprint rule

Do not create a generic “business module” that mixes unrelated vertical concepts. Reuse horizontal infrastructure and contracts; keep domain language explicit. Similar-looking tables are not necessarily the same domain abstraction.