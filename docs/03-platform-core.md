# Platform Core

## Purpose

The platform core is the smallest stable backend layer shared by every K-Nex application. It should make modules interoperable without containing customer presentation or vertical business behavior.

The core should be deliberately conservative. Changes to it affect every module and potentially every customer application.

## Core responsibilities

### Module lifecycle

- Accept module declarations from the customer composition root.
- Validate IDs, versions, dependencies, conflicts, and registration order.
- Expose a typed registration context.
- Build a final immutable module graph.
- Produce diagnostic output describing the installed platform.

### Identity and access integration

- Define the current actor/request context.
- Integrate with Payload authentication.
- Register permissions provided by modules.
- Provide reusable access-control helpers.
- Prevent modules from hard-coding role names.

### Services

- Provide a typed service registry.
- Allow infrastructure modules to register providers.
- Allow business modules to resolve contracts rather than concrete implementations.
- Fail at startup when a required provider is missing.

### Events

- Define a standard domain event envelope.
- Register event contracts and subscribers.
- Provide in-process publication for simple deployments.
- Allow a durable or distributed event adapter later.
- Preserve transaction boundaries and event metadata.

### Jobs and workflows

- Register background tasks and workflows.
- Normalize queue names, retry policy, idempotency keys, and tracing metadata.
- Integrate with Payload Jobs Queue by default.
- Keep expensive side effects outside request-blocking hooks.

### Audit and observability

- Standard audit event contract.
- Request, actor, customer application, and correlation identifiers.
- Structured logging hooks.
- Health, liveness, and readiness checks.
- Module/version inventory exposed to operations.

### Shared backend utilities

- Stable error types and API error serialization.
- Pagination and cursor conventions.
- Clock, ID, and transaction abstractions useful in tests.
- Common test harnesses and module contract tests.

## Core non-responsibilities

The core must not contain:

- CSS, design tokens, logos, fonts, or customer branding;
- reusable page sections or frontend components;
- CMS pages, CRM contacts, opportunities, shipments, vehicles, menu items, or stock concepts;
- customer-specific terminology;
- conditional behavior based on customer name or ID;
- direct integrations that belong in optional modules;
- business policies that vary by vertical.

## Suggested package layout

```text
packages/
├── contracts/
│   ├── module.ts
│   ├── dependency.ts
│   ├── permission.ts
│   ├── event.ts
│   ├── service.ts
│   ├── job.ts
│   └── errors.ts
├── core/
│   ├── module-registry/
│   ├── service-registry/
│   ├── permissions/
│   ├── events/
│   ├── jobs/
│   ├── audit/
│   ├── health/
│   └── payload/
├── testing/
│   ├── create-test-platform.ts
│   ├── module-contract-suite.ts
│   └── fixtures/
└── tooling/
    ├── validate-app.ts
    ├── inspect-modules.ts
    └── create-customer-app.ts
```

## Draft core API

```ts
export interface CreatePlatformOptions {
  app: {
    id: string
    name: string
    environment: 'development' | 'test' | 'staging' | 'production'
  }
  modules: KNeXModuleDeclaration[]
  extensions?: KNeXExtension[]
  providers?: ServiceProvider[]
}

export async function createPlatform(
  options: CreatePlatformOptions,
): Promise<ResolvedPlatform> {
  // 1. validate graph
  // 2. register contracts and providers
  // 3. compose Payload configuration
  // 4. freeze and expose inventory
}
```

The customer application should have one obvious composition root:

```ts
export default createPlatform({
  app: {
    id: 'acme-cargo',
    name: 'Acme Cargo',
    environment: env.NODE_ENV,
  },
  modules: [
    cmsModule(),
    crmModule(),
    websocketModule(),
    logisticsCoreModule(),
    dispatchModule(),
    driverModule(),
  ],
  extensions: [acmeCargoExtension()],
})
```

## Service registry

Modules should depend on contracts:

```ts
export const REALTIME_GATEWAY = serviceToken<RealtimeGateway>(
  'k-nex.realtime.gateway',
)

export interface RealtimeGateway {
  publish<T>(channel: string, message: T): Promise<void>
  disconnectConnection(connectionId: string): Promise<void>
}
```

The WebSocket module can provide that token. Driver or live-tracking modules resolve it without importing the WebSocket implementation internals.

## Payload boundary

K-Nex modules may contribute Payload configuration, but the platform core should mediate the composition:

```ts
export interface PayloadContribution {
  collections?: CollectionConfig[]
  globals?: GlobalConfig[]
  endpoints?: Endpoint[]
  jobs?: JobsConfigContribution
  plugins?: Plugin[]
  admin?: AdminContribution
}
```

The core should merge arrays and function-based configuration safely, detect duplicate slugs/routes, and preserve deterministic ordering.

## Stability rules

- Public core contracts use semantic versioning.
- Breaking contract changes require a major version.
- Experimental APIs are explicitly marked and isolated.
- Core exports should be narrow; internal implementation paths are not public API.
- Modules declare a compatible core version range.
- Customer repositories pin an exact core version.

## Testing expectations

Every core release should prove:

- valid dependency graphs resolve deterministically;
- invalid graphs fail with actionable messages;
- duplicate permissions, services, collections, endpoints, and module IDs are detected;
- module registration is independent of import order where explicit order exists;
- customer extensions cannot silently overwrite shared registrations;
- the final Payload configuration can boot against a clean test database.