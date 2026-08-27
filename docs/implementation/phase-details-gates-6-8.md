# Detailed Implementation Plan — Gates 6–8

- **Status:** planned; authoritative for future Gates 6–8
- **Entry:** Gate 5 result records `GO PHASE 6` and is merged
- **Supersedes:** future Gate 6 and Gate 7 sections in `phase-details-gates-1-7.md`
- **Architecture:** [`../33-plugin-platform-hardening-and-reference-sales.md`](../33-plugin-platform-hardening-and-reference-sales.md), [`../34-headless-component-system.md`](../34-headless-component-system.md)
- **ADR:** [`ADR-0020`](../adr/0020-reference-sales-and-headless-component-system.md)

## Governing product constraint

Until Gate 8 passes:

```text
first-party domain modules allowed: module.sales only
new logistics/restaurant/inventory/budgeting modules: prohibited
customer fixtures: Sales-based composition only
```

The purpose of Gates 6–8 is to turn the existing executable foundation into a repeatable plugin-authoring and customer-application factory. Domain expansion is not an exit criterion.

# Phase 6 — Plugin Platform Hardening and Sales Reference Module

## Objective

Freeze a complete, learnable, testable plugin authoring contract and prove it through one reference module.

```text
complete contribution taxonomy
+ stable authoring boundaries
+ settings/routes/navigation/default pages
+ browser query/action factories
+ UI/Puck contribution contract
+ Sales reference implementation
+ plugin conformance command
= plugin foundation ready for new domain modules
```

## Explicit non-goals

```text
second domain module
large component catalog
full commercial CRM scope
package marketplace
public third-party plugin distribution
production fleet operations
full retained-schema uninstall compatibility
```

### P6.1 — Freeze the complete plugin contribution taxonomy

#### Deliver

- one typed contribution-category registry;
- manifest declarations for every supported category;
- declared-versus-actual inventory extensions;
- required/optional category semantics;
- canonical IDs and ownership rules;
- generated schema and valid/invalid fixtures.

Categories:

```text
schema, migrations, services, permissions, settings,
sources, actions, tools, events, jobs, realtime topics,
components, blocks, routes, navigation, page templates,
localization, health/audit, lifecycle, testing metadata
```

#### Acceptance

```text
all categories are machine-readable
unknown/duplicate/undeclared contribution fails
database content cannot create executable categories
Zod/AJV parity and deterministic generation pass
```

### P6.2 — Define the plugin authoring and package-entrypoint API

#### Deliver

- public authoring imports using existing packages where possible;
- strict separation of `manifest/contracts/server/browser/ui/migrations/testing`;
- capability-scoped registration helpers;
- no ambient service container;
- no third-party type leakage;
- reference package skeleton derived from Sales.

#### Acceptance

```text
browser and UI entrypoints cannot import server/Payload code
contracts cannot import React/Puck/Payload/MCP/query-engine types
server binding absent from static descriptor fixtures
packed package exports exactly the declared entrypoints
```

### P6.3 — Implement plugin settings, permissions, routes, and navigation contracts

#### Deliver

```text
versioned strict settings schema
secret-reference fields
permission and policy metadata
route IDs with typed parameters
navigation items resolved by route and permission
runtime settings revision and migration
```

#### Required failures

```text
settings create executable contribution
secret value enters settings document
uninstalled route target
navigation item bypasses permission
runtime setting changes topology/import graph
```

### P6.4 — Implement default page-template contracts and seed semantics

#### Deliver

- immutable plugin template ID/version;
- canonical UiDocument template;
- route/surface/profile/permission metadata;
- capability preflight;
- idempotent instantiate operation;
- customer-owned instance semantics;
- explicit compare/adopt flow for later template versions.

#### Required proof

```text
first install creates one instance
retry creates no duplicate
customer edit is never overwritten by package upgrade
missing source/block/action fails with diagnostic
failed migration preserves last valid instance
```

### P6.5 — Implement standard browser query and action factories

#### Deliver

```text
defineSourceQuery
defineActionMutation
library-neutral typed definitions
standard request cancellation and result states
stable query identity
source/action invalidation metadata
URL-safe view-state serialization
```

Concrete helper names may change during this task; final names are frozen at closeout.

#### Boundaries

- no raw Payload client in module UI;
- no plugin-owned parallel cache transport;
- no actor/record scope in browser-authored query state;
- no query-library type in persisted contracts.

### P6.6 — Implement component, Puck-block, route, and page contribution registration

#### Deliver

```text
component descriptor + renderer binding
canonical props schema
source/action binding policy
surface/audience/permission metadata
loading/empty/error state requirements
Puck bridge reconciliation
route/page-template contribution inventory
```

Every component must render outside the editor. Puck may not own the renderer, persisted props, or source/action authority.

### P6.7 — Complete `module.sales` as the reference plugin

Sales must exercise at least one contribution in every supported mandatory category and selected optional category.

Minimum reference surface:

```text
Payload:
  tasks and opportunities

sources:
  sales.tasks
  sales.total-potential-revenue
  sales.opportunities

actions:
  sales.task.create
  sales.task.update
  sales.opportunity.stage.update

tools:
  sales.tools.search-tasks
  sales.tools.create-task

events/realtime:
  task changed
  opportunity changed

settings:
  one pipeline/default-page setting

components/blocks:
  revenue metric
  task table
  opportunity list/detail
  quick-create task form

routes/pages:
  overview
  tasks
  opportunities
  settings
```

The domain remains intentionally small. The task is complete when it exercises platform contracts, not when it matches a mature CRM product.

### P6.8 — Build the plugin conformance kit

#### Deliver

Planned command:

```text
pnpm plugin:check modules/sales
```

It runs:

```text
manifest/schema fixtures
package export and bundle boundaries
deterministic inventory reconciliation
fresh migration and boot
settings and permission attacks
source/action/tool/event/realtime checks
component runtime and Puck parity
default-page seed idempotency
accessibility smoke
packed-package reproducibility
```

The command must prove that every named test actually ran and must fail on missing evidence.

### P6.9 — Prove install, enable, disable, and re-enable for Sales

#### Deliver

```text
lifecycle state model
install and seed plan
enable/disable behavior
re-enable readiness
source/action/tool/UI availability reconciliation
data preservation on disable
reference scan before destructive operations
```

Package removal, upgrade, archive/export, purge, and restore remain Gate 8.

### P6.10 — Close Gate 6 and freeze the pre-v1 authoring contract

Create:

```text
docs/implementation/phase-6-result.md
pnpm gate:6
```

#### Exit

- Sales passes the complete conformance suite;
- a second module would not need a new platform mechanism;
- plugin author documentation links only to tested contracts/fixtures;
- obsolete pre-v1 helpers are removed;
- `status.md` advances to P7.1 only on project-manager PASS.

#### Gate decision

```text
GO PHASE 7
REWORK PLUGIN AUTHORING CONTRACT
REJECT GENERAL PLUGIN SURFACE
```

# Phase 7 — Comprehensive Headless Component System

## Objective

Ship a broad platform-owned component library and data experience that plugins can compose without implementing accessibility, interaction, query state, table behavior, or theme-specific UI.

## Explicit non-goals

```text
new domain module
arbitrary CSS/component marketplace
full design-tool editor
complete-product WCAG certification
native mobile component system
```

### P7.1 — Freeze component taxonomy, slot model, and package boundaries

#### Deliver

- Component Gallery 60-item inventory;
- additional K-Nex utility inventory;
- component maturity and version rules;
- stable semantic slots/data-state attributes;
- package/export boundaries;
- small theme ABI versus compound-component rule.

#### Acceptance

Every inventory item has an owner, package target, behavior source, test class, and implementation disposition.

### P7.2 — Foundation, layout, content, and feedback components

Implement the baseline semantic components and utilities:

```text
Box, Stack, Inline, Grid, Container, Section,
Text, Heading, Link, List, Icon, Image, Avatar,
Card, Badge, Alert, Status, Separator, Skeleton,
Spinner, Progress, EmptyState, ErrorState,
VisuallyHidden, Header, Footer, Hero, Quote, File, Video
```

Use native HTML where it supplies the correct semantics.

### P7.3 — Form and input component family

Implement:

```text
Form, Fieldset, FormField, Label, FieldDescription, FieldError,
TextInput, Textarea, NumberInput, PasswordInput, SearchInput,
Checkbox, RadioGroup, Toggle, Select, MultiSelect, Combobox,
TagInput, Slider, Stepper, Rating, ColorPicker,
DateInput, DatePicker, DateRangePicker, TimeInput,
FileUpload, FormActions, UnsavedChangesGuard
```

Select the form engine only after the Sales create/edit spike. Its types remain adapter-local.

### P7.4 — Navigation, disclosure, and overlay family

Implement:

```text
Navigation, Breadcrumbs, Pagination, Tabs, SegmentedControl,
ButtonGroup, Toolbar, DropdownMenu, TreeView, SkipLink,
Accordion, Modal/Dialog, Drawer, Popover, Tooltip, Carousel, Toast
```

Nested overlays, focus restoration, escape behavior, portal boundaries, collision handling, and route semantics require browser tests.

### P7.5 — Data/content/editor adapters

Implement or accept bounded adapters for:

```text
semantic Table
DataList and KeyValueList
RichTextRenderer
RichTextEditor adapter
VirtualList
media/file presentation
```

Rich text must have versioned editor-state, sanitization, migration, and publication boundaries. It cannot introduce arbitrary HTML/script authority.

### P7.6 — Build the standard DataTable/DataGrid system

Required capabilities:

```text
registered table.records@1 source
required/optional fields
offset and cursor pagination
search/filter/facet/sort
stable query identity
column visibility/order/size/density
row selection and permission-aware bulk actions
row actions/detail panel
URL view state without authority data
loading/empty/error/stale/refetching states
realtime invalidation and authoritative refetch
optional virtualization
semantic Table default and explicit DataGrid mode
```

Sales tasks is the reference dataset.

### P7.7 — Build page templates and Sales default pages

Implement:

```text
DashboardPage
IndexPage
DetailPage
CreatePage
EditPage
SettingsPage
WizardPage
BuilderPage
```

Use them to deliver Sales overview, tasks, opportunities, and settings pages. No page may use raw Payload access or customer-theme imports.

### P7.8 — Build the generic and Sales Puck block library

Generic blocks:

```text
Stack, Grid, Section, Heading, Text, Card,
Alert, Tabs, Accordion, Metric, DataTable, Form, EmptyState
```

Sales blocks:

```text
revenue metric
task table
opportunity list/detail
task quick-create
pipeline status
```

Editor and runtime use the same component definitions. Round-trip, profile policy, missing component, and source/action authority tests are required.

### P7.9 — Accessibility, SSR/hydration, theme, and interaction matrix

Run the full component-state matrix under Minimal and Neobrutalism:

```text
default, hover, focus, pressed, selected, disabled,
read-only, pending, invalid, empty, error, high contrast,
reduced motion, RTL, long text, localization
```

Evidence:

```text
Testing Library user interactions
real Chromium keyboard/focus/portal journeys
ARIA snapshots
SSR/hydration parity
screen-reader smoke record
nested theme roots and live switching
```

### P7.10 — Performance, bundle, coverage audit, and closeout

Create:

```text
docs/implementation/phase-7-result.md
pnpm gate:7
```

#### Exit

- all 60 Component Gallery families have an executable disposition;
- all K-Nex utilities used by Sales are implemented;
- DataTable and forms use standard source/action gateways;
- component packages remain style-agnostic and tree-shakeable;
- themes do not reimplement compound behavior;
- Sales pages and Puck blocks pass accessibility/performance gates.

#### Gate decision

```text
GO PHASE 8
REWORK COMPONENT SYSTEM
REDUCE COMPONENT COVERAGE WITH EXPLICIT DECISION
```

# Phase 8 — Lifecycle, Application Factory, Release, and Fleet Safety

## Objective

Prove that the complete platform and Sales reference plugin can be generated, upgraded, operated, restored, and patched across independent customer applications without introducing new domain modules.

### P8.1 — Freeze package release and compatibility boundaries

Deliver exact package versioning, peer compatibility, release manifests, integrity, and support-window policy for the pre-v1 line.

### P8.2 — Implement plugin/package upgrade planning and customer-owned migrations

Deliver:

```text
current → target graph plan
migration predecessor/current revisions
source/action/tool/block/theme/template migrations
settings migrations
preflight and dry-run diagnostics
```

Sales is the sole schema-owning upgrade fixture.

### P8.3 — Prove migration concurrency and stale-artifact readiness fences

Use PostgreSQL advisory locking, expected predecessor checks, release revision records, and readiness denial for stale artifacts.

### P8.4 — Implement bounded archive/export, purge, backup, and restore

Evaluate the official Payload Import/Export plugin only as an adapter for bounded administrator transfer. It does not replace database backup, schema migration, legal retention, or full restore.

Prove:

```text
archive/export versioning and access
backup exists and is restorable
reference/dependency scan
purge plan and explicit authorization
failed purge rollback
restore into a clean environment
```

### P8.5 — Implement `create-knex-app` and composition plan/apply

The CLI must support:

```text
Sales reference preset
plugin and theme selection
Payload Postgres adapter selection
local Docker or external DATABASE_URL
exact dependency installation
manifest/config generation
migration and readiness plan
initial default-page instantiation
add/disable/enable/upgrade planning
```

No runtime package installation is introduced.

### P8.6 — Prove two Sales-only customer applications

Create two independent fixtures using the same released platform/Sales packages but different:

```text
theme/profile
Sales settings
default-page choices
permissions/layouts
lockfile and release cadence
```

Do not add Cargo or Restaurant modules. The goal is composition reuse, not domain breadth.

### P8.7 — Produce verifiable release evidence

```text
SBOM
source/lock/resolved-graph digests
artifact/container digest
signed provenance
full-SHA workflow identity
```

### P8.8 — Produce deployment receipts and runtime inventory

Each customer fixture records/verifies:

```text
deployed artifact
exact packages and plugin graph
migration revision
settings/template revisions without secrets
runtime health/readiness
```

### P8.9 — Prove fleet query, patch propagation, previous-release upgrade, and restore

Required scenarios:

```text
one customer upgrades while another stays on supported prior release
vulnerable package range identifies every affected deployment
security patch PR/update is generated for both
previous release upgrades through reviewed migrations
backup restore and redeploy recover the expected inventory
```

### P8.10 — Close the platform-foundation program

Create:

```text
docs/implementation/phase-8-result.md
pnpm gate:8
```

#### Exit

- plugin authoring contract is complete through Sales;
- comprehensive component system is available to plugins;
- customer application generation and upgrades are repeatable;
- lifecycle/destructive operations are evidence-backed;
- two independent Sales-based customers prove reuse and fleet operations;
- production roadmap may now select the next real domain module.

#### Gate decision

```text
PLATFORM FOUNDATION ACCEPTED
REWORK APPLICATION FACTORY OR LIFECYCLE
DO NOT START DOMAIN EXPANSION
```

# Post-Gate 8 boundary

Only after Gate 8 project-manager PASS may a product roadmap choose among:

```text
full CRM expansion
CMS product features
logistics/driver/dispatch/live tracking
restaurant/QR menu/inventory/budgeting
AI assistant productization
commerce/payments
third-party plugin distribution
```

The chosen module begins from the Sales package structure and must pass the same plugin and component conformance gates.