# Platform Package and Runtime Boundary

## Purpose

K-Nex needs a stable domain-neutral platform family, but “core” must not become one package containing every cross-cutting service and ambient dependency.

## Physical boundaries

```text
@k-nex/contracts
  schemas, IDs, actors, permissions, service tokens,
  events, jobs, errors, contributions, source/UI contracts

@k-nex/composition
  resolver, provider selection, ordering, collision ownership,
  declared-versus-actual inventory, deterministic graph

@k-nex/runtime
  scoped services, actor/access integration, events/outbox,
  jobs, audit, health/readiness, runtime inventory

@k-nex/payload-adapter
  Payload contributions, authentication/access adaptation,
  jobs, versions, migrations, config generation

@k-nex/testing
  contract suites, fakes, clean Postgres fixtures,
  failure-injection and compatibility fixtures
```

`@k-nex/core` may be a supported facade for common public APIs; it must not expose internal mutable registries or make all packages depend on one monolith.

## Responsibilities

### Contracts

- canonical identity and manifest/application schemas;
- actor, permission, event, job, source, action, block, error, health contracts;
- no framework/engine implementation types.

### Composition

- normalized desired requests and exact package manifests;
- formal capability/provider selection;
- cycle/conflict/compatibility diagnostics;
- canonical registration order;
- immutable `k-nex.resolved.json`;
- declared-versus-actual validation.

### Runtime

- phase lifecycle and freeze;
- capability-scoped service contexts;
- actor and authorization adapters;
- event durability-class enforcement and outbox boundary;
- jobs, audit, health, readiness, operational inventory;
- no package-manager or runtime plugin discovery.

### Payload adapter

- owned collection/global/endpoint/job/admin contributions;
- deliberate function composition;
- duplicate slug/route/index checks;
- request/auth/access/transaction propagation;
- migration/type-generation integration;
- no universal arbitrary deep merge.

## Registration phases

The only accepted sequence is defined in the machine-readable contract:

```text
manifest → contracts → providers → schema → behavior → jobs
→ data-handlers → ui → admin → validate → freeze
```

Each phase exposes only its own API. A plugin cannot register a handler before declaring its descriptor or introduce a dependency during execution.

## Capability-scoped service context

Composition computes the service view for each plugin.

```ts
interface PluginRuntimeContext<TServices> {
  readonly pluginId: PluginId
  readonly services: TServices
  readonly actorAdapter: ActorAdapter
  readonly logger: StructuredLogger
}
```

`TServices` is derived from the plugin’s resolved direct/capability dependencies. Runtime token access uses the same allowlist. A broad `ServiceContainer` is an internal composition detail, never handed to arbitrary plugin/job code.

## Actor and authorization

Common actor context supports user, driver, service, public-session, and system-job identities. Permission possession is necessary but does not replace domain record policy.

The same domain policy is adapted to:

```text
Payload access
HTTP actions and data sources
jobs when actor scope matters
files/exports
realtime subscriptions
```

## Events and jobs

Runtime distinguishes:

```text
ephemeral-hint
reconstructible-invalidation
durable-integration
durable-workflow
```

The latter two require transactional outbox or equivalent atomic durability. Jobs are schema-versioned, idempotent where effects can repeat, capability-scoped, cancellable/checkpointed where long-running, and observable.

Payload Jobs Queue is the initial implementation adapter, not a public plugin API.

## Error convention

External HTTP APIs use RFC 9457 Problem Details with stable K-Nex `type`, `code`, `correlationId`, and bounded validation issues. Domain/application errors remain typed internally. Production serialization never returns stack traces, SQL, policy predicates, secret/provider values, or unauthorized resource existence.

## Health and inventory

```text
liveness   process responds
readiness  required config/providers/migration revision compatible
health     degraded optional dependencies and backlog
inventory  exact resolved and actual composition
```

Startup verifies actual package/manifest integrity, resolved graph, actual contributions, environment names, and migration revision. An older artifact fails readiness against a newer incompatible schema.

## Customer extensions

`k-nex.config.ts` exports static registered extensions through the same ownership, collision, capability, and bundle rules. Generation fingerprints its transitive source. It cannot vary graph composition by network, time, random values, secrets, or ambient filesystem discovery.

## Relationship to UI

Backend platform packages own registration and server handlers. Browser rendering remains in UI packages. Source descriptors/actions/blocks have serializable contract entrypoints; handlers and renderers are separate exports.

## Non-responsibilities

The platform family does not own:

- Sales, logistics, restaurant, CMS content, or customer domain policy;
- customer theme/CSS/assets;
- Puck, ECharts, TanStack, Zustand, or Socket.IO types as public contracts;
- one concrete provider when a capability contract is justified;
- final customer migrations;
- a shared multi-customer runtime/control plane;
- automatic package install or destructive lifecycle behavior.

## Required tests

- CLI and runtime resolve identical graph semantics.
- deterministic graph/registries are byte-identical in clean runs.
- undeclared contribution/capability access fails.
- duplicate IDs/slugs/routes/providers identify both owners.
- server-only code cannot enter browser exports.
- scoped service contexts reject ambient access.
- rollback emits no external event/invalidation.
- durable event survives crash and duplicate processing.
- clean and previous-release Postgres fixtures boot/migrate.
- runtime inventory matches package integrity and actual registration.
