# ADR-0006: Theme Package Plus Runtime Theme Profile

- Status: accepted
- Date: 2026-08-25
- Decision owners: K-Nex platform maintainers
- Related: [Theme and design system](../18-theme-and-design-system.md), [UI composition runtime](../16-ui-composition-runtime.md)

## Context

Customers need strongly different visual languages such as minimal, neobrutalist, glassmorphism, or custom corporate systems. They should be able to adjust palettes, spacing, radius, shadows, typography, and variants without redeploying for every visual change.

However, storing arbitrary CSS or executable component code in the database creates security, migration, accessibility, and supportability problems. A theme also needs more than color tokens: complex primitives may require different DOM/component implementations and structural CSS.

## Decision

Split theme into two layers.

### Theme package

Installed, trusted executable code containing:

```text
stable theme plugin ID and version
token schema and defaults
named palettes
semantic primitive implementations
component variants
structural CSS
validation and accessibility rules
profile migrations
```

Installing or removing a theme package is a source-control/build/deploy operation.

### Runtime theme profile

Customer database data containing:

```text
selected installed theme ID/version family
surface (admin/public)
validated token values
selected palette and variants
light/dark policy
draft/published/archived revision metadata
```

Activating or adjusting an already installed theme can happen at runtime through a privileged theme manager after validation and publication.

Use separate admin and public theme profiles. Store profiles in a versioned collection with exactly one published default per active surface.

Do not allow arbitrary runtime CSS/JavaScript or database-driven package imports.

## Consequences

### Positive

- Customers can make broad visual adjustments without code deployments.
- Themes can implement genuinely different primitives, not only recolor one design system.
- Stored builder documents remain semantic and theme-independent.
- Runtime input remains schema-bounded and auditable.
- Admin and public experiences can use different design languages.
- Theme upgrades can migrate draft profiles before publication.

### Costs

- Theme packages must implement a primitive contract and test suite.
- Token schemas need versioning/migrations.
- Theme publication and rollback storage/UI must be built.
- Customer code overrides still require deployment and compatibility tests.
- Accessibility validation cannot cover every possible custom override automatically.

### Rules

- Database theme ID must exist in generated static registry.
- Profile values are validated on write and read.
- CSS variables are generated from typed tokens, not arbitrary declarations.
- Fonts/assets come from approved registries, not arbitrary remote URLs.
- Editor chrome remains system-safe; content preview uses selected theme.
- Active themes cannot be uninstalled before replacement publication.

## Alternatives considered

### CSS files only in each customer repository

Rejected as the only mechanism because routine palette/token changes would require code deployment and themes could not be productized as reusable packages.

### Database JSON tokens only

Rejected because visual systems may require different primitive implementations, structural CSS, and validation/migration code.

### Arbitrary CSS editor

Rejected for V1 because of security, supportability, cross-page side effects, and inability to guarantee accessible/valid output.

### One global theme for admin and public

Rejected because operational density and public brand expression often have different requirements.

## Validation or revisit trigger

Validate by rendering the same CMS and workspace documents with Minimal, Neobrutalism, and Glassmorphism packages; changing profiles at runtime; previewing drafts; upgrading a token schema; and proving server/client consistency and safe invalid-token fallback.
