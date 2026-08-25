# Plugin Data Sources, UI State, and Bindings

## Purpose

Modules expose deliberate authenticated projections to reusable UI without exposing Payload collections, database APIs, internal stores, arbitrary URLs, SQL, or executable expressions.

```text
sales.total-potential-revenue → metric.scalar@1
sales.tasks                   → table.records@1
sales.opportunities-by-stage  → series.category@1
sales.revenue-over-time       → series.time@1
```

## Descriptor and handler separation

Descriptor/contracts entrypoint:

```text
source ID/major/owner/display
surface/audience/permission
input schema and central budget class
one primary output contract
exact output schema identity
stable field definitions
pagination/filter/sort/cache/realtime policy
```

Server entrypoint:

```text
authenticated req.payload/domain service handler
record and field authorization
permitted projection query
```

The handler binds during `data-handlers`, after its descriptor was declared in `contracts`.

## Standard gateway

```text
GET  /api/k-nex/data-sources
GET  /api/k-nex/data-sources/:sourceId/descriptor
POST /api/k-nex/data-sources/:sourceId/query
```

Pipeline:

```text
authenticate
lookup profile/surface/audience
resolve actor-filtered descriptor
authorize source and requested fields
apply body/depth/field/page/time/concurrency/rate/cost limits
execute only permitted projection
validate exact schema and output contract
defensively redact
apply safe cache policy
observe and serialize success/problem
```

## Field identity and authority

Table fields are stable opaque IDs such as `assignee`, not internal object paths. Descriptors can omit fields the current actor may not discover.

Bindings mark fields:

```text
required  explicit insufficient-permission/unavailable state if absent
optional  safely omitted without changing declared meaning
```

The server never trusts builder selection as authorization.

## Source response identity

A success envelope carries source ID/major, output contract ID/major, `structuralCompatibilityHash`, and data. Localized labels/editor hints use a separate `presentationMetadataRevision` and do not trigger document migration.

Package version, source major, contract major, structural hash, and presentation revision are independent.

## Cache identity

Query key includes source/major, validated parameters, selected fields, surface, locale/timezone when semantic, publication/feature revision, and one safe authorization boundary:

```text
no-store
actor
authorization-context fingerprint
public source revision
```

Role name alone is never used. Permission/membership/policy changes invalidate the fingerprint.

## UI state and context

UI state coordinates filters/selections:

```text
page.filters.date-range
page.filters.selected-stage
workspace.selected-branch
```

Runtime context is read-only:

```text
context.current-user
context.current-branch
context.route.params
context.cms.locale
context.cms.preview-mode
```

Neither replaces authenticated business data sources.

## Bindings

Stored connections can bind static/context/state values to source parameters and source results to compatible block inputs. Component events may update allowed state or invoke registered actions.

The binding graph is schema-validated, bounded, and rejects synchronous cycles. It stores no arbitrary expression.

## Realtime

Sources declare reconstructible invalidation topics. Client queries also use revision/watermark, reconnect resync, focus revalidation, and bounded freshness polling. True live streams require explicit snapshot/message/reducer/resync contracts.

## Public sources

Public CMS uses distinct explicit IDs with anonymous/signed-session policy, narrow DTO, rate/abuse/privacy/cache rules. Internal workspace sources cannot be published publicly.

## Versioning and migration

- additive presentation metadata: presentation revision;
- compatible optional structural addition: structural hash change;
- selected field rename/removal/semantic change: source major and document migration;
- canonical shape break: output contract major;
- missing source/field/plugin: safe runtime fallback and readiness/orphan report.

## Required tests

- source/record/field direct manipulation denial;
- required versus optional field behavior;
- no unauthorized value in cache/log/error;
- actor/policy cache separation;
- contract output fail-closed;
- bounded pagination/filter/sort/series;
- public/internal publication separation;
- invalidation loss/reconnect convergence;
- source/field migration across drafts/published/layout revisions.
