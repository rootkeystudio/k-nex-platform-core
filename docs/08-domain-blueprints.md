# Domain Blueprints — Deferred Product Backlog

These possible future module boundaries are not active implementation plans and do not authorize product code.

Until Gate 10 PASS:

```text
module.sales remains the sole first-party domain reference
no broad CRM/CMS expansion
no logistics/restaurant/inventory/budgeting product module
```

Gate 9 may create bounded Hot Application/Theme Skin fixtures only to prove the extension runtime. Gate 10 uses Sales and that app fixture to prove authorization. Neither is a new vertical product.

## Logistics graph — future candidate

```text
module.logistics.core
module.logistics.dispatch
module.logistics.driver
module.logistics.live-tracking
```

Potential collaboration:

```text
action  logistics.shipment.assign
event   logistics.assignment.created
source  logistics.dispatch.board
source  logistics.driver.tasks
public  logistics.public-tracking
```

Core operational facts likely require Platform Plugins and static Payload schema. Bounded customer workflows, dashboards, integrations, or assistant experiences may fit Hot Applications only when they can use stable host contracts without raw cross-module storage access.

High-frequency tracking storage, privacy, retention, precision, public delay, and geospatial indexing require measured domain evidence.

## Restaurant graph — future candidate

```text
module.restaurant.core
module.restaurant.qr-menu
module.inventory
module.budgeting
integration.inventory-budgeting
```

Inventory should be movement/ledger based rather than one mutable quantity. Budget approval and stock adjustment are permissioned idempotent actions. Public menu sources must exclude internal cost, supplier, margin, and control data.

Theme/brand variants may use Theme Skins; domain schema and authoritative workflows remain Platform Plugin decisions.

## CMS/CRM productization — future candidate

The current Sales module is a reference, not a complete CRM. CMS infrastructure exists, but product breadth such as page hierarchy, redirects, search, persisted forms, localization workflow, contacts/accounts/leads/activities/pipelines/forecasting, and integrations requires a separate product plan.

A future CRM/CMS product may combine:

```text
Platform Plugins for authoritative schema/workflows
Hot Applications for isolated add-ons and customer-specific experiences
Theme Skins for live visual variants
```

The class is selected by required authority, not convenience.

## Cross-domain rules

- A module owns authoritative facts and public contracts.
- One module does not read another module's private Payload collections.
- Immediate behavior uses stable action/service contracts; completed facts use events.
- Substantial optional collaboration belongs in an integration extension.
- Public and authenticated source/action IDs are distinct.
- Realtime never owns business truth.
- Hot Applications cannot bypass module policy through host capabilities.
- Remote UI visibility is not authorization.
- Platform Plugin package changes use verified release delivery.
- Dynamic apps/skins use immutable generation activation.
- Every extension passes its class-specific conformance and lifecycle gates.

## Preconditions for selecting a product

```text
Gate 9   live app/skin and zero-downtime Platform Plugin delivery PASS
Gate 10  RBAC, role templates, lifecycle authorization, admin UI PASS
next     system settings/full extension operations sufficiently complete
then     explicit product/customer requirement and accepted bounded plan
```

This document alone is never sufficient authorization to implement a module.
