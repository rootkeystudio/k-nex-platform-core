# K-Nex Implementation Master Plan — Codex Execution Contract

- **Status:** active execution plan
- **Scope:** Gate 0, Gates 1–7, and Gate 2A
- **Execution authority:** `status.md` selects the only task that may be implemented
- **Architecture authority:** generated contracts, accepted ADRs, and architecture documents
- **Gate definitions:** [`../30-executable-poc-gates.md`](../30-executable-poc-gates.md)
- **Official Payload plugin plan:** [`../32-payload-official-plugin-adoption-plan.md`](../32-payload-official-plugin-adoption-plan.md)
- **Detailed Phase 0 plan:** [`phase-0.md`](./phase-0.md)
- **Detailed Gate 1–7 task catalog:** [`phase-details-gates-1-7.md`](./phase-details-gates-1-7.md)
- **Detailed Phase 2A plan:** [`phase-2a-agent-tools.md`](./phase-2a-agent-tools.md)

## 1. Purpose

This is the single orchestration source for agentic implementation. It defines the phase order, task IDs, handoff protocol, gate commands, and which detailed plan Codex must read.

The operator should not have to carry project context manually between sessions. Codex recovers the current task from the repository.

Resolve conflicts in this order:

1. machine-readable contracts and generated schemas;
2. accepted ADRs and evidence registry;
3. architecture documents, including the official Payload plugin adoption plan;
4. this master plan;
5. linked detailed task plan;
6. PR descriptions and implementation notes.

The phase order in this file is authoritative. The Gate 1–7 task catalog was preserved from the original full master plan; where its old phase map omits Gate 2A, this file and the dedicated Phase 2A plan take precedence.

## 2. One instruction to give Codex

```text
Fetch the latest main branch. Read AGENTS.md, status.md, and
`docs/implementation/codex-master-plan.md`. Find the exact active task ID,
then read its linked detailed plan and any gate-assigned Payload plugin
adoption notes. Execute only that task, follow its scope, acceptance commands,
and stop conditions, update status.md in the same implementation commit,
open a pull request, and stop without merging or enabling auto-merge.
```

## 3. Mandatory execution protocol

### Task selection

Codex must:

1. fetch latest `main`;
2. read `AGENTS.md`;
3. read `status.md`;
4. find the exact active task ID in the phase/task index below;
5. read the linked detailed plan and relevant ADRs;
6. when the phase has assigned official Payload plugin candidates, read `docs/32-payload-official-plugin-adoption-plan.md`;
7. implement only that bounded task.

If the task is absent, ambiguous, already complete, or blocked, Codex stops and reports the inconsistency. It does not infer a nearby task.

### Branch and pull request

```text
branch:   codex/<task-id-lowercase>-<short-slug>
PR title: <type>: <task outcome>
```

One pull request implements one bounded work package unless the task explicitly allows a smaller sequence.

Every implementation PR reports:

```text
What changed
Files/packages affected
Architecture constraints preserved
Commands run
Test and CI results
Known limitations
Exact next task
```

Every agent-authored repository commit updates `status.md` according to `AGENTS.md`.

### Review boundary

Codex must never:

- merge its own pull request;
- enable auto-merge;
- advance `status.md` beyond `Ready for review`;
- start the next task before review and merge;
- convert a kill criterion into a workaround without project-manager approval.

The reviewer returns `PASS`, `REWORK`, `BLOCKED`, or `REJECT`. On PASS, the reviewer advances `status.md` to the post-merge task state, waits for final CI, and merges.

### Official Payload plugin boundary

Codex does not install the official plugin catalog preemptively. A candidate is considered only in its assigned gate and must be exact-pinned, inventoried, migrated, attacked, and kept behind K-Nex adapters. A candidate may implement only the subset allowed by `docs/32-payload-official-plugin-adoption-plan.md`.

## 4. Authoritative phase order

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
Phase 6   lifecycle, migrations, and upgrade safety
   ↓
Phase 7   second customer and verifiable fleet operations
```

A later phase starts only after the preceding result document records GO and `status.md` names the next task.

Required local/CI gate commands:

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
```

A gate command fails on the first failed requirement, requires no production secret, and is the command run by its required CI workflow.

## 5. Phase and task index

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

Result: [`phase-0-result.md`](./phase-0-result.md) — `GO PHASE 1`.

### Phase 1 — Minimal Deterministic Payload Composition

Detailed task definitions: search the exact task ID in [`phase-details-gates-1-7.md`](./phase-details-gates-1-7.md).

```text
P1.1  freeze executable framework tuple and Gate 1 fixture shell
P1.2  load static package manifests and installed package identity
P1.3  implement minimal deterministic resolver
P1.4  generate resolved graph and static registries
P1.5  implement phased registration and declared-versus-actual inventory
P1.6  compose minimal Payload application
P1.7  prove customer-owned migration and clean Postgres boot
P1.8  add authenticated query and protected runtime inventory
P1.9  Gate 1 failure corpus, reproducibility, and closeout
```

Gate outcome: `GO PHASE 2`, `REWORK PHASE 1`, or reject the composition approach according to its kill criteria.

### Phase 2 — Authenticated Data Sources and Output Contracts

Detailed task definitions: [`phase-details-gates-1-7.md`](./phase-details-gates-1-7.md).

```text
P2.1  canonical Metric and Table contract schemas
P2.2  source descriptor and handler registration APIs
P2.3  staged data-source gateway pipeline
P2.4  source, record, and field authorization
P2.5  bounded query semantics and abuse budgets
P2.6  safe cache classifications
P2.7  Sales proof sources
P2.8  headless binding result states and client query identity
P2.9  benchmark, attack, and Gate 2 closeout
```

Gate outcome must authorize Phase 2A, not Phase 3 directly.

### Phase 2A — Agent Tool Contracts and Safe Execution

Architecture: [`../31-agent-tools-and-ai-control-plane.md`](../31-agent-tools-and-ai-control-plane.md)

Payload plugin policy: [`../32-payload-official-plugin-adoption-plan.md`](../32-payload-official-plugin-adoption-plan.md)

Detailed plan: [`phase-2a-agent-tools.md`](./phase-2a-agent-tools.md)

ADR: [`ADR-0018`](../adr/0018-agent-tool-contracts-and-safe-execution.md)

```text
P2A.1  agent-tool identity, descriptor, and manifest contracts
P2A.2  actor-filtered tool catalog
P2A.3  minimal registered actions and source/action bindings
P2A.4  staged tool execution gateway
P2A.5  delegation, approval, and replay protection
P2A.6  write idempotency, budgets, and audit
P2A.7  official Payload MCP adapter evaluation and fallback
P2A.8  Sales proof tools and deterministic agent client
P2A.9  attack, close Gate 2A, and authorize Phase 3
```

P2A.7 evaluates `@payloadcms/plugin-mcp` first, with collection/global CRUD disabled and all custom tools forced through the K-Nex gateway. A direct MCP SDK or custom transport is a fallback only after documented kill criteria.

Gate 2A proves a model-independent tool control plane. It does not select an LLM provider, implement autonomous loops, or claim durable asynchronous workflows. Gate outcome: `GO PHASE 3`, `REWORK AGENT TOOL CONTRACT`, or `REJECT GENERIC AGENT TOOL EXPOSURE`.

### Phase 3 — Transactions, Durable Events, and Realtime Convergence

Detailed task definitions: [`phase-details-gates-1-7.md`](./phase-details-gates-1-7.md).

```text
P3.1  event classes and transactional outbox schema
P3.2  transaction atomicity and rollback silence
P3.3  idempotent outbox processing
P3.4  realtime.gateway and Socket.IO memory mode
P3.5  process-topology compatibility
P3.6  distributed publication path
P3.7  source revisions and convergence
P3.8  subscription security and backpressure
P3.9  failure injection and Gate 3 closeout
```

Phase 3 may extend Gate 2A tools with durable asynchronous workflows and realtime progress only after outbox and convergence pass. Stripe/payment webhook integrations remain deferred until Gate 3 durability and Gate 6 lifecycle evidence exist.

### Phase 4 — Builder Engine Kill-Spike

Detailed task definitions: [`phase-details-gates-1-7.md`](./phase-details-gates-1-7.md).

```text
P4.1  minimal canonical document schema
P4.2  minimal UiDocumentRuntime
P4.3  BuilderEngineAdapter and Puck round-trip
P4.4  fixed shell and profile-specific palettes
P4.5  one static and one authenticated data block
P4.6  missing component, migration, and safe fallback
P4.7  bundle and runtime boundaries
P4.8  accessibility kill-spike
P4.9  Gate 4 decision
```

### Phase 5 — UI Runtime, Themes, and Atomic CMS Publication

Detailed task definitions: [`phase-details-gates-1-7.md`](./phase-details-gates-1-7.md).

```text
P5.1  small semantic primitive ABI
P5.2  theme package and profile schemas
P5.3  Minimal theme
P5.4  Neobrutalism theme
P5.5  UiDocumentRepository
P5.6  atomic CMS page/document publication
P5.7  deterministic workspace layout resolution
P5.8  accessibility and visual acceptance
P5.9  Gate 5 closeout
```

Phase 5 reads the official Payload plugin plan. Preferred CMS candidates are SEO, Nested Docs, and Redirects; Form Builder and Search are conditional. Gate 5 adopts only the smallest subset needed for its proof and records each candidate as accepted, conditional, deferred, or rejected. Plugin-private types do not enter the canonical CMS/document contract.

### Phase 6 — Lifecycle, Migrations, and Upgrade Safety

Detailed task definitions: [`phase-details-gates-1-7.md`](./phase-details-gates-1-7.md).

```text
P6.1  lifecycle state and planning model
P6.2  install, enable, disable, and re-enable
P6.3  package upgrade and customer-owned migration
P6.4  migration concurrency and stale-artifact fence
P6.5  explicit archive/export project
P6.6  explicit purge safety
P6.7  source, block, theme, and document migrations
P6.8  previous-release, overlap, restore, and rollback fixtures
P6.9  Gate 6 closeout
```

P6.5 evaluates `@payloadcms/plugin-import-export` as a bounded admin transfer/archive accelerator. It does not replace backups, schema migrations, legal retention, or lifecycle planning. Imports/exports require explicit field access, size/cost limits, job readiness, versioning, storage policy, and restore evidence.

### Phase 7 — Second Customer and Verifiable Fleet Operations

Detailed task definitions: [`phase-details-gates-1-7.md`](./phase-details-gates-1-7.md).

```text
P7.1   package release boundaries
P7.2   Cargo fixture from released packages
P7.3   Restaurant fixture from the same release line
P7.4   independent upgrade cadence
P7.5   verifiable build evidence
P7.6   deployment receipt and runtime inventory
P7.7   fleet evidence collection and query
P7.8   security patch propagation
P7.9   restore, previous-release, and operational proof
P7.10  Gate 7 closeout
```

Phase 7 may evaluate the official Sentry plugin as an optional deployment adapter while Pino/OpenTelemetry remain the K-Nex contracts. Payload Multi-Tenant is not used for customer isolation. Stripe and Ecommerce remain post-Gate 7 vertical candidates unless a separately approved bounded spike is added after their prerequisite gates.

## 6. Cross-phase quality gates

### Determinism

```text
exact direct dependencies
frozen lockfile
canonical generated artifacts
no time/path/host/random/secret in committed generation
clean-tree checks
staged-path reproducibility for deterministic generators
```

### Security

```text
server-side authorization
least-privileged capability-scoped services
bounded inputs and resource use
safe errors and logs
no secret in events, tools, inventory, exports, or evidence
public/authenticated authority separated by identity
agent catalogs actor/delegation-filtered and invocation reauthorized
protocol/model/plugin annotations never grant authority
official plugin automatic surfaces disabled unless explicitly proved
```

### Package boundaries

```text
contracts do not import framework, editor, model-provider, protocol, or official-plugin implementation types
browser exports do not import server code
modules do not import customer code
core/composition do not import business modules
runtime data does not select imports/packages or create executable tools
third-party types remain behind adapters
```

### Official plugin adoption

```text
exact package and Payload tuple
current official documentation/license review
contribution inventory and customer migration
access/failure/bundle/lifecycle tests
no plugin-private public contract
no automatic catalog-wide installation
candidate removal instead of pre-v1 compatibility shims
phase result records explicit adoption/rejection
```

### Testing

```text
unit tests for pure policy/algorithms
contract fixtures for public shapes
real Postgres for migrations/transactions
scripted deterministic client for Gate 2A
failure injection for durability/convergence
browser tests for UI/accessibility
previous-release fixtures for upgrades
packed-package tests for release boundaries
```

### Documentation and evidence

```text
status.md current and compact
phase result records observed evidence only
ADR maturity promoted only for fully proved scope
open limitations explicit
all referenced paths and CI runs exist
```

## 7. Decision and stop protocol

Codex stops and opens a decision request when:

- an accepted invariant cannot be implemented with approved dependencies without weakening it;
- a public or persisted contract must change outside the active task;
- a new dependency family or provider abstraction is required;
- an official Payload plugin requires K-Nex to adopt its private contract or weakens an accepted boundary;
- a phase kill criterion is observed;
- official package behavior/types contradict the plan;
- a required test needs secrets, production data, or unsupported external access;
- safe tool execution would require model-specific authority or protocol types in core contracts.

A decision request includes:

```text
observed fact
minimal reproduction
contract/decision affected
options and consequences
recommended option
work that remains valid
```

Do not merge a knowingly temporary stopgap while waiting for a decision.

## 8. Post-Gate 7 boundary

This plan proves or rejects platform foundations; it does not pre-approve a full product backlog.

Only after Gate 7 may the project manager create the production roadmap for full CRM/CMS/logistics/restaurant products, AI assistant productization, Stripe/e-commerce verticals, optional intra-customer multi-tenancy, marketplace/distribution, and the v1.0 support policy. Those plans must use evidence from Gates 1–7 and Gate 2A.