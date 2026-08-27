# Theme and Design System

## Model

```text
theme package
  token schema, palettes, recipes, primitive overrides,
  bounded structural CSS, validation, and migrations

theme profile
  installed theme ID, validated adjustable values,
  draft/published revisions and surface

platform component system
  style-agnostic accessible behavior and composition,
  semantic slots/parts consumed by themes
```

Theme code installs through source control and deployment. Profiles switch/adjust installed themes at runtime. Admin and public profiles are independent.

The comprehensive component roadmap is defined in [Headless Component System and Data Experience](./34-headless-component-system.md).

## Small stable theme primitive ABI

Every supported theme implements or styles the stable primitive boundary:

```text
layout       Box / Stack / Inline / Grid / Container
typography   Text / Heading / Link
actions      Button / IconButton
surfaces     Card / Badge / Status
inputs       Input / Textarea / Select / Checkbox / FormField
overlays     Dialog / Popover / Tooltip
feedback     Toast / Skeleton / EmptyState / ErrorState
data basics  simple Table / Pagination
```

React Aria Components is the initial behavior/accessibility foundation behind K-Nex primitives. Domain modules import K-Nex primitives and compound components, not React Aria types where K-Nex coverage exists.

## Comprehensive component system without theme explosion

K-Nex will cover the Component Gallery inventory plus platform-specific data, form, page, and builder utilities. This does **not** expand the theme ABI to every component.

Platform-owned components include or adapt behavior for:

```text
DataTable/DataGrid
DatePicker/calendar
TreeView
Combobox and advanced selection
forms and validation state
navigation/disclosure/overlays
virtualized lists/tables
rich-text editing
page templates
query/filter/sort/pagination utilities
```

Themes provide:

```text
tokens
semantic slots/parts
recipes and variants
state styling
bounded structural CSS
```

Themes do not reimplement sorting, filtering, focus management, calendar math, virtualization, rich-text state, source queries, or action execution.

## Component slots

Compound components publish stable semantic slots rather than exposing implementation-library class names.

Examples:

```text
component.data-table.root
component.data-table.header
component.data-table.row
component.data-table.cell
component.data-table.sort-trigger
component.filter-bar.root
component.dialog.content
component.tree.item
component.date-picker.calendar-cell
```

Slot names are versioned K-Nex contracts. Internal React Aria/TanStack/Lexical DOM or types remain implementation details.

## Structural CSS

Style-agnostic does not mean zero CSS. Components and themes may include bounded structural CSS required for:

```text
layout mechanics
visually-hidden content
overlay positioning
focus visibility
virtualization
reduced motion
forced colors
nested theme ownership
```

Structural CSS is profile-scoped and cannot escape its theme root. Runtime profiles cannot provide arbitrary CSS, selectors, class names, functions, imports, URLs, or remote fonts.

## Tokens

Validated typed groups cover semantic colors, typography IDs/scales, spacing, radius, border, shadow, density, motion, and theme-specific namespaced values.

CSS variables are generated from parsed values and namespaced by surface/profile. Server/client use the same profile revision to avoid hydration mismatch.

## Accessibility

Supported surfaces target WCAG 2.2 AA. Publication/build gates include:

```text
semantic names/roles/states
keyboard operation and visible/unobscured focus
non-drag alternatives
minimum target-size policy
contrast/state distinguishability
reduced motion
forced colors/high contrast
screen-reader smoke journeys
browser automation and manual review
```

Token contrast checks are necessary but insufficient. Customer primitive/renderer overrides rerun the same contract tests.

## Theme manager

A privileged UI can select installed themes/palettes, edit schema-backed tokens, preview surfaces/modes/viewports/component states, validate, publish, rollback, and audit.

It cannot install packages, execute CSS/JS, reference secrets, load uninstalled theme IDs, or bypass accessibility/security validation.

## Customer overrides

Customer code may deliberately override a primitive, recipe, slot presentation, or block renderer through typed extension points. Overrides are inventoried, versioned, reviewed, deployed, and tested. They cannot alter server authorization, source/action contracts, or component interaction semantics without replacing the component through an explicit adapter.

## Migration

Theme package upgrades migrate existing profiles to **draft** revisions. No package upgrade silently publishes visual changes. Prior published revision remains available.

Component adapter upgrades provide their own version/migration contract when persisted documents or settings depend on them. Theme profile migration and component/document migration are separate concerns.

## Required fixtures

- Minimal and Neobrutalism implement the same primitive ABI;
- the same canonical document and component-state matrix render without mutation;
- compound components use semantic slots instead of third-party classes;
- DataTable/date/tree/rich-text adapters retain platform behavior across themes;
- malicious token/font/CSS values fail;
- sibling and nested theme roots remain selector-owned;
- WCAG journeys and visual regression pass;
- server/client profile revision and CSS variables match;
- migrated profile is draft and rollback remains valid;
- a theme cannot modify source/action authorization or component query identity.