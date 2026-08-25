# K-Nex Implementation Master Plan — Codex Execution Contract

- **Status:** active execution plan
- **Scope:** Gate 0 through Gate 7
- **Architecture authority:** accepted ADRs, machine-readable contracts, and architecture documents
- **Execution authority:** `status.md` selects the only task that may be implemented
- **Detailed Phase 0 plan:** [`phase-0.md`](./phase-0.md)
- **Gate definitions:** [`../30-executable-poc-gates.md`](../30-executable-poc-gates.md)

## 1. Purpose

This file is the single orchestration source for agentic implementation after Phase 0. It contains the ordered phase map, work packages, boundaries, required evidence, stop conditions, and handoff protocol.

It exists so the operator does not have to carry implementation context manually between the project manager and Codex. Codex must recover the current task from the repository itself.

This plan is not a replacement for architecture decisions. Resolve conflicts in this order:

1. machine-readable contracts and generated schemas;
2. accepted ADRs and their evidence registry;
3. architecture documents;
4. this execution plan;
5. PR descriptions and implementation notes.

No implementation task may silently reinterpret an accepted contract.

## 2. One instruction to give Codex

Use this instruction for every new Codex session:

```text
Fetch the latest main branch. Read AGENTS.md, status.md, and
`docs/implementation/codex-master-plan.md`. Execute only the active task
recorded in status.md. Follow its entry criteria, allowed scope, acceptance
commands, and stop conditions. Update status.md in the same implementation
commit, open a pull request, and stop without merging or enabling auto-merge.
```

The operator should not need to explain the previous task, current phase, next task, package boundaries, or acceptance criteria. Those must be recovered from `main`.

## 3. Mandatory execution protocol

### 3.1 Task selection

Codex must:

1. fetch latest `main`;
2. read [`../../AGENTS.md`](../../AGENTS.md);
3. read [`../../status.md`](../../status.md);
4. find the exact active task ID in this file;
5. read the linked architecture documents for that task;
6. implement only that task.

If the active task is absent, ambiguous, already complete, or blocked, Codex must stop and report the inconsistency. It must not select a nearby task by inference.

### 3.2 Branch and pull request

Use:

```text
branch: codex/<task-id-lowercase>-<short-slug>
PR title: <type>: <task outcome>
```

Examples:

```text
codex/p1-2-static-manifest-loader
codex/p2-4-source-authorization
codex/p4-3-puck-round-trip
```

One pull request implements one bounded work package unless the task explicitly defines a smaller PR sequence.

### 3.3 Required task output

Every implementation PR must include:

```text
What changed
Files/packages affected
Architecture constraints preserved
Commands run
Test and CI results
Known limitations
Exact next task
```

Every agent-authored repository commit must update `status.md` according to `AGENTS.md`.

### 3.4 Review boundary

Codex must never:

- merge its own pull request;
- enable auto-merge;
- advance `status.md` beyond `Ready for review`;
- start the next task before the current PR is reviewed and merged;
- convert a failed kill criterion into a workaround without a project-manager decision.

The reviewer/project manager:

1. inspects the actual diff and executable evidence;
2. returns `PASS`, `REWORK`, `BLOCKED`, or `REJECT`;
3. on `PASS`, updates `status.md` to the next task before merge;
4. merges only after the final head passes required checks.

### 3.5 Global engineering rules

Across all phases:

- preserve modular package boundaries and directed dependencies;
- implement the smallest end-to-end slice that fully proves the current requirement;
- reuse stable behavior, but do not create speculative abstractions;
- before v1.0, remove obsolete unreleased paths instead of adding compatibility aliases or fallbacks;
- prefer current approved dependencies and official framework capabilities;
- verify package documentation and installed types before adding or reimplementing behavior;
- exact-pin direct dependencies and commit the lockfile;
- do not expose third-party types as persisted or public K-Nex contracts;
- do not put executable package selection, imports, schema composition, or secrets in runtime data;
- do not claim evidence maturity that the current phase has not proved.

## 4. Phase dependency map

```text
Phase 0  contract freeze and repository governance
   ↓
Phase 1  minimal deterministic Payload composition
   ↓
Phase 2  authenticated data sources and output contracts
   ↓
Phase 3  transactions, durable events, and realtime convergence
   ↓
Phase 4  builder engine kill-spike
   ↓
Phase 5  UI runtime, themes, and atomic CMS publication
   ↓
Phase 6  lifecycle, migrations, and upgrade safety
   ↓
Phase 7  second customer and verifiable fleet operations
```

A later phase may not begin because its code appears easy. It begins only after the previous result document records `GO` and `status.md` names the first task of the next phase.

Each phase must add or maintain one local/CI entry point:

```text
pnpm phase:0
pnpm gate:1
pnpm gate:2
pnpm gate:3
pnpm gate:4
pnpm gate:5
pnpm gate:6
pnpm gate:7
```

A gate command must fail on the first failed requirement, require no production secret, and be the command executed by its required CI workflow.

## 5. Phase 0 — Contract Freeze and Repository Readiness

### Objective

Prove that public architecture contracts have one typed authoring source, deterministic artifacts, fixture-backed validation, reproducibility, and enforced repository governance.

The detailed plan remains [`phase-0.md`](./phase-0.md). Do not duplicate or reinterpret its implementation details here.

### Work packages

```text
P0.1  pinned repository toolchain                         complete
P0.2  typed contract-authoring source                    complete
P0.3  valid and invalid fixture corpus                   complete
P0.4  executable repository validation                   complete
P0.5  generation reproducibility                         complete
P0.6  CI and repository governance                      verified; merge evidence pending
P0.7  gate closeout and evidence promotion              next
```

### P0.7 — Close the gate and promote evidence

#### Entry criteria

- PR #12 is independently approved and merged.
- Active `main` and `v*` rulesets remain enforced.
- Issue #2 remains closed with evidence.
- `pnpm phase:0` passes on latest `main`.

#### Required changes

Create:

```text
docs/implementation/phase-0-result.md
```

Record only observed facts:

```text
P0.1–P0.6 PRs and merge commits
successful and intentional-failure CI runs
exact Node/pnpm/TypeScript/Zod/Ajv/Vitest tuple
valid/invalid fixture inventory
contract-generation method and reproducibility digest
main and release-tag ruleset identifiers
repository visibility decision
remaining limitations
explicit GO or REWORK decision
```

Update `docs/adr/evidence-registry.json` only where the entire ADR decision has executable evidence. ADR-0014 is the expected Phase 0 promotion candidate. Runtime, Payload composition, source gateway, realtime, builder, theme, lifecycle, and production claims remain `design-only`.

Update `status.md` to:

```text
Phase 1 — Minimal Deterministic Payload Composition
P1.1 — Freeze the executable framework tuple and Gate 1 fixture shell
Ready to start
```

#### Acceptance

```bash
pnpm install --frozen-lockfile
pnpm phase:0
git diff --check
git status --porcelain --untracked-files=all
```

The result must state explicitly that Phase 0 proves repository contracts and governance only; it does not prove Payload boot, Postgres migration, plugin runtime, UI, or deployment behavior.

#### Stop condition

If evidence references are incomplete, nonexistent, aspirational, or point to unmerged code, return `REWORK Phase 0`. Do not start Phase 1.

---

## 6. Phase 1 — Minimal Deterministic Payload Composition

- **Gate mapping:** Gate 1
- **Goal:** turn one exact application manifest and one exact module package into a deterministic resolved graph, generated static registries, a composed Payload application, a clean Postgres migration, one authenticated query, and a verified runtime inventory.

### 6.1 Phase boundaries

Included:

```text
one fixture customer application
Payload + Postgres
contracts/composition/runtime/Payload adapter boundaries
one module
one collection
one authenticated query
one customer-owned migration
one deterministic resolved graph
one generated static registry set
one protected runtime inventory
```

Excluded:

```text
full CLI product
CMS or builder
React UI and themes
data-source gateway
output-contract execution
Socket.IO, Redis, outbox
plugin disable/uninstall/purge
second customer
package publication
```

### P1.1 — Freeze the executable framework tuple and Gate 1 fixture shell

#### Goal

Select and pin one officially compatible Payload/Next/React/Node/pnpm tuple and create the smallest customer fixture capable of becoming a real Payload application.

#### Required work

- Verify the exact compatible tuple against official Payload documentation and installed package peer dependencies.
- Exact-pin direct packages and update the lockfile.
- Add only the minimal package/application directories required by Gate 1.
- Add a fixture application manifest using the existing generated schema.
- Add a `pnpm gate:1` placeholder that fails until the final Gate 1 task wires the complete command.

Expected shape:

```text
packages/composition/
packages/runtime/
packages/payload-adapter/
packages/testing/
modules/sales/
fixtures/customer-gate-1/
```

Do not add empty framework layers without an immediate Gate 1 responsibility.

#### Acceptance

- frozen install succeeds;
- framework peer dependencies are clean;
- fixture manifest validates;
- no Payload app behavior is claimed yet;
- `status.md` advances only to P1.2 after review.

### P1.2 — Load static package manifests and installed package identity

#### Goal

Load side-effect-free `k-nex.plugin.json` data from exact installed packages without executing module server code.

#### Required behavior

```text
package name/version/integrity
plugin ID/kind/version
compatibility tuple
required/optional/conflicting dependencies
provided capabilities
expected contribution inventory
lifecycle declaration
environment variable names
```

The loader must reject package/manifest/version mismatch, malformed static metadata, duplicate plugin IDs, unsupported framework tuple, and undeclared files masquerading as manifests.

Use package exports and lockfile/package-manager information; do not scan arbitrary runtime directories or import plugin server entrypoints.

### P1.3 — Implement the minimal deterministic resolver

#### Goal

Resolve the Gate 1 graph with formal, testable semantics rather than catalog order or runtime discovery.

#### Required scope

```text
exact requested plugin versions
direct required dependencies
optional dependency activation only when explicitly installed
conflicts
shortest explainable required cycle
single-cardinality capability selection when applicable
prerelease only when exactly requested
canonical deterministic ordering
```

Create a CLI-independent golden corpus for success and failure cases. The resolver version must be explicit in its output.

Do not implement a general SAT solver if the accepted rules can be satisfied by a smaller deterministic graph algorithm.

### P1.4 — Generate the resolved graph and static registries

#### Goal

Produce deterministic committed artifacts from normalized manifest, exact installed manifests, lock/integrity data, resolver version, and hermetic customer config fingerprint.

Minimum artifacts:

```text
.k-nex/generated/k-nex.resolved.json
.k-nex/generated/plugin-registry.ts
.k-nex/generated/payload-contributions.ts
.k-nex/generated/runtime-registration.ts
.k-nex/generated/environment-schema.ts
```

The resolved graph includes no timestamp, hostname, absolute path, random value, secret, or environment value. Two independent staged paths must produce byte-identical artifacts.

Runtime data may configure installed code but may not change imports or graph membership.

### P1.5 — Implement phased registration and declared-versus-actual inventory

#### Goal

Execute the canonical registration lifecycle with restricted phase APIs and compare actual contributions with static declarations.

Canonical phases:

```text
manifest
contracts
providers
schema
behavior
jobs
data-handlers
ui
admin
validate
freeze
```

Gate 1 only needs the subset exercised by the minimal module, but the phase state machine and freeze invariant must be real.

Required failures:

```text
registration in the wrong phase
undeclared contribution
undeclared capability token access
duplicate contribution ID
late registration after freeze
manifest/actual inventory mismatch
```

A plugin receives capability-scoped services, not a universal public service locator.

### P1.6 — Compose the minimal Payload application

#### Goal

Compose Payload config through the dedicated adapter without arbitrary deep merge or framework patching.

The Sales module contributes one owned collection, for example `sales-tasks`, with:

```text
stable collection ownership
a minimal authenticated read policy
one domain-neutral test fixture
no builder/data-source contract yet
```

The application uses Payload's Postgres adapter selected in framework configuration. K-Nex does not add another ORM or primary database abstraction.

Required checks include duplicate collection slug, route/index collision where applicable, request context propagation, and server/browser package separation.

### P1.7 — Prove customer-owned migration and clean Postgres boot

#### Goal

Generate/review one customer-owned migration, run it against a real disposable Postgres instance, boot the application, and verify the expected predecessor/current revision.

Use Testcontainers with the approved Postgres package. Do not mock migration, transaction, or database behavior.

Required paths:

```text
empty database → current migration → boot
already current database → no-op/status
failed migration → non-ready application
older/incompatible revision → readiness failure
```

The production advisory-lock mechanism is Phase 6; Gate 1 only proves clean deterministic migration ownership and revision awareness.

### P1.8 — Add one authenticated query and protected runtime inventory

#### Goal

Demonstrate that the composed application can authenticate one actor, query the one collection through supported Payload request/access behavior, and expose a non-secret inventory matching the resolved graph.

This is not the generic data-source gateway. Use the narrowest supported Payload endpoint/query path that proves request, actor, access, and registration wiring.

The inventory must bind:

```text
application ID
source commit/artifact identity available in the fixture
resolved graph digest
exact package/plugin versions
expected and actual contributions
migration revision
```

No secret, connection string, token, or internal stack details may appear.

### P1.9 — Gate 1 failure corpus, reproducibility, and closeout

#### Goal

Wire `pnpm gate:1`, add failure tests, and create `docs/implementation/phase-1-result.md`.

Required failure corpus:

```text
package/manifest mismatch
ambiguous provider selection when exercised
required dependency cycle
undeclared contribution
wrong-phase registration
duplicate collection/contribution
stale generated registry
non-deterministic config input
failed/incorrect migration revision
unauthenticated query
```

#### Gate 1 acceptance

```bash
pnpm install --frozen-lockfile
pnpm phase:0
pnpm gate:1
git diff --check
git status --porcelain --untracked-files=all
```

Two clean staged roots must produce the same resolved graph and generated registries. A real Postgres fixture must migrate and boot.

#### Kill/rework criteria

Return `REWORK Phase 1` when:

- identical normalized inputs do not produce identical graph/registries;
- Payload composition requires a maintained deep fork, monkey patch, or private-internal dependency;
- static declarations cannot be reconciled with executable registration;
- customer-owned migrations cannot be generated and tested reliably.

---

## 7. Phase 2 — Authenticated Data Sources and Output Contracts

- **Gate mapping:** Gate 2
- **Goal:** expose deliberate, bounded, permission-aware module projections that generic consumers can use without exposing raw Payload collections or inventing a query language.

### 7.1 Phase boundaries

Included:

```text
metric.scalar@1
table.records@1
source descriptors and server handlers
standard authenticated source gateway
source/record/field authorization
required/optional field behavior
bounded page/sort/filter/query cost
safe cache classes
RFC 9457 errors
one Sales metric source
one Sales table source
validation benchmark
```

Excluded:

```text
Puck and visual builder
full React dashboard
arbitrary transform/query language
raw collection exposure
Socket.IO transport
cross-module joins
category/time charts unless added as a narrow follow-up after Metric/Table pass
```

### P2.1 — Implement canonical Metric and Table contract schemas

Create typed Zod authoring sources, generated JSON Schema where required, runtime validators, fixtures, and semantic-value tests for:

```text
metric.scalar@1
table.records@1
```

Requirements include exact decimal strings where precision matters, currency/unit metadata, explicit comparison sentiment, stable opaque field IDs, selected/authorized values, null-versus-omitted semantics, bounded page information, and registered route references instead of unrestricted URLs.

Do not add an untyped extension bag.

### P2.2 — Define source descriptor and handler registration APIs

Separate:

```text
contracts entrypoint  descriptor, schemas, permissions, fields, limits, policy metadata
server entrypoint     executable handler and domain/query service binding
browser entrypoint    typed transport client only when needed
```

A source has one primary projection contract and one exact source-specific schema. Source major and output-contract major remain independent.

Implement only the authoring surface required by the Sales sources; avoid a speculative source framework.

### P2.3 — Build the staged data-source gateway pipeline

Implement the standard route as orchestration over independently tested stages:

```text
RequestAuthenticator
SourceCatalog
SurfaceAudienceGuard
AuthorizationEvaluator
QueryBudgetEvaluator
HandlerDispatcher
SourceSchemaValidator
OutputContractValidator
ProjectionRedactor
CachePolicyEvaluator
ObservabilityDecorator
ProblemDetailsSerializer
```

The secure order is:

```text
authorize requested fields
→ query only permitted projection
→ validate source-specific result
→ validate output contract
→ defensively redact
→ cache/observe/serialize
```

Do not fetch broad private objects and strip fields after cache or telemetry.

### P2.4 — Implement source, record, and field authorization

Use the authenticated Payload request/actor context and module-owned policy service. Prove:

```text
source permission
record policy
field permission
impersonation-aware context where supported
public/internal source separation
manual request manipulation denial
```

Bindings and requests distinguish:

```text
required field  missing authority returns explicit insufficient-permission state
optional field  may be omitted without changing the component's declared meaning
```

UI hiding or descriptor omission is not the security boundary.

### P2.5 — Add bounded query semantics and abuse budgets

Implement only source-declared operations:

```text
cursor or page pagination
allowlisted sort fields
allowlisted filter fields/operators
selected field limit
body/depth/page/result-byte limit
timeout/cancellation
per-actor/source concurrency
rate/burst and cost class
```

Batching is disabled by default. Plugins may request lower limits but cannot silently raise platform ceilings.

### P2.6 — Implement safe cache classifications

Support:

```text
no-store
actor
authorization-context
public
```

Internal sources default to `actor` or `no-store`. An authorization-context key must include a stable permission/policy revision or fingerprint covering relevant membership, impersonation, selected fields, surface, locale/timezone when semantic, and publication/feature revision.

Role name alone is not a cache key. Unauthorized values must never enter a broader cached result.

Start with in-memory test adapter if sufficient for the gate; the public contract must not expose the cache library.

### P2.7 — Implement the Sales proof sources

Minimum:

```text
sales.total-potential-revenue → metric.scalar@1
sales.tasks                   → table.records@1
```

The metric aggregates server-side. The table declares stable fields, field permissions, server pagination, allowlisted filtering/sorting, and one required sensitive field scenario.

Several external sources may share one internal query/projection family; one external source must not become a multi-output query language.

### P2.8 — Add headless binding result states and client query identity

Without introducing the visual builder, prove a generic consumer can represent:

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
stale/refetching
```

Define stable query identity from source/version, validated input, selected fields, surface, semantic locale/timezone, publication revision, and authorization boundary.

Use TanStack Query only behind a K-Nex adapter if a browser proof is required; do not persist TanStack types in contracts.

### P2.9 — Benchmark, attack, and close Gate 2

Create `pnpm gate:2` and `docs/implementation/phase-2-result.md`.

Required tests:

```text
direct source/record/field manipulation
required versus optional field behavior
cross-actor and cross-policy cache isolation
unauthorized value absent from query result/cache/log/error
invalid source and output contract fail closed
body/filter/field/page/time/cost limit enforcement
malformed RFC 9457 response prevention
realistic table and metric validation benchmark
```

Record representative dataset size, hardware/runner class, p50/p95 validation/query overhead, and accepted budget. Do not describe a micro-benchmark as production capacity.

#### Kill/rework criteria

Return `REWORK Phase 2` when:

- a safe cache identity cannot be stated;
- field authorization occurs only after broad private data enters cache/telemetry;
- contract validation/projection overhead is unacceptable at representative sizes;
- source authoring requires arbitrary user queries or raw collection exposure.

---

## 8. Phase 3 — Transactions, Durable Events, and Realtime Convergence

- **Gate mapping:** Gate 3
- **Goal:** prove that correctness-relevant event intent survives crashes and that realtime clients converge after loss, reconnect, topology changes, and permission revocation.

### 8.1 Phase boundaries

Included:

```text
event durability classes
transactional outbox
idempotent processor
reconstructible source invalidation
Socket.IO provider candidate
single-process memory topology
distributed worker/web topology
revision/watermark and resync
subscription authorization and revocation
failure injection
```

Excluded:

```text
full logistics tracking product
route optimization
high-frequency GPS history platform
mobile application
production fleet deployment
```

### P3.1 — Implement event classes and transactional outbox schema

Model:

```text
ephemeral-hint
reconstructible-invalidation
durable-integration
durable-workflow
```

Durable classes require outbox intent written in the same database transaction as authoritative state. Provider selection cannot downgrade durability.

Define versioned event envelopes, correlation/causation, actor metadata, idempotency, attempt/checkpoint/dead-letter state, retention, and safe payload rules.

### P3.2 — Prove transaction atomicity and rollback silence

Using real Postgres and Payload transaction behavior, prove:

```text
commit → state and outbox both durable
rollback → neither state nor event/invalidation escapes
commit then process crash → outbox intent remains
```

No external network effect occurs inside the database transaction.

### P3.3 — Implement idempotent outbox processing

Use Payload Jobs Queue as the first adapter unless measured evidence requires another queue.

Prove:

```text
claim/lease
retry/backoff
duplicate delivery
idempotent subscriber effect
poison/dead-letter handling
checkpoint for long work
observable backlog and failure
```

Jobs receive capability-scoped services and least-privileged actor/system context.

### P3.4 — Define `realtime.gateway` and implement Socket.IO memory mode

Keep Socket.IO types inside the provider package. Register typed channel/topic factories and subscription authorization; clients do not invent raw room strings.

Memory mode is valid only when one compatible process owns all sockets and all direct invalidation publication paths.

### P3.5 — Enforce process-topology compatibility

Represent process topology in deployment/config validation and `k-nex doctor`.

Reject memory mode when:

```text
multiple web instances
separate worker publishes invalidations
separate realtime gateway
rolling topology cannot preserve publication path
```

The error must identify the incompatible publication path and supported remedies.

### P3.6 — Prove a distributed publication path

Choose the simplest accepted option that supports the fixture:

```text
Socket.IO Redis adapter with ioredis
or
Postgres outbox relay consumed by the socket-owning process
```

Do not implement both unless the first cannot satisfy the gate. Modules continue to depend only on `realtime.gateway`.

### P3.7 — Implement source revisions and convergence

Invalidation is a hint, not state. Every query-capable client proves:

```text
authoritative initial fetch
source/snapshot revision or watermark
newer-revision cache invalidation
reconnect/resume uncertainty → refetch
window-focus revalidation for workspace client
bounded periodic revalidation by freshness class
permission/subscription reauthorization
```

A lost Pub/Sub or WebSocket message cannot leave the client indefinitely stale.

### P3.8 — Implement subscription security and backpressure

Bound and test:

```text
origin/transport policy
authenticated or narrow public session
channel parameter validation
source/record permission
connection/subscription/message/rate limits
buffer size/coalescing
slow-consumer disconnect
session and permission revocation
safe logging/metrics
```

Full business records are not the default invalidation payload.

### P3.9 — Failure injection and Gate 3 closeout

Create `pnpm gate:3` and `docs/implementation/phase-3-result.md`.

Inject:

```text
commit then process crash
rollback
duplicate outbox event
worker-to-web invalidation
lost Pub/Sub message
socket reconnect during rolling deployment
permission revocation during subscription
slow consumer
backplane unavailable/recovered
```

#### Kill/rework criteria

Return `REWORK Phase 3` when:

- durable intent can be lost after commit;
- provider contracts cannot state topology and durability honestly;
- an authorized client can remain indefinitely stale after message loss;
- permission revocation cannot terminate or constrain an existing subscription.

---

## 9. Phase 4 — Builder Engine Kill-Spike

- **Gate mapping:** Gate 4
- **Goal:** determine whether Puck can edit K-Nex canonical documents inside a fixed shell without owning storage/runtime contracts, leaking server code, confusing public/workspace authority, or requiring a maintained deep fork.

### 9.1 Phase boundaries

Included:

```text
minimal canonical UI document
BuilderEngineAdapter
UiDocumentRuntime minimum
one static block
one authenticated data block
fixed shell outside canvas
CMS/workspace policy separation
missing-block fallback
browser/server bundle checks
keyboard and non-drag operation
```

Excluded:

```text
broad CMS feature set
full theme manager
large component catalog
layout inheritance product
production publication workflow
rich text/maps/advanced grids
```

### P4.1 — Freeze the minimal canonical document schema

Define only the persisted data required by the spike:

```text
document/profile/schema version
regions and nodes
block ID/version
validated static props
source/state/context bindings
selected stable fields
layout constraints/tokens
namespaced optional engine metadata
```

Forbid Puck types, arbitrary JavaScript, SQL, package paths, secret values, unrestricted URLs, and arbitrary style objects.

Provide valid/invalid fixtures and deterministic migrations for the spike version.

### P4.2 — Implement the minimal `UiDocumentRuntime`

The runtime owns:

```text
document validation
block/source compatibility
profile/surface policy
permission-aware rendering decisions
missing-block/source behavior
migration dispatch
rendering outside the editor
```

It must not import the editor engine.

### P4.3 — Define `BuilderEngineAdapter` and implement Puck round-trip

The adapter owns only:

```text
canonical document ↔ Puck representation
palette/field/slot bridge
editor host
minimal namespaced Puck metadata
editor diagnostics
```

Prove a canonical fixture can be loaded, edited, serialized, loaded again, and compared semantically without loss.

### P4.4 — Prove fixed shell and profile-specific palettes

Authentication, routing, sidebar host, top bar, system/security screens, and global dialogs remain outside the canvas.

CMS and workspace can share the engine but use different block/source/action allowlists and publication rules.

### P4.5 — Add one static and one authenticated data block

Minimum:

```text
static Card/Text block
workspace Metric or DataTable block bound to a Phase 2 source
```

Public and workspace authority-bearing IDs are distinct. Authenticated preview must not make an internal source publishable.

### P4.6 — Missing component, migration, and safe fallback

Prove behavior for:

```text
missing plugin
missing block version
missing source or selected field
incompatible structural hash
failed document migration
```

Content is not silently deleted. Runtime shows safe fallback; readiness/orphan reporting identifies owner and remediation.

### P4.7 — Enforce bundle and runtime boundaries

Required checks:

```text
Puck package absent from production renderer bundle where editor is not used
server/Payload code absent from browser exports
module contracts contain no Puck types
persisted fixtures contain no Puck implementation types/config
runtime renderer works without editor package initialization
```

### P4.8 — Accessibility kill-spike

Prove:

```text
keyboard-only block selection and editing
visible/unobscured focus
non-drag alternative for reorder/move
semantic names/roles/states
minimum target-size policy
screen-reader smoke path
```

### P4.9 — Gate 4 decision

Create `pnpm gate:4` and `docs/implementation/phase-4-result.md` with one of:

```text
ACCEPT PUCK
REWORK ADAPTER/DOCUMENT
REJECT PUCK AND EVALUATE CRAFT.JS THROUGH THE SAME CONTRACTS
```

#### Kill/rework criteria

Reject or rework when lossless round-trip, fixed-shell policy, public/workspace separation, runtime independence, or accessible operation requires a maintained deep Puck fork.

---

## 10. Phase 5 — UI Runtime, Themes, and Atomic CMS Publication

- **Gate mapping:** Gate 5
- **Goal:** prove that one canonical document renders under materially different themes, supports accessible semantic primitives, publishes CMS page metadata and UI document atomically, and resolves workspace layouts deterministically.

### 10.1 Phase boundaries

Included:

```text
small semantic primitive ABI
React Aria behavior foundation
Minimal and Neobrutalism themes
typed theme profiles and publication
UiDocumentRepository
atomic CMS page/document publish and rollback
layout assignments and constrained user patches
WCAG 2.2 AA acceptance journeys
```

Excluded:

```text
full theme marketplace
Glassmorphism unless needed after two-theme proof
arbitrary CSS/JS editor
complete CMS feature catalog
advanced DataGrid/map/rich-text behavior
```

### P5.1 — Implement the small semantic primitive ABI

Start only with the accepted V1 base set needed by the proof:

```text
Box / Stack / Inline / Grid / Container
Text / Heading / Link
Button / IconButton
Card / Badge / Status
Input / Textarea / Select / Checkbox / FormField
Dialog / Popover / Tooltip
Toast / Skeleton / EmptyState / ErrorState
simple Table / Pagination
```

React Aria Components provides accessible behavior behind K-Nex primitives. Domain modules import K-Nex primitives, not React Aria types where a primitive exists.

Complex DataGrid, DatePicker, chart, map, rich text, command menu, and resizable grid remain separate adapters.

### P5.2 — Define theme package and profile schemas

Theme package owns executable schema, palettes, recipes, structural CSS, migrations, and optional approved primitive overrides.

Theme profile owns validated runtime values, draft/published revisions, surface, and selected installed theme.

Forbid arbitrary CSS, class names, functions, imports, remote font URLs, secrets, and uninstalled theme IDs.

### P5.3 — Implement Minimal theme

Use the smallest complete implementation of the base ABI. Prove server/client profile revision consistency, token-to-CSS-variable generation, light/dark modes where required, and no hydration mismatch.

### P5.4 — Implement Neobrutalism theme

Render the same canonical document and primitive fixtures with materially different tokens/recipes without mutating the document or module code.

Do not fork primitive interaction behavior merely to achieve a visual difference.

### P5.5 — Implement `UiDocumentRepository`

Use Payload storage for:

```text
drafts
immutable published revisions
lineage
rollback
query/index strategy
validation status
```

The repository does not own editor-engine conversion or runtime rendering policy.

### P5.6 — Prove atomic CMS page and document publication

In one real transaction/integration fixture:

```text
page metadata draft
document draft
public block/source/action/theme validation
atomic publication of one page+document revision pair
failure rollback
published pair lookup
rollback to previous pair
cache/invalidation only after commit
```

Localization and SEO fields included in the fixture must not break atomic revision pairing.

### P5.7 — Implement deterministic workspace layout resolution

Use explicit assignments:

```text
assignment ID
subject selector
layout revision
priority
active interval
reason/source
```

Published customer/group layouts are immutable snapshots with lineage. User personalization is a constrained patch for allowed move/hide/resize/prop operations.

A user with multiple roles/groups must produce one deterministic, explainable result. Keep the last valid resolved snapshot after conflict or migration failure.

### P5.8 — Accessibility and visual acceptance

Target WCAG 2.2 AA for supported proof surfaces. Test:

```text
keyboard
focus visible and not obscured
non-drag alternatives
target size
semantic names/roles/states
reduced motion
forced colors/high contrast
screen-reader smoke journeys
both themes
customer override fixture
```

Automated checks do not replace required manual smoke evidence.

### P5.9 — Gate 5 closeout

Create `pnpm gate:5` and `docs/implementation/phase-5-result.md`.

#### Kill/rework criteria

Return `REWORK Phase 5` when:

- the same document requires theme-specific mutation;
- atomic page/document publication cannot be guaranteed;
- multi-assignment layout resolution is nondeterministic or unexplained;
- accessibility blockers require replacing the semantic primitive or builder foundations rather than ordinary fixes.

---

## 11. Phase 6 — Lifecycle, Migrations, and Upgrade Safety

- **Gate mapping:** Gate 6
- **Goal:** prove safe install, upgrade, disable, re-enable, archive/export, purge, and migration concurrency behavior for one schema-owning plugin without promising generic retained-schema uninstall.

### 11.1 Phase boundaries

Included:

```text
lifecycle planner and state model
install/enable
disable/re-enable
package upgrade
customer-owned migrations
Postgres advisory lock
expected predecessor and stale-artifact fence
archive/export project
explicit purge
source/block/theme/document migrations
previous-release fixtures
```

Excluded:

```text
generic schema-owning retained-data uninstall guarantee
runtime package installation
marketplace
multi-customer rollout automation
```

### P6.1 — Implement lifecycle state and planning model

Represent independently:

```text
catalog support
installed package bytes
enabled state
runtime settings/features
migration readiness
data retention/archive state
release/support state
```

A plan records manifest/package/lock changes, providers/topology, schema/migration impact, stored references, environment names, rollback limits, and required approvals.

Plan inputs are fingerprinted; apply refuses stale plans.

### P6.2 — Prove install, enable, disable, and re-enable

For the schema-owning Sales module:

```text
install/enable → collection and behavior available
disable → schema/data retained, declared writes/actions/jobs/navigation/public behavior gated
re-enable → behavior restored after readiness checks
```

Disable semantics must be explicit and testable; it is not inferred from plugin kind.

### P6.3 — Prove package upgrade and customer-owned migration

Use an actual previous package/application fixture. The upgrade plan identifies package, source, contract, schema, document, theme, and process changes.

Generate/review the final customer migration; never edit an executed migration. Use expand/contract when overlapping versions are promised.

### P6.4 — Implement migration concurrency and stale-artifact fence

Production-style migration fixture:

1. derive lock key from application ID and database identity;
2. obtain PostgreSQL advisory lock on a dedicated session;
3. verify expected predecessor revision;
4. run reviewed migration/backfill;
5. record new migration/release revision;
6. release lock;
7. make older incompatible artifact fail readiness.

Test simultaneous migration attempts and interrupted execution.

### P6.5 — Implement explicit archive/export project

Define and test:

```text
export format/version
encryption and access policy
external reference handling
restore/read path
retention and deletion decision
proof that archive can be read before purge
```

Archive is not a boolean lifecycle flag and not a substitute for backup.

### P6.6 — Implement explicit purge safety

Purge refuses without resolved:

```text
dependent plugins/integrations
stored document/source/action/block references
jobs/outbox/events
retention/legal requirements
successful export or approved exception
restorable backup evidence
reviewed destructive migration
rollback/irreversibility acknowledgment
audit approval
```

Purge is source-controlled release work, not an admin-panel delete button.

### P6.7 — Implement source, block, theme, and document migrations

Trusted deterministic migrations create new drafts, preserve last valid published revisions, and report orphan/incompatibility instead of silently deleting content.

Before v1.0, remove obsolete unreleased shapes and update all fixtures/callers atomically; do not add compatibility layers merely to preserve experimental paths.

### P6.8 — Previous-release, overlap, restore, and rollback fixtures

Test:

```text
fresh install
previous deployed revision → target
old/new process overlap where promised
interrupted resumable backfill
backup restore with external effects disabled/redirected
no unsafe outbox/job replay
application rollback separate from data/content/theme rollback
```

### P6.9 — Gate 6 closeout

Create `pnpm gate:6` and `docs/implementation/phase-6-result.md`.

A schema-owning compatibility package or retained-schema uninstall may be researched as a separate optional experiment after Gate 6; failure or omission does not block V1.

#### Kill/rework criteria

Return `REWORK Phase 6` when:

- disable cannot preserve data while gating declared behavior;
- migration concurrency can race;
- an older incompatible artifact can report ready after a newer migration;
- purge can bypass dependency/reference/retention/backup evidence;
- previous-release upgrade cannot be reproduced.

---

## 12. Phase 7 — Second Customer and Verifiable Fleet Operations

- **Gate mapping:** Gate 7
- **Goal:** prove that released shared packages compose into two independently deployed customer products with different modules/themes/release cadences, and that deployed versions are discoverable from verifiable evidence rather than manual claims.

### 12.1 Phase boundaries

Included:

```text
first Cargo/Sales fixture application
second Restaurant/CMS fixture application
same released packages, different composition
different themes and public/internal sources
independent lockfiles/migrations/releases
automated upgrade PR generation
SBOM and signed build provenance
deployment receipt and runtime inventory
fleet vulnerability query and patch propagation
restore/upgrade fixture
```

Excluded:

```text
full cargo product
full restaurant ERP
shared multi-tenant runtime
plugin marketplace
complete mobile driver app
route optimization/accounting/advanced inventory
```

### P7.1 — Stabilize package release boundaries

Pack/install the exact shared packages used by both fixtures. Validate exports/types with `publint` and Are the Types Wrong, exact integrity, no server code in browser packages, and no customer-specific branch in shared code.

Choose the registry/release mechanism through an executable publish/install spike; do not add a second package architecture.

### P7.2 — Build the Cargo fixture from released packages

Composition may include the proven Sales core plus the smallest logistics proof needed to demonstrate domain package reuse. It owns its repository/manifest/lockfile/migrations/theme/assets/deployment fixture.

Do not turn the fixture into a complete logistics product.

### P7.3 — Build the Restaurant fixture from the same release line

Minimum differentiated composition:

```text
module.cms
module.restaurant.core
module.restaurant.qr-menu
module.visualization when required
builder selected by Gate 4
different installed public/admin theme profiles
explicit public menu source excluding internal cost fields
```

Customer-specific policy remains in the customer repository until real reuse is demonstrated.

### P7.4 — Prove independent upgrade cadence

Generate an upgrade PR for Cargo while Restaurant remains on the previous supported package tuple. Then upgrade Restaurant separately.

Each PR owns its lockfile, generated graph, migration fixture, artifact, approval, and rollback notes.

No central operation may silently rewrite all customer repositories.

### P7.5 — Produce verifiable build evidence

For each customer artifact produce:

```text
source commit/workflow identity
resolved graph digest
lockfile digest
package integrity inventory
SBOM
artifact/container digest
signed hosted-build provenance
migration revision
```

Do not claim a SLSA level until the evidence is independently verified against that level.

### P7.6 — Produce deployment receipt and runtime inventory

A deployment receipt binds:

```text
application/environment
artifact digest
migration revision
provider/process topology
deployment workflow/approved actor
smoke/readiness result
deployment time
```

The protected runtime inventory must match the artifact and database revision without exposing secrets.

### P7.7 — Implement fleet evidence collection and query

Fleet data is derived from deployment receipts, runtime inventories, SBOMs, and artifact digests. A manual operations file may store owner/support tier/desired target, but it cannot override observed deployed versions.

Required query:

```text
Given package/version or vulnerable range,
list every deployed customer artifact and environment affected.
```

### P7.8 — Prove security patch propagation

Release one shared security-relevant package patch. Prove:

```text
affected fleet query
automated customer-specific upgrade PRs
independent test/migration/deployment approval
one customer upgraded first
other customer remains safely on supported prior release until its window
post-deploy inventory confirms remediation
rollback path remains customer-specific
```

### P7.9 — Restore, previous-release, and operational proof

For both fixtures test:

```text
previous release → current upgrade
backup restore or reproducible rebuild classification
external integrations disabled/redirected during restore
published CMS/workspace render smoke
authentication/signing reconfiguration
outbox/job replay safety
runtime inventory after restore
```

### P7.10 — Gate 7 closeout

Create `pnpm gate:7` and `docs/implementation/phase-7-result.md`.

The result must answer:

```text
Can two customers consume the same released packages without core forks?
Can they upgrade independently?
Can we identify every deployed customer affected by a package range?
Can build and deployment claims be verified from evidence?
Is the architecture ready for a production-product roadmap?
```

Possible decisions:

```text
GO TO PRODUCT ROADMAP
REWORK PACKAGE/FLEET MODEL
REJECT INDEPENDENT-CUSTOMER DELIVERY MODEL
```

#### Kill/rework criteria

Return `REWORK Phase 7` when:

- customer-specific conditionals enter shared packages;
- the second customer requires copying/patching platform source;
- deployed versions cannot be derived from verifiable evidence;
- one customer cannot upgrade without forcing the other;
- security range queries cannot identify affected artifacts reliably.

---

## 13. Cross-phase quality gates

Every phase must preserve:

### Determinism

```text
exact direct dependencies
frozen lockfile
canonical generated artifacts
no time/path/host/random/secret in committed generation
clean-tree check
staged-path reproducibility for deterministic generators
```

### Security

```text
server-side authorization
least-privileged/capability-scoped services
bounded inputs and resource use
safe errors and logs
no secret in events/inventory/evidence
public and authenticated authority separated by identity
trusted-package supply-chain controls acknowledged
```

### Package boundaries

```text
contracts do not import framework/engine implementations
browser exports do not import server code
modules do not import customer code
core/composition do not import business modules
runtime data does not select imports or packages
third-party types remain behind adapters
```

### Testing

```text
unit tests for pure policy/algorithms
contract fixtures for public shapes
real Postgres for migrations/transactions
failure injection for durability/convergence
browser tests for UI/accessibility
previous-release fixtures for upgrades
packed-package tests for release boundaries
```

### Documentation and evidence

```text
status.md current and compact
phase result records observed evidence only
ADR maturity promoted only for fully proved decision scope
open limitations remain explicit
all referenced paths and CI runs exist
```

## 14. Decision and stop protocol

Codex must stop and open a decision request when:

- an accepted architecture invariant cannot be implemented with the approved framework/library without weakening it;
- a public or persisted contract must change outside the active task;
- a new dependency family or provider abstraction is required;
- a phase kill criterion is observed;
- the simplest complete implementation conflicts with a long-term accepted boundary;
- official package behavior or types contradict the plan;
- a required test needs secrets, production data, or unsupported external access.

A decision request must include:

```text
observed fact
minimal reproduction
current contract/decision affected
options with consequences
recommended option
work that remains valid regardless of the decision
```

Do not merge a knowingly temporary stopgap while waiting for a decision.

## 15. Post-Gate 7 boundary

This master plan intentionally ends at Gate 7. It proves or rejects the platform foundations; it does not pre-approve a full product backlog.

Only after Gate 7 may the project manager create the production roadmap for:

```text
create-k-nex-app productization
full CMS and Sales/CRM feature sets
visualization catalog
logistics/driver/dispatch products
restaurant/inventory/budgeting products
marketplace or external distribution
v1.0 support and compatibility policy
```

Those plans must be based on the executable evidence from Gates 1–7 rather than assumptions made before the platform foundation exists.
