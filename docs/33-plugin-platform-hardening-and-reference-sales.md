# Platform Plugin Hardening and the Sales Reference Module

## Scope

This document defines the accepted **Platform Plugin** authoring model proven through Gates 6–8. It does not define the Phase 9 Hot Application or Theme Skin runtime; see [Dynamic Applications and Zero-Downtime Extension Delivery](./35-dynamic-applications-and-zero-downtime-delivery.md).

`module.sales` remains the sole first-party domain reference. It demonstrates deep trusted host integration without pretending to be a complete commercial CRM.

## Platform Plugin definition

A Platform Plugin is an exact-version trusted package compiled into the customer host artifact. Existing kinds:

```text
module
provider
builder
theme
integration
preset
```

It may contribute:

```text
Payload schema and customer migrations
services, permissions, settings
sources, actions, tools
events, jobs, realtime topics
native components, blocks, routes, navigation, pages
providers, builders, executable themes
localization, health, lifecycle, testing metadata
```

Every contribution is static, explicit, versioned where persisted, reconciled declared-versus-actual, and frozen before boot. Database content cannot create executable contributions.

## Package boundaries

```text
./manifest    side-effect-free static package metadata
./contracts   serializable IDs/descriptors/schemas
./server      Payload/Node handlers and scoped services
./browser     browser-safe clients/hooks
./ui          native K-Nex component/block compositions
./migrations  customer-consumed migration inventory
./testing     conformance fixtures/metadata
```

Third-party Payload/Puck/protocol/component-engine types remain implementation details.

## Sales reference matrix

| Surface | Sales proof |
|---|---|
| Identity/package | `module.sales` exact manifest/package/integrity |
| Schema/migrations | tasks and opportunities with clean/upgrade fixtures |
| Permissions/settings | record/field/settings descriptors and validation |
| Sources | tasks/opportunities tables and revenue metric |
| Actions | task create/update and opportunity stage update |
| Agent tools | explicit search/create tools through K-Nex gateway/MCP adapter |
| Events/outbox | task/opportunity changed durable events |
| Jobs/realtime | bounded audit job and source invalidation |
| UI/components | overview, tables, forms, details, status |
| Puck | canonical Sales block bridges |
| Routes/navigation | Sales overview/tasks/opportunities/settings |
| Default pages | immutable templates instantiated into customer-owned documents |
| Lifecycle | install/enable/disable/re-enable/upgrade/purge planning |
| Evidence | conformance, real Postgres/browser, packed package, release/restore/fleet |

A second domain module must not be created to discover a generic platform gap.

## Settings

Platform Plugin settings are customer-owned validated documents with version, defaults, permissions, secret references, and migrations. They configure behavior already present in the host artifact.

They cannot install packages, add host schema/imports, create executable contributions, change topology, or weaken authorization/lifecycle policy.

## Routes, UI, and pages

Native routes and React renderers are built into the host generation. Persisted navigation/pages reference stable route/component/block IDs and typed parameters rather than unrestricted URLs/import paths.

Default templates are immutable package artifacts. Instantiated pages are customer-owned; upgrades do not overwrite edits. New versions require explicit compare/adopt/create.

Platform Plugin UI uses K-Nex source/action/query/component contracts rather than custom raw Payload/fetch/cache/form/table stacks.

## Lifecycle after Phase 9 decision

```text
package add/upgrade/remove
  immutable host release
  blue/green no-outage promotion when compatible
  maintenance-required when overlap is unsafe

preinstalled enable/disable/re-enable
  live state only when code/schema/migrations/dependencies/settings are ready

schema-owning removal
  explicit purge migration/release or retained disabled state
```

The application never runs a package manager or imports new Platform Plugin code at runtime.

## Relationship to Hot Applications

A feature that fits fixed host capabilities and does not need Payload config/native host imports may be authored as a signed `app.*` Hot Application and installed live through an isolated runner/remote UI.

A feature needing Payload collections/hooks, host services/providers/builders, native React, or executable Theme Package behavior remains a Platform Plugin.

This distinction preserves both deep integration and no-outage app installation without weakening either contract.

## Conformance

A Platform Plugin passes one class-specific conformance command proving:

```text
manifest/package/export identity
static resolution and declared-versus-actual inventory
capability-scoped services
Payload schema/migrations and customer boot
settings/permissions/sources/actions/tools/events/jobs/realtime
server/browser/editor bundle boundaries
native UI/Puck/routes/navigation/default pages
accessibility and result states
lifecycle/reference/purge/upgrade/restore
packed package and release evidence
```

Hot Application and Theme Skin have separate Phase 9 conformance suites and cannot satisfy Platform Plugin conformance by omission.
