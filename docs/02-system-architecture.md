# System Architecture

## Overview

```text
Customer Application
  ├─ Stable Gateway / Reverse Proxy
  ├─ Blue/Green K-Nex Host Generations
  │    ├─ Next.js + Payload
  │    ├─ Static Platform Plugin Registry
  │    ├─ PluginManager API
  │    ├─ Fixed App/Remote UI Hosts
  │    └─ Host Capability Gateway
  ├─ Worker / Outbox Process
  ├─ Extension Runner Service
  ├─ PostgreSQL
  ├─ Object and Content-Addressed Artifact Storage
  ├─ Optional Redis/Backplane
  └─ Separate Deployment Supervisor
```

Each customer has an independent instance of this logical system.

## Static host plane

The host generation contains:

```text
Payload/Next/framework tuple
exact Platform Plugin packages
static resolved graph and registration imports
Payload collections, migrations, jobs, routes, native UI
full executable Theme Packages and Builder/Provider code
```

It is immutable after boot. A host change creates a new blue/green generation.

## Dynamic extension plane

PostgreSQL and artifact storage track:

```text
Hot Application catalog/install state
verified app bundle generations
Theme Skin generations
active/rollback pointers
settings and app storage
activation/retirement receipts
runtime extension revision
```

A dynamic app cannot alter host config. The host contains generic route, artifact, runner, storage, capability, and remote UI adapters before installation.

## Control flow

### Hot Application / Theme Skin

```text
operator/API
→ PluginManager plan
→ catalog/artifact verify
→ stage/warm
→ atomic generation pointer transaction
→ outbox/revision convergence
```

### Platform Plugin

```text
operator/API
→ PluginManager impact plan
→ authorized DeploymentSupervisor request
→ build/pull/migrate/start/warm green
→ gateway promotion
→ drain/receipt
```

## Data authority

```text
static business/CMS schema  Payload/Postgres collections
Hot Application V1 data    platform-owned app document/KV storage
runtime extension state    platform-owned lifecycle/generation tables
artifacts                   immutable digest-addressed storage
```

No app receives raw database credentials. Future richer dynamic objects require a separate explicit design.

## Execution authority

### Platform Plugin

Runs as trusted host code from the verified customer image. Capability-scoped services and server authorization still apply, but this is not a malicious-code sandbox.

### Hot Application

Runs as an isolated capability client:

```text
server bundle → extension runner
UI bundle     → Web Worker/equivalent remote UI realm
```

The host authorizes every capability invocation using app ID/generation and current actor/delegation.

### Theme Skin

Parsed/validated data only. No executable realm.

## Consistency

All lifecycle changes use PostgreSQL revisions and transactional outbox:

```text
commit state/pointer/revision/receipt
→ web/worker/runner/gateway/browser invalidation
→ periodic revision recovery
```

No process-local registry is the sole truth.

## Routing

```text
native Platform Plugin routes  compiled into host generation
Hot Application routes         fixed /apps/:appId/* dispatcher
remote UI assets               verified generation-pinned route
source/action/tool calls        fixed typed gateways
```

Unrestricted runtime route registration is not allowed.

## Availability

- Hot app/skin activation keeps the host and previous generation running.
- Platform Plugin promotion keeps blue serving while green warms.
- Incompatible migrations use maintenance-required flow.
- Runner failure degrades one app, not the host.
- Gateway, database, storage, and runner availability have explicit health/SLO policy in production work.

## Security boundaries

```text
customer-to-customer     separate data/secrets/deployment
host-to-Hot Application runner and remote UI isolation
web-to-Docker            separate deployment supervisor
unverified-to-active     artifact verification and atomic activation
actor-to-capability      current permission/record/field policy
public-to-internal       distinct IDs/surfaces and gateways
```

## Evidence boundaries

```text
static host truth       image digest, lock, resolved graph, migrations, receipt
runtime extension truth catalog/artifact digest, generation, pointer, receipt
fleet truth             verified observed inventory, never manual assertion
```
