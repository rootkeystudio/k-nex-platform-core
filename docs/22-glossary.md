# Glossary

## Application

One independently deployed customer product composed from Payload, exact K-Nex packages, customer code/configuration, data, themes, migrations, and infrastructure.

## Application manifest

`k-nex.app.json`, the desired non-secret source-controlled composition.

## Build provenance

Signed evidence binding source commit, workflow/builder identity, lock/resolved graph inputs, and artifact digest.

## Builder engine adapter

Narrow engine bridge that converts canonical documents, hosts the editor, and maps palette/fields. It does not own storage/publication/runtime policy.

## Capability

Versioned interchangeable service contract such as `realtime.gateway` or `storage.objects`.

## Canonical document

Engine-independent versioned layout/block/props/bindings/constraints representation stored by the customer application.

## Composition

Deterministic resolution and registration of exact packages, dependencies, providers, contributions, customer extensions, and framework config.

## Data source

Plugin-owned authenticated bounded server query/projection with descriptor, handler, input/output schemas, permission/record/field policy, limits, cache and realtime policy.

## Deployment receipt

Record that an exact artifact digest and migration revision was deployed to one customer environment with outcome and provenance link.

## Descriptor structural hash

Hash of source-compatible fields/types/input/output/pagination/filter/sort/major versions. Separate from localized presentation metadata revision.

## Disable

Keep package/schema/data installed while gating exactly declared behavior; reversible through re-enable when ready.

## Evidence maturity

`design-only`, `executable-poc`, `production-observed`, or `superseded`; independent from ADR decision status.

## Hermetic customer config

`k-nex.config.ts` static registrations whose graph cannot depend on network, time, random values, secrets, or ambient filesystem discovery.

## Module

Plugin implementing reusable business/horizontal behavior, for example `module.sales` or `module.logistics.driver`.

## Output contract

Reusable versioned semantic result family such as `metric.scalar@1` or `table.records@1`.

## Plugin

Installable trusted K-Nex package: module, provider, builder, theme, integration, or preset.

## Plugin ID

Stable persisted hierarchical product identity, independent from package name/version.

## Provider

Plugin implementing a genuinely replaceable infrastructure capability. Payload database adapter is not a provider.

## Purge

Explicit destructive data/schema/reference migration after dependency, retention, backup, approval, and rollback analysis.

## Required field

Dynamic component field whose absence/insufficient authority makes the component explicitly unavailable rather than silently incomplete.

## Resolved graph

Deterministic committed `k-nex.resolved.json` containing exact package integrity, plugin manifests, provider choices, order, inventory, environment names, and config fingerprint—without timestamps/secrets/host paths.

## Runtime inventory

Protected non-secret view of actual resolved and registered composition plus artifact/migration revision.

## Schema-owning plugin

Plugin contributing Payload schema. In V1 it can disable/re-enable or explicitly purge; package removal with retained schema is not a generic guarantee.

## Source family

Internal shared query/projection service used by several purpose-built external sources without turning one source into unrelated multi-output API.

## Theme package/profile

Package is executable presentation code/schema; profile is validated versioned database data selecting and configuring an installed theme.

## Transactional outbox

Durable event intent inserted atomically with business state and later processed idempotently.

## UI document repository

Payload storage/revision/publication/rollback boundary for canonical documents.

## UI document runtime

Engine-independent validation, rendering, permissions, bindings, migrations, and missing-component behavior.

## UI state

Typed filter/selection/coordination value, not a cache or copy of business records.

## WCAG target

Supported K-Nex web surfaces target WCAG 2.2 AA; conformance requires evidence, not only token validation.
