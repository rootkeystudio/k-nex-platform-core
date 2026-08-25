# ADR-0013: Conservative Technology and Package Baseline

- Status: accepted
- Date: 2026-08-25
- Decision owners: K-Nex platform maintainers
- Related: [Technology and package baseline](../26-technology-package-baseline.md), [Research plan](../12-research-plan-and-poc.md), [ADR-0010](./0010-typed-data-source-state-binding-graph.md), [ADR-0012](./0012-hybrid-output-contracts.md)

## Context

K-Nex requires concrete implementation packages for validation, remote data, local UI state, accessible primitives, forms, tables, charts, realtime, jobs, logging, telemetry, testing, CLI behavior, monorepo builds, and package releases.

The package choices must reinforce the existing architecture:

```text
Payload remains the framework and database owner
K-Nex contracts remain editor/transport/component-library independent
plugins expose deliberate authenticated data sources
server authorization and business services remain authoritative
themes own presentation
realtime normally invalidates and refetches
customer applications pin independent exact releases
```

Choosing overlapping frameworks or leaking implementation types into plugin APIs would reverse these decisions. Choosing newly released major versions without ecosystem soak would also increase upgrade risk for independently deployed customer applications.

## Decision

Adopt the following conservative default package families for the first implementation:

```text
Runtime/framework
  Node.js 24 LTS
  Next.js + Payload + React exact tested tuple
  @payloadcms/db-postgres
  pnpm workspaces
  Turborepo
  Changesets

Validation
  Zod 4 for first-party TypeScript/runtime schema authoring
  generated JSON Schema
  Ajv 8 + ajv-formats for compiled static JSON validation

Client data and state
  native fetch
  TanStack Query 5 for server/data-source state
  Zustand 5 vanilla, scoped stores for ephemeral UI state
  React Hook Form + Zod resolver for client form interaction

Accessible UI
  React Aria Components behind K-Nex semantic primitives
  CSS custom properties and local structural CSS
  no React Spectrum or visually opinionated core component suite

Tables and charts
  TanStack Table 8 initially behind the K-Nex DataTable adapter
  TanStack Virtual for measured virtualization needs
  Apache ECharts 6 behind a K-Nex visualization adapter

Realtime and jobs
  Socket.IO 4 as the first realtime.gateway implementation
  in-memory adapter for single instance
  Socket.IO Redis adapter + ioredis for multi-instance mode
  Payload Jobs Queue for V1 jobs/workflows

Operations and tests
  Pino for structured logs
  OpenTelemetry API for optional traces/metrics integration
  Vitest 4
  React Testing Library
  Playwright
  Testcontainers PostgreSQL

CLI and package quality
  Commander
  @inquirer/prompts
  Execa
  semver
  ESLint + typescript-eslint + Next config
  Prettier
  dependency-cruiser
  publint
  @arethetypeswrong/cli
```

### Adapter boundary

Implementation library types are not K-Nex public or persisted contracts.

```text
TanStack Query types stay inside UI source runtime
Zustand StoreApi stays inside scoped state runtime
TanStack Table types stay inside DataTable adapter
ECharts options stay inside visualization adapter
Socket.IO types stay inside realtime provider
Puck types stay inside builder adapter
React Aria components stay behind semantic primitives where available
```

### Version policy

Customer applications pin exact tested versions and commit lockfiles. New major versions require a compatibility/soak gate including framework, SSR/RSC, accessibility, bundle/runtime, migration, stored-document, and customer-fixture tests.

TanStack Table v9 is not the initial frozen baseline because it became stable only on 2026-08-04. It is evaluated in parallel behind the adapter and adopted only after the gate passes.

### Schema policy

Zod is the authoring source of truth. JSON Schema is generated from those definitions where static/tool interoperability is required. Ajv compiles and validates those JSON artifacts; the same contract is not manually authored twice.

### State policy

TanStack Query owns remote/server data. Zustand owns only ephemeral page/workspace selection and filter state. React Hook Form owns local form interaction. None of these replace Payload data, permissions, or domain services.

### Realtime policy

Socket.IO implements transport and subscriptions. It is not the source of truth. Ordinary components invalidate and refetch authenticated source queries. Disconnect/reconnect requires authoritative resynchronization even when connection recovery succeeds.

### Presentation policy

React Aria Components provide accessible behavior and semantics; K-Nex themes and customer repositories provide visual design. Apache ECharts receives only trusted options generated from K-Nex canonical series/metric contracts.

## Consequences

### Positive

- The stack is built from mature, broadly adopted packages with active maintenance.
- Package roles align with existing K-Nex boundaries instead of creating parallel architecture.
- K-Nex can replace an implementation later without changing stored documents or plugin contracts.
- Accessible behavior is separated from customer visual design.
- Server data, ephemeral UI state, and form state have distinct owners.
- Realtime invalidation maps directly to TanStack Query cache behavior.
- Real Postgres, browser, package, and import-boundary tests become first-class.
- Independent customer applications receive reproducible exact dependency tuples.

### Costs

- K-Nex must maintain adapters around table, chart, query, realtime, builder, and primitives.
- Zod-to-JSON-Schema compatibility needs contract tests.
- Ajv validators must be compiled/cached rather than created per request.
- Socket.IO introduces more protocol overhead than raw WebSocket.
- TanStack Table v8 may later require a controlled v9 migration.
- React Aria and TanStack Table behavior must be composed carefully for advanced grids.
- OpenTelemetry exporters and SDK setup remain deployment responsibility.
- The package baseline requires ongoing security and ecosystem-health review.

### Required invariants

- Payload remains the primary database/persistence framework.
- no third-party implementation type appears in persisted K-Nex documents;
- no third-party implementation type appears in domain plugin public contracts unless explicitly approved;
- server authorization and output validation run on every protected source/action execution;
- client caches are actor/surface scoped;
- Next.js stores are created per request/document/provider, not as global mutable state;
- raw ECharts options/functions/HTML/URLs are never builder input;
- Socket.IO subscriptions are authenticated and authorized;
- reconnect/resync does not rely on socket delivery guarantees;
- dependency-cruiser rules enforce adapter boundaries in CI;
- generated customer projects pin exact tested versions;
- major upgrades do not auto-merge.

## Alternatives considered

### Redux Toolkit for general state

Rejected as the default because K-Nex separates remote data, ephemeral page state, and form state. A single global business-state store would duplicate Payload/TanStack Query and increase coupling.

### MUI, Chakra UI, Ant Design, or React Spectrum

Rejected as core design systems because their visual language conflicts with installable K-Nex themes. React Aria Components provide a better behavior/semantics layer.

### TanStack Form v2

Not selected for V1 because it is newly released/pre-stable relative to the baseline. React Hook Form is mature and fits the required role.

### TanStack Table v9 immediately

Not selected as the initial frozen version because of its very recent stable release. The adapter keeps the migration path open.

### raw WebSocket/`ws` as the first provider

Not selected because Socket.IO provides proven reconnect, middleware, room, fallback, and multi-server ergonomics for the first customer deployments. A raw provider remains possible after workload benchmarks.

### BullMQ or Temporal in V1

Rejected until Payload Jobs proves insufficient. Adding another durable-work owner immediately would duplicate queues, retries, scheduling, and operations.

### arbitrary chart configuration

Rejected because it would leak ECharts into persisted contracts and create executable/security/migration risk.

### tRPC, Apollo, or Axios for the data-source gateway

Not selected. The accepted source registry already defines dynamic descriptors, schemas, envelopes, permissions, and native HTTP behavior; native `fetch` is sufficient.

### one schema library only for every artifact

Zod alone is sufficient for TypeScript runtime boundaries but Ajv is retained for efficient, standards-oriented validation of generated static JSON Schema artifacts. The schemas are generated rather than duplicated.

### immediate adoption of every new stable major

Rejected because each customer has an independent deployment and release history. New majors require explicit soak and upgrade evidence.

## Validation or revisit trigger

Validate through the POC gates in [the technology baseline](../26-technology-package-baseline.md), including:

- exact Payload/Next/React/Node tuple;
- Zod/Ajv schema parity;
- actor-scoped TanStack Query behavior;
- per-provider Zustand SSR/hydration isolation;
- React Aria primitives under multiple themes;
- TanStack Table server-mode and accessibility fixtures;
- ECharts canonical contract rendering and injection resistance;
- Socket.IO single/multi-instance invalidation and reconnect resync;
- Payload Jobs worker/scheduler topology;
- Vitest/Playwright/Testcontainers coverage;
- dependency-cruiser and package-publication checks.

Revisit one package when it reaches end of support, materially degrades in project health, cannot meet performance/accessibility/deployment requirements, or a replacement passes the same K-Nex adapter and migration contracts with lower total risk.
