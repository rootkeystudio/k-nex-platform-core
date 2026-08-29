# K-Nex Implementation Master Plan — Codex Execution Contract

- **Status:** active execution plan
- **Scope:** Gates 0–9 and Gate 2A
- **Execution authority:** `status.md` selects the active phase/task
- **Architecture authority:** generated contracts, accepted ADRs, and architecture documents
- **Gate definitions:** [`../30-executable-poc-gates.md`](../30-executable-poc-gates.md)
- **Official Payload plugin plan:** [`../32-payload-official-plugin-adoption-plan.md`](../32-payload-official-plugin-adoption-plan.md)
- **Plugin platform direction:** [`../33-plugin-platform-hardening-and-reference-sales.md`](../33-plugin-platform-hardening-and-reference-sales.md)
- **Component system direction:** [`../34-headless-component-system.md`](../34-headless-component-system.md)
- **Authorization direction:** [`../adr/0021-rbac-authorization-and-plugin-role-templates.md`](../adr/0021-rbac-authorization-and-plugin-role-templates.md)
- **Detailed Phase 0 plan:** [`phase-0.md`](./phase-0.md)
- **Detailed Gates 1–5 history/tasks:** [`phase-details-gates-1-7.md`](./phase-details-gates-1-7.md)
- **Detailed Phase 2A plan:** [`phase-2a-agent-tools.md`](./phase-2a-agent-tools.md)
- **Authoritative Gates 6–8 plan:** [`phase-details-gates-6-8.md`](./phase-details-gates-6-8.md)
- **Authoritative Phase 9 plan:** [`phase-9-rbac-and-authorization-control-plane.md`](./phase-9-rbac-and-authorization-control-plane.md)

## 1. Purpose

This is the single orchestration source for agentic implementation. It defines phase order, task IDs, handoff protocol, gate commands, and the exact detailed plan Codex must read.

Resolve conflicts in this order:

1. machine-readable contracts and generated schemas;
2. accepted ADRs and evidence registry;
3. architecture documents;
4. this master plan;
5. the linked detailed plan for the active gate;
6. PR descriptions and implementation notes.

The future Gate 6 and Gate 7 sections in `phase-details-gates-1-7.md` are superseded. Gates 6–8 are defined only in `phase-details-gates-6-8.md`. Phase 9 is defined only in `phase-9-rbac-and-authorization-control-plane.md`.

## 2. Current product focus freeze

Gate 8 is accepted. The selected next core-productization phase is Phase 9 authorization and plugin bootstrap.

Until Gate 9 receives project-manager PASS:

```text
first-party reference domain module: module.sales
new CRM/CMS domain breadth: prohibited
new logistics/restaurant/inventory/budgeting modules: prohibited
runtime package installation: prohibited
customer runtime deployment: Docker/container-first
package add/upgrade/removal: immutable release/deployment only
```

Do not implement Cargo, Restaurant, Driver, Dispatch, Live Tracking, QR Menu, Inventory, Budgeting, broad CRM, broad CMS, or another domain module to discover a missing authorization/administration abstraction. Improve the platform and exercise it through Sales plus bounded test-only fixtures.

## 3. One instruction to give Codex

```text
Fetch the latest main branch. Read AGENTS.md, status.md,
docs/implementation/codex-master-plan.md, and the detailed plan linked for the
active phase. Work only inside that phase and in documented task order.

Use one branch for the entire phase and one coherent commit per task. Update
status.md in every task commit and run the task-specific acceptance commands.
You may advance status.md between tasks within the same phase, but may not
start the next phase.

When the complete phase result and full gate pass, mark the phase Ready for
review, open one pull request, and stop without merging or enabling auto-merge.
```

## 4. Mandatory execution protocol

### Task selection

Codex must:

1. fetch latest `main`;
2. read `AGENTS.md` and `status.md`;
3. locate the exact active task in this plan;
4. read the linked detailed phase plan and relevant ADRs;
5. read gate-assigned official plugin/dependency notes where applicable;
6. implement tasks only in the active phase.

If the active task is absent, ambiguous, already complete, or blocked, stop and report the inconsistency. Do not infer a nearby task.

### Branch, commits, and pull request

```text
branch:   codex/phase-<number>-<short-slug>
commit:   one coherent task outcome
PR title: <type>: complete Phase <number> <outcome>
```

One phase uses one branch and one final PR. Each task remains a separate coherent commit so review and rework can target the exact layer.

Every phase PR reports:

```text
completed task matrix
architecture constraints preserved
packages/files affected
commands and CI runs
failure/attack evidence
known limitations
phase result decision
exact next phase/task
```

### Review boundary

Codex must never:

- merge its own pull request;
- enable auto-merge;
- start the next phase;
- convert a kill criterion into a workaround without project-manager approval;
- begin domain expansion while the active roadmap phase forbids it;
- preserve obsolete pre-v1 APIs through aliases or compatibility shims.

The reviewer returns `PASS`, `REWORK`, `BLOCKED`, or `REJECT`. Only project-manager PASS and merge authorize the next phase.

### Official plugin and dependency boundary

Do not install package catalogs preemptively. A dependency candidate is considered only when the active task has a real consumer and must be:

```text
exact-pinned
compatible with the frozen framework tuple
kept behind K-Nex contracts
covered by access/bundle/lifecycle/failure tests
removable if kill criteria fire
```

## 5. Authoritative phase order

```text
Phase 0   contract freeze and repository governance
   ↓
Phase 1   minimal deterministic Payload composition
   ↓
Phase 2   authenticated data sources and output contracts
   ↓
Phase 2A  agent tool contracts and safe execution
   ↓
Phase 3   transactions, durable events, and realtime convergence
   ↓
Phase 4   builder engine kill-spike
   ↓
Phase 5   UI runtime, themes, and atomic CMS publication
   ↓
Phase 6   plugin platform hardening and Sales reference module
   ↓
Phase 7   comprehensive headless component system
   ↓
Phase 8   lifecycle, application factory, release, and fleet safety
   ↓
Phase 9   RBAC, authorization policy, and plugin bootstrap control plane
```

A later phase starts only after the preceding phase result records GO/PASS and `status.md` names the next task.

Required gate commands:

```text
pnpm phase:0
pnpm gate:1
pnpm gate:2
pnpm gate:2a
pnpm gate:3
pnpm gate:4
pnpm gate:5
pnpm gate:6
pnpm gate:7
pnpm gate:8
pnpm gate:9
```

A gate command fails on the first missing requirement, requires no production secret, and is run by required CI at phase closeout.

## 6. Phase and task index

### Phase 0 — Contract Freeze and Repository Readiness

Detailed plan: [`phase-0.md`](./phase-0.md)

```text
P0.1  pinned repository toolchain                              complete
P0.2  typed contract-authoring source                         complete
P0.3  valid and invalid fixture corpus                        complete
P0.4  executable repository validation                        complete
P0.5  generation reproducibility                              complete
P0.6  CI and repository governance                            complete
P0.7  gate closeout and evidence promotion                    complete
```

Result: [`phase-0-result.md`](./phase-0-result.md).

### Phase 1 — Minimal Deterministic Payload Composition

Detailed historical plan: [`phase-details-gates-1-7.md`](./phase-details-gates-1-7.md)

```text
P1.1  framework tuple and fixture shell
P1.2  static installed-package manifest loader
P1.3  deterministic resolver
P1.4  resolved graph and static registries
P1.5  phased registration and inventory reconciliation
P1.6  minimal Payload composition
P1.7  customer-owned migration and Postgres boot
P1.8  authenticated query and runtime inventory
P1.9  failure corpus and closeout
```

### Phase 2 — Authenticated Data Sources and Output Contracts

```text
P2.1  canonical Metric and Table schemas
P2.2  source descriptor and handler registration
P2.3  staged source gateway
P2.4  source/record/field authorization
P2.5  bounded query semantics and budgets
P2.6  safe cache classes
P2.7  Sales proof sources
P2.8  headless result states and query identity
P2.9  benchmark, attack, and closeout
```

### Phase 2A — Agent Tool Contracts and Safe Execution

Detailed plan: [`phase-2a-agent-tools.md`](./phase-2a-agent-tools.md)

```text
P2A.1  agent-tool descriptor and manifest contracts
P2A.2  actor-filtered catalog
P2A.3  registered actions and source/action bindings
P2A.4  tool execution gateway
P2A.5  delegation, approval, replay protection
P2A.6  idempotency, budgets, audit
P2A.7  official Payload MCP adapter evaluation
P2A.8  Sales proof tools and deterministic client
P2A.9  attack and closeout
```

### Phase 3 — Transactions, Durable Events, and Realtime Convergence

```text
P3.1  event classes and outbox schema
P3.2  atomicity and rollback silence
P3.3  idempotent outbox processing
P3.4  realtime gateway and Socket.IO memory mode
P3.5  process-topology compatibility
P3.6  worker-to-web publication path
P3.7  source revisions and convergence
P3.8  subscription security and backpressure
P3.9  failure injection and closeout
```

### Phase 4 — Builder Engine Kill-Spike

```text
P4.1  canonical UI document
P4.2  editor-independent runtime
P4.3  Puck adapter and round-trip
P4.4  fixed shell and profile policy
P4.5  static and authenticated data blocks
P4.6  migrations and fallback
P4.7  bundle/runtime boundaries
P4.8  accessible keyboard operation
P4.9  builder decision
```

### Phase 5 — UI Runtime, Themes, and Atomic CMS Publication

```text
P5.1  small semantic primitive ABI
P5.2  theme package/profile contracts
P5.3  Minimal theme
P5.4  Neobrutalism theme
P5.5  UiDocumentRepository
P5.6  atomic CMS page/document publication
P5.7  deterministic workspace layout resolution
P5.8  accessibility and visual acceptance
P5.9  closeout
```

### Phase 6 — Plugin Platform Hardening and Sales Reference Module

Authoritative detail: [`phase-details-gates-6-8.md`](./phase-details-gates-6-8.md)

```text
P6.1   complete plugin contribution taxonomy
P6.2   plugin authoring and package-entrypoint API
P6.3   settings, permissions, routes, and navigation
P6.4   default page-template and seed semantics
P6.5   standard browser query/action factories
P6.6   component, Puck, route, and page registration
P6.7   complete module.sales reference implementation
P6.8   plugin conformance kit
P6.9   install/enable/disable/re-enable proof
P6.10  Gate 6 closeout and pre-v1 authoring freeze
```

Gate outcome:

```text
GO PHASE 7
REWORK PLUGIN AUTHORING CONTRACT
REJECT GENERAL PLUGIN SURFACE
```

### Phase 7 — Comprehensive Headless Component System

```text
P7.1   component taxonomy, slots, and package boundaries
P7.2   foundation/layout/content/feedback components
P7.3   form and input family
P7.4   navigation/disclosure/overlay family
P7.5   data/content/editor adapters
P7.6   standard DataTable/DataGrid system
P7.7   page templates and Sales default pages
P7.8   generic and Sales Puck block library
P7.9   accessibility, SSR/hydration, theme matrix
P7.10  performance, bundle, coverage audit, and closeout
```

Gate outcome:

```text
GO PHASE 8
REWORK COMPONENT SYSTEM
REDUCE COMPONENT COVERAGE WITH EXPLICIT DECISION
```

### Phase 8 — Lifecycle, Application Factory, Release, and Fleet Safety

Authoritative detail: [`phase-details-gates-6-8.md`](./phase-details-gates-6-8.md)

```text
P8.1   package release and compatibility boundaries
P8.2   upgrade planning and customer-owned migrations
P8.3   migration lock and stale-artifact readiness fence
P8.4   archive/export, purge, backup, and restore
P8.5   create-knex-app and composition plan/apply
P8.6   two independent Sales-only customer applications
P8.7   SBOM and signed provenance
P8.8   deployment receipts and runtime inventory
P8.9   fleet query, patch propagation, prior-release upgrade, restore
P8.10  platform-foundation closeout
```

Gate outcome:

```text
PLATFORM FOUNDATION ACCEPTED
REWORK APPLICATION FACTORY OR LIFECYCLE
DO NOT START DOMAIN EXPANSION
```

### Phase 9 — RBAC, Authorization, and Plugin Bootstrap

Authoritative detail: [`phase-9-rbac-and-authorization-control-plane.md`](./phase-9-rbac-and-authorization-control-plane.md)

```text
P9.1   authorization, role, grant, template, bootstrap, cleanup contracts
P9.2   role-template contribution and permission-policy binding
P9.3   PostgreSQL/Payload authorization storage
P9.4   active/admin catalogs and effective authority resolution
P9.5   application/record/field policy hooks across platform boundaries
P9.6   protected roles, first owner, and plugin-template bootstrap
P9.7   live enable/disable/re-enable plus uninstall/purge integration
P9.8   live authorization revision and convergence
P9.9   system access administration UI
P9.10  Sales/schema-less proof, attack corpus, and closeout
```

Phase 9 keeps Sales as the sole domain reference. It may add bounded test-only schema-less fixtures to prove lifecycle behavior but no new first-party domain product.

Gate outcome:

```text
GO SYSTEM SETTINGS, PLUGIN/THEME ADMINISTRATION, AND DOCKER CATALOG
REWORK RBAC OR PLUGIN BOOTSTRAP
REJECT LIVE PREINSTALLED-PLUGIN ENABLE SEMANTICS
```

## 7. Cross-phase quality gates

### Determinism

```text
exact direct dependencies and frozen lockfile
canonical generated artifacts
no time/path/host/random/secret in committed generation
clean-tree and staged-path reproducibility
idempotent plugin/template/bootstrap operations
```

### Security and authority

```text
server-side authorization
role labels never authorize
capability-scoped policy services
normalized revisioned grants and assignments
bounded inputs and resource use
safe errors/logs/audit
no secret in events/tools/settings/inventory/exports/evidence
public/authenticated authority separated by ID
runtime data cannot create executable contributions or policies
plugin UI cannot bypass source/action gateways
last-owner and stale-authority attacks fail closed
```

### Plugin completeness

```text
complete declared-versus-actual inventory
Sales exercises every mandatory contribution category
one plugin conformance command
settings/routes/navigation/templates/role templates are versioned and typed
component/Puck runtime parity
lifecycle and migration fixtures
```

### Component quality

```text
style-agnostic K-Nex API
small theme ABI plus compound platform components
role/name/keyboard/focus contract
SSR/hydration and portal behavior
Minimal/Neobrutalism state matrix
DataTable authorization/query integration
bundle and performance budgets
```

### Package boundaries

```text
contracts import no framework/editor/model/protocol types
browser exports import no server code
modules import no customer/theme implementation
third-party behavior engines remain behind adapters
optional complex components remain tree-shakeable
```

### Evidence

```text
real Postgres for migrations/transactions/lifecycle/authorization
real Chromium for UI/focus/CSS/SSR/admin behavior
failure injection for durability, revocation, and destructive operations
packed-package tests
previous-release upgrade and restore fixtures
phase result states observed limitations only
```

## 8. Decision and stop protocol

Stop and request a decision when:

- an accepted invariant cannot be implemented without weakening it;
- a persisted/public contract must change outside the active task;
- a new dependency family is required without a bounded spike;
- an official plugin/library requires private types to become K-Nex contracts;
- a phase kill criterion is observed;
- Sales cannot exercise a proposed generic plugin capability coherently;
- another domain module appears necessary before the active core phase exits;
- live enable requires code hot-loading or weakens migration/readiness fences;
- authorization cleanup would silently delete customer-owned roles or assignments.

A decision request includes:

```text
observed fact
minimal reproduction
contract/decision affected
options and consequences
recommended option
work that remains valid
```

## 9. Post-Gate 9 boundary

Only after Gate 9 project-manager PASS may the roadmap begin the next administration/deployment phase:

```text
system settings administration
plugin and theme administration
verified official GitHub package/theme catalog
Docker release/build/deploy controller
operations center and backup/deployment UI
```

CRM/CMS product breadth remains a separate explicit roadmap decision after the administration and deployment core is sufficiently complete. New modules start from the Sales package structure and pass the same plugin, component, lifecycle, authorization, and release gates.
