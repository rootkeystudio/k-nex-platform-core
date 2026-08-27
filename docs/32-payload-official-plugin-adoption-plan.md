# Official Payload Plugin Adoption Plan

## Purpose

K-Nex is strategically built on Payload, so official Payload plugins should be reused when they reduce implementation and maintenance cost without taking ownership of K-Nex public contracts, authorization, lifecycle, or product boundaries.

The governing rule is:

> Prefer an official Payload plugin as a bounded implementation adapter when it satisfies the K-Nex contract; never reshape K-Nex around a plugin's private types, collections, routes, or assumptions.

The platform-foundation program now uses `module.sales` as its sole first-party reference domain module. Official plugins that imply a new product module, such as forms or ecommerce, are deferred until Gate 8 unless a current foundation gate explicitly requires them.

## Adoption policy

An official plugin is not installed merely because it exists. Every adoption requires:

```text
current official documentation and license review
exact version pin compatible with the frozen Payload tuple
peer-dependency and package-export verification
static contribution inventory before boot
declared-versus-actual registration checks
access-control and direct-request attack tests
migration, disable, upgrade, and rollback analysis
server/browser bundle-boundary tests
secret, log, error, and telemetry redaction tests
representative performance and failure evidence
```

General boundaries:

- Payload plugin types do not become persisted or public K-Nex contracts.
- Payload-added collection slugs and fields are adapter internals unless K-Nex explicitly promotes a stable contract.
- Runtime data may narrow behavior but cannot install code, register executable contributions, or expand authority.
- Automatic exposure of collections, globals, routes, actions, or tools is disabled unless explicitly proven.
- Customer repositories own final migrations and exact package versions.
- Candidate failure does not invalidate the K-Nex contract; the gate may use a smaller adapter.
- Official packages remain trusted in-process code subject to integrity, SBOM, provenance, and fleet controls.

## Classification

```text
adopted bounded adapter
  executable evidence exists for the accepted subset

preferred candidate
  likely to remove substantial generic work; evaluate in the assigned gate

conditional candidate
  useful for a bounded product need, not a platform default

deferred vertical accelerator
  product-specific and outside the foundation roadmap

not a baseline fit
  conflicts with current product boundaries or introduces the wrong abstraction
```

## Decision matrix

| Official Payload plugin | K-Nex decision | Gate / phase | Intended use |
|---|---|---|---|
| `@payloadcms/plugin-mcp` | adopted bounded adapter | Phase 2A | MCP transport/API-key/admin integration over the K-Nex tool gateway |
| `@payloadcms/plugin-import-export` | preferred candidate | Phase 8 | Bounded admin transfer/archive adapter during lifecycle/restore proof |
| `@payloadcms/plugin-sentry` | conditional candidate | Phase 8 deployment proof | Optional Sentry adapter; Pino/OpenTelemetry remain platform contracts |
| `@payloadcms/plugin-form-builder` | deferred product candidate | post-Gate 8 | Future forms product behind K-Nex form/action contracts |
| `@payloadcms/plugin-nested-docs` | deferred product candidate | post-Gate 8 | Future CMS hierarchy/breadcrumb projection |
| `@payloadcms/plugin-redirects` | deferred product candidate | post-Gate 8 | Future managed redirects with K-Nex runtime authority |
| `@payloadcms/plugin-search` | deferred product candidate | post-Gate 8 | Future public-safe CMS indexing/query adapter |
| `@payloadcms/plugin-seo` | deferred product candidate | post-Gate 8 | Future CMS metadata editor/preview adapter |
| `@payloadcms/plugin-multi-tenant` | not a baseline fit | post-Gate 8 only | Optional intra-customer subdivision, never customer isolation |
| `@payloadcms/plugin-stripe` | deferred vertical accelerator | post-Gate 8 | Explicit billing/payment product |
| `@payloadcms/plugin-ecommerce` | deferred vertical accelerator | post-Gate 8 | Explicit ecommerce product |

## MCP plugin — adopted bounded adapter

The Phase 2A evidence adopted `@payloadcms/plugin-mcp@3.88.0` only for transport and management integration.

Required K-Nex configuration remains:

```text
collections: {}
globals: {}
custom K-Nex tools only
overrideAuth → K-Nex principal/delegation resolution
custom handler → K-Nex tool execution gateway
onEvent → transport telemetry only
```

Module authors do not receive a generic Payload MCP handler and do not call ambient `req.payload` from the agent-tool contract. API-key toggles can reduce authority but cannot add tools or permissions.

The accepted adapter does not imply adoption of other official plugins or promotion of all ADR-0019 decisions.

## Import/Export — Gate 8 preferred lifecycle adapter

The official Import/Export plugin supports CSV/JSON transfer, preview, stored export files, hooks, limits, and Payload Jobs Queue for large operations.

Gate 8 evaluates it for bounded administrator transfer and explicit archive/export work.

It does not replace:

```text
database backup and restore
schema migration
full application archive
legal-retention policy
plugin lifecycle planning
cross-version compatibility proof
```

Required proof:

- explicit collection/field permissions;
- inaccessible fields absent from files, previews, jobs, logs, and errors;
- row/file/byte/time/concurrency limits;
- strict upload-storage access, retention, and content policy;
- job runner readiness, idempotency, checkpoint, cancellation, and safe retry;
- deterministic import modes and relationship resolution;
- versioned exports tested for read/restore before purge;
- encrypted storage where classification requires it.

If the plugin does not fit the lifecycle/restore contract, Gate 8 uses a smaller K-Nex adapter.

## Sentry — Gate 8 conditional deployment adapter

K-Nex keeps Pino and OpenTelemetry as vendor-neutral contracts. Sentry may be selected per deployment.

Required proof:

```text
release/application/environment tags
trace/correlation linkage
PII and secret redaction
request/user context minimization
sampling and cost limits
source maps and artifact identity
no double-reporting with OpenTelemetry
no Sentry types in module/runtime contracts
```

A mutable `latest` setup wizard is not a production installation procedure.

## Deferred CMS/product candidates

Phase 5 intentionally proved canonical metadata, publication, themes, and runtime behavior without adopting SEO, Nested Docs, Redirects, Form Builder, or Search. They remain valid future candidates but are no longer foundation-gate work.

### Form Builder

Potential use:

```text
public contact/lead forms
workspace-configured forms
CMS form blocks
submission actions/admin review
```

Any future adoption requires allowlisted field types, public/workspace action separation, CSRF/rate/upload/PII policy, durable email semantics, and explicit conversion from submission to CRM records. Payment fields do not bypass payment gates.

### Nested Docs

Potential use:

```text
CMS page/category hierarchy
breadcrumbs
navigation projections
route lineage
```

Required proof includes cycle rejection, depth/update bounds, localization, unpublished-path protection, route IDs, migrations, and rollback.

### Redirects

Payload may store managed redirect records while K-Nex/Next retains execution authority. Required proof includes open-redirect prevention, loop/chain detection, locale/publication awareness, cache invalidation, and rollback.

### Search

The first acceptable use is a public-safe CMS projection. Raw search collections are not queried by clients. Fields, drafts, locales, indexing jobs, freshness, deletion/unpublish convergence, and source authorization remain K-Nex contracts.

### SEO

Payload SEO may later provide editor assistance and preview while K-Nex owns the metadata contract and public rendering. Generated values remain drafts; canonical URLs and structured data remain validated.

These plugins are evaluated only when a real post-Gate 8 product plan selects the feature. They do not justify creating `module.forms`, a broader CMS module, or another domain plugin during Gates 6–8.

## Multi-Tenant — not customer isolation

K-Nex customers remain separate repositories, databases, secrets, deployments, and release cadences. Payload Multi-Tenant must not collapse customer isolation into one application.

It may be evaluated after Gate 8 only for an explicit intra-customer requirement such as franchises or business subdivisions. Such an experiment must prove tenant context across sources, tools, cache, realtime, files, jobs, search, exports, and destructive operations.

## Stripe and Ecommerce — deferred vertical accelerators

Stripe and Ecommerce are not platform-foundation dependencies. Evaluation requires:

```text
Gate 3 durable event/outbox semantics
Gate 8 lifecycle/upgrade/restore and fleet safety
an explicit customer/payment or ecommerce product requirement
```

Stripe additionally requires webhook signatures, idempotency, duplicate/out-of-order handling, durable acknowledgement/processing, restricted proxy allowlists, secret isolation, audit, reconciliation, and PCI scope review.

Ecommerce requires a deliberate comparison against K-Nex product, pricing, inventory, order, payment, tax, shipping, fulfillment, customer, and lifecycle contracts. Restaurant or generic CRM modules do not inherit its domain model automatically.

## Gate integration summary

```text
Phase 2A
  Payload MCP accepted for its bounded adapter subset

Phase 5
  CMS candidates reviewed and deferred; no official CMS plugin adopted

Phase 6
  no new official plugin; focus is plugin contract + Sales reference

Phase 7
  no new official Payload plugin; focus is platform component system

Phase 8
  evaluate Import/Export
  optionally evaluate Sentry for deployment proof

Post-Gate 8
  CMS/form/search/SEO/hierarchy/redirect candidates
  Multi-Tenant only for intra-customer need
  Stripe/Ecommerce only for selected vertical products
```

## Gate result requirements

Whenever a gate adopts or rejects a candidate, its result records:

```text
package and exact version
Payload/Next/React/Node compatibility tuple
documentation and license reviewed
accepted K-Nex boundary
contributed schema/routes/jobs/admin UI
migration and lifecycle impact
security/performance fixtures
known limitations
fallback/removal path
explicit adoption or rejection decision
```

No official plugin is a K-Nex baseline dependency beyond its proven subset.