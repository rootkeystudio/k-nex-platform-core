# ADR-0005: Unified Builder Contracts with Fixed Shell and Editable Canvas

- Status: accepted
- Date: 2026-08-25
- Decision owners: K-Nex platform maintainers
- Related: [UI composition runtime](../16-ui-composition-runtime.md), [Builder engine and profiles](../17-builder-engine-and-profiles.md)

## Context

K-Nex should support visual composition of both public CMS pages and authenticated dashboards/overview pages. Modules can provide UI blocks and logic, while each customer needs a different visual language.

Allowing the entire application—including navigation, authentication, system routes, and security settings—to be arbitrarily reconstructed would reduce supportability and increase authorization, migration, accessibility, and usability risks. Building unrelated page editors for CMS and dashboards would duplicate component, storage, migration, preview, and theme systems.

## Decision

Use one K-Nex-owned UI block/layout contract and one builder-provider abstraction with separate profiles:

```text
CMS profile
  public content blocks
  SEO/localization
  draft/preview/publish
  public theme

Workspace profile
  permission-aware data/actions
  dashboard/overview/report pages
  customer/role/user scopes
  realtime support
  admin theme
```

Keep the application shell fixed and platform-controlled:

```text
sidebar host
top bar
router
authentication boundary
notifications/dialogs
system/security screens
```

Module navigation is discovered dynamically, but the shell is not freely editable. Builder editing is limited to configured content canvases.

Operational transaction screens remain module-owned in V1 and can expose controlled extension slots.

Builder documents contain only registered block/data-source/action IDs and validated serializable data—no arbitrary code, SQL, imports, secrets, or unrestricted CSS.

## Consequences

### Positive

- CMS and workspace reuse component discovery, validation, migrations, preview, and theme rendering.
- Sidebar/routes remain stable and supportable.
- Modules can export reusable UI without owning customer styling.
- Public and authenticated policies remain explicit.
- Builder engine can be replaced behind an adapter.
- Operational screens keep reliable transaction-focused UX.

### Costs

- K-Nex must build data/action/permission/layout-inheritance systems above the visual editor.
- Some customers may request shell customization beyond V1 constraints.
- Canonical document translation to an editor engine requires a POC.
- Record/form/operational builders are deferred.

### Required boundaries

- Hiding UI is not authorization; server data/actions enforce policy.
- Domain modules export K-Nex contracts, not editor-engine types.
- Public blocks use explicit public projections/actions.
- Missing plugin components fail safely and remain diagnosable.
- Block identities and versions are persisted and migrated.

## Alternatives considered

### Fully editable application shell

Rejected for V1 due to security, supportability, route stability, and user-error risk.

### Separate CMS and dashboard editor architectures

Rejected because of duplication and inconsistent component/theme/migration behavior.

### No reusable module UI

Rejected because every customer would repeatedly implement common operational components despite shared backend logic.

### Fully visual operational application builder

Deferred. It would require robust form/workflow/transaction semantics and can be introduced through later controlled profiles.

## Validation or revisit trigger

Validate with a realistic cargo workspace dashboard and restaurant CMS site using the same builder architecture and different themes. Revisit shell constraints only after concrete customer needs identify safe extension points; do not make authentication/system security freely editable without a new ADR.
