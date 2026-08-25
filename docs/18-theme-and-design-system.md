# Theme and Design System

## Model

```text
theme package
  token schema, palettes, recipes, base primitive implementations,
  structural CSS, validation and migrations

theme profile
  installed theme ID, validated adjustable values,
  draft/published revisions and surface
```

Theme code installs through source control and deployment. Profiles switch/adjust installed themes at runtime. Admin and public profiles are independent.

## Small V1 primitive ABI

Every supported theme implements:

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

React Aria Components is the initial behavior/accessibility foundation behind K-Nex primitives. Domain modules import K-Nex primitives, not React Aria types where a primitive exists.

## Complex adapters

Not every theme reimplements:

```text
DataGrid
DatePicker/calendar
resizable dashboard grid
advanced Menu/CommandMenu
Map
Chart
rich-text editor
```

These are separate versioned adapters/capabilities. Themes provide tokens/recipes for installed adapters; interaction behavior stays in the adapter.

## Tokens

Validated typed groups cover semantic colors, typography IDs/scales, spacing, radius, border, shadow, density, motion, and theme-specific namespaced values. Runtime profiles cannot store arbitrary CSS, class names, functions, imports, remote fonts, or URLs.

CSS variables are generated from parsed typed values and namespaced by surface. Server/client use the same profile revision to avoid hydration mismatch.

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

A privileged UI can select installed themes/palettes, edit schema-backed tokens, preview surfaces/modes/viewports, validate, publish, rollback, and audit.

It cannot install packages, execute CSS/JS, reference secrets, load uninstalled theme IDs, or bypass accessibility/security validation.

## Customer overrides

Customer code may deliberately override a primitive or block renderer through typed extension points. Overrides are inventoried, versioned, reviewed, deployed, and tested. They cannot alter server authorization or source/action contracts.

## Migration

Theme package upgrades migrate existing profiles to **draft** revisions. No package upgrade silently publishes visual changes. Prior published revision remains available.

## Required fixtures

- Minimal and Neobrutalism implement the same base ABI;
- same canonical document renders without mutation;
- complex DataTable/chart adapters consume shared semantic tokens;
- malicious token/font/CSS values fail;
- WCAG journeys and visual regression pass;
- server/client profile revision and CSS variables match;
- migrated profile is draft and rollback remains valid.
