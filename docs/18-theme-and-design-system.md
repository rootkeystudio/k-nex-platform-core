# Theme and Design System

## Three layers

```text
platform-owned semantic/compound components
→ executable Theme Package or active Theme Skin
→ customer-owned Theme Profile values/publication
```

The same canonical document/component behavior renders under different visual layers without changing business data or authority.

## Platform component ownership

K-Nex owns behavior, semantics, accessibility, keyboard/focus, data/form/page state, and complex components. Themes do not fork business or interaction behavior.

The stable primitive ABI remains small. DataTable/DataGrid, date/calendar, tree, editor, map, chart, command, virtualization, and complex layout behavior stay in platform adapters.

## Executable Theme Package

Identity:

```text
theme.*
```

A full Theme Package may include:

```text
runtime token validator
palette/recipe definitions
scoped structural CSS
profile migration functions
native semantic primitive overrides
server/browser package code
```

Because it can contain JavaScript and React behavior, it is a Platform Plugin release. Package add/upgrade/remove uses verified blue/green delivery when compatible.

The current Minimal and Neobrutalism packages are executable Theme Packages.

## Live Theme Skin

Identity:

```text
skin.*
```

A Theme Skin is a signed data-only artifact:

```text
closed token values/schema reference
palettes
recipe selections
scoped CSS
approved content-addressed images/icons/fonts when policy permits
localized metadata
profile compatibility and bounded data-only transforms
```

Forbidden:

```text
JavaScript/WASM entrypoints
React components or primitive overrides
install scripts
remote @import
unrestricted url()
global selectors
custom event handlers
host package/import paths
secret/network references
```

A skin can install/update/rollback live because it does not extend executable host behavior.

## Theme Profile

A Theme Profile is customer-owned runtime data that selects an installed Theme Package/Skin generation and validated values for one surface.

```text
profile ID/revision
surface: admin | public
base Theme Package ID/version
optional active Skin ID/generation
palette/mode/token overrides
publication state/history
```

Profiles do not install packages or skins. Publication atomically references an already verified active/available generation.

## CSS and asset safety

Skin CSS is parsed into an AST and must:

- select only the assigned theme root or descendants;
- use allowed at-rules/properties/functions;
- reject global/document selectors and scriptable/remote constructs;
- reference only approved content-addressed assets through rewritten handles;
- remain under selector/rule/byte/complexity budgets;
- preserve reduced-motion and forced-colors expectations.

Assets have strict content type, dimensions/bytes/count, immutable digest, serving headers, and no executable content.

## Live activation

```text
catalog selection
→ signed artifact verification
→ parse/scoping/token validation
→ preview and accessibility/visual checks
→ stage immutable skin generation
→ atomically publish profile/generation pointer
→ browser invalidation/refetch
→ retain previous compatible generation for rollback
```

A failed skin never changes the current profile.

## Full-theme zero-downtime delivery

An executable Theme Package follows the Platform Plugin path:

```text
build verified target image
→ start/warm target host generation
→ render visual/accessibility smoke
→ gateway promotion
→ drain old generation
```

Customer Theme Profile data is migrated/validated under an expand-compatible plan. Incompatible profile or code migration is maintenance-required rather than hot-injected.

## Remote UI integration

Hot Application remote UI does not ship native theme implementations. The host maps its allowlisted component tree to current K-Nex components, so the same app follows the active Package/Skin/Profile.

App-specific arbitrary CSS is not allowed to escape the remote app root. A bounded app-local style contract may be evaluated later, separately from global theme authority.

## Accessibility acceptance

For each supported Theme Package and Skin state:

```text
contrast and forced colors
keyboard/focus visibility
reduced motion
target size
component semantic names/states
portal/overlay layering
SSR/hydration or remote-host consistency
visual regression across required surfaces
```

Token checks alone are insufficient.

## Lifecycle

```text
Theme Package install/update/remove  Platform Plugin release
Theme Package enable/select          profile publication when installed/ready
Theme Skin install/update/rollback   live generation
Theme Skin disable/remove            profile/reference checks + generation retirement
Theme Profile edit/publish/rollback  live customer data
```

An active skin/package cannot be removed until replacement/reference impact is resolved. Prior generation retention follows rollback and storage policy.

## Required tests

- skin manifest rejects executable content and unscoped CSS;
- path/asset/font/URL escape fails;
- same canonical document survives skin switch without mutation;
- invalid/accessibility-failing skin does not publish;
- activation/update/rollback is atomic under concurrent readers;
- remote UI follows host theme without loading app-native components;
- full Theme Package is routed to blue/green delivery;
- backup/restore reproduces active Package/Skin/Profile inventory.
