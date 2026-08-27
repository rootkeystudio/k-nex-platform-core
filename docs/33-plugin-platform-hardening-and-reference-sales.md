# Plugin Platform Hardening and the Sales Reference Module

## Decision summary

K-Nex will stop expanding the first-party domain catalog until the plugin platform is complete enough that a new module can be implemented primarily by following one reference module and running one conformance suite.

The only first-party domain module used to shape the pre-v1 plugin authoring contract is:

```text
module.sales
```

Logistics, restaurant, inventory, budgeting, dispatch, driver, live-tracking, QR-menu, and similar domain modules remain product ideas and architecture blueprints. They are not active implementation targets before the platform, component system, lifecycle, and customer-application factory gates pass.

The working rule is:

> If a platform capability cannot be exercised through `module.sales`, first improve the platform or the Sales reference implementation. Do not create another domain module to discover the same missing contract a second time.

## Why one complete reference plugin

Parallel domain-module development would create multiple incomplete interpretations of the plugin contract. A single reference module gives K-Nex one executable answer for:

```text
package layout
manifest identity and compatibility
dependency/capability declarations
Payload schema and migrations
domain/application boundaries
permissions and settings
data sources and output contracts
actions and agent tools
events, jobs, outbox, and realtime topics
browser queries and mutations
headless UI components
Puck blocks and builder metadata
routes, navigation, and default pages
lifecycle and upgrade behavior
observability, audit, and health
fixtures, documentation, and conformance tests
```

Sales is intentionally not required to become a full commercial CRM before the contract is frozen. It must be broad enough to exercise every supported plugin surface with the smallest coherent business behavior.

## Plugin contribution model

Every contribution is explicit, statically inventoried, versioned where persisted, and reconciled declared-versus-actual. Database content cannot create executable contributions.

| Surface | Static contract | Executable binding | Sales reference proof |
|---|---|---|---|
| Identity | plugin ID, package, exact version, compatibility | installed package/lock integrity | `module.sales` package and manifest |
| Dependencies | required/optional plugins and capabilities | deterministic resolver grants | contracts/runtime/realtime capabilities |
| Payload schema | owned collections, globals, indexes, fields | Payload config composition | tasks and opportunities |
| Migrations | predecessor/current revision and owned migration inventory | customer-owned migration runner | fresh install and upgrade fixtures |
| Domain | public IDs and DTO schemas | services, commands, invariants | task and opportunity behavior |
| Permissions | permission IDs and policy metadata | actor/record/field evaluation | read revenue, private notes, task write |
| Settings | versioned schema, defaults, secret references | validated settings reader | sales pipeline and page defaults |
| Sources | descriptor, input/output schemas, fields, limits | authenticated source handlers | tasks table and revenue metric |
| Actions | descriptor, effects, input/output schemas | registered application commands | create task and update stage |
| Agent tools | explicit source/action projection | tool gateway and MCP adapter | search tasks and create task |
| Events | event IDs/classes and payload schemas | transactional outbox/subscribers | task/opportunity changed |
| Jobs | job/workflow descriptor and limits | worker handler | one bounded Sales maintenance job |
| Realtime | topic IDs, parameters, revision policy | authorized gateway publication | Sales source invalidation |
| UI | component/block descriptors and slots | browser-safe renderers | metric, task table, quick-create, detail blocks |
| Builder | Puck bridge metadata and profile policy | canonical adapter bindings | Sales blocks in CMS/workspace palettes |
| Routes | route IDs and typed parameters | fixed-shell route handlers | Sales overview, tasks, opportunities |
| Navigation | stable item IDs, route references, permission | resolved shell navigation | Sales section and child entries |
| Default pages | immutable template ID/version | idempotent seed/instantiate service | Sales overview and task index templates |
| Localization | message IDs and supported locales | loaded message catalog | English reference catalog |
| Observability | health/audit/metric categories | safe counters and audit decorators | source/action/job/tool outcomes |
| Lifecycle | states, owned data, reference behavior | install/enable/disable/re-enable/upgrade/purge | complete Sales lifecycle fixture |
| Testing | conformance declaration | standard plugin test runner | `module.sales` passes every required suite |

A plugin may omit optional surfaces. It must not declare a surface and leave it unbound, and it must not bind a contribution absent from the manifest-derived inventory.

## Authoring package boundaries

The public authoring experience should reuse existing K-Nex packages before introducing speculative wrappers. The intended import boundaries are:

```text
@k-nex/contracts
  serializable IDs, descriptors, schemas, DTOs, settings,
  source/action/tool/event/UI/template contracts

@k-nex/runtime
  capability-scoped server registration and execution ports

@k-nex/ui-runtime
  browser-safe query/action adapters, component/block registration,
  canonical document and page-template integration

@k-nex/plugin-testing
  conformance harness created only when Sales needs the shared runner
```

Module entrypoints remain physically separated:

```text
./manifest
./contracts
./server
./browser
./ui
./migrations
./testing
```

Third-party framework types, Payload internals, Puck types, MCP types, query-library types, and component-engine types do not enter persisted or public plugin contracts.

## Plugin settings

A plugin settings contribution contains:

```text
stable settings ID
schema version
strict runtime schema
default values
surface and audience
permission to read/change
secret-reference fields, never secret values
migration functions
feature/publication revision
```

Settings may configure already-installed behavior. They cannot:

```text
install packages
add schema or imports
create sources/actions/tools/blocks
change required topology
weaken permission or lifecycle policy
store arbitrary executable code or CSS
```

Sales must provide at least one safe setting used by its default page or source presentation so the contract is exercised end to end.

## Routes and navigation

Plugins declare route metadata without owning the application shell:

```text
route ID
typed path parameters
surface and audience
required permission
page/view ID
navigation relationships
```

Persisted documents and navigation items use route IDs plus typed parameters rather than unrestricted URLs. The fixed shell resolves them and remains responsible for authentication, error boundaries, breadcrumbs, page title, and global navigation behavior.

## Default pages and page templates

A plugin may contribute immutable source-controlled templates for useful first-run experiences.

A template contains:

```text
template ID and version
owner plugin
surface/profile
typed route assignment
canonical UiDocument
required plugin/source/block/theme capabilities
permission and publication policy
migration metadata
```

Template semantics:

1. Installation may instantiate a template idempotently.
2. The instantiated page is customer-owned mutable content.
3. A package upgrade never overwrites a customer-edited page.
4. New template versions are offered as an explicit create/compare/adopt operation.
5. Required system pages, if any, use a separate protected-page contract rather than silently treating defaults as immutable.
6. Missing capability or failed migration produces a diagnostic and preserves the last valid page.

Sales reference templates:

```text
sales.page.overview
sales.page.tasks
sales.page.opportunities
sales.page.settings
```

The first proof may keep the pages small, but each must use canonical K-Nex components and registered Sales sources/actions rather than custom one-off fetching or raw Payload access.

## Browser query and action authoring

Plugins do not invent a separate fetch/cache/mutation stack. They define typed factories over the standard gateways.

Implemented authoring shape:

```ts
export const salesTasksQuery = defineSourceQuery({
  source: { id: salesTasksDescriptor.id, version: salesTasksDescriptor.version },
  input: salesEmptyInputRuntimeSchema,
  output: salesTasksOutputRuntimeSchema,
  defaults: {},
  selectedFields: ["title", "status", "potential-revenue"]
});

export const salesCreateTaskMutation = defineActionMutation({
  action: { id: salesTaskCreateDescriptor.id, version: salesTaskCreateDescriptor.version },
  input: salesCreateTaskInputRuntimeSchema,
  output: salesCreateTaskOutputRuntimeSchema,
  invalidates: [salesTasksDescriptor.id, salesTotalPotentialRevenueDescriptor.id]
});
```

These helper names are frozen for the pre-v1 authoring contract. The invariant remains:

```text
plugin-specific types and defaults
+ platform-owned transport, identity, cache, authorization,
  cancellation, result-state, invalidation, and error behavior
```

Query-library state may be used behind the browser adapter. It is not persisted and is not exposed as the plugin contract.

## UI and Puck contributions

A plugin UI contribution separates:

```text
component descriptor
browser renderer
builder field model
canonical props schema
source/action bindings
surface/audience/permission policy
loading/empty/error/forbidden states
default page-template use
```

Sales will be the reference for at least:

```text
sales.metric.total-potential-revenue
sales.table.tasks
sales.form.task-quick-create
sales.list.opportunities
sales.detail.opportunity
sales.status.pipeline-stage
```

Each contribution must render outside Puck. The Puck adapter is only an authoring bridge over the same canonical component/block definition.

## Sales reference completeness gate

`module.sales` is considered a complete reference plugin only when one command can prove:

```text
manifest and package identity
clean composition and migration
declared-versus-actual contribution inventory
settings validation and migration
permission, record, and field boundaries
source/action/tool contracts
outbox/job/realtime behavior according to class
browser query/action factories
component and Puck runtime parity
default-page seed idempotency
server/browser/editor package boundaries
accessibility and theme compatibility
disable/re-enable and upgrade behavior
packed-package reproducibility
reference documentation generation
```

Authoritative command:

```text
pnpm plugin:check modules/sales
```

The command is runnable in a clean checkout and fails if required evidence is missing, a declared contribution is missing, an undeclared contribution appears, a browser entry imports server code, or a default page references an unavailable source/block/action.

## Plugin author documentation

The Sales module will serve as executable documentation, but code alone is insufficient. Gate 6 produces:

```text
plugin author quick start
contribution matrix
package/entrypoint template
source/action/tool examples
UI/Puck/default-page examples
settings and permissions example
migration and lifecycle guide
conformance command guide
failure diagnostics catalog
```

Examples are generated from or linked to tested Sales fixtures; duplicate prose-only contract shapes are not introduced.

## Freeze rule

Before the plugin authoring gate passes:

- no second first-party domain module is implemented;
- no compatibility layer is added for pre-v1 draft APIs;
- obsolete authoring helpers are removed rather than aliased;
- a new abstraction is accepted only when Sales needs it and the resulting code is reusable;
- customer-specific code may exist only as a fixture proving the platform boundary.

After the gate passes, new modules start from the Sales package structure and must pass the same conformance suite.

## Deferred product work

The following are deliberately deferred until the platform gates complete:

```text
logistics, dispatch, driver, and live-tracking products
restaurant, QR-menu, inventory, and budgeting products
broad CRM feature catalog beyond the reference Sales scope
AI assistant product and autonomous workflows
marketplace and third-party plugin distribution
commerce/payment verticals
```

Their architecture notes may remain as non-executable backlog context, but they do not select the next implementation task.

## Exit criteria

The plugin-platform hardening phase exits only when:

1. all supported plugin contribution categories have one normative contract;
2. Sales exercises every mandatory category and the selected optional categories;
3. plugin settings, routes, navigation, templates, UI, and builder contributions are deterministic and permission-aware;
4. one clean conformance command proves package boundaries and the complete reference fixture;
5. creating a second sample module would require domain code and descriptors, not a new platform mechanism;
6. the remaining platform gaps are documented as explicit later-gate work rather than hidden inside Sales.
