# Headless Component System and Data Experience

## Purpose

K-Nex needs a broad, reusable, style-agnostic component system so customer applications and plugins compose product-quality interfaces without rebuilding accessibility, interaction, query state, data tables, forms, or page structure.

This is not a request to make every theme implement every widget. The architecture remains layered:

```text
small stable theme primitive ABI
        ↓
platform-owned headless components
        ↓
platform-owned data/form/page utilities
        ↓
plugin-owned compositions and Puck blocks
        ↓
theme tokens, recipes, slots, and customer overrides
```

The small theme ABI remains deliberately stable. Complex behavior belongs to K-Nex component/adaptor packages and is styled through semantic slots and tokens.

## Definition of style-agnostic

A K-Nex component may include the minimum structure required for correctness:

```text
semantic HTML
ARIA roles, states, names, and relationships
keyboard and focus behavior
portal/overlay structure
measurement and collision handling
virtualization layout mechanics
visually-hidden utility rules
reduced-motion and forced-colors safeguards
```

It must not include brand presentation such as color palette, typography personality, decorative shadows, arbitrary spacing scale, or customer-specific composition.

Themes own visual presentation through:

```text
typed tokens
semantic data attributes
component slots/parts
state attributes
recipes and variants
bounded structural CSS
```

No component accepts arbitrary persisted CSS, class names, executable style functions, or remote assets as a general customization contract.

## External inventory baseline

The Component Gallery component list is the minimum coverage inventory for the K-Nex web component system. It is a discovery checklist, not a source-code dependency and not the K-Nex API contract.

Reference: <https://component.gallery/components/>

The inventory currently contains 60 component families. By Gate 7 closeout every item must have one of these executable K-Nex dispositions:

```text
implemented K-Nex component
native semantic wrapper
versioned complex adapter
explicitly rejected with a replacement contract and project-manager decision
```

A component cannot silently disappear from the matrix.

## Component Gallery coverage matrix

### Layout, content, and media

```text
Avatar
Card
File
Footer
Header
Heading
Hero
Icon
Image
Link
List
Quote
Separator
Stack
Video
Visually hidden
```

### Feedback and status

```text
Alert
Badge
Empty state
Progress bar
Progress indicator
Skeleton
Spinner
Toast
```

### Navigation and actions

```text
Breadcrumbs
Button
Button group
Dropdown menu
Navigation
Pagination
Segmented control
Skip link
Tabs
Tree view
```

### Forms and inputs

```text
Checkbox
Color picker
Combobox
Date input
Datepicker
Fieldset
File upload
Form
Label
Radio button
Rating
Search input
Select
Slider
Stepper
Text input
Textarea
Toggle
```

### Disclosure and overlays

```text
Accordion
Carousel
Drawer
Modal
Popover
Tooltip
```

### Data and editing

```text
Table
Rich text editor
```

## Additional K-Nex platform components

The gallery inventory does not cover all product-level utilities required by a CMS/CRM platform. K-Nex additionally owns:

### Foundation and page structure

```text
Box
Inline
Grid
Container
PageShell
PageHeader
Section
Toolbar
ActionBar
SplitView
ScrollableArea
AspectRatio
Portal
FocusScope
```

### Form composition

```text
FormField
FieldDescription
FieldError
InputGroup
PasswordInput
NumberInput
CurrencyInput
PhoneInput
URLInput
TimeInput
DateRangePicker
MultiSelect
TagInput
Autocomplete
FormActions
UnsavedChangesGuard
```

### Data presentation and query state

```text
QueryBoundary
LoadingState
ErrorState
ForbiddenState
InsufficientPermissionState
StaleState
DataList
KeyValueList
DescriptionList
Metric
MetricGroup
StatCard
DataTable
DataGrid
FilterBar
FacetFilter
SortControl
SearchControl
ColumnChooser
DensityControl
SelectionSummary
BulkActionBar
RowActions
DetailPanel
LoadMore
InfiniteList
VirtualList
```

### Product page templates

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

These templates are compositional helpers, not fixed visual designs. Plugins supply descriptors, sources, actions, columns, fields, and canonical page documents.

## Package boundaries

Target package direction:

```text
@k-nex/ui-design-system-contracts
  stable semantic primitive ABI, theme slots/tokens, provider boundary

@k-nex/ui-components
  style-agnostic accessible compound components

@k-nex/ui-data
  query boundaries, table/grid/list/filter/sort/pagination utilities

@k-nex/ui-forms
  field composition, form state adapter, server-error mapping

@k-nex/ui-pages
  page templates and route-level composition helpers

@k-nex/ui-builder-blocks
  canonical Puck bridges over the same components

@k-nex/ui-testing
  shared accessibility, interaction, SSR/hydration, and theme contract suite
```

Packages are created only when implementation reaches their first real consumer. This list is the intended separation of concerns, not permission to create empty abstraction packages.

## Dependency policy

K-Nex should use established headless engines where they remove complexity and stay behind K-Nex contracts.

### React Aria Components

React Aria remains the preferred accessibility and interaction foundation for common controls and collections. Its components are unstyled by default and expose interaction state for custom design systems.

Reference: <https://react-spectrum.adobe.com/react-aria/getting-started.html>

Rules:

```text
React Aria types do not leak from K-Nex public component props
plugins import K-Nex components, not React Aria directly when coverage exists
unsupported behavior may use lower-level React Aria hooks behind the adapter
all wrappers retain K-Nex naming, error, slot, and test conventions
```

### WAI-ARIA Authoring Practices

The WAI-ARIA APG is the behavior and keyboard reference for widgets, but it is not itself a design system. Native HTML is preferred where it supplies the correct behavior.

References:

- <https://www.w3.org/WAI/ARIA/apg/>
- <https://www.w3.org/WAI/ARIA/apg/patterns/>

### TanStack Table

TanStack Table is the preferred candidate for headless table/data-grid state because it does not own markup or styling and supports opt-in sorting, filtering, pagination, selection, sizing, grouping, and related features.

Reference: <https://tanstack.com/table/latest/docs/overview>

K-Nex owns:

```text
source/query integration
column and field authority
semantic table/grid rendering
permission and required-field states
URL/query-state serialization
empty/loading/error states
bulk-action authorization
theme slots and accessibility acceptance
```

TanStack types remain implementation-local.

### TanStack Virtual

TanStack Virtual is the first candidate for large list/table virtualization. Virtualization is opt-in and cannot break keyboard order, screen-reader access, focus restoration, row identity, or print/export behavior.

Reference: <https://tanstack.com/virtual/latest/docs/framework/react/react-virtual>

### Form engine

TanStack Form and React Hook Form are implementation candidates. The selection must be made through a bounded spike using Sales create/edit forms. K-Nex owns field components, validation/result contracts, server problem mapping, dirty-state behavior, and accessibility.

References:

- <https://tanstack.com/form/latest/docs/overview>
- <https://react-hook-form.com/>

### Rich text

Lexical is the first rich-text editor candidate because it is modular and does not prescribe product UI. Rich-text editor state and rendered content require their own versioned adapter and sanitization/publication contract.

Reference: <https://lexical.dev/>

No dependency is installed merely because it is listed here. Every candidate is exact-pinned and accepted only after boundary, accessibility, bundle, performance, and migration proof.

## Theme ABI versus component catalog

The theme ABI must not expand to mirror the complete component inventory.

Stable theme primitives remain approximately:

```text
layout       Box / Stack / Inline / Grid / Container
typography   Text / Heading / Link
actions      Button / IconButton
surfaces     Card / Badge / Status
inputs       Input / Textarea / Select / Checkbox / FormField
overlays     Dialog / Popover / Tooltip
feedback     Toast / Skeleton / EmptyState / ErrorState
data basics  Table / Pagination
```

Compound and advanced components consume these primitives and publish semantic slots such as:

```text
component.data-table.root
component.data-table.header
component.data-table.row
component.data-table.cell
component.data-table.sort-trigger
component.filter-bar.root
component.date-picker.calendar-cell
component.tree.item
```

Themes provide tokens/recipes for slots. They do not reimplement sorting, focus management, calendar math, virtualization, rich-text editing, or data fetching.

## DataTable architecture

`DataTable` is a first-class K-Nex product component, not a thin HTML table wrapper.

### Source contract

A DataTable consumes one registered `table.records@1` source plus a view preset:

```text
source ID/version
source input
available fields
required and optional fields
default columns
allowed filters/sorts/facets
pagination mode
row identity
row and bulk actions
realtime invalidation policy
presentation revision
```

The client cannot invent field IDs, filter operators, sort fields, record scopes, or actions absent from the descriptor.

### Modes

```text
Table
  semantic read-oriented rows and columns
  default for reports and index views

DataGrid
  interactive cell/row navigation and editing semantics
  used only when grid behavior is required and explicitly tested
```

A visually complex table is not automatically an ARIA grid. Native table semantics remain the default.

### Server/client responsibilities

Server-owned:

```text
authentication and authorization
record/field projection
filter/sort/operator allowlist
stable ordering and tie-breaker
pagination cursor/offset validation
aggregation and canonical output
result budgets
```

Client-owned:

```text
controlled view state
column visibility/order/width
density
selection state
URL state where enabled
loading/empty/error rendering
keyboard interaction
request cancellation and stale display
```

### Required features

```text
offset and cursor pagination
load-more/infinite adapter
server-side and bounded client-side sorting
server-side filtering and search
faceted filters when declared
column visibility and ordering
column sizing with bounded persistence
single/multi-row selection
permission-aware row and bulk actions
sticky header where supported
responsive overflow
virtualization for representative large datasets
CSV/export action only through an authorized action contract
realtime invalidation followed by authoritative refetch
```

### Failure states

```text
forbidden source
insufficient required-field permission
optional field omission
invalid/stale contract
empty result
rate limit
query timeout
stale cached data
refetching
partial action failure
```

Each state has a canonical component and cannot be collapsed into a blank table or generic console error.

## Filter, sort, search, and pagination utilities

Plugins describe allowed operations; K-Nex renders and executes them consistently.

```text
FilterBar
  typed filter controls from source metadata
  no arbitrary expression language

FacetFilter
  bounded server-provided values/counts

SortControl
  allowlisted sort IDs and directions
  stable tie-breaker remains server-owned

SearchControl
  debounced/cancellable source input
  explicit minimum/maximum length and mode

Pagination
  page/size controls, count when known, keyboard and landmark semantics

CursorPagination
  next/previous opaque cursors; client never edits cursor contents
```

State serialization is versioned and excludes authority-bearing server context. A copied URL may preserve view preferences but cannot preserve another actor's record scope or permissions.

## QueryBoundary

Every source-driven component uses one standard state boundary:

```text
idle
loading
success
empty
forbidden
insufficient-permission
invalid-contract
rate-limited
error
stale
refetching
```

The boundary supports suspense-like presentation if selected, but the persisted component contract is library-neutral. It must preserve the last valid authorized snapshot only where the source/cache policy permits it.

## Forms

K-Nex forms combine:

```text
strict input schema
field descriptors
client interaction state
server action contract
RFC 9457 problem mapping
field/form errors
permission-aware disabled/hidden policy
unsaved-change handling
submission idempotency where required
```

A field being hidden in the browser never grants server authority. Server validation remains final.

The Sales reference proof must include:

```text
create task form
edit opportunity form
async option loading through a registered source
field-level server error
form-level conflict
successful action invalidation
keyboard and screen-reader journey
```

## Puck integration

Every builder component uses the same runtime component definition as non-editor rendering.

```text
K-Nex component definition
  props schema
  slots
  source/action binding policy
  runtime renderer
        ↓
canonical block descriptor
        ↓
Puck bridge
```

No component is implemented twice for editor and runtime. Builder fields are derived from or reconciled with the canonical props schema. Unsupported props, bindings, and actions fail publication.

The initial Sales Puck library includes:

```text
Sales metric
Sales task table
Sales opportunity list
Sales quick-create form
Sales detail summary
generic heading/text/card/stack/section blocks
```

## Accessibility and quality contract

Every component must define and test:

```text
semantic element/role
accessible name and description
keyboard interaction
focus entry, containment, restoration, and visibility
pointer and touch target behavior
disabled/read-only/pending/invalid states
reduced motion
forced colors/high contrast
RTL and localization behavior
SSR and hydration
controlled/uncontrolled state where supported
portal and nested-overlay behavior
screen-reader smoke acceptance
```

Testing layers:

```text
unit/state-machine tests
Testing Library user-level interaction tests
contract tests across Minimal and Neobrutalism
real Chromium journeys
axe-style automated checks where useful
manual keyboard and screen-reader smoke evidence
visual regression at representative states
```

Tests query by role/name/state rather than implementation classes. Browser acceptance remains authoritative for focus, layout, portal, and CSS behavior.

## Performance and bundle budgets

The component gate records budgets for:

```text
package/browser bundle size
initial render and hydration
1,000-row normal table interaction
10,000-row virtualized table interaction
filter/sort/pagination request churn
large combobox/tree collections
overlay open/close latency
memory after repeated mount/unmount
```

Budgets detect order-of-magnitude regressions; they are not production capacity claims.

Server-only, editor-only, and complex optional adapters must remain tree-shakeable and absent from consumers that do not import them.

## Component maturity

```text
experimental
  internal use, API may change in the same phase

reference
  used by Sales and covered by component contract tests

stable-pre-v1
  documented, themed, builder-compatible where relevant,
  accessibility and migration behavior frozen for current pre-v1 line
```

No backward-compatibility shim is required before v1.0. Obsolete APIs are removed and all first-party callers migrate atomically.

## Gate 7 exit criteria

1. all 60 Component Gallery families have an explicit executable disposition;
2. the additional K-Nex data/form/page utilities required by Sales are implemented;
3. DataTable supports authorized pagination, filtering, sorting, selection, actions, and realtime refetch;
4. Sales default pages use only K-Nex components and standard query/action factories;
5. Minimal and Neobrutalism render the same component-state matrix without behavior forks;
6. browser, accessibility, SSR/hydration, package-boundary, and performance gates pass;
7. plugins can compose components without importing theme packages or third-party behavior engines directly;
8. advanced components remain versioned adapters rather than expanding the stable theme ABI.