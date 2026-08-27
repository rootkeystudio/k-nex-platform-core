# Plugin Authoring

This is the pre-v1 authoring contract proved by `module.sales`. Until Gate 8 passes, Sales remains the only first-party domain module; use it to harden platform mechanisms instead of adding domain breadth.

## Quick start

1. Follow the entrypoint split in the tested [Sales package](../modules/sales/package.json): `manifest`, `contracts`, `server`, `browser`, `ui`, `migrations`, and `testing`.
2. Declare every contribution in [the static manifest](../modules/sales/k-nex.plugin.json), then register it through [the phased server plan](../modules/sales/src/server.ts). Database content cannot register executable behavior.
3. Keep contracts free of React, Puck, Payload, MCP, and query-library types. Keep browser/UI entrypoints free of server and Payload imports. The executable check is [the Sales boundary test](../modules/sales/scripts/check-boundaries.mjs).
4. Add a strict [conformance plan](../modules/sales/k-nex.conformance.json) and run `pnpm plugin:check <plugin-directory>`.

## Contribution matrix

The canonical category list, phase, and authority live in [the typed contribution registry](../packages/contracts/src/plugin-contribution-taxonomy.ts). Sales declares and exercises schema, migrations, services, permissions, settings, sources, actions, tools, events, jobs, realtime topics, components, blocks, routes, navigation, page templates, localization, health/audit, lifecycle, and testing metadata. Required declarations must reconcile with runtime registration; optional declarations may be absent, but undeclared runtime contributions always fail.

## Entrypoints and package boundary

Use [the Sales export map](../modules/sales/package.json) as the package template. Only declared files enter the tarball. [The reproducibility check](../modules/sales/scripts/check-pack.mjs) compares every packed entry with the customer-installed artifact, while [the customer composition test](../modules/sales/tests/payload-composition.test.ts) proves public entrypoint loading and Payload ownership.

## Sources, actions, and tools

- Author source/action DTOs and descriptors in [Sales contracts](../modules/sales/src/contracts.ts).
- Bind authenticated, actor-scoped server handlers in [Sales server](../modules/sales/src/server.ts). Module UI never receives raw Payload access.
- Define browser execution through [standard query/action factories](../modules/sales/src/browser.ts); injected platform transport owns cancellation, identity, result state, and invalidation.
- Project only explicit sources/actions into tools. The tested tool gateway and MCP adapter remain platform boundaries; a plugin does not expose automatic CRUD.

## UI, Puck, routes, and default pages

[Sales UI bindings](../modules/sales/src/ui.ts) separate canonical descriptors from browser renderers. Every component renders outside the editor. Puck reconciles the same renderer and persisted props rather than owning a parallel component model. Default pages are immutable package templates; [the page-template runtime](../packages/runtime/src/page-template.ts) creates customer-owned instances idempotently, preserves edits, and requires explicit compare/adopt for later versions.

Routes use stable IDs and typed parameters. Navigation resolves route and permission metadata through platform contracts; unrestricted URLs and permission bypasses fail validation.

## Settings and permissions

[Plugin settings contracts](../packages/runtime/src/plugin-settings.ts) are strict and revisioned. Store secret references, never secret values. Settings may configure installed behavior but cannot change imports, topology, contribution inventory, or lifecycle policy. Permissions are explicit application/record/field/aggregate metadata and remain necessary but not sufficient; server policy still scopes actors, records, and fields.

## Migrations and lifecycle

Plugins ship migration metadata, while customer applications own executable migrations. The Sales proof is [customer migration revision 6](../fixtures/customer-gate-1/src/migrations/20260827_000006_sales_opportunities.ts).

[The lifecycle runtime](../packages/runtime/src/plugin-lifecycle.ts) keeps catalog support, installed bytes, enabled state, settings readiness, migration readiness, data state, and release support independent. Install planning is source-controlled and requires deployment. Disable retains package/schema/data and read compatibility while gating writes, sources, actions, tools, jobs, navigation, routes, components, blocks, and page behavior. Re-enable requires current settings and migration readiness. Schema-owning uninstall remains unsupported; destructive work starts with a deterministic reference scan. Archive/export, purge, upgrade, backup, and restore remain Gate 8.

## Conformance command

`pnpm plugin:check modules/sales` runs the strict plan through [the conformance runner](../scripts/plugin-conformance.mjs). Every required evidence class must be covered exactly once. Named Node proofs must resolve by real path inside the target plugin, receive runner-owned plugin identity, and pass exactly one named test. Package-boundary and reproducibility evidence is implemented directly by the repository runner rather than plugin-selected scripts. The suite covers manifest/schema/exact runtime inventory, package boundaries, deterministic customer inventory, fresh migration/boot, lifecycle, Sales settings/permission attacks, registered Sales source/action/tool/event/realtime/job execution, runtime/Puck parity, default-page idempotency, Sales accessibility smoke, and packed reproducibility.

The plan cannot point at another workspace package, escape the target plugin, select arbitrary scripts, duplicate evidence, or introduce arbitrary command shapes. [Negative runner tests](../scripts/plugin-conformance.test.mjs) prove those cases fail closed.

## Diagnostic catalog

| Surface | Stable diagnostic source | Typical correction |
|---|---|---|
| Manifest/schema | generated AJV/Zod and repository diagnostics | fix the authoring manifest or canonical fixture, then regenerate |
| Registration | `RegistrationError.code` in [registration runtime](../packages/runtime/src/registration-runtime.ts) | align phase, declaration, owner, binding, capability, and inventory |
| Settings | strict settings runtime errors | remove executable/topology keys, raw secrets, or invalid revisions |
| Page templates | page-template preflight result | install the exact source/action/block/capability or preserve last valid instance |
| Lifecycle | `PluginLifecycleError.code` in [lifecycle runtime](../packages/runtime/src/plugin-lifecycle.ts) | restore exact package/readiness, resolve references, or use a supported operation |
| Conformance | proof ID plus captured runner output | run/fix the named proof; never add a marker without executable evidence |

Do not add aliases or compatibility shims for discarded pre-v1 helper names. Update callers, fixtures, tests, generated artifacts, and documentation atomically.
