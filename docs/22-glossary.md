# Glossary

## Application

One independently deployed customer product composed from Payload/Postgres, exact Platform Plugins, dynamic extension state, customer data/configuration, migrations, and infrastructure.

## Platform Plugin

Existing trusted K-Nex package (`module.*`, `provider.*`, `builder.*`, `theme.*`, `integration.*`, `preset.*`) statically composed into the host artifact. It may own Payload schema and deep host integration.

## Hot Application

Signed prebuilt `app.*` bundle installed as an isolated runtime generation without mutating host Payload config or imports. Server logic runs through the extension runner and UI through the remote UI host.

## Theme Skin

Signed data-only `skin.*` artifact containing bounded tokens, recipes, scoped CSS, and approved assets. It can activate live. It is not an executable Theme Package.

## Theme Package / Profile

A Theme Package is executable `theme.*` code/schema and follows Platform Plugin delivery. A Theme Profile is customer-owned validated data selecting/configuring an installed package and optional skin generation.

## Plugin Manager

Thin orchestration façade for catalog, planning, staging, validation, activation, lifecycle, deployment requests, receipts, and inventory across all extension classes. It is not a host package manager.

## Extension generation

Immutable staged/active/rollback identity for one exact Hot Application or Theme Skin artifact. Activation atomically changes a generation pointer.

## Host generation

One immutable blue/green web/worker application release containing an exact Platform Plugin graph.

## Zero-downtime eligible

A Platform Plugin release whose old/new host generations and database schema can overlap safely during warm-up, promotion, drain, and rollback, proven by continuous probes.

## Maintenance-required

Explicit result for a migration/topology change that cannot safely overlap old/new releases. It is not disguised as zero downtime.

## Extension runner

Separate process/service executing Hot Application server bundles with short-lived identity, capability-scoped RPC, resource limits, and no raw host/database/Docker authority.

## Remote UI

Hot Application UI executed in a Web Worker/equivalent realm. It sends a bounded component/event protocol; the host owns actual K-Nex components, DOM, focus, routing, theme, data gateways, and authorization.

## Host capability

Versioned RPC service available to an app only when declared, installed, authorized, and budgeted, such as app storage, record query/action, scoped files, events, or constrained network.

## Content-addressed artifact

Immutable bundle stored and retrieved by cryptographic digest. Verification binds manifest, files, SBOM, provenance, and catalog identity.

## Official catalog

Signed versioned index pointing to immutable approved artifacts with publisher/source/release, digests, compatibility, capability/permission impact, support, and revocation state.

## Application manifest

`k-nex.app.json`, the desired source-controlled static customer composition. It does not contain runtime-downloaded executable paths.

## Build provenance

Signed evidence binding source commit, builder/workflow identity, inputs, and artifact digest.

## Activation receipt

Audited record binding an app/skin generation, expected and final revision, artifact verification, actor/automation identity, outcome, and rollback relation.

## Deployment receipt

Record that an exact host artifact, migration revision, topology, and traffic target were deployed/promoted to one customer environment.

## Capability

Versioned interchangeable contract. Platform Plugin capabilities resolve statically; Hot Application host capabilities are runtime RPC grants.

## Canonical document

Engine-independent versioned layout/block/props/bindings/constraints representation owned by the customer application.

## Composition

Deterministic resolution and registration of exact static Platform Plugins, providers, contributions, customer extensions, and framework config.

## Data source

Owner-defined authenticated bounded server query/projection with descriptor, handler, schemas, permission/record/field policy, limits, cache, and realtime behavior.

## Disable

Reversible lifecycle state that prevents new effective behavior while preserving the exact artifact/package and reviewed data according to class.

## Evidence maturity

`design-only`, `executable-poc`, `production-observed`, or `superseded`, independent from ADR decision status.

## Hermetic customer config

Source-controlled static registrations whose graph cannot depend on network, time, random values, secrets, or ambient filesystem discovery.

## Output contract

Reusable versioned semantic result family such as `metric.scalar@1` or `table.records@1`.

## Purge

Explicit destructive data/schema/reference operation after dependency, retention, backup, approval, and rollback analysis.

## Required field

Component/source field whose missing authority creates explicit unavailable/forbidden state rather than silently incomplete output.

## Resolved graph

Deterministic committed static Platform Plugin graph with exact package integrity, provider choices, order, inventory, environment names, and config fingerprint.

## Runtime inventory

Protected non-secret truth combining host artifact/static graph, migration revision, active app/skin generations, artifact digests, runner/gateway topology, and receipts.

## Schema-owning plugin

Platform Plugin contributing Payload schema. It can disable/re-enable or explicitly purge; remove-code/retain-schema is not generic.

## Transactional outbox

Durable event/invalidation intent inserted atomically with state and processed idempotently.

## UI document runtime/repository

Runtime owns engine-independent validation/render/policy; repository owns drafts/revisions/publication/rollback storage.

## WCAG target

Supported K-Nex web surfaces target WCAG 2.2 AA; a claim requires scoped evidence, not token checks alone.
