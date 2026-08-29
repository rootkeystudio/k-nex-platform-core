# Platform Package and Runtime Boundary

## Purpose

K-Nex separates deterministic host composition from dynamic isolated applications. “Core” must not become one package with every cross-cutting service, package manager, runner, deployment engine, and ambient authority.

## Physical direction

```text
@k-nex/contracts
  IDs, manifests, bundles, generations, actors, permissions,
  sources/actions/tools/events/jobs/UI/error/health contracts

@k-nex/composition
  static Platform Plugin resolver, provider selection,
  ordering/collisions, generated immutable graph/registries

@k-nex/runtime
  registration freeze, gateways, outbox, jobs, audit,
  lifecycle/revision/runtime inventory, PluginManager contracts

@k-nex/payload-adapter
  static Payload collections/config/access/migrations/admin composition

@k-nex/extension-runtime       created only with Phase 9 consumer
  app generation registry, host capability gateway,
  runner protocol, app storage, activation/drain/rollback

@k-nex/remote-ui              created only with Phase 9 consumer
  K-Nex remote component protocol and browser host adapter

@k-nex/deployment             created only with Phase 9 consumer
  deployment-supervisor contracts, blue/green traffic/migration plans

@k-nex/testing
  contracts, fakes, Postgres/Chromium/multi-process/Docker evidence
```

A convenience facade cannot expose internal registries, Docker control, package fetching, or mutable global state.

## Platform Plugin composition

Platform Plugins remain boot-time code:

```text
exact package and manifest
→ deterministic resolved graph
→ generated static imports
→ phased registration
→ Payload config/schema/migrations
→ declared-versus-actual validation
→ freeze
```

No runtime data or PluginManager action mutates this graph in place.

## Hot Application runtime

Hot Applications are a separate execution plane:

```text
signed prebuilt app bundle
→ content-addressed verification/staging
→ isolated runner generation
→ remote UI generation
→ bounded metadata/app-storage transaction
→ atomic active-generation pointer
```

The host already contains generic `/apps/:appId/*` routes, extension slots, capability gateway, artifact route, and registry lookup. Installing an app changes data/generation state, not host imports or Payload config.

## Theme Skin runtime

Theme Skins are data-only artifacts. Runtime validates/scopes tokens, recipes, CSS, and assets and activates a generation/profile pointer. Full executable Theme Packages remain static Platform Plugins.

## PluginManager boundary

`PluginManager` orchestrates, but specialized services own behavior:

```text
catalog and artifact verification
content-addressed staging
plan/lease/idempotency state
runner and remote UI generations
activation/rollback/drain
migration compatibility
external deployment requests
traffic promotion
operation authorization
audit/outbox/observability/inventory
```

The manager has no generic `install(packageName)` that invokes a package manager. Requests identify a catalog artifact and an explicit extension class.

## Runner boundary

The extension runner is not part of the web module graph. It receives a signed generation reference, structured input, short-lived app/actor context, and capability handles.

It receives no:

```text
raw req.payload
Postgres connection string
Docker socket
host filesystem
ambient process.env/NODE_OPTIONS
unrestricted network
broad service container
```

The initial local adapter may spawn child Node processes, but production security is expressed so a dedicated container/service can enforce credentials, filesystem, network, CPU, memory, and termination.

## Remote UI boundary

Remote UI worker code is not imported as a host React module. It emits a bounded K-Nex component/event tree. The browser host owns actual React components, DOM, focus, accessibility, routing, theme, source/action clients, and authorization.

Third-party remote UI engines remain implementation details behind the K-Nex protocol adapter.

## Deployment boundary

Platform Plugin package operations are handled by a separate deployment supervisor:

```text
verified target release
→ build/pull target image
→ migration compatibility and advisory lock
→ start/warm target generation
→ readiness/inventory/smoke
→ gateway promotion
→ drain/rollback/receipt
```

The web process submits a bounded change request only after authorization. It never receives Docker control.

## Capability-scoped contexts

Platform Plugins receive services derived from their resolved manifest. Hot Applications receive an even narrower RPC capability set derived from the verified app manifest and current actor/delegation.

A capability grant is necessary but does not replace permission, record, field, rate, network, secret, or data-scope policy.

## Persistence

Static Platform Plugin schema stays in customer-owned Payload/Postgres migrations. Hot Applications initially use platform-owned generic tables for:

```text
catalog/install/generation/receipt state
manifest/settings/metadata
namespaced schema-validated app documents/KV
remote UI/navigation references
outbox/audit/idempotency
```

Dynamic custom relational schema is not hidden inside the first app runtime.

## Health and inventory

```text
liveness    host/runner responds
readiness   config/providers/migrations/artifacts compatible
app health  active runner/UI generation passes probes
inventory   static graph + active app/skin generations + artifact digests
deployment  blue/green target and gateway truth
```

Runtime inventory never treats database assertions as verified package/artifact identity.

## Non-responsibilities

The platform family does not:

- own customer domain behavior or content;
- execute arbitrary package scripts;
- hot-add Payload collections/hooks;
- expose Docker/database/host-secret authority to apps;
- use Node permission flags as the only sandbox;
- execute remote app React in the host realm;
- promise zero downtime for incompatible migrations;
- launch a public unreviewed marketplace in Phase 9.

## Required evidence

- static graph remains deterministic/frozen;
- signed bundle verification and secure extraction;
- isolated runner escape/resource failure corpus;
- remote UI worker/CSP/accessibility proof;
- atomic app generation activation/rollback/restore;
- multi-process convergence;
- continuous-traffic Docker blue/green proof;
- maintenance-required refusal;
- exact combined runtime inventory.
