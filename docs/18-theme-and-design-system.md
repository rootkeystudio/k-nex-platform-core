# Theme and Design System

## Purpose

K-Nex modules export style-agnostic UI behavior. Customer applications select one or more installed theme packages and store adjustable theme profiles in their own database.

The system separates executable design code from runtime-adjustable values:

```text
theme package
  = token schema + palettes + semantic primitives + component adapters + structural CSS

theme profile
  = selected installed theme + validated customer-adjustable values + revision/publication state
```

A new theme package requires a code change, package installation, build, and deployment. Changing colors, spacing, radius, shadow, typography settings, or the active installed theme profile does not require a new deployment.

## Theme plugin examples

```text
@k-nex/theme-minimal
@k-nex/theme-neobrutalism
@k-nex/theme-glassmorphism
@k-nex/theme-corporate
```

Stable plugin IDs:

```text
theme.minimal
theme.neobrutalism
theme.glassmorphism
theme.corporate
```

## Theme surfaces

V1 supports separate profiles for:

```text
admin    authenticated workspace, CMS editor content preview, system pages
public   websites, public forms, QR menus, public tracking projections
```

The editor chrome itself should use a stable system-safe appearance. The editable preview/canvas uses the selected admin or public content theme.

Future surfaces can include:

```text
driver
mobile
email
print
```

A theme declares supported surfaces. An admin-only theme cannot be selected as the public theme unless the package explicitly supports public rendering.

## Theme plugin contract

```ts
export interface KNeXThemeDefinition<TTokens> {
  manifest: {
    id: string
    version: string
    displayName: string
    supportedSurfaces: readonly ThemeSurface[]
    compatibility: {
      uiContracts: string
      core?: string
    }
  }

  tokenSchema: Schema<TTokens>
  defaultTokens: TTokens
  palettes: Record<string, Partial<TTokens>>
  variants?: Record<string, Partial<TTokens>>

  primitives: DesignSystemPrimitiveAdapter
  componentVariants?: ThemeComponentVariantRegistry
  structuralStylesheets?: readonly string[]

  validate?(tokens: TTokens): ThemeValidationResult
  migrate?: ThemeProfileMigration[]
}
```

Example:

```ts
export default defineTheme({
  manifest: {
    id: 'theme.neobrutalism',
    version: '1.0.0',
    displayName: 'Neobrutalism',
    supportedSurfaces: ['admin', 'public'],
    compatibility: {
      uiContracts: '^1.0.0',
    },
  },
  tokenSchema,
  defaultTokens,
  palettes,
  primitives,
  structuralStylesheets: ['./styles/structure.css'],
})
```

## Design-system primitive contract

Modules should render through semantic primitives rather than importing a customer UI library directly.

Initial primitive catalog:

```text
Box
Stack
Inline
Grid
Container
Text
Heading
Link
Button
IconButton
Card
Badge
Metric
Table
DataGrid adapter
Input
Textarea
Select
Checkbox
Radio
Switch
DatePicker adapter
Dialog
Drawer
Popover
Tooltip
Tabs
Accordion
Menu
CommandMenu
Toast
Skeleton
EmptyState
ErrorState
Pagination
FormField
```

Specialized complex UI can provide domain components but should still consume primitives where practical.

Contract example:

```ts
export interface ButtonPrimitiveProps {
  variant?: 'primary' | 'secondary' | 'quiet' | 'danger'
  size?: 'sm' | 'md' | 'lg'
  loading?: boolean
  disabled?: boolean
  type?: 'button' | 'submit' | 'reset'
  onClick?: () => void
  children: React.ReactNode
}
```

The contract describes semantic intent, not DOM implementation or CSS class names.

## Structural CSS versus brand styling

Modules and primitives may ship minimum structural styles required for correct behavior:

- screen-reader-only utilities;
- focus traps and overlay geometry;
- virtualization container rules;
- map/canvas sizing;
- drag-and-drop geometry;
- table layout behavior;
- reduced-motion handling;
- accessible hidden content.

They must not ship customer-specific visual decisions:

- customer colors;
- logos;
- brand fonts;
- marketing gradients;
- fixed theme-specific shadows;
- hard-coded design language;
- assumptions such as all primary buttons are blue.

Theme packages own presentation. Customer repositories own brand assets and final deliberate overrides.

## Token model

Suggested token groups:

```ts
interface ThemeTokens {
  colors: {
    background: string
    surface: string
    surfaceElevated: string
    foreground: string
    foregroundMuted: string
    primary: string
    primaryForeground: string
    secondary: string
    secondaryForeground: string
    accent: string
    danger: string
    warning: string
    success: string
    border: string
    focus: string
  }

  typography: {
    bodyFont: string
    headingFont: string
    monoFont: string
    baseSize: number
    scaleRatio: number
    bodyWeight: number
    headingWeight: number
    lineHeight: number
  }

  spacing: {
    unit: number
    content: number
    section: number
    page: number
  }

  radius: {
    input: number
    button: number
    card: number
    modal: number
  }

  border: {
    width: number
    strongWidth: number
  }

  shadow: {
    card: ShadowToken
    popover: ShadowToken
    modal: ShadowToken
  }

  motion: {
    durationFast: number
    durationNormal: number
    easingStandard: string
  }
}
```

A theme can extend this schema with namespaced tokens, for example:

```text
glass.opacity
glass.blur
glass.borderOpacity
brutal.shadowOffsetX
brutal.shadowOffsetY
brutal.shadowBlur
```

The runtime exposes only values validated by the selected theme's schema.

## Neobrutalism example

```ts
const defaultTokens = {
  colors: {
    primary: '#ffde59',
    secondary: '#ff5757',
    background: '#fffef8',
    surface: '#ffffff',
    foreground: '#111111',
    border: '#111111',
    focus: '#3457ff',
  },
  border: {
    width: 3,
    strongWidth: 4,
  },
  radius: {
    input: 0,
    button: 0,
    card: 0,
    modal: 0,
  },
  brutal: {
    shadowOffsetX: 6,
    shadowOffsetY: 6,
    shadowBlur: 0,
  },
  typography: {
    headingWeight: 800,
    bodyWeight: 500,
  },
}
```

The theme package provides semantic primitive implementations that interpret these tokens consistently, such as bordered cards and offset shadows. The database stores selected/adjusted values, not arbitrary CSS source.

## Glassmorphism example

```ts
const defaultTokens = {
  colors: {
    primary: '#7c5cff',
    background: '#0d1021',
    surface: '#ffffff',
    foreground: '#ffffff',
    border: '#ffffff',
    focus: '#b7a8ff',
  },
  radius: {
    input: 12,
    button: 14,
    card: 20,
    modal: 24,
  },
  glass: {
    opacity: 0.12,
    blur: 18,
    borderOpacity: 0.22,
  },
}
```

The theme validator must still enforce readable foreground/background combinations and provide a fallback for environments where backdrop filtering is unavailable or undesirable.

## Palettes

A theme can ship named starting palettes:

```ts
palettes: {
  sunflower: {
    colors: {
      primary: '#ffde59',
      secondary: '#ff5757',
    },
  },
  ocean: {
    colors: {
      primary: '#53d8fb',
      secondary: '#5d5fef',
    },
  },
}
```

Selecting a palette copies or references validated starting values into a draft theme profile. Customers can then adjust allowed parameters.

A palette is not a separate package and does not change plugin dependencies.

## Runtime theme profile

Suggested persisted shape:

```ts
interface ThemeProfile {
  id: string
  name: string
  surface: 'admin' | 'public'

  themeId: string
  themePackageVersion: string
  themeSchemaVersion: number

  paletteId?: string
  tokens: Record<string, unknown>
  componentVariants?: Record<string, string>

  modePolicy: 'light' | 'dark' | 'system' | 'user-selectable'

  status: 'draft' | 'published' | 'archived'
  revision: number
  baseRevisionId?: string

  createdBy: string
  updatedBy: string
  publishedBy?: string
  publishedAt?: string
}
```

Current decision: theme profiles use a versioned collection rather than one mutable global record. This supports drafts, revisions, rollback, multiple candidate profiles, and separate public/admin publication.

Exactly one published default profile exists per active surface, enforced transactionally.

## Installation versus activation

### Install theme package

```bash
k-nex theme add theme.neobrutalism
```

Effects:

- add exact package dependency;
- update `k-nex.app.json` installed themes;
- regenerate static theme registry;
- build and deploy application;
- optionally create an initial draft profile.

### Activate installed theme

Can occur through CLI or privileged runtime panel:

```bash
k-nex theme set theme.neobrutalism --surface public
```

Effects:

- validate selected installed theme;
- create/update a draft profile;
- preview;
- publish runtime profile;
- no package install and no code download.

A database value can only select a theme ID already present in the generated static registry.

## Static theme registry

Generated example:

```ts
// Generated. Do not edit.
export const themeRegistry = {
  'theme.minimal': () => import('@k-nex/theme-minimal'),
  'theme.neobrutalism': () => import('@k-nex/theme-neobrutalism'),
  'theme.glassmorphism': () => import('@k-nex/theme-glassmorphism'),
} as const
```

The runtime never evaluates a package name from database input.

Resolution:

```text
read published theme profile
  → verify theme ID is installed
  → load static theme package
  → migrate profile if supported/required
  → validate tokens against schema and accessibility rules
  → generate CSS variables and primitive provider
  → render page/workspace
```

## CSS variable generation

Validated tokens are compiled into namespaced variables:

```css
:root {
  --kn-color-background: #fffef8;
  --kn-color-surface: #ffffff;
  --kn-color-foreground: #111111;
  --kn-color-primary: #ffde59;
  --kn-border-width: 3px;
  --kn-radius-card: 0px;
  --kn-brutal-shadow-x: 6px;
  --kn-brutal-shadow-y: 6px;
}
```

Rules:

- values are generated from a schema, not string-concatenated arbitrary CSS;
- unsafe URL/function syntax is rejected in token types that do not permit it;
- variables are injected once per surface/theme boundary, not per block;
- server and client resolve the same profile revision to prevent hydration mismatch;
- cache keys include theme profile revision.

## Typography and fonts

Theme packages describe semantic typography roles. Customer repositories provide licensed font assets or allowed remote/local font configuration.

A runtime user should not be able to enter arbitrary remote font URLs. Font selection is from an installed/approved font registry.

Suggested font registry:

```ts
export const customerFonts = defineFontRegistry({
  inter: localFont(...),
  spaceGrotesk: localFont(...),
})
```

Theme profile stores approved IDs:

```json
{
  "typography": {
    "bodyFont": "inter",
    "headingFont": "spaceGrotesk"
  }
}
```

## Component variants

Some presentation differences cannot be represented by numeric/color tokens alone. Themes can expose named variants:

```text
card: flat | bordered | elevated | glass
button: solid | offset-shadow | outline | soft
navigation: compact | comfortable
input: filled | outlined
```

The profile selects from the package-declared enum. It cannot provide arbitrary React components or class strings.

## Customer code overrides

A customer repository can override semantic primitives or domain renderers for exceptional design work:

```ts
export default defineCustomerConfig({
  ui: {
    primitiveOverrides: {
      Card: AcmeCard,
    },
    blockRendererOverrides: {
      'crm.pipeline-summary': AcmePipelineSummary,
    },
  },
})
```

Overrides are code, not runtime theme profile values. They require review, testing, build, and deployment.

Rules:

- override IDs must target documented contracts;
- accessibility and behavior contract tests still apply;
- customer overrides cannot bypass server authorization;
- overrides are visible in generated inventory/diagnostics.

## Theme manager UI

A privileged theme manager can provide:

- installed theme list and versions;
- surface compatibility;
- palette selection;
- token editors generated from schema metadata;
- light/dark preview;
- responsive CMS/workspace preview;
- validation and contrast feedback;
- draft revisions;
- publish/rollback;
- export/import of profile JSON for the same installed theme/version family;
- audit history.

It cannot:

- install npm packages;
- run arbitrary CSS or JavaScript;
- edit application routes or permissions;
- reference secrets;
- load a non-installed theme ID;
- publish invalid token values.

## Token editor metadata

Schemas should include editor hints:

```ts
field.color({
  label: 'Primary color',
  contrastAgainst: ['primaryForeground'],
})

field.number({
  label: 'Card radius',
  minimum: 0,
  maximum: 40,
  unit: 'px',
})

field.number({
  label: 'Glass blur',
  minimum: 0,
  maximum: 40,
  unit: 'px',
})
```

Ranges prevent pathological or unusable values while preserving meaningful customization.

## Accessibility validation

Before publication, validate at least:

- text/background contrast for primary semantic pairs;
- focus indicator visibility;
- error/warning/success distinguishability;
- minimum interactive target sizes through primitive contracts;
- motion duration and reduced-motion fallback;
- disabled-state readability;
- chart palette distinguishability where chart tokens are exposed.

Validation levels:

```text
error    cannot publish; core accessibility/security invariant broken
warning  allowed only with privileged override and audit reason
info     recommendation or preview concern
```

A theme package should ship automated fixtures covering its default palettes.

## Builder integration

The same stored CMS/workspace document can render under different theme profiles without changing block data.

Builder preview receives:

```text
selected surface
selected theme package
selected draft/published profile revision
responsive viewport
light/dark mode
current UI registry
```

Layout blocks configure semantic tokens, such as `gap: spacing.section`, rather than raw CSS values. Theme changes therefore update the visual result coherently.

The editor chrome remains readable even when previewing high-contrast, transparent, or unconventional public themes.

## Public/admin separation

A customer can use:

```text
admin: theme.minimal
public: theme.neobrutalism
```

This is expected, not exceptional. Operational users may need dense, calm application UI while the public website uses an expressive brand style.

Shared brand values can be referenced through a customer brand profile, but public and admin theme tokens remain independently publishable.

## Brand profile

Theme is not the only branding data. A separate brand profile may own:

```text
product/customer display name
logos
favicon
approved fonts
support/contact links
legal footer content
social preview assets
terminology overrides
```

Themes consume approved brand assets by ID. Keeping brand identity separate allows theme switching without losing logos/content.

## Theme migrations

When a theme token schema changes, the package supplies deterministic migrations:

```ts
export const migrateNeobrutalism1To2 = defineThemeMigration({
  fromSchemaVersion: 1,
  toSchemaVersion: 2,
  migrate: old => ({
    ...old,
    brutal: {
      shadowOffsetX: old.shadow?.x ?? 6,
      shadowOffsetY: old.shadow?.y ?? 6,
      shadowBlur: old.shadow?.blur ?? 0,
    },
  }),
})
```

Upgrade flow:

```text
install new theme package version
  → inspect profile compatibility
  → create migrated draft revisions
  → validate and preview
  → publish deliberately
  → retain previous published revision for rollback
```

A package upgrade must not silently publish a visually changed theme profile.

## Theme removal

A theme package cannot be uninstalled while:

- it is the published default for any surface;
- any draft/published profile still requires its renderer and no migration/replacement is selected;
- stored page/workspace revisions are guaranteed to need theme-specific component variants that cannot fall back safely.

Typical flow:

```text
select/install replacement
  → migrate/copy draft profile
  → preview and publish replacement
  → archive old profiles
  → uninstall package while preserving profile history if desired
  → purge archived profile data only by explicit policy
```

## Security

Runtime-adjustable theme values are untrusted input.

Controls:

- schema validation on write and read;
- allowlisted token types and ranges;
- no arbitrary CSS declarations;
- no `javascript:` URLs;
- no arbitrary remote asset/font URLs;
- CSS variable escaping;
- Content Security Policy compatible rendering;
- permission-protected draft/publish actions;
- audit records for publication and rollback;
- server-side registry verification of theme ID/version.

A theme package is trusted application code and follows the same package supply-chain controls as other plugins.

## Performance and rendering

- Theme packages are statically importable and code-splittable.
- The active profile revision can be cached per surface.
- Generated CSS variables are small and stable.
- Public page cache keys include page revision and theme revision.
- Admin theme changes should invalidate shell/theme caches without invalidating unrelated domain data.
- Avoid shipping every installed theme's full CSS to every route; load selected adapters where possible.

## Testing

Each theme package must pass:

- token schema/default validation;
- palette validation;
- primitive contract suite;
- server/client render consistency;
- accessibility checks for default palettes;
- CMS and workspace builder preview fixtures;
- representative module component fixtures;
- migration fixtures from supported previous schema versions;
- missing/invalid token fallback behavior;
- light/dark/system mode behavior if supported.

Customer applications should run cross-theme smoke tests for the themes they install.

## V1 decisions

| Question | Decision |
|---|---|
| Is a theme executable code or only JSON? | Theme is an installed code package; profile is validated JSON/data. |
| Where are adjustable values stored? | Customer database in versioned theme profiles. |
| Can the panel install themes? | No. It can configure and activate already installed themes. |
| Can users enter arbitrary CSS? | No. |
| Can customer developers override components? | Yes, through reviewed code in the customer repository. |
| Are admin and public themes separate? | Yes. |
| Can a theme switch happen without deploy? | Yes, among already installed themes after profile validation/publication. |
| Does a new theme require deploy? | Yes. |
| Are theme profiles draft/published? | Yes. |
| Is the editor chrome themed by public theme? | No; only the content preview uses it. |
