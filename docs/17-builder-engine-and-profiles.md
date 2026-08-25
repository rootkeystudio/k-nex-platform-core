# Builder Engine and Profiles

## Decision summary

K-Nex will use one visual-composition architecture for both public CMS pages and authenticated workspace pages.

The first implementation candidate is Puck, but domain modules and stored K-Nex contracts remain independent of Puck through an adapter package.

```text
K-Nex UI contracts
        │
        ▼
K-Nex builder runtime
        │
        ▼
@k-nex/builder-puck
        │
        ▼
Puck editor engine
```

The same engine is exposed through distinct **builder profiles** with different component palettes, data/action policies, publication rules, and security boundaries.

## Why one engine

Using one engine and one persisted K-Nex layout contract avoids building unrelated authoring systems for:

- website pages;
- CMS landing pages;
- dashboards;
- module overview pages;
- report pages;
- role workspaces;
- personal dashboards.

Shared capabilities include:

- component discovery;
- drag and drop;
- nested layout primitives;
- field editors;
- component versioning;
- validation;
- preview;
- draft and published revisions;
- missing component diagnostics;
- theme-aware rendering.

The profile layer prevents “one engine” from becoming “one unrestricted policy.”

## Builder profiles

### CMS profile

Purpose:

- author public or authenticated content pages;
- manage URL/slug metadata;
- preview and publish content;
- compose brand-oriented blocks;
- support localization and SEO;
- render through the public theme.

Typical blocks:

```text
hero
rich text
image/media
features grid
CTA
contact/lead form
tracking form
menu category
branch selector
FAQ
testimonials
module-provided public projections
```

CMS profile policy:

```ts
export const cmsBuilderProfile = defineBuilderProfile({
  id: 'cms',
  surfaces: ['cms', 'public'],
  pageKinds: ['content-page', 'landing-page', 'public-form'],
  allowAnonymousBlocks: true,
  allowAuthenticatedDataSources: false,
  allowUserOverrides: false,
  publication: 'draft-preview-publish',
  themeSurface: 'public',
})
```

### Workspace profile

Purpose:

- compose authenticated dashboards and overview/report pages;
- bind registered permission-aware data sources;
- invoke registered actions;
- optionally receive realtime updates;
- support customer, role, and user layout scopes;
- render through the admin theme.

Typical blocks:

```text
metric
chart
data table
activity feed
pipeline summary
unassigned shipments
live vehicle map
inventory warning
budget variance
recent content
quick action
```

Workspace policy:

```ts
export const workspaceBuilderProfile = defineBuilderProfile({
  id: 'workspace',
  surfaces: ['workspace'],
  pageKinds: ['dashboard', 'module-overview', 'report'],
  allowAnonymousBlocks: false,
  allowRegisteredDataSources: true,
  allowRegisteredActions: true,
  allowRealtime: true,
  layoutScopes: ['platform', 'customer', 'role', 'user'],
  publication: 'scoped-revisions',
  themeSurface: 'admin',
})
```

### Future profiles

Possible future profiles:

```text
record-page       controlled record detail composition
form              schema-driven business form composition
email             HTML/email-safe block composition
driver-dashboard  limited mobile/driver layout composition
report-template   export/PDF-oriented composition
```

Each profile requires a deliberate security, rendering, and persistence policy. Enabling a profile is not only a palette change.

## Shared block contract

Domain modules export K-Nex block definitions:

```ts
export const leadFormBlock = defineUiBlock({
  id: 'crm.public-lead-form',
  version: 1,
  pluginId: 'module.crm',
  surfaces: ['public', 'workspace'],
  audiences: ['anonymous', 'authenticated'],
  fields: {
    title: field.text(),
    submitLabel: field.text(),
    source: field.text({ hidden: true }),
  },
  action: 'crm.public-lead.submit',
  renderer: LeadForm,
})
```

The builder adapter translates the generic field schema and constraints into Puck configuration. The same block registry is used by the runtime renderer.

## Engine abstraction

Draft contract:

```ts
export interface BuilderEngineAdapter<TEditorProps = unknown> {
  id: string
  capabilityVersion: string

  createEditor(input: {
    profile: ResolvedBuilderProfile
    registry: ResolvedUiRegistry
    document: UiDocument
    permissions: BuilderPermissionContext
    theme: ResolvedTheme
    onChange(document: UiDocument): void
    onPublish?(document: UiDocument): Promise<void>
  }): React.ComponentType<TEditorProps>

  validateDocument(input: {
    profile: ResolvedBuilderProfile
    registry: ResolvedUiRegistry
    document: UiDocument
  }): BuilderValidationResult

  migrateEngineDocument?(input: {
    document: unknown
    fromVersion: number
    toVersion: number
  }): UiDocument
}
```

The persisted canonical document should be K-Nex-owned. If an engine requires additional internal state, the adapter either derives it or stores a versioned engine metadata section that can be migrated without leaking engine-specific types into module contracts.

## Puck adapter

Working package:

```text
@k-nex/builder-puck
```

Responsibilities:

- map K-Nex block definitions to Puck component configuration;
- map K-Nex field definitions to Puck fields;
- expose the editor inside the fixed K-Nex application shell;
- apply profile-specific palette filtering and permissions;
- render editor preview through the K-Nex runtime and selected theme;
- convert Puck output into canonical K-Nex documents;
- integrate draft/publish/revisions with Payload storage;
- expose Puck-specific diagnostics only inside the adapter;
- support nested layout primitives through controlled slots;
- provide component/version migration hooks.

Non-responsibilities:

- defining CRM, logistics, restaurant, or customer blocks;
- authorizing domain data;
- supplying a customer's final theme;
- storing secrets;
- executing arbitrary user code;
- installing plugins from the editor.

## Payload integration

The builder storage/editor integration can use or learn from an existing Payload–Puck plugin, but K-Nex should own the outer contracts.

Potential package split:

```text
@k-nex/builder-puck             engine adapter and editor UI
@k-nex/payload-builder-storage  Payload collections/globals/endpoints/revisions
@k-nex/module-cms               page/content lifecycle
@k-nex/ui-runtime               canonical renderer and layout resolution
```

The third-party Payload–Puck package may accelerate the CMS POC. K-Nex must be able to replace or wrap it if its data model, editor route, permission model, or upgrade cycle becomes limiting.

## Fixed shell integration

The editor appears inside the application shell. The builder edits only the configured canvas region.

```text
┌───────────────────┬────────────────────────────────────────┐
│ fixed sidebar     │ fixed top bar                          │
│                   ├────────────────────────────────────────┤
│ module navigation │ builder toolbar / preview controls     │
│                   ├────────────────────────────────────────┤
│                   │                                        │
│                   │ editable content canvas                │
│                   │                                        │
└───────────────────┴────────────────────────────────────────┘
```

The builder cannot replace:

- authentication;
- global router;
- shell permission boundary;
- system navigation host;
- global dialogs/notifications;
- security settings.

This preserves supportability while allowing extensive content customization.

## Layout primitives

The initial cross-profile layout palette should remain small and semantic:

```text
Page
Section
Container
Stack
Grid
Columns
Tabs
Accordion
Divider
Spacer with bounded token values
```

These primitives consume design-system tokens. Users do not edit arbitrary CSS properties.

Example constraints:

```ts
export const gridBlock = defineUiBlock({
  id: 'layout.grid',
  surfaces: ['public', 'workspace'],
  fields: {
    columns: field.responsiveNumber({ min: 1, max: 12 }),
    gap: field.token({ group: 'spacing' }),
    align: field.enum({ values: ['start', 'center', 'stretch'] }),
  },
  slots: {
    content: {
      allowedCategories: ['content', 'data', 'action'],
      maximumDepth: 6,
    },
  },
})
```

No freeform `style` object is persisted in V1.

## Field system

Generic field types:

```text
text
textarea
richText
number
boolean
enum
colorToken
spacingToken
typographyToken
asset
link
resource
resourceList
dataSource
action
slot
responsiveNumber
object
group
```

The profile and block definition determine which fields are allowed. A module can register a custom field editor through a documented UI extension point, but stored values still require a serializable schema.

## Public-safe and authenticated blocks

A block must declare audience and data policy.

### Static content block

```ts
surfaces: ['public', 'workspace']
audiences: ['anonymous', 'authenticated']
dataPolicy: 'static'
```

### Public projection block

```ts
surfaces: ['public']
audiences: ['anonymous', 'signed-public-session']
dataSource: 'logistics.public-tracking'
```

### Authenticated business block

```ts
surfaces: ['workspace']
audiences: ['authenticated']
permission: 'crm.opportunities.read'
dataSource: 'crm.pipeline.summary'
```

The builder palette excludes blocks that the current profile, audience, installed plugin graph, or editor permission does not allow.

## Action safety

Builder data can reference only registered actions:

```text
crm.public-lead.submit
cms.newsletter.subscribe
logistics.tracking.lookup
crm.contact.create
logistics.shipment.assign
```

The first three may be public-safe with rate limits and narrow input schemas. The last two are authenticated and permission-protected.

Disallowed in builder documents:

- arbitrary fetch URLs;
- inline JavaScript;
- arbitrary server function names;
- database queries;
- environment variable references;
- raw permission predicates.

## Data storage

Suggested storage concepts:

```text
UiPage
UiLayout
UiRevision
UiPublication
UiMigrationRecord
```

CMS pages may store builder documents as part of the page collection's versioned content. Workspace layouts may use a separate versioned collection to support customer/role/user scopes.

Example workspace layout record:

```ts
interface WorkspaceLayoutRecord {
  pageId: string
  scopeType: 'platform' | 'customer' | 'role' | 'user'
  scopeId?: string
  baseLayoutId?: string
  profileId: 'workspace'
  documentVersion: number
  document: UiDocument
  status: 'draft' | 'published' | 'archived'
  revision: number
  createdBy: string
  publishedBy?: string
}
```

## CMS page lifecycle

```text
create page metadata
  → compose builder document
  → validate component/data/action references
  → save draft revision
  → preview with public theme and draft authorization
  → publish page + builder revision atomically
  → invalidate relevant cache/projection
```

Publishing must not make a page visible when its builder document fails validation or references unavailable components.

## Workspace lifecycle

```text
open customer/role layout draft
  → compose permitted blocks
  → preview as selected role/user
  → validate permissions and locked constraints
  → publish scoped revision
  → audit publication
  → users resolve new layout inheritance
```

Personal dashboard changes can use a reduced immediate-save flow but remain revisioned enough to recover from invalid migrations.

## Theme preview

The editor uses the selected theme profile while composing content. Theme changes and layout changes can be previewed together without publishing either.

Requirements:

- preview uses the same semantic primitives as runtime;
- responsive viewport switching is supported;
- light/dark variants can be previewed where the theme supports them;
- theme draft values are validated before injection;
- editor chrome remains usable even when the content theme is visually extreme.

The editor chrome should use a stable system theme rather than inheriting every public-theme choice.

## Component identity and migration

Persisted identity:

```text
pluginId + blockId + blockVersion
```

Example:

```json
{
  "type": "crm.pipeline-summary",
  "version": 2,
  "props": {}
}
```

Lifecycle:

```text
active
  → deprecated
  → replacement/migration available
  → all drafts and published documents migrated
  → removed in later major release
```

Builder validation scans:

- CMS draft and published versions;
- workspace customer/role/user layouts;
- archived revisions according to retention policy;
- reusable symbols/templates if introduced.

A component is not removable merely because it is absent from current published pages.

## Engine comparison

### Puck

Fit:

- React-oriented;
- embeddable;
- self-hosted application/data ownership;
- existing editor UI;
- custom component configuration;
- suitable for fixed shell + editable canvas;
- lower initial implementation cost.

Risks:

- editor customization limits may appear during workspace POC;
- some engine APIs may evolve;
- K-Nex still owns data/action/permission/layout-inheritance systems;
- a third-party Payload integration may not match K-Nex storage semantics.

Decision: first adapter and POC candidate.

### Builder.io

Strengths:

- mature visual editor;
- polished marketing/content workflows;
- component registration and components-only operation;
- targeting, scheduling, comments, and collaboration features.

Mismatch for the core platform:

- external editing/content-management dependency;
- account/space/API-key lifecycle per customer;
- greater vendor and pricing dependency;
- broad custom code/style capabilities are unnecessary or risky for operational applications;
- conflicts with the goal that customer application data and panel remain independently operated.

Decision: not the core K-Nex builder. A customer-specific optional integration remains possible.

### Craft.js

Strengths:

- low-level React editor framework;
- complete control over editor behavior;
- self-hosted and engine-level flexibility.

Costs:

- component palette, inspector, layers, responsive preview, permissions, migrations, keyboard behavior, and editor UX require substantial custom work.

Decision: fallback if Puck cannot support required shell/composition behavior. It is not the default first implementation.

### GrapesJS

Strengths:

- mature HTML/CSS template editing;
- self-hosted;
- suitable for landing pages and email-style templates.

Mismatch:

- HTML/CSS-centric model rather than permission-aware React business widgets and typed data/action contracts.

Decision: possible future email/template plugin, not the application UI builder.

## Puck acceptance POC

The Puck adapter is accepted only after proving:

1. Fixed K-Nex sidebar and top bar remain outside the editable canvas.
2. CMS and workspace profiles use the same K-Nex block contracts with different policies.
3. Module blocks appear/disappear based on resolved plugin state.
4. Permission filtering controls palette, rendering, data, and actions.
5. Customer admin can lock blocks/regions.
6. Normal users can personalize only permitted dashboard regions.
7. Two themes render the same stored document without document mutation.
8. Public and authenticated data-source boundaries remain separate.
9. Realtime workspace block works through capability contracts.
10. Missing module/block produces safe fallback and readiness diagnostics.
11. Block version migrations are deterministic and fixture-tested.
12. Draft/preview/publish works for CMS and customer/role workspace layouts.
13. Editor document cannot contain arbitrary JS, SQL, imports, secrets, or global CSS.
14. Domain modules do not import Puck types.
15. Server/client rendering and code splitting are acceptable.
16. Keyboard and accessibility behavior is sufficient or can be extended without forking the engine.

## Rejection criteria

Reconsider Puck if any of these are fundamental rather than adapter-level problems:

- fixed shell cannot reliably host the editor;
- canonical K-Nex documents cannot round-trip without loss;
- profile permissions cannot prevent forbidden structure/action configuration;
- custom field/data binding requires pervasive Puck-specific types in modules;
- nested operational dashboard layouts are unstable or inaccessible;
- editor overrides require maintaining a deep engine fork;
- preview cannot use the same runtime/theme renderer;
- performance becomes unacceptable with realistic block catalogs.

If rejected, evaluate Craft.js using the same K-Nex contracts and stored documents. The adapter boundary is specifically designed to make that experiment possible.

## V1 non-goals

- arbitrary application-building logic;
- visual creation of server workflows;
- visual editing of authentication and security settings;
- arbitrary JavaScript or CSS;
- fully composable dispatch/approval/transaction screens;
- runtime installation of new component packages;
- cross-customer shared content service;
- replacing customer developers for custom domain UI.
