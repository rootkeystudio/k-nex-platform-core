# UI Composition Runtime

## Purpose

K-Nex modules can provide reusable application behavior and reusable UI capabilities without imposing one customer's visual design. The UI composition runtime collects the contributions of all enabled plugins and exposes them through a fixed application shell, a permission-aware route/navigation registry, and controlled composable page canvases.

The intended result is:

```text
style-agnostic module UI
+ customer-selected design system and theme
+ customer/role/user layout configuration
= customer-specific application interface
```

The UI runtime is separate from the builder engine. It can render fixed screens and stored layouts even when the editing package is not installed in a particular deployment process.

## Package boundaries

Suggested packages:

```text
@k-nex/ui-contracts
@k-nex/ui-runtime
@k-nex/ui-shell
@k-nex/ui-design-system-contracts
@k-nex/ui-testing
@k-nex/builder-puck
```

### `ui-contracts`

Contains serializable and TypeScript contracts for:

- navigation contributions;
- route and screen declarations;
- block definitions;
- field schemas;
- data-source descriptors;
- action descriptors;
- layout documents;
- surface/audience metadata;
- component versions and migrations;
- extension slots.

It must not import Puck, customer CSS, or a concrete design-system implementation.

### `ui-runtime`

Contains:

- contribution registry;
- permission filtering;
- route/screen/block resolution;
- layout inheritance and merge logic;
- data-source execution clients;
- action execution clients;
- missing/orphan component behavior;
- theme/design-system binding;
- runtime diagnostics.

### `ui-shell`

Contains the stable application shell behavior:

- sidebar region;
- top bar;
- breadcrumbs;
- route outlet;
- command palette;
- notification center;
- global dialog/overlay host;
- current-user menu;
- loading, error, and permission boundaries.

The shell structure is platform-controlled. Its appearance is theme-controlled.

### `ui-design-system-contracts`

Defines semantic primitives that module UI can use without selecting customer colors or component-library implementations.

### Builder adapter

`@k-nex/builder-puck` converts K-Nex block and layout contracts into editor-engine configuration. Domain modules do not import Puck types.

## Surfaces

The UI runtime recognizes explicit surfaces.

| Surface | Audience | Typical content |
|---|---|---|
| `workspace` | authenticated staff | dashboards, CRM, dispatch, inventory, reports |
| `cms` | authenticated editors | content tree, page editor, preview controls |
| `public` | anonymous or signed public session | websites, QR menus, tracking projections, forms |
| `driver` | authenticated driver | tasks, route, proof of delivery, status updates |
| `system` | privileged operators | users, roles, plugins, audit, health, integrations |

A component declares allowed surfaces. Registration in one surface never automatically exposes it in another.

## Fixed shell

The initial product decision is:

> Navigation structure is generated from modules, but the shell itself is not freely editable by end users.

Fixed areas:

```text
application frame
sidebar container
top bar
router
notification center
current-user menu
system dialogs
error boundaries
authentication boundary
```

Modules contribute items into known shell regions. For example:

```ts
export const crmNavigation = defineNavigationContribution({
  moduleId: 'module.crm',
  items: [
    {
      id: 'crm.contacts',
      label: 'Contacts',
      icon: 'users',
      href: '/crm/contacts',
      order: 100,
      permission: 'crm.contacts.read',
    },
    {
      id: 'crm.pipeline',
      label: 'Pipeline',
      icon: 'kanban',
      href: '/crm/pipeline',
      order: 200,
      permission: 'crm.opportunities.read',
    },
  ],
})
```

The resolved sidebar is filtered by:

- installed/enabled plugin state;
- current actor permissions;
- route availability;
- optional integration activation;
- customer navigation overrides that remain within allowed slots.

A customer can rename, reorder, group, or hide optional items through configuration where allowed. It cannot replace authentication, bypass permissions, or route a permission-protected item to an unprotected screen.

## Screen categories

Not every screen is equally editable.

### System screens

Developer/platform-controlled and not builder-editable in V1:

```text
login and authentication flows
user management
role and permission management
plugin inventory and settings
audit log
integration credentials
migration/system health
security-sensitive configuration
```

### Operational screens

Owned by a module and optimized for a business workflow:

```text
contact record editor
dispatch board
shipment assignment
inventory adjustment
budget approval
driver task execution
```

These screens can expose documented extension slots but are not initially reconstructed from arbitrary drag-and-drop blocks. Their transaction boundaries, keyboard interactions, validation, and error recovery must remain reliable.

### Composable screens

Suitable for visual composition:

```text
dashboard
module overview
executive summary
operations overview
report page
role workspace
user-personal dashboard
public CMS page
```

V1 builder support focuses on composable screens. Operational screen composition can expand later through controlled record-page and form-builder contracts.

## UI contribution contract

A plugin can expose one UI contribution bundle.

```ts
export interface UiContribution {
  pluginId: string
  navigation?: NavigationContribution[]
  routes?: RouteContribution[]
  screens?: ScreenDefinition[]
  blocks?: UiBlockDefinition[]
  actions?: UiActionDefinition[]
  dataSources?: UiDataSourceDefinition[]
  slots?: UiSlotContribution[]
  migrations?: UiMigrationDefinition[]
}
```

Example:

```ts
export const crmUi = defineUiContribution({
  pluginId: 'module.crm',
  navigation: crmNavigation,
  screens: [contactsScreen, pipelineScreen],
  blocks: [
    pipelineSummaryBlock,
    contactTableBlock,
    recentActivityBlock,
  ],
  dataSources: [
    contactsDataSource,
    pipelineSummaryDataSource,
  ],
  actions: [
    createContactAction,
    moveOpportunityAction,
  ],
})
```

## Style-agnostic module UI

“Style-free” is interpreted as **style-agnostic**, not as literally zero structural CSS.

Modules must not encode customer presentation decisions such as:

```text
brand colors
brand fonts
fixed customer-specific radius/shadow
visual style names
customer logos
hard-coded Tailwind color classes
customer spacing scale
```

A complex module UI may include structural behavior needed to function:

```text
virtualized table layout
map viewport sizing
kanban drag geometry
accessible hidden labels
screen-reader utilities
focus management
animation required for state continuity
```

Final visual language is resolved through semantic design-system primitives and runtime theme tokens.

## Layered component model

### 1. Headless state and behavior

```ts
usePipelineSummary()
useDispatchBoard()
useInventoryLedger()
useLiveTracking()
```

This layer owns browser-safe state, query coordination, optimistic UI policy, and interaction logic. It never contains server-only secrets or authoritative business rules.

### 2. Semantic domain component

```tsx
export function PipelineSummary(props: PipelineSummaryProps) {
  const result = usePipelineSummary(props)
  const { Card, Heading, Metric, Stack } = useDesignSystem()

  return (
    <Card variant="summary">
      <Stack gap="content">
        <Heading level={2}>{props.title}</Heading>
        <Metric label="Open opportunities" value={result.openCount} />
      </Stack>
    </Card>
  )
}
```

The component knows domain meaning but not customer brand appearance.

### 3. Design-system adapter

The customer-selected theme/design-system package provides implementations for semantic primitives:

```tsx
<KNeXDesignSystemProvider
  primitives={{
    Button: CustomerButton,
    Card: CustomerCard,
    Table: CustomerTable,
    Dialog: CustomerDialog,
    Badge: CustomerBadge,
  }}
>
  <Application />
</KNeXDesignSystemProvider>
```

### 4. Runtime token profile

Validated database values control palette, spacing, typography, radius, shadow, and component variants within the installed theme's schema.

### 5. Customer override

The customer repository can deliberately replace a module renderer or primitive through a documented override slot. Overrides are code changes, reviewed and deployed like other customer extensions.

## Blocks

A block is a versioned UI capability that can appear in a stored layout.

```ts
export const pipelineSummaryBlock = defineUiBlock({
  id: 'crm.pipeline-summary',
  version: 2,
  pluginId: 'module.crm',
  title: 'Pipeline summary',
  category: 'CRM',
  surfaces: ['workspace'],
  permission: 'crm.opportunities.read',
  fields: {
    title: field.text({ required: true }),
    pipelineIds: field.resourceList({ resource: 'crm.pipeline' }),
    period: field.enum({ values: ['week', 'month', 'quarter'] }),
  },
  dataSource: 'crm.pipeline.summary',
  renderer: PipelineSummary,
})
```

Block identifiers are stable persisted identities. Display names can change without migration; IDs cannot.

### Block audience

```ts
publicLeadFormBlock = defineUiBlock({
  id: 'crm.public-lead-form',
  surfaces: ['public', 'workspace'],
  audience: ['anonymous', 'authenticated'],
  action: 'crm.public-lead.submit',
})
```

A public-capable block uses a deliberately public action/data projection. It does not receive the same API access as an authenticated CRM screen.

## Data sources

Stored layouts reference registered data sources, not raw queries or copied live data.

```json
{
  "type": "crm.contact-table",
  "version": 1,
  "props": {
    "data": {
      "source": "crm.contacts",
      "params": {
        "status": ["lead", "active"],
        "limit": 20
      }
    }
  }
}
```

Definition:

```ts
export const contactsDataSource = defineUiDataSource({
  id: 'crm.contacts',
  surfaces: ['workspace'],
  permission: 'crm.contacts.read',
  input: contactsQuerySchema,
  output: contactListProjectionSchema,
  execute: async ({ input, actor, services }) => {
    return services.crmQueries.listContacts({ input, actor })
  },
})
```

Rules:

- input and output are schema-validated;
- authorization occurs server-side on every execution;
- output is a projection, not unrestricted database documents;
- cache policy belongs to the definition;
- PII classification can be attached to fields;
- layouts store parameters, not data snapshots unless a content block deliberately owns static content.

## Actions

Stored layouts can invoke only registered action IDs.

```json
{
  "event": "submit",
  "action": "crm.public-lead.submit",
  "params": {
    "source": "homepage"
  }
}
```

Browser-safe descriptor:

```ts
export const submitLeadAction = defineUiAction({
  id: 'crm.public-lead.submit',
  surfaces: ['public'],
  input: leadInputSchema,
  executeClient: ({ input, api }) =>
    api.actions.execute('crm.public-lead.submit', input),
})
```

Authoritative server handler:

```ts
registerActionHandler({
  id: 'crm.public-lead.submit',
  input: leadInputSchema,
  rateLimit: 'public-form',
  handle: async ({ input, request, services }) => {
    return services.crmCommands.createLeadFromPublicForm({ input, request })
  },
})
```

Frontend action metadata never replaces backend authorization, validation, rate limiting, transaction handling, or audit policy.

## Layout document

Example:

```json
{
  "schemaVersion": 1,
  "pageId": "workspace.operations-dashboard",
  "scope": {
    "type": "role",
    "id": "dispatcher"
  },
  "baseLayoutId": "platform.logistics-dashboard",
  "regions": {
    "main": [
      {
        "id": "block-01",
        "type": "logistics.unassigned-shipments",
        "version": 1,
        "locked": true,
        "props": {
          "branch": "current"
        }
      },
      {
        "id": "block-02",
        "type": "logistics.live-map",
        "version": 2,
        "props": {
          "fleetFilter": "active"
        }
      }
    ]
  }
}
```

The document never contains:

- arbitrary JavaScript;
- arbitrary SQL;
- package/module import paths;
- secret values;
- unrestricted URLs for server-side fetching;
- raw backend permission expressions;
- executable React source;
- user-provided global CSS.

## Layout scope and inheritance

Supported hierarchy:

```text
platform default
       ↓
customer default
       ↓
role default
       ↓
user override
```

### Platform layout

Shipped by K-Nex or a module as a safe default.

### Customer layout

Published by a customer administrator. Can add, remove, reorder, configure, or lock blocks within the profile policy.

### Role layout

Specializes the customer layout for a customer-defined role or permission set.

### User override

Allows a normal user to personalize permitted pages, initially personal dashboards only.

## Merge semantics

V1 uses explicit patch operations over an immutable base layout rather than storing four complete unrelated copies.

Example user patch:

```json
{
  "baseRevision": "role-dispatcher:7",
  "operations": [
    {
      "op": "move",
      "blockId": "block-02",
      "after": "block-04"
    },
    {
      "op": "setProps",
      "blockId": "block-03",
      "props": {
        "period": "week"
      }
    },
    {
      "op": "hide",
      "blockId": "block-05"
    }
  ]
}
```

Rules:

- locked blocks cannot be removed, hidden, or moved outside allowed regions;
- user overrides cannot add blocks outside the user-editable palette;
- stale patches are rebased or marked conflicted after a base-layout publication;
- unresolved conflicts fall back to the last valid resolved layout;
- published base revisions remain available for rollback and migration.

This patch model requires a POC before final implementation. If rebasing proves too complex, V1 may store copy-on-write snapshots while preserving explicit lineage metadata.

## Draft and publish

Customer/role layouts use:

```text
draft
preview
published
archived revision
```

Normal user personal changes can publish immediately to that user after validation because they do not affect other users. Customer and role changes require explicit publish permission and create audit entries.

## Locked content

Blocks and regions can define edit constraints:

```ts
constraints: {
  canDelete: false,
  canMove: false,
  editableFields: ['period'],
  allowedChildren: ['core.metric', 'core.chart'],
}
```

Constraints are evaluated from trusted definitions and administrator policy, not solely from mutable layout data.

## Missing and orphan components

When a stored layout references a component whose plugin is disabled, uninstalled, incompatible, or removed:

- the page does not crash;
- normal users receive a safe unavailable/omitted fallback according to screen policy;
- administrators see plugin ID, component ID, expected version, and remediation;
- readiness checks report every affected draft and published layout;
- uninstall does not delete the stored block automatically;
- purge requires explicit cleanup or migration.

Example admin fallback:

```text
Unavailable component
crm.pipeline-summary@2 is provided by module.crm,
which is not enabled in this build.
```

## Component lifecycle

```text
active       renderable and selectable
deprecated   renderable but unavailable for new insertion
migrating    replacement and deterministic migration supplied
removed      allowed only after readiness confirms no stored references
```

Each block carries a version. Modules register migrations:

```ts
registerUiMigration({
  blockId: 'crm.pipeline-summary',
  from: 1,
  to: 2,
  migrate: props => ({
    pipelineIds: [props.pipelineId],
    period: props.period ?? 'month',
  }),
})
```

## Realtime blocks

A block can declare a realtime capability without importing a concrete WebSocket implementation.

```ts
export const liveMapBlock = defineUiBlock({
  id: 'logistics.live-map',
  requiresCapabilities: ['realtime.gateway'],
  dataSource: 'logistics.fleet.current',
  realtime: {
    channelFactory: 'logistics.fleet.channel',
    messageTypes: ['logistics.vehicle-position.changed'],
    strategy: 'invalidate-and-refetch',
  },
})
```

The authoritative state remains queryable. Realtime normally invalidates/refetches or applies validated projections; it is not the only source of truth.

## Permission behavior

Permissions are enforced at several layers:

```text
navigation visibility
route access
screen rendering
block palette availability
block data source
block action
record-level domain policy
realtime subscription
```

Hiding a block or menu item is a usability behavior, not a security boundary. Server data sources and actions always enforce authorization independently.

## Rendering strategy

### Public CMS

Prefer server rendering or static/cached rendering where suitable, with client hydration only for interactive blocks. Theme resolution and component registry must be available during server render.

### Workspace

Render the shell and permission-filtered layout consistently on server/client where the application stack allows. Data-heavy interactive blocks can use client queries with server-validated endpoints. Avoid serializing sensitive data into builder documents or broadly shared caches.

### Builder preview

Preview uses the same runtime renderer, component registry, and theme profile as production whenever possible. Editor chrome is separate from content rendering.

## Performance

The runtime should support:

- code splitting by plugin/screen/block;
- no server-only package leakage into browser bundles;
- block-level query deduplication;
- bounded data-source output;
- lazy loading for maps/charts/heavy grids;
- cache keys including actor/scope where required;
- stable layout resolution caching by revision;
- theme token injection without full CSS regeneration per block.

The generated UI registry uses static import maps so bundlers can discover chunks safely.

## Accessibility

Semantic design-system primitives and module components must preserve:

- keyboard navigation;
- focus management;
- accessible names and descriptions;
- color-contrast validation at the theme layer;
- reduced-motion preferences;
- error identification;
- table/grid semantics;
- drag-and-drop alternatives where practical.

A theme cannot remove required focus indicators or create invalid contrast without validation warnings/errors.

## Testing

Required test layers:

- UI contract schema tests;
- module contribution collision tests;
- permission-filtered navigation snapshots;
- server action/data-source authorization tests;
- theme adapter contract tests;
- block renderer tests against all supported theme primitives;
- layout inheritance and patch tests;
- orphan/deprecated component fixtures;
- component migration fixtures;
- builder-to-runtime round-trip tests;
- accessibility tests for shell and common primitives;
- cross-customer rendering tests using the same module blocks and different themes.

## V1 acceptance criteria

- Enabled modules automatically contribute permitted navigation and blocks.
- Sidebar/top bar remain fixed platform regions.
- Dashboard, module overview, report, and CMS page canvases are composable.
- Operational transaction screens remain stable module-owned screens.
- Two customer applications render the same CRM block with substantially different design systems.
- A user cannot add a block or execute an action they lack permission for.
- Server authorization remains effective when client metadata is modified.
- Layouts contain no arbitrary JS, SQL, import paths, secrets, or unrestricted CSS.
- A disabled module produces clear orphan diagnostics without deleting stored layouts.
- Puck types do not appear in domain-module public contracts.
