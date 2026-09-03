# Product Vision and Boundaries

## Vision

K-Nex is a software product line and application factory for repeatedly delivering customer-specific business applications without rebuilding authentication, content, modular behavior, UI composition, extension delivery, themes, authorization, and operations for every customer.

Customer products may combine CMS, CRM/Sales, operations, analytics, and future vertical capabilities. Each customer owns an independent repository, Payload/Postgres data, storage, secrets, deployment, migrations, backups, visual language, content, extension state, and release schedule.

## Product equation

```text
Payload/Postgres application foundation
+ deterministic Platform Plugins
+ isolated live Hot Applications
+ live Theme Skins
+ customer-owned data/content/settings/authorization
+ immutable Docker delivery and verifiable operations
= independently deployable customer product
```

## What K-Nex is

- a conservative platform and contract system on Payload;
- exact-version reusable Platform Plugins, Hot Applications, Theme Skins, integrations, and presets;
- a deterministic customer application compiler and release discipline;
- a live application runtime with isolated server logic and remote UI;
- a zero-downtime deployment path for compatible full-plugin releases;
- a platform-owned component/data/form/page system and canonical visual document model;
- a central authorization and administration control plane delivered after the runtime substrate;
- an independently deployable customer product model rather than initial shared tenancy.

## What K-Nex is not

- a shared customer database/runtime in V1;
- copied/patched core source per customer;
- a database portability layer above Payload;
- arbitrary NPM execution inside the running web process;
- an assumption that every existing deep plugin can be hot-injected;
- arbitrary visual JavaScript, SQL, Payload queries, host imports, global CSS, or unrestricted URLs;
- an untrusted-code sandbox implemented only by TypeScript/package exports;
- a promise that every database migration has zero downtime;
- a generic retained-schema uninstall promise for schema-owning plugins.

## Extension delivery classes

### Platform Plugin

Existing full packages may own Payload schema, migrations, services, routes, jobs, native UI, providers, builders, and executable themes. They are statically composed and frozen into the application artifact.

Package add, upgrade, and removal build a new immutable release. A stable gateway and separate deployment supervisor can promote a compatible release blue/green while the old release continues serving.

### Hot Application

A signed `app.*` bundle uses fixed host contracts. It may contribute declarative screens/navigation/settings, isolated logic functions, remote UI, sources/actions/tools through fixed gateways, app storage, events/schedules through bounded host APIs, assets, localization, and permission/template descriptors.

It cannot mutate host Payload config, import into the main Node process, use raw database/Docker credentials, inherit ambient secrets, or execute unrestricted network calls.

### Theme Skin

A signed `skin.*` artifact contains bounded tokens, palettes, recipes, scoped CSS, and approved assets. It activates as an immutable runtime generation. Full executable `theme.*` packages remain Platform Plugins.

## Plugin Manager experience

The product presents one extension catalog but clearly reports execution and availability:

```text
Hot Application / Theme Skin  Install live
Platform Plugin               Install with live deployment when eligible
Incompatible migration        Maintenance required
```

The manager downloads in the background, verifies immutable artifacts, stages and warms a generation, then atomically activates an app pointer or deployment traffic target. It never runs a package manager in the host process.

## Payload commitment

Payload remains the strategic V1 application framework for static collections, access controls, request context, jobs, versions/drafts, admin integration, migrations, and Postgres.

Hot Applications do not pretend Payload config is mutable. They use a separate runtime substrate and generic host capabilities. Replacing Payload remains a platform migration, not a provider switch.

## Customer ownership

A customer owns:

```text
k-nex.app.json and exact lockfile
bounded source-controlled customer registration
brand assets and approved fonts
final Platform Plugin migrations and release fixtures
CMS content, layouts, theme profiles/skins, settings
roles/grants/assignments after Phase 10
Hot Application storage and generation state
deployment resources, secrets, backups, logs, alerts
artifact and extension release cadence
```

Shared packages/artifacts own reusable behavior and versioned contracts.

## UI and data vision

Platform Plugins and Hot Applications can expose permission-aware navigation, screens/blocks, bounded sources/actions/tools, realtime invalidation, and explicit extension slots.

Generic components consume stable output contracts. Raw Payload collections are not automatically builder sources. Hot Application UI composes allowlisted host components through a remote protocol; it does not execute arbitrary host React modules.

## Fixed shell and runtime hosts

The fixed shell owns authentication, router, sidebar/top bar hosts, global dialogs/notifications, security/system screens, `/apps/:appId/*`, remote UI host, and app-local error boundaries.

CMS/workspace canvases remain declarative. Public and authenticated authority IDs are separate.

## Build-time and runtime boundary

Build/release time:

```text
Platform Plugin packages/versions
Payload config and customer migrations
static registration and native UI
process/infrastructure topology
full Theme Packages
```

Runtime generation time:

```text
verified Hot Application bundles
verified Theme Skins
active generation pointers
app metadata/settings/storage
published content/layout/theme profiles
roles and assignments after Phase 10
```

Runtime values cannot select arbitrary package paths or mutate host schema/imports.

## Success criteria

K-Nex succeeds when it can:

- generate and upgrade independent customer applications deterministically;
- install/update/rollback a signed Hot Application without host restart;
- contain runner/UI failure to one application;
- install/update/rollback a Theme Skin live;
- promote a compatible full Platform Plugin release with continuous successful traffic;
- refuse a false zero-downtime claim for incompatible migrations;
- enforce source/record/field and host-capability authorization;
- recover after lost realtime/activation invalidations;
- restore exact static and runtime extension inventory;
- identify every affected customer release through verifiable fleet evidence.

## Current roadmap boundary

```text
Gate 9   accepted Dynamic Application Runtime and Zero-Downtime Delivery
Gate 10  accepted RBAC, Authorization, and Extension Bootstrap
Gate 11  System Settings and Extension Operations
then     explicit CRM/CMS productization decision
```
