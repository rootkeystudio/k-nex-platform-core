# System Architecture

## High-level model

```text
machine-readable contracts and schemas
        ↓
trusted package catalog + exact package manifests
        ↓
create-k-nex-app / k-nex CLI
        ↓
deterministic resolved graph + static registries
        ↓
customer composition root (Payload + K-Nex + customer code)
        ↓
immutable customer artifact + signed provenance
        ↓
independent customer web/worker/realtime/storage/database deployment
```

## Physical platform packages

```text
@k-nex/contracts
  IDs, schemas, actors, permissions, events, jobs,
  source/action/block contracts, errors, health

@k-nex/composition
  resolver, compatibility, ordering, declared/actual inventory,
  deterministic resolved graph

@k-nex/runtime
  capability-scoped services, actors, permissions,
  events/outbox, jobs, audit, health/readiness

@k-nex/payload-adapter
  Payload contributions, authentication adaptation,
  access, jobs, versions, migrations, config composition

@k-nex/testing
  contract suites, fixtures, failure injection

@k-nex/cli
  catalog, planning, generation, package/filesystem operations
```

UI packages remain separate:

```text
@k-nex/ui-contracts
@k-nex/ui-runtime
@k-nex/ui-shell
@k-nex/ui-design-system-contracts
@k-nex/ui-data-table
@k-nex/ui-visualization-echarts
@k-nex/builder-puck
@k-nex/payload-builder-storage
```

A convenience facade may re-export stable entrypoints but cannot erase dependency-cruiser boundaries.

## Dependency direction

```text
customer application
  → modules/providers/themes/builder/customer extensions
  → runtime/composition/UI adapters
  → low-dependency contracts
```

Forbidden:

- contracts importing Payload, Puck, Socket.IO, ECharts, TanStack Query/Table, or customer code;
- core/composition importing business modules;
- modules reading another module’s private table or source path;
- browser exports importing server-only code;
- plugins accessing capability services not declared in the resolved graph;
- runtime data selecting executable imports.

## Composition sources and precedence

See [Contract governance](./28-contract-governance-and-determinism.md). In summary:

```text
desired      k-nex.app.json
installed    pnpm-lock.yaml + integrity
self-declared released plugin manifest
customer code hermetic k-nex.config.ts fingerprint
executable   deterministic k-nex.resolved.json + static registries
runtime      validated records/settings/publications
deployed     signed artifact provenance + deployment receipt
```

A mismatch fails with diagnostics; it does not silently choose one layer.

## Canonical registration lifecycle

```text
manifest
contracts
providers
schema
behavior
jobs
data-handlers
ui
admin
validate
freeze
```

Source descriptors are contracts. Server source handlers bind later. React renderers bind in UI. `validate` compares declared and actual inventory and enforces collision, capability, bundle, and lifecycle rules. `freeze` makes the graph immutable.

## Payload framework boundary

Payload is the strategic V1 framework. The adapter composes explicit owned contributions:

```text
collections/globals/fields/indexes
endpoints/access/hooks
jobs and schedules
admin/system components
versions/drafts and migration integration
```

K-Nex does not generic-deep-merge arbitrary Payload config. Ambiguous contribution categories require a deliberate adapter or fail.

The Payload Postgres adapter is selected under application framework configuration. Hosted Postgres services use `DATABASE_URL`; they do not become separate persistence plugin families.

## Plugin boundary

A plugin package exposes physically separated entrypoints:

```text
./manifest    static JSON only
./contracts   IDs, schemas, DTOs, tokens; browser/server neutral
./server      Payload handlers, domain services, policies, jobs
./browser     typed source/action/realtime clients
./ui          React renderers and headless UI behavior
./migrations  deterministic helpers/readiness
./testing     fixtures and contract suite
```

The manifest declares expected contributions. Runtime registration must match them.

## Capability-scoped services

A plugin does not receive a universal service locator. Composition derives a typed and runtime-enforced service context from declared dependencies.

```ts
interface DriverServices {
  logistics: LogisticsDomainService
  realtime: RealtimeGateway
}
```

Jobs receive similarly scoped services plus actor/correlation/idempotency/checkpoint APIs.

## UI architecture

```text
resolved plugin graph
  → browser-safe UI/source/action registries
  → surface/audience/permission filtering
  → fixed shell + operational screens + canonical documents
  → semantic primitives and installed theme profile
```

Three separate builder boundaries:

```text
BuilderEngineAdapter  engine conversion and editor bridge
UiDocumentRuntime     validation, rendering, migrations, permissions
UiDocumentRepository  Payload revisions and atomic publication
```

## Data-source architecture

The gateway orchestrates independent stages:

```text
authenticate
catalog/surface lookup
authorize source and fields
budget
execute permitted projection
validate source schema and output contract
defensive redact
cache policy
observe and serialize RFC 9457 errors
```

Generic components bind by output contract. Business data never lives in unrestricted shared UI state.

## Runtime processes and realtime topology

Potential processes:

```text
web
worker
scheduler/outbox processor
optional dedicated realtime gateway
```

In-memory realtime is valid only when one process owns sockets and every publication path. Split processes or multiple web instances require Redis/backplane, an outbox relay, or another distributed provider.

Durable business events are written transactionally. Reconstructible invalidations use revision/watermark plus reconnect/focus/periodic revalidation so message loss cannot leave clients permanently stale.

## Data and migrations

- Postgres is the only supported V1 adapter.
- Customer repositories own final Payload migrations.
- Migration execution uses a per-application/database advisory lock, expected predecessor revision, and stale-artifact readiness fence.
- Schema-owning plugins can be disabled/re-enabled or explicitly purged in V1; retained-schema uninstall is not a general contract.

## Release and fleet architecture

Committed generated graph is deterministic and timestamp-free. CI produces separate evidence:

```text
source commit and workflow identity
lockfile and manifest digests
SBOM
artifact/container digest
signed provenance
migration revision
deployment receipt
runtime inventory
```

Fleet state is derived from deployed evidence. A handwritten inventory may contain ownership/notes, but it is not authoritative for deployed versions.

## Security and quality architecture

- NIST SSDF guides secure development/release practices.
- OWASP ASVS and API Security requirements map to tests.
- External API errors use RFC 9457.
- Supported web surfaces target WCAG 2.2 AA.
- Trusted in-process packages require protected publishing, integrity, SBOM, provenance, and fleet impact analysis.

## Validation sequence

See [Executable POC gates](./30-executable-poc-gates.md). The sequence intentionally proves deterministic composition before data sources, realtime, builder, themes, lifecycle, or the second customer.
