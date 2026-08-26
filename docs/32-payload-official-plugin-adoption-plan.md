# Official Payload Plugin Adoption Plan

## Purpose

K-Nex is strategically built on Payload, so official Payload plugins should be reused when they reduce implementation and maintenance cost without taking ownership of K-Nex public contracts, authorization, lifecycle, or product boundaries.

This document classifies every official plugin currently listed in the Payload plugin documentation and assigns it to an executable K-Nex gate.

The governing rule is:

> Prefer an official Payload plugin as a bounded implementation adapter when it satisfies the K-Nex contract; never reshape K-Nex around a plugin's private types, collections, routes, or assumptions.

## Adoption policy

An official plugin is not installed merely because it exists. Every adoption requires, in its assigned gate:

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
- Runtime data may narrow an installed plugin's behavior but cannot install code, register new executable tools, or expand authority.
- Automatic exposure of collections, globals, routes, actions, or tools is disabled unless the active gate explicitly proves it safe.
- Customer repositories own final migrations and exact package versions.
- Failure of one plugin candidate does not invalidate the K-Nex contract; the gate may use a smaller custom adapter instead.
- Official packages are trusted in-process code and remain subject to supply-chain, integrity, SBOM, and fleet controls.

## Classification

```text
preferred candidate
  likely to remove substantial generic work; evaluate in the named gate

conditional candidate
  useful for a bounded use case, but not a platform default

deferred vertical accelerator
  potentially useful after foundation gates; not part of the core roadmap

not a baseline fit
  conflicts with current product boundaries or introduces the wrong abstraction
```

## Decision matrix

| Official Payload plugin | K-Nex decision | Gate / phase | Intended use |
|---|---|---|---|
| `@payloadcms/plugin-mcp` | preferred candidate | Phase 2A / P2A.7 | MCP transport and API-key/admin integration over the K-Nex tool gateway |
| `@payloadcms/plugin-form-builder` | conditional candidate | Phase 5 | CMS/public forms, submissions, editor schema, and email workflow behind `module.forms` |
| `@payloadcms/plugin-nested-docs` | preferred candidate | Phase 5 | Hierarchical CMS pages/categories and breadcrumb projection |
| `@payloadcms/plugin-redirects` | preferred candidate | Phase 5 | Managed CMS redirects; actual redirect execution remains in K-Nex/Next runtime |
| `@payloadcms/plugin-search` | conditional candidate | Phase 5 | Public-safe CMS search projection and reindex workflow |
| `@payloadcms/plugin-seo` | preferred candidate | Phase 5 | CMS metadata editor, preview, and generation hooks |
| `@payloadcms/plugin-import-export` | preferred candidate | Phase 6 | Bounded admin import/export and an accelerator for explicit archive/export work |
| `@payloadcms/plugin-sentry` | conditional candidate | Phase 7 / deployment | Optional Sentry adapter; Pino/OpenTelemetry remain vendor-neutral platform contracts |
| `@payloadcms/plugin-multi-tenant` | not a baseline fit | post-Gate 7 only | Optional intra-customer sub-organization experiment, never customer isolation |
| `@payloadcms/plugin-stripe` | deferred vertical accelerator | after Gates 3 and 6 | Explicit billing/payment integration with outbox, idempotency, webhook, and lifecycle controls |
| `@payloadcms/plugin-ecommerce` | deferred vertical accelerator | post-Gate 7 roadmap | E-commerce vertical accelerator, not K-Nex core commerce/domain model |

## MCP plugin — Phase 2A preferred adapter

Payload's MCP plugin provides an MCP endpoint, API-key management, per-key capability toggles, custom tools/prompts/resources, custom authentication, event callbacks, and collection/global CRUD exposure.

K-Nex uses only the transport and management capabilities that preserve its tool contract.

Required configuration direction:

```text
collections: {}
globals: {}
custom K-Nex tools only
overrideAuth → K-Nex principal and delegation resolution
custom handler → K-Nex tool execution gateway
onEvent → transport telemetry only
```

The adapter-generated handler delegates to one K-Nex tool ID/version. Module authors do not receive a generic Payload MCP handler and do not call `req.payload` directly from an agent tool.

P2A.7 is amended to evaluate and adapt `@payloadcms/plugin-mcp` before selecting a lower-level MCP SDK or implementing a custom server.

Acceptance:

- exact package version is pinned to the active Payload tuple;
- built-in collection/global CRUD is absent from `tools/list`;
- only actor/delegation-filtered K-Nex tools are published;
- execution re-enters K-Nex authorization, approval, idempotency, budgets, output validation, redaction, and audit;
- API-key capability toggles can only reduce authority;
- plugin/API-key collection contributions are inventoried and migrated by the customer repository;
- MCP types do not enter K-Nex contracts;
- internal `module.ai-assistant` can call the K-Nex gateway directly without loopback MCP.

Reject the adapter and use a direct MCP SDK only if automatic CRUD cannot be fully disabled, custom tools cannot be safely filtered, authentication cannot bind to a K-Nex principal/delegation, token passthrough is required, or output/policy enforcement can be bypassed.

## Form Builder — Phase 5 conditional CMS accelerator

The official Form Builder manages dynamic form definitions and submissions in Payload, supports brand-owned frontend rendering, confirmation/redirect behavior, emails, uploads, and optional payment hooks.

K-Nex may wrap it as an implementation candidate for:

```text
module.forms
public contact/lead forms
workspace-configured internal forms
CMS form block renderer
form submission registered action
submission/admin review surface
```

K-Nex boundaries:

- form definitions are not arbitrary executable UI documents;
- only allowlisted field types and options are publishable;
- public and workspace form action IDs are distinct;
- submission uses K-Nex CSRF/origin, abuse, rate, upload, PII, and audit policies;
- form submissions do not automatically become CRM records; an explicit action/integration owns conversion;
- email delivery uses the selected K-Nex email capability and durable semantics where required;
- the payment field is disabled in the first proof and does not bypass payment/integration gates;
- plugin collection types do not become the K-Nex form contract.

Adoption is conditional because the canonical form/block schema, localization, multi-step behavior, accessibility, and atomic CMS publication must map cleanly without deep plugin overrides.

## Nested Docs — Phase 5 preferred CMS hierarchy candidate

The official Nested Docs plugin adds parent relationships and generated breadcrumbs, including recursive descendant updates when hierarchy changes.

Candidate uses:

```text
CMS page tree
category hierarchy
navigation-source projection
breadcrumb generation
route lineage after slug/parent changes
```

Required proof:

- cycles and invalid parent relationships are rejected;
- depth and descendant-update cost are bounded and measured;
- localized routes remain deterministic;
- page/document publication and hierarchy updates do not expose unpublished paths;
- K-Nex persists route IDs and typed route parameters where authority matters, not unrestricted external URLs;
- plugin-added fields are adapter internals and migrate through customer-owned migrations.

## Redirects — Phase 5 preferred routing candidate

The official Redirects plugin stores managed redirect records but deliberately leaves redirect execution to the frontend/application runtime.

K-Nex can reuse its admin collection while retaining routing authority in the K-Nex Next.js runtime.

Required proof:

```text
301/302 or explicitly allowed status codes
relative/internal destination policy by default
open-redirect prevention
redirect loop and excessive chain detection
locale and publication awareness
cache invalidation after commit
missing target handling
customer-owned migration and rollback
```

A redirect document does not become an unrestricted URL execution contract.

## Search — Phase 5 conditional public-CMS search candidate

The official Search plugin creates an indexed denormalized `search` collection, synchronizes selected document fields, supports priorities and reindexing, and can exclude drafts/locales/documents.

This can remove the need for an initial Algolia/Elasticsearch integration for bounded CMS search.

K-Nex use is conditional and limited initially to public-safe CMS content:

- only explicitly selected public fields are copied into the index;
- unpublished/draft/private records are excluded;
- locale and publication revisions participate in source identity;
- reindexing is a bounded job with progress, failure, and readiness evidence;
- deletion and unpublish converge correctly;
- clients query a registered K-Nex search source, not the raw search collection;
- the search projection cannot bypass record or field authorization;
- business/CRM full-text search is a separate decision and is not implied by adopting CMS search.

Reject the candidate if its hook-based synchronization cannot provide the publication, authorization, and convergence guarantees required by the K-Nex source contract.

## SEO — Phase 5 preferred metadata candidate

The official SEO plugin adds metadata fields, editor assistance, previews, and generation hooks to selected collections/globals.

K-Nex can adopt it behind the CMS Payload adapter for:

```text
title
description
social image
canonical/robots extensions
structured metadata extensions
editor preview
```

Required boundaries:

- K-Nex owns the public CMS metadata contract and frontend rendering;
- plugin fields are mapped through the adapter;
- complex tab/field merging is explicit rather than relying on fragile plugin order;
- generated values remain draft until normal publication;
- any AI-assisted generation uses a separately approved provider/tool path and cannot silently publish;
- structured data and canonical URLs are schema-validated.

## Import/Export — Phase 6 preferred lifecycle accelerator

The official Import/Export plugin supports CSV/JSON export, browser download, stored export files, preview, imports, collection-specific configuration, limits, hooks, and Payload Jobs Queue for large operations.

K-Nex should evaluate it in P6.5 and P6.8 for bounded administrator data transfer and explicit archive/export projects.

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

- export/import permissions are explicit per collection and field;
- inaccessible fields never enter files, previews, jobs, logs, or errors;
- row/file/byte/time/concurrency limits are non-zero platform defaults;
- upload collections have strict access, retention, malware/content-type, and storage policy;
- large jobs have runner/readiness checks, idempotency, checkpoint, cancellation, and safe retry behavior;
- import modes and relationship resolution are deterministic and audited;
- exports are versioned and tested for read/restore before any purge;
- encrypted export storage is used when data classification requires it.

## Sentry — Phase 7 conditional observability adapter

The official Sentry plugin integrates Payload/Next.js error and performance reporting.

K-Nex keeps Pino and OpenTelemetry as vendor-neutral contracts; Sentry is a deployment-selected adapter.

Required proof:

```text
release/application/environment tags
trace/correlation linkage
PII and secret redaction
request/user context minimization
sampling and cost limits
source maps and artifact release identity
no double-reporting with OpenTelemetry instrumentation
no Sentry types in module/runtime contracts
```

The setup must be reviewable and exact-pinned; a `latest` setup wizard is not a production installation procedure.

## Multi-Tenant — not a baseline fit

The official Multi-Tenant plugin adds tenant fields, admin tenant switching, automatic tenant assignment, relationship/list filtering, and cleanup behavior within one Payload application.

K-Nex V1 isolates customers with separate repositories, databases, secrets, deployments, and release cadences. Therefore this plugin must not be used to collapse customer isolation into one shared application.

It may be evaluated after Gate 7 only for an explicit **intra-customer** requirement such as a franchise, agency sub-account, or business group inside one customer deployment.

Such an experiment must prove:

```text
customer boundary remains physical and independent
branch/organization policy maps cleanly to K-Nex actors and sources
cross-tenant reads/writes/relationships/files/jobs/search are denied
super-admin scope is explicit and audited
tenant deletion cleanup cannot cause uncontrolled destructive behavior
cache, realtime, agent tools, exports, and search include tenant context
```

## Stripe — deferred vertical integration

The official Stripe plugin proxies Stripe APIs/webhooks, supports synchronization, and exposes Stripe operations through Payload access control.

It can reduce integration code for a future billing/e-commerce product, but it is not a core provider for every K-Nex application.

Evaluation starts only after:

```text
Gate 3 durable event/outbox semantics
Gate 6 lifecycle, migration, and upgrade safety
an explicit customer/payment product requirement
```

Required controls include webhook signature verification, idempotency, duplicate/out-of-order event handling, fast acknowledgement plus durable processing, restricted API proxy allowlists, secret isolation, PCI scope review, audit, reconciliation, and customer-specific rollback. Serverless asynchronous webhook behavior must not be relied upon without a durable worker path.

## Ecommerce — deferred post-Gate 7 accelerator

The official Ecommerce plugin provides product variants, carts, orders, transactions, addresses, payment adapters, currencies, and React utilities. It does not natively cover shipping, tax, or subscriptions.

This is too broad and domain-opinionated for the platform foundation. It becomes a post-Gate 7 product-roadmap candidate for a real e-commerce customer.

Any adoption must compare its domain model against K-Nex inventory, pricing, order, customer, payment, tax, shipping, fulfillment, and lifecycle contracts. K-Nex does not promise that restaurant, inventory, logistics, or generic CRM modules will share the plugin's commerce model.

## Phase integration summary

### Phase 2A

```text
P2A.7 evaluates @payloadcms/plugin-mcp first
fallback to a direct MCP SDK/custom adapter only on documented kill criteria
```

### Phase 5

```text
SEO and Redirects: preferred CMS adapter candidates
Nested Docs: preferred hierarchy candidate
Form Builder: conditional forms-module candidate
Search: conditional public-CMS search candidate
```

Gate 5 does not need to adopt all five. It selects the smallest combination required by the CMS proof and records accepted/rejected candidates in `phase-5-result.md`.

### Phase 6

```text
Import/Export: preferred accelerator for bounded admin transfer and archive/export proof
```

### Phase 7

```text
Sentry: optional deployment observability adapter
```

### Post-Gate 7 / explicit vertical work

```text
Multi-Tenant: only intra-customer experiment
Stripe: billing/payment integration after durable/lifecycle gates
Ecommerce: product-roadmap accelerator for a real commerce customer
```

## Gate result requirements

Whenever a phase adopts or rejects a candidate, its result document records:

```text
package and exact version
Payload/Next/React/Node compatibility tuple
official documentation and license reviewed
accepted K-Nex boundary
contributed schema/routes/jobs/admin UI
migration and lifecycle impact
security and performance fixtures
known limitations
fallback/removal path
GO, conditional adoption, or rejection decision
```

No plugin is considered a K-Nex dependency baseline until its assigned executable gate passes.