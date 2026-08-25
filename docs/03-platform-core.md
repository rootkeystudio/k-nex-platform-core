# Platform Core

## Purpose

The K-Nex platform core is the smallest stable, domain-neutral runtime shared by customer applications and first-party plugins. It makes independently developed plugins interoperable without containing customer presentation, concrete infrastructure providers, visual-editor implementations, or vertical business behavior.

Core should be conservative. A public core contract can affect the CLI, every plugin, every generated customer application, and every deployed customer release.

```text
customer manifest and generated registries
                ↓
resolved immutable plugin graph
                ↓
platform core registration/runtime services
                ↓
Payload/framework adapter and customer application
```

## Core responsibilities

### Plugin graph runtime validation

The CLI performs composition planning and generation, but the application must validate the same graph again at build/startup.

Core must:

- accept generated plugin declarations and customer extensions;
- verify plugin IDs, package versions, compatibility, enabled state, capabilities, and registration order;
- reject missing providers, conflicts, cycles, duplicate IDs, or stale generated artifacts;
- expose one immutable resolved graph and release inventory;
- prevent runtime package discovery or database-driven executable imports;
- use the same resolver/contracts package as the CLI so plan-time and runtime semantics agree.

Core does not run a package manager or mutate `k-nex.app.json`.

### Registration lifecycle

Core owns deterministic registration phases:

```text
contracts
providers
schema
behavior
jobs
ui
admin
finalize
```

It exposes phase-specific APIs and rejects contributions registered in an invalid phase.

Core tracks ownership for every registered item:

```text
service/capability provider
permission
event
job/workflow
Payload collection/global/endpoint
UI navigation/screen/block/action/data source
health check
runtime setting schema
```

This ownership is used for collision diagnostics, inventory, lifecycle checks, and security review.

### Capability and service registry

Core provides a typed service registry that binds versioned capabilities to implementations selected by the customer application.

```ts
export const REALTIME_GATEWAY = serviceToken<RealtimeGateway>({
  capability: 'realtime.gateway',
  version: '1.0.0',
})

export interface RealtimeGateway {
  publish<TMessage>(input: PublishRealtimeMessage<TMessage>): Promise<void>
}
```

A provider plugin registers the implementation. A consuming module resolves the token; it does not import the provider internals.

Registry requirements:

- version-compatible binding;
- single/multiple provider cardinality;
- deterministic initialization and disposal;
- health/readiness integration;
- test overrides through an explicit test container;
- no hidden global mutable service locator outside platform context.

### Identity and actor context

Core defines a common request/execution actor model adaptable from different authentication strategies:

```ts
export interface ActorContext {
  id: string
  type:
    | 'user'
    | 'driver'
    | 'service'
    | 'public-session'
    | 'system-job'
  permissions: ReadonlySet<string>
  teamIds?: readonly string[]
  branchIds?: readonly string[]
  sessionId?: string
  impersonatorId?: string
  correlationId: string
}
```

Core integrates Payload authentication for ordinary users but must not assume every actor is a Payload admin user. Driver, public tracking, service, and background-job actors can use narrower authentication adapters.

### Permission registry and access helpers

Core owns:

- permission-definition registration;
- duplicate/ownership detection;
- actor permission lookup;
- common deny-by-default helpers;
- risk metadata for privileged actions;
- role-composition inputs for customer applications;
- access-decision diagnostics and audit hooks.

Modules own domain record policy. Core does not know whether a user can read a specific shipment or budget; it provides context and enforcement hooks used consistently by Payload access, HTTP/actions, UI data sources, jobs, and realtime subscriptions.

### Events

Core defines the domain-event envelope, registration, publication contract, and adapter boundary.

```ts
export interface DomainEvent<TPayload = unknown> {
  id: string
  type: string
  schemaVersion: number
  occurredAt: string
  applicationId: string
  actor?: {
    id: string
    type: string
  }
  correlationId: string
  causationId?: string
  idempotencyKey?: string
  payload: TPayload
}
```

Core supports an initial in-process/after-commit adapter and leaves room for outbox or broker-backed providers. Domain modules never import Redis/Kafka/broker clients directly.

### Jobs and workflows

Core standardizes:

- job/task/workflow IDs and ownership;
- input schemas and schema versions;
- logical queue names;
- retry/backoff/timeout policy;
- idempotency metadata;
- actor/correlation/causation propagation;
- schedule registration;
- worker health and inventory.

Payload Jobs Queue is the provisional default adapter. Core wraps it with K-Nex naming, ownership, tracing, and compatibility conventions.

### Audit and observability

Core defines common audit and observability contracts:

```text
application ID and environment
release/commit/image identity
core/plugin/provider/builder/theme versions
request/correlation/causation IDs
actor and impersonation context
resource/action/outcome
job/event identifiers
health/readiness status
```

Core provides structured hooks; modules decide which domain actions require audit and what safe summaries are recorded.

Secret, credential, and unnecessary personal data must be redacted by default.

### Health, readiness, and inventory

Core aggregates checks from plugins and customer extensions:

```text
liveness       process is running
readiness      required DB/providers/config/migrations are usable
health         degraded optional integrations and operational state
inventory      exact resolved product composition
```

A plugin can be installed yet unconfigured. Readiness policy depends on whether its missing configuration is required for the deployed application.

The authenticated operations inventory should expose non-secret information such as:

```text
application/release ID
core and Payload versions
plugin package versions and enabled state
capability providers
builder and theme packages
migration revision
failed/degraded checks
```

### Stable error and API conventions

Core provides:

- typed domain/application/infrastructure error bases;
- safe HTTP/action error serialization;
- retryable versus terminal classification;
- validation issue format;
- correlation IDs;
- pagination/cursor conventions;
- no raw stack/provider secret leakage in production responses.

### Framework contribution composition

Core mediates plugin contributions to Payload rather than exposing unrestricted shared mutation.

```ts
export interface PayloadContributionSet {
  collections?: OwnedContribution<CollectionConfig>[]
  globals?: OwnedContribution<GlobalConfig>[]
  endpoints?: OwnedContribution<Endpoint>[]
  plugins?: OwnedContribution<Plugin>[]
  jobs?: PayloadJobsContribution
  admin?: PayloadAdminContribution
}
```

Core/adapter responsibilities:

- preserve owning plugin and source path metadata;
- validate duplicate slugs, endpoints, indexes, and admin routes;
- compose known function fields deliberately;
- use deterministic ordering;
- reject ambiguous merge behavior;
- produce final immutable Payload config and diagnostics;
- expose advanced escape hatches only through documented owned contribution APIs.

Do not implement a universal untyped deep merge.

### Customer extension registration

Customer code participates through documented extension APIs and the same ownership/collision/security rules.

```ts
export interface KNeXCustomerExtension {
  id: string
  compatibility: {
    core: string
  }
  register(context: ExtensionRegistrationContext): void | Promise<void>
}
```

An extension can consume public module/capability contracts. It cannot replace core internals, patch package files, or introduce invisible registration.

### Shared testing utilities

Core/testing packages provide:

- test platform creation;
- fake clock/ID/transaction abstractions;
- actor/request fixtures;
- provider test doubles;
- plugin contract suite;
- collision/dependency fixtures;
- clean Payload/Postgres boot fixture;
- event/job idempotency helpers;
- access-policy assertions;
- generated inventory snapshots.

## Relationship to CLI

Core and CLI have different responsibilities but share contracts.

### CLI owns

```text
catalog and package selection
manifest editing
package-manager operations
plan/apply/filesystem generation
static registry generation
environment/Docker scaffolding
source-level upgrade planning
```

### Core owns

```text
runtime/build validation of generated graph
registration and service lifecycle
framework composition
actor/access/events/jobs/audit/health
immutable runtime inventory
```

### Shared packages own

```text
plugin and capability schemas
resolver algorithm/semantics
diagnostics model
generated-registry API version
```

The application must fail when generated files do not match supported runtime contracts, even if the CLI was not run correctly.

## Relationship to UI runtime

UI composition is a foundational platform subsystem but should not be implemented inside the backend core package.

```text
@k-nex/core          plugin/runtime/backend foundations
@k-nex/ui-contracts engine-independent UI declarations
@k-nex/ui-runtime   registry/layout/data/action rendering
@k-nex/ui-shell     fixed application shell
@k-nex/builder-*    optional editor providers
@k-nex/theme-*      presentation providers
```

Core can register UI contribution ownership and expose actor/services to server data/action handlers, while browser/runtime rendering stays in UI packages.

Core contains no final CSS, visual primitive implementation, customer logo, or builder-engine code.

## Core non-responsibilities

Core must not contain:

- CRM, CMS, logistics, restaurant, inventory, budgeting, or other domain models;
- a concrete Postgres/WebSocket/S3/email implementation when a provider contract is appropriate;
- Puck or another visual-editor implementation;
- customer themes, CSS, logos, fonts, palettes, or brand assets;
- reusable business page blocks/renderers;
- customer-specific terminology, role names, or IDs;
- arbitrary runtime package installation;
- final customer migrations;
- a central multi-customer SaaS tenancy/control plane;
- all business logic inside generic hooks;
- customer conditionals such as `if (applicationId === 'acme')`.

## Suggested package layout

```text
packages/
├── contracts/
│   ├── plugin.ts
│   ├── capability.ts
│   ├── dependency.ts
│   ├── service.ts
│   ├── actor.ts
│   ├── permission.ts
│   ├── event.ts
│   ├── job.ts
│   ├── audit.ts
│   ├── health.ts
│   ├── contribution.ts
│   └── errors.ts
├── resolver/
│   ├── graph.ts
│   ├── compatibility.ts
│   ├── capabilities.ts
│   ├── ordering.ts
│   └── diagnostics.ts
├── core/
│   ├── platform/
│   ├── registration/
│   ├── services/
│   ├── actors/
│   ├── permissions/
│   ├── events/
│   ├── jobs/
│   ├── audit/
│   ├── health/
│   └── inventory/
├── payload-adapter/
│   ├── contributions/
│   ├── authentication/
│   ├── jobs/
│   ├── access/
│   └── config/
├── testing/
│   ├── create-test-platform.ts
│   ├── plugin-contract-suite.ts
│   ├── provider-fakes/
│   └── fixtures/
└── cli/
    └── consumes resolver/contracts but remains a separate package
```

Repository topology is still an open Phase 0 decision; package boundaries should remain valid whether these packages live in one monorepo or later split.

## Draft application API

Generated registries make the composition explicit without hand-maintaining every import.

```ts
import { createPlatform } from '@k-nex/core'
import { generatedPlugins } from '../.k-nex/generated/plugin-registry'
import { generatedProviders } from '../.k-nex/generated/provider-registry'
import { generatedUi } from '../.k-nex/generated/ui-registry'
import customerConfig from '../k-nex.config'

export const platform = await createPlatform({
  application: {
    id: 'acme-cargo',
    name: 'Acme Cargo',
    environment: process.env.NODE_ENV,
  },
  generated: {
    plugins: generatedPlugins,
    providers: generatedProviders,
    ui: generatedUi,
  },
  customer: customerConfig,
})
```

Draft result:

```ts
export interface ResolvedPlatform {
  graph: ResolvedPluginGraph
  services: ServiceContainer
  permissions: PermissionRegistry
  events: EventBus
  jobs: JobRegistry
  audit: AuditRecorder
  health: HealthRegistry
  inventory: ReleaseInventory
  payloadConfig: PayloadConfig
  dispose(): Promise<void>
}
```

## Initialization sequence

```text
1. Validate application identity/environment.
2. Validate generated registry API and source inventory.
3. Normalize and resolve plugin graph.
4. Register contracts and ownership metadata.
5. Bind capability/service providers.
6. Register schema contributions.
7. Register behavior, jobs, UI server handlers, and admin contributions.
8. Compose/validate final Payload config.
9. Validate environment/runtime settings and migrations.
10. Freeze registries and release inventory.
11. Start framework/runtime adapters.
```

Failure before finalization should not leave partially mutable global registration state.

## Stability and versioning

- Public core contracts follow semantic versioning.
- Resolver/manifest/generated-registry APIs are versioned explicitly.
- Breaking capability or contribution contracts require major-version evolution or new capability versions.
- Experimental exports live under explicit experimental entry points and are not silently promoted.
- Internal implementation paths are not public package exports.
- Plugins declare compatible core/framework ranges.
- Customer applications pin exact core/plugin versions.
- Deprecations include replacement and migration guidance.

## Security rules

- The plugin graph is trusted code composition, not an untrusted sandbox.
- Runtime data cannot introduce executable imports.
- Server authorization is mandatory for data/actions/endpoints/jobs/realtime.
- Registration ownership/collisions fail closed.
- Secrets are resolved from environment/secret providers, not manifests or event/UI data.
- Customer extensions are inventoried and tested like plugins.
- Release inventory must match installed lockfile/artifact.

See [Security and Trust Boundaries](./20-security-and-trust-boundaries.md).

## Required core tests

Every core release should prove:

- valid graphs resolve deterministically in CLI and runtime;
- missing/incompatible capabilities fail with actionable diagnostics;
- duplicate plugin IDs/providers/permissions/events/jobs/routes/slugs/actions/blocks are rejected with both owners;
- registration order does not depend on import accident;
- customer extensions cannot silently overwrite shared contributions;
- server-only dependencies do not leak through client/UI entry points;
- final Payload config boots against clean Postgres;
- event publication respects transaction/after-commit policy;
- access decisions are reusable across API/UI/realtime adapters;
- provider lifecycle initializes/disposes predictably;
- generated inventory matches exact package/runtime versions;
- a customer application can upgrade core independently of another fixture.

## POC exit criteria

Core is ready for the next phase when:

```text
manifest and generated registry
  → shared resolver
  → plugin/provider registration
  → collision-safe Payload config
  → clean Postgres boot
  → immutable inventory
```

works for two different customer compositions without copied core source or customer-specific conditions in shared packages.
