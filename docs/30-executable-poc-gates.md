# Executable Proof-of-Concept Gates

## Principle

A gate must be independently falsifiable. K-Nex will not build the entire platform and then try to infer which architectural assumption failed.

A gate starts only after its predecessor's contract/evidence is stable enough. Failure causes a documented redesign or rejection; it does not get hidden by adding more features.

The platform-foundation program deliberately uses `module.sales` as its only first-party domain module. Domain breadth is deferred until Gate 8.

## Gate 0 — Contract freeze and repository governance

Deliver:

```text
canonical ID grammar
plugin/application JSON Schemas
one plugin fixture
canonical registration phases
output-contract registry
ADR evidence registry
docs/schema/legacy-symbol CI
CODEOWNERS and PR checklist
```

Exit:

- validator passes in a clean checkout;
- intentional legacy fixture fails;
- two clean runs produce identical normalized schema/fixture outputs.

Kill/rework criterion: prose examples cannot be made consistent with machine-readable contracts without changing accepted product semantics.

## Gate 1 — Minimal deterministic composition

Scope:

```text
one customer repository
Payload + Postgres
contracts + resolver + composition + Payload adapter
one Sales module
one collection
one authenticated query
generated registries and resolved graph
one clean migration
boot inventory
```

Excluded: Puck, themes, WebSocket, retained-schema uninstall, second customer.

Exit:

- two clean directories generate byte-identical artifacts;
- graph matches package integrity and runtime registration;
- undeclared contribution/capability access fails;
- clean Postgres boot and migration pass.

Kill/rework criterion: identical normalized inputs cannot produce identical graph/registries or Payload composition needs a deep framework fork.

## Gate 2 — Data source, authorization, and output contracts

Scope:

```text
metric.scalar@1
table.records@1
Sales metric and paginated table sources
source/field/record authorization
required/optional fields
bounded sort/filter/page/query cost
source-specific + canonical contract validation
safe cache classes
RFC 9457 errors
```

Exit:

- source/field manipulation is denied;
- no unauthorized value enters result, cache, trace, or error;
- cache fixtures do not cross actor/policy boundaries;
- representative validation/query budgets pass;
- missing required authority creates explicit UI state.

Kill/rework criterion: safe cache identity is not expressible or validation/projection cost is unacceptable at representative sizes.

## Gate 2A — Agent tool contracts and safe execution

Scope:

```text
explicit plugin tool descriptors
actor/delegation-filtered catalog
source-backed read tool
action-backed write tool
execution-time authorization
approval and idempotency
budgets, timeout, audit
Payload MCP adapter
deterministic scripted client
```

Excluded:

```text
LLM/provider selection
prompt/conversation product
autonomous loops
agent-created tools
unattended destructive operations
durable asynchronous effects
```

Exit:

- only explicit static tools are discoverable;
- discovery filtering and execution authorization both hold;
- delegation cannot exceed principal authority;
- writes are approval- and idempotency-safe;
- output is valid, redacted, bounded, and audited;
- MCP does not weaken K-Nex policy or leak protocol types.

Kill/rework criterion: a tool bypasses source/action policy, runtime content creates tools, retries duplicate effects, or model/protocol types are required in core contracts.

## Gate 3 — Transactions, durable events, and realtime convergence

Scope:

```text
transactional outbox
leased idempotent processing
reconstructible invalidation
Socket.IO supported topology
worker-to-web relay
revision/watermark and resync
failure injection
```

Exit:

- durable intent survives crash and processes idempotently;
- rollback exposes no event/invalidation;
- unsupported topology fails closed;
- clients converge after loss/reconnect;
- subscription/session authorization is re-evaluated.

Kill/rework criterion: topology/durability cannot be stated honestly or clients can remain indefinitely stale.

## Gate 4 — Builder engine kill-spike

Scope:

```text
BuilderEngineAdapter
canonical document round-trip
fixed shell outside canvas
static and authenticated blocks
public/workspace policy separation
missing-block fallback
browser/server boundary
keyboard operation
```

Exit:

- canonical fixture round-trips without semantic loss;
- Puck types/config do not enter module contracts or persisted documents;
- public/internal binding policy is enforced;
- runtime rendering works without editor initialization;
- accessibility does not require a deep fork.

Kill/rework criterion: canonical mapping, fixed-shell policy, or accessible operation requires maintaining a deep Puck fork.

## Gate 5 — UI runtime, themes, and atomic CMS publication

Scope:

```text
small semantic primitive ABI
Minimal + Neobrutalism
WCAG acceptance journeys
UiDocumentRuntime/Repository split
atomic page+document publish/rollback
published layout snapshot + constrained patch
```

Exit:

- same document renders under both themes without mutation;
- keyboard/focus/target/motion/high-contrast journeys pass;
- failed validation rolls back publication;
- concurrent publication is ordered/idempotent;
- layout resolution is deterministic and explainable.

## Gate 6 — Plugin platform hardening and Sales reference module

Scope:

```text
complete contribution taxonomy
plugin authoring/package boundaries
settings and permissions
routes and navigation
default page templates and seed semantics
browser query/action factories
component/Puck contribution contracts
complete Sales reference plugin
plugin conformance kit
install/enable/disable/re-enable
```

No second domain module is allowed.

Exit:

- every supported contribution category is machine-readable and reconciled;
- Sales exercises all mandatory categories;
- default pages seed idempotently and upgrades do not overwrite customer edits;
- plugin UI uses standard source/action/query/component contracts;
- one clean conformance command proves package, runtime, UI, builder, and lifecycle boundaries;
- a second module would require domain code, not a new platform mechanism.

Kill/rework criterion: plugin completeness requires ambient authority, duplicate transport/UI stacks, runtime-created executable contributions, or multiple modules to define the same platform contract.

## Gate 7 — Comprehensive headless component system

Scope:

```text
Component Gallery 60-family coverage matrix
K-Nex foundation/layout/content components
forms and input family
navigation/disclosure/overlays
feedback/media/content adapters
DataTable/DataGrid and query utilities
page templates
Sales default pages
Puck component/block library
SSR/hydration, accessibility, theme, bundle, and performance gates
```

The small theme ABI remains small. Compound behavior is platform-owned and styled through tokens/slots/recipes.

Exit:

- every Component Gallery family has an executable disposition;
- Sales pages use only K-Nex components and standard query/action factories;
- DataTable supports authorized pagination/filter/sort/selection/actions/realtime refetch;
- Minimal and Neobrutalism render the same state matrix without behavior forks;
- browser accessibility, SSR/hydration, bundle, and representative performance budgets pass;
- plugins do not import theme packages or third-party behavior engines directly where K-Nex coverage exists.

Kill/rework criterion: component coverage requires turning every theme into a separate component framework, leaks third-party types into K-Nex contracts, or cannot preserve authority/accessibility through the data and builder paths.

## Gate 8 — Lifecycle, application factory, release, and fleet safety

Scope:

```text
package release/compatibility boundaries
upgrade planning and customer migrations
migration advisory lock and readiness fence
archive/export, purge, backup, restore
create-knex-app and composition plan/apply
two Sales-only customer applications
SBOM and signed provenance
deployment receipt/runtime inventory
fleet query and security patch propagation
previous-release upgrade fixture
```

Cargo and Restaurant modules are not introduced. Two independent Sales-based customers prove composition reuse with different themes, settings, permissions, layouts, lockfiles, and release cadence.

Exit:

- disable/re-enable/upgrade preserve declared behavior and data;
- stale artifacts and concurrent migrations fail safely;
- purge requires reference, backup, and migration evidence;
- a clean customer app can be generated and booted from exact packages;
- one customer upgrades while another stays on a supported prior release;
- fleet inventory derives from verifiable deployed evidence;
- a vulnerable range identifies every affected deployment;
- backup restore reproduces the expected runtime inventory.

Kill/rework criterion: independent customer upgrades cannot be made deterministic and recoverable, destructive lifecycle remains ambiguous, or fleet evidence depends on manually asserted state.

## Post-Gate 8

Only after Gate 8 project-manager PASS may the roadmap select a new domain/product module. Candidate work includes full CRM, CMS features, logistics, restaurant, inventory, budgeting, AI assistant productization, commerce, and third-party plugin distribution.

The selected module begins from the Sales package structure and passes the same plugin/component conformance suites.

## Evidence promotion

After a gate passes, update `docs/adr/evidence-registry.json` with links to:

```text
implementation commit/PR
test fixture and CI run
benchmark/failure injection
migration/upgrade/restore fixture
deployment receipt when production-observed
```

An accepted design remains `design-only` until its complete ADR scope has executable evidence.