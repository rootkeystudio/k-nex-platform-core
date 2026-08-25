# Module System

## Goal

A K-Nex module is an independently versioned capability that can be installed in a customer application without copying its source code.

A module may provide:

- Payload collections, fields, globals, endpoints, hooks, and plugins;
- domain services;
- permission definitions;
- domain events and subscribers;
- jobs and workflows;
- health checks;
- migration helpers;
- optional frontend SDK or headless UI exports.

A module is more than a Payload plugin. The K-Nex manifest wraps Payload contributions with dependency, compatibility, security, and operational metadata.

## Draft module contract

```ts
export interface ModuleDependency {
  id: string
  version: string
  reason?: string
}

export interface KNeXModuleManifest {
  id: string
  version: string
  displayName: string

  compatibility: {
    core: string
    payload?: string
    node?: string
  }

  requires?: ModuleDependency[]
  optional?: ModuleDependency[]
  conflicts?: ModuleDependency[]

  provides?: string[]
  permissions?: PermissionDefinition[]
  events?: EventDefinition[]
  jobs?: JobDefinition[]
}

export interface KNeXModule {
  manifest: KNeXModuleManifest
  register(context: ModuleRegistrationContext):
    | void
    | Promise<void>
}
```

## Dependency semantics

### Required dependency

The module cannot operate correctly without it. Missing or incompatible required dependencies fail the build or application startup.

```ts
const driverManifest = {
  id: 'driver',
  requires: [
    {
      id: 'logistics.core',
      version: '^1.0.0',
      reason: 'Driver assignments reference shipments and stops',
    },
    {
      id: 'transport.websocket',
      version: '^1.0.0',
      reason: 'Driver tasks and status updates are delivered in real time',
    },
  ],
}
```

### Optional dependency

The module can run without it, but enables an integration when present.

```ts
const dispatchManifest = {
  id: 'logistics.dispatch',
  optional: [
    {
      id: 'crm',
      version: '^1.0.0',
      reason: 'Display customer and account context on dispatch records',
    },
  ],
}
```

Optional integrations must be explicit. A module must not import an optional module's private implementation and hope that it is installed.

### Conflict

Two modules cannot safely operate together, or only a single provider may exist.

```ts
conflicts: [
  { id: 'transport.websocket-legacy', version: '*' },
]
```

### Capability provider

Sometimes a module needs a capability rather than a specific package. For example, a notification consumer may need any provider implementing `notifications.sender`.

```ts
requiresCapabilities: [
  { token: 'notifications.sender', version: '^1.0.0' },
]
```

This allows different customer applications to select SMTP, a transactional email provider, or another implementation without changing the consuming module.

## Resolution rules

Before Payload config is built, the resolver must:

1. Normalize module IDs.
2. Reject duplicate module IDs.
3. Validate core, Payload, and Node compatibility ranges.
4. Verify required dependencies and capability providers.
5. Discover enabled optional integrations.
6. Reject conflicts.
7. Detect dependency cycles.
8. Compute deterministic registration order.
9. Produce a human-readable module inventory.
10. Freeze the final graph so modules cannot appear during runtime.

Example error:

```text
Cannot compose customer application "acme-cargo".

Module "driver@1.3.0" requires:
  transport.websocket >=1.0.0 <2.0.0

Installed modules do not provide this dependency.

Suggested fix:
  pnpm add @k-nex/module-websocket@1.4.2
```

## Registration phases

A phased lifecycle prevents order-dependent mutation:

```text
1. describe     collect manifests only
2. resolve      validate graph and compatibility
3. provide      register service providers
4. schema       contribute collections, fields, globals, and indexes
5. behavior     register endpoints, policies, events, jobs, and workflows
6. admin        register optional admin contributions
7. finalize     validate final Payload config and freeze platform inventory
```

A module should not depend on accidental array order. Explicit dependency edges and phase/order metadata determine registration.

## Package exports

A module may expose server, client, and optional UI entry points without forcing all code into one bundle:

```json
{
  "name": "@k-nex/module-dispatch",
  "exports": {
    "./server": "./dist/server/index.js",
    "./client": "./dist/client/index.js",
    "./ui": "./dist/ui/index.js",
    "./contracts": "./dist/contracts/index.js"
  }
}
```

Recommended responsibilities:

- `server`: registration, collections, domain services, endpoints, jobs;
- `contracts`: stable DTOs, event types, provider interfaces;
- `client`: typed API client for customer frontends or mobile apps;
- `ui`: optional unstyled/headless primitives, never the customer's final design language.

A backend-only module may export only `server` and `contracts`.

## Configuration

Configuration should express legitimate product variation, not customer identity.

Good:

```ts
dispatchModule({
  assignmentMode: 'manual',
  allowMultiVehicleRoutes: true,
})
```

Bad:

```ts
dispatchModule({
  isAcmeCargo: true,
})
```

Config is validated with a runtime schema and inferred TypeScript type. Defaults must be explicit and documented.

## Module boundaries

A module owns its public contracts and business rules. It must not:

- read another module's private table directly;
- mutate another module's Payload config after finalization;
- assume a role name such as `manager` or `admin`;
- publish undocumented events;
- broadcast data without authorization;
- execute destructive uninstall behavior automatically;
- import customer application code.

Cross-module collaboration uses one of these mechanisms:

1. service contract;
2. domain event;
3. documented extension point;
4. explicit integration package.

## Integration packages

When two modules have substantial optional behavior, keep both modules independent and create a small integration package:

```text
@k-nex/module-crm
@k-nex/module-logistics
@k-nex/integration-crm-logistics
```

This avoids polluting either module with knowledge of the other's internals.

## Module enablement

Because each customer has a separate build and deployment, most module selection is **build-time composition** rather than a global runtime feature flag.

Three states should remain distinct:

- **installed and enabled:** code and schema are active;
- **installed and disabled:** code remains available but routes/UI/actions are intentionally unavailable;
- **uninstalled:** package is absent, while historical data may still remain until an explicit purge migration.

## Publishing

- Use semantic versioning.
- Publish private packages to GitHub Packages or another private registry.
- Customer applications pin exact versions.
- Every module declares compatible core and Payload ranges.
- A release includes generated types, changelog, migration notes, and compatibility metadata.
- Modules run contract tests against supported core versions before publishing.

## Suggested first modules

```text
@k-nex/module-cms
@k-nex/module-crm
@k-nex/module-page-builder
@k-nex/module-websocket
@k-nex/module-logistics-core
@k-nex/module-dispatch
@k-nex/module-live-tracking
@k-nex/module-driver
@k-nex/module-restaurant-core
@k-nex/module-qr-menu
@k-nex/module-inventory
@k-nex/module-budgeting
```

The first POC should implement only enough of this contract to prove dependency resolution, Payload composition, service providers, permissions, events, and customer-specific deployment.