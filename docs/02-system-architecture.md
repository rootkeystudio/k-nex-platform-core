# System Architecture

## High-level model

K-Nex separates reusable platform behavior from customer delivery.

```text
┌─────────────────────────────────────────────────────────────┐
│ Shared package ecosystem                                    │
│                                                             │
│  @k-nex/core                                                │
│  @k-nex/contracts                                           │
│  @k-nex/module-cms                                          │
│  @k-nex/module-crm                                          │
│  @k-nex/module-websocket                                    │
│  @k-nex/module-dispatch                                     │
│  @k-nex/module-live-tracking                                │
│  @k-nex/module-inventory                                    │
│  ...                                                        │
└───────────────────────────┬─────────────────────────────────┘
                            │ exact package versions
                            ▼
┌─────────────────────────────────────────────────────────────┐
│ Customer application repository                             │
│                                                             │
│  module composition                                         │
│  Payload configuration                                      │
│  theme and CSS                                               │
│  frontend and admin UI                                      │
│  customer extensions                                        │
│  generated migrations                                       │
│  infrastructure                                              │
└───────────────────────────┬─────────────────────────────────┘
                            │ build and deploy
                            ▼
┌─────────────────────────────────────────────────────────────┐
│ Independent customer environment                            │
│                                                             │
│  application container                                      │
│  worker container                                            │
│  Postgres                                                    │
│  object storage                                              │
│  optional Redis / realtime infrastructure                    │
│  customer-specific secrets and domain                        │
└─────────────────────────────────────────────────────────────┘
```

## Architectural layers

### 1. Contracts layer

Stable TypeScript interfaces and shared identifiers:

- module manifest;
- module dependency declarations;
- permission definitions;
- domain event envelopes;
- job/task contracts;
- service provider tokens;
- migration metadata;
- error and API result conventions.

This layer should have very few runtime dependencies.

### 2. Platform core

The core implements cross-cutting backend behavior:

- module discovery and validation;
- service registry;
- authentication integration;
- permission registry and access helpers;
- event publication and subscription;
- audit recording;
- job and workflow registration;
- health and readiness checks;
- observability hooks;
- shared testing utilities.

The core does not know what a shipment, menu item, opportunity, or webpage is.

### 3. Capability modules

Each module implements a reusable business or infrastructure capability. Examples:

- infrastructure: WebSocket, notifications, files, search;
- horizontal business capabilities: CMS, CRM, forms, page builder;
- vertical capabilities: logistics-core, dispatch, live tracking, restaurant-core, inventory;
- application-facing APIs: driver API, public tracking API, QR menu API.

A module declares what it needs and what it provides.

### 4. Presets

A preset is a convenience composition, not a new runtime layer.

```ts
logisticsPreset({
  cms: true,
  crm: true,
  dispatch: true,
  tracking: true,
  driver: true,
})
```

Presets must resolve to ordinary module declarations. A customer may override or compose modules manually.

### 5. Customer application

The customer repository is the final composition root. It decides:

- which packages and exact versions are installed;
- module configuration;
- role definitions;
- customer-specific policies;
- final Payload configuration;
- application routes and UI;
- theme and styling;
- infrastructure adapters;
- generated migration sequence.

### 6. Runtime infrastructure

Each customer environment is isolated. The default topology is one application deployment and one database per customer. Workers, WebSocket gateways, Redis, or specialized storage are added only when selected modules require them.

## Repository topology

The architectural boundary is the **package**, not necessarily the Git repository.

A practical initial layout for this repository is:

```text
k-nex-platform-core/
├── packages/
│   ├── contracts/
│   ├── core/
│   ├── testing/
│   └── tooling/
├── docs/
└── examples/
```

Modules can live in dedicated repositories:

```text
k-nex-module-cms
k-nex-module-crm
k-nex-module-websocket
k-nex-module-logistics
k-nex-module-dispatch
```

They can also later move into a modules monorepo while retaining the same published package names. “Separate GitHub package” does not require “separate Git repository”; registry and repository boundaries are independent decisions.

## Dependency direction

Allowed dependency direction:

```text
customer app
    ↓
presets and modules
    ↓
platform core
    ↓
contracts
```

Vertical modules may depend on horizontal infrastructure modules through declared contracts. The core must never import a business module.

Forbidden examples:

- core importing CRM;
- CRM importing a specific customer extension;
- logistics-core importing customer UI;
- a module reading another module's private database table directly;
- customer identity checks inside shared packages.

## Composition lifecycle

A customer build follows this sequence:

1. Load customer module declarations.
2. Normalize module IDs and versions.
3. Resolve required and optional dependencies.
4. Reject missing, incompatible, duplicate, or conflicting modules.
5. Register service providers.
6. Compose Payload plugins and configuration.
7. Register permissions, events, jobs, and health checks.
8. Produce the final application configuration.
9. Generate types and customer-specific migrations.
10. Build and deploy the customer application.

## Default technical hypothesis

Payload is the leading application foundation because its configuration and plugin model can host reusable collections, fields, endpoints, hooks, jobs, and admin extensions. K-Nex remains an architecture above Payload rather than exposing raw Payload config mutation as the only module contract.

This abstraction leaves room to:

- validate dependencies before Payload config composition;
- standardize permissions and events;
- test modules independently;
- keep domain logic in services rather than hooks;
- replace individual infrastructure providers without rewriting domain modules.