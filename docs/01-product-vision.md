# Product Vision and Boundaries

## Vision

K-Nex is a modular application platform for repeatedly delivering custom business products without rebuilding foundational backend, UI composition, infrastructure integration, and project scaffolding for every customer.

A customer may need a familiar combination such as CMS and CRM, or a vertical combination such as:

- logistics: shipments, dispatch, live tracking, driver operations, public tracking;
- restaurant: CMS, QR menu, inventory, recipe costing, budgeting;
- agency: CMS, forms, CRM, proposals, reporting;
- another industry with its own domain modules, integrations, and user-facing applications.

The result delivered to each customer is an independent product with its own:

```text
repository
database and storage
deployment and release history
modules and infrastructure providers
public website and authenticated workspace
builder content/layouts
theme packages and runtime theme profiles
customer extensions and overrides
```

The economic goal is to reuse tested capability logic and UI contracts while preserving the freedom to design and operate every customer product differently.

## Product model

K-Nex follows a **software product line** and **application factory** model:

```text
shared platform contracts
+ trusted versioned plugins
+ manifest-driven application composition
+ generated customer shell
+ customer data, design, extensions, and infrastructure
= independently deployed customer product
```

The product factory is operated through:

```text
trusted plugin catalog
create-k-nex-app
k-nex.app.json
k-nex.config.ts
k-nex CLI
```

The CLI can create a repository, select plugins/themes/providers, validate dependencies, generate static registries, prepare database/Docker choices, and later plan plugin additions, removals, and upgrades.

## What K-Nex is

- A small domain-neutral platform core.
- A trusted ecosystem of versioned modules, providers, builders, themes, and integrations.
- A manifest and resolver for dependencies, compatibility, capabilities, permissions, events, jobs, UI, and migrations.
- A project generator and ongoing application-management CLI.
- A style-agnostic UI contribution model for navigation, screens, blocks, data sources, and actions.
- A shared visual composition architecture for CMS pages and workspace dashboards/overviews.
- A runtime theme system backed by installed code packages and validated database profiles.
- A repeatable method for operating separate customer applications.
- A foundation on which Payload is the provisional first backend/application host.

## What K-Nex is not

- A shared multi-tenant SaaS control plane in the initial product.
- A single database containing all customers.
- A literal fork of platform core for each customer.
- A universal final design imposed on every customer.
- A runtime npm marketplace that downloads executable packages from the admin panel.
- A low-code system that allows arbitrary JavaScript, SQL, server imports, secrets, or global CSS in builder documents.
- A promise that every plugin can be enabled/disabled without build/deploy/migration implications.
- A reason to place all business logic inside Payload hooks.
- A promise that every operational transaction screen is fully drag-and-drop in V1.

## Product identity

The product name is **K-Nex**. Tool/package naming avoids collision with the existing `knex` database library ecosystem:

```text
create-k-nex-app
k-nex CLI
k-nex.app.json
@k-nex/* working package scope
```

The exact package scope remains open until registry ownership is finalized. Stable persisted identities use plugin IDs such as `module.crm` and `theme.neobrutalism`, so package location can change without changing product identity.

## Customer ownership boundary

A customer application owns:

- exact plugin package versions and application manifest;
- separate repository, database, storage, secrets, and deployment;
- final customer migrations and upgrade history;
- brand assets and approved fonts;
- installed theme selection and customer theme profiles;
- public and admin theme configuration;
- customer-specific components, render overrides, and CSS where deliberately needed;
- local extensions and integrations;
- role definitions and organization-specific policy;
- public routes, mobile/driver apps, and infrastructure;
- runtime CMS content, workspace layouts, theme revisions, and operational data.

Shared packages own reusable contracts and behavior.

## Core boundary

The platform core should remain small and conservative. It can own:

```text
plugin/capability resolution
service, permission, event, job, audit, and health foundations
actor/request context
framework contribution composition
static inventory contracts
shared testing utilities
```

Core does not own:

```text
CMS pages
CRM contacts/opportunities
shipments/drivers/vehicles
restaurant menu/stock/budget
customer colors/fonts/logos
a visual editor engine implementation
one concrete storage/realtime/email provider
customer-specific policy
```

CMS, CRM, builder, themes, realtime, and vertical concepts are plugins or separate foundational UI packages.

## Plugin ecosystem

Plugin is the umbrella installable concept.

### Modules

Reusable application/domain capability:

```text
CMS
CRM
forms
logistics core
dispatch
driver
live tracking
restaurant core
QR menu
inventory
budgeting
```

### Providers

Replaceable infrastructure capability:

```text
Postgres database
WebSocket realtime
Redis-backed realtime
local/S3 storage
email delivery
maps/routing
queue/event durability
```

### Builder

Adapter between K-Nex UI/block/layout contracts and a visual editing engine. Puck is the provisional first provider.

### Themes

Installed design-system packages such as Minimal, Neobrutalism, or Glassmorphism.

### Integrations

Reusable bridges between modules/providers or external services.

### Presets

CLI recipes such as Logistics or Restaurant that expand into explicit plugin selections.

## UI product vision

Enabled modules can provide style-agnostic:

```text
navigation items
fixed operational screens
composable blocks
headless hooks/controllers
data-source descriptors
action descriptors
realtime bindings
extension slots
```

The customer-selected design system and theme render these capabilities in the customer's visual language.

### Fixed shell

The application shell remains stable:

```text
sidebar host
top bar
router
authentication boundary
global notifications/dialogs
system/security screens
```

Sidebar content is generated from enabled modules and filtered by permissions. Customers can use allowed labels/grouping/order overrides without breaking security boundaries.

### Composable canvas

Initial composable surfaces:

```text
public CMS pages
dashboards
module overviews
reports
role workspaces
personal dashboards
```

Operational workflow screens such as shipment assignment or inventory adjustment remain module-owned in V1, with controlled extension slots.

## Shared builder vision

The same canonical block/layout architecture powers:

### CMS profile

```text
public-safe blocks
SEO/localization
draft/preview/publish
public theme
content page routing
```

### Workspace profile

```text
authenticated data/actions
permission filtering
customer/role/user layouts
realtime widgets
admin theme
```

One engine does not imply one policy. Each profile controls palette, audience, data, actions, publication, and layout scope.

Puck is the provisional first adapter. K-Nex contracts remain engine-independent so Craft.js or another engine can be evaluated if Puck fails the POC.

## Theme product vision

A theme is not merely a CSS file and not arbitrary database CSS.

```text
theme package
  token schema, palettes, semantic primitives, component variants,
  structural CSS, accessibility validation, migrations

theme profile
  selected installed theme, adjustable validated values,
  draft/published revisions stored in customer DB
```

Customers can choose and adjust installed themes at runtime. Installing a new theme remains a code/package/deploy operation.

Admin and public themes are separate so an expressive website does not force the same density/style onto operations users.

## Build-time versus runtime boundary

### Build-time/source-control

```text
install/remove plugin package
select provider/builder/theme packages
schema-owning module composition
generated static imports/routes/registries
Docker/infrastructure templates
customer code override
```

### Runtime database configuration

```text
active installed theme and token profile
published CMS pages
published customer/role/user layouts
plugin settings that do not alter schema/imports
feature options within an installed module
```

Database values never choose arbitrary package paths or executable code.

## Reuse rule

A feature begins in the narrowest correct location.

1. A one-customer requirement starts as a customer extension/override.
2. When a second similar requirement appears, compare real business rules.
3. Extract reusable behavior into a module/provider/integration/theme only when the stable common contract is understood.
4. Customer-specific policy remains local.

A large extension is not automatically reusable; reuse is proven by repeated need and stable semantics.

## Success criteria

The platform is successful when these become routine:

### Application creation

- Run `create-k-nex-app` and answer module/theme/database/Docker questions.
- Generate a start-ready, reviewable customer repository.
- Create cargo and restaurant products with different plugin graphs and visual languages.

### Composition

- Add `module.logistics-driver`; automatically resolve `logistics.domain` and `realtime.gateway` requirements.
- Detect incompatible versions, duplicate routes/slugs/blocks, and provider conflicts before boot.
- Change a provider without rewriting consumer modules.

### UI and themes

- Enabled modules automatically contribute permission-aware menus and blocks.
- The same CRM block renders correctly in Minimal and Neobrutalism themes.
- The same builder architecture creates public CMS pages and authenticated dashboards.
- A theme palette/token change publishes without application redeployment.
- A new theme package installs through source-control/deployment review.

### Upgrades and operations

- Upgrade one customer while another remains on older compatible versions.
- Fix a shared security/logic bug once and release it as a package.
- Generate/review customer-specific final migrations.
- Disable/uninstall a plugin without silently deleting data.
- Query fleet inventory to identify affected customer versions.

### Security and trust

- Direct API/action calls remain unauthorized even if UI metadata is manipulated.
- Builder/theme input cannot execute arbitrary code or access secrets.
- Public blocks use explicit public projections.
- Driver realtime subscriptions enforce actor/domain scope.

## Primary constraints

- TypeScript-first development.
- Trusted private package distribution.
- Exact dependency versions in customer applications.
- Separate repository/deployment/database per customer.
- Postgres as the supported V1 production default.
- Static generated plugin/provider/UI/theme registries.
- No runtime package installation.
- Server-owned authorization and business transactions.
- Style-agnostic shared UI with customer-owned final design.
- Payload/Puck remain provisional until POC evidence supports acceptance.

## Long-term direction

The architecture should later allow—but does not currently require:

- additional builder engines;
- third-party reviewed plugin marketplace/signing;
- optional centralized fleet/control tooling;
- more deployment providers;
- native/driver/mobile surface packages;
- record/form/email/report builder profiles;
- additional database providers after compatibility testing.

These extensions should build on stable manifest, plugin, capability, UI, theme, migration, and customer-isolation contracts rather than weakening them.
