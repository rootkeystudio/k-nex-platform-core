# Implementation Phase 2A — Agent Tool Contracts and Safe Execution

- **Status:** planned
- **Gate mapping:** Gate 2A in [`docs/30-executable-poc-gates.md`](../30-executable-poc-gates.md)
- **Entry:** Phase 2 result records `GO PHASE 2A`
- **Next phase:** Phase 3 — transactions, durable events, and realtime convergence
- **Architecture:** [`docs/31-agent-tools-and-ai-control-plane.md`](../31-agent-tools-and-ai-control-plane.md)
- **ADR:** [`ADR-0018`](../adr/0018-agent-tool-contracts-and-safe-execution.md)

## 1. Objective

Prove that installed plugins can expose selected sources and actions as typed, discoverable, permission-aware tools that an AI module or protocol client can invoke without receiving direct access to Payload, plugin internals, or infrastructure services.

The required outcome is:

```text
explicit plugin tool descriptors
+ actor-filtered catalog
+ bounded delegation and approval
+ schema-validated execution gateway
+ idempotent writes and audit
+ model-independent reference client
+ minimal MCP adapter
= safe agent-tool foundation
```

This phase proves the tool control plane. It does not select an LLM provider or implement a general autonomous agent.

## 2. Why this phase is between Phase 2 and Phase 3

Phase 2 supplies:

```text
authenticated source gateway
record/field authorization
bounded inputs and outputs
safe cache and error contracts
```

Phase 2A reuses those controls and adds safe machine-callable action execution.

Phase 3 later supplies:

```text
transactional outbox
durable asynchronous workflows
retries and idempotent workers
realtime progress/convergence
```

Gate 2A must not fake those durability guarantees. A tool that requires durable asynchronous completion remains unavailable or explicitly unsupported until Gate 3.

## 3. Scope

Included:

```text
agent tool descriptor and manifest contribution
actor-filtered tool discovery
minimal registered-action contract needed by tools
source/action-backed invocation
principal/delegation/session binding
risk/effect classification
per-call approval for writes
idempotency and duplicate suppression
input/output schema validation
budgets, timeout, rate, and concurrency
redacted audit and observability
minimal MCP tools/list and tools/call adapter
deterministic scripted agent-client fixture
```

## 4. Explicit non-goals

```text
LLM/model-provider selection
prompt management product
long-term conversation memory
vector database or RAG framework
arbitrary autonomous loops
agent-created tool definitions
runtime plugin installation
MCP resources/prompts/sampling/UI extensions
public MCP marketplace
unattended destructive operations
payments or credential collection
correctness-relevant durable workflows
Socket.IO/realtime progress
```

## 5. Architectural rules

1. Tool exposure is explicit; no source, action, endpoint, or collection is automatically exposed.
2. Tool handlers reuse existing sources/actions/application services. Business logic is not duplicated in the agent layer.
3. Static trusted package/customer code defines tools. Database and CMS content cannot create executable tool metadata.
4. Discovery is filtered but never replaces execution-time authorization.
5. Agent delegation can only reduce the principal's authority.
6. Write tools require idempotency and the declared approval policy.
7. Tool output is structured untrusted data, not instructions.
8. Model-provider and MCP implementation types remain behind adapters.
9. The reference proof uses a deterministic client; no LLM result is a gate assertion.
10. External protocol adapters cannot weaken K-Nex policy.

## 6. Target package direction

Add only packages justified by an immediate work package:

```text
packages/contracts/
  agent tool descriptor/value/error schemas

packages/runtime/
  tool catalog and execution ports/adapters

packages/agent-tools-mcp/
  minimal MCP mapping after internal gateway passes

modules/sales/
  one read tool and one write tool

fixtures/customer-gate-2a/
  deterministic actor, delegation, approval, and tool-call fixtures
```

Do not create a generic AI framework package in this phase.

## 7. Work packages

### P2A.1 — Freeze agent-tool identity and descriptor contracts

#### Goal

Define the smallest serializable contract needed for safe discovery and execution.

#### Required fields

```text
tool ID and major version
owner plugin
title and trusted description
input schema
optional output schema/contract
source or action invocation target
surface/audience
permission/policy reference
effect and risk class
approval policy
idempotency policy
dry-run support
timeout/rate/concurrency/cost ceilings
redaction and audit metadata
```

Add `tools` as an explicit plugin contribution category in the typed manifest source and generated schema. Before v1.0, update all fixtures and callers atomically; add no compatibility alias.

#### Required invariants

- Tool ID follows the canonical hierarchical grammar.
- Input is an object schema with closed properties unless a reviewed reason exists.
- Tool descriptions are static trusted metadata.
- Invocation references an installed, declared source or action.
- A write cannot declare idempotency as not applicable.
- Destructive/external tools fail closed unless the phase explicitly supports their policy.

#### Acceptance

```text
typed authoring source
generated JSON Schema where applicable
valid/invalid fixtures
stable diagnostics
no MCP/model SDK imports in contracts
```

### P2A.2 — Implement the actor-filtered tool catalog

#### Goal

Discover the exact tools available to one principal, delegation, surface, and resolved application graph.

#### Required behavior

```text
pagination
stable structural catalog revision
actor/delegation filtering
surface and feature filtering
exact tool version
trusted descriptions and schemas
list-changed invalidation hook without realtime dependency
```

Discovery must not reveal forbidden tool existence or sensitive schema details. The catalog cannot load tools from database content or scan runtime package directories.

#### Failure cases

```text
forbidden tool omitted
stale or unknown tool version
uninstalled owner plugin
undeclared manifest contribution
duplicate tool ID
runtime descriptor mutation after freeze
```

### P2A.3 — Implement minimal registered actions and source/action tool bindings

#### Goal

Ensure tools delegate to existing platform behavior rather than becoming a second command/query framework.

#### Required bindings

```text
source tool → one Phase 2 source query
write tool  → one registered action/application command
```

Define only the minimal action descriptor/handler boundary needed by the proof:

```text
action ID/version
input/output schemas
permission and domain policy
effect metadata
idempotency requirement
trusted server handler binding
```

The action path owns domain invariants and transaction behavior. The tool path owns agent-specific catalog, delegation, approval, budgets, and result mapping.

#### Failure cases

```text
tool references missing source/action
tool and target schema incompatibility
undeclared target access
direct handler invocation bypass
business logic duplicated in protocol adapter
```

### P2A.4 — Build the staged tool execution gateway

#### Goal

Provide one authenticated, policy-enforced invocation path.

#### Pipeline

```text
PrincipalAuthenticator
AgentClientAuthenticator
DelegationEvaluator
ToolCatalogLookup
ToolInputValidator
AuthorizationEvaluator
RiskBudgetEvaluator
ApprovalEvaluator
IdempotencyCoordinator
SourceActionDispatcher
ToolOutputValidator
ProjectionRedactor
AuditDecorator
ProblemSerializer
```

Execution order is security-significant and independently tested.

#### Minimum API behavior

```text
list available tools
prepare/preview a call where supported
request/submit approval
execute a call
retrieve stable synchronous result
```

Do not add arbitrary multi-tool orchestration in the gateway.

### P2A.5 — Implement delegation, approval, and replay protection

#### Goal

Bind tool execution to real authority and explicit human intent.

#### Delegation

A delegation record contains:

```text
principal
agent client
application/customer
allowed tool IDs/effect classes
expiry
revocation revision
optional resource scope
```

It cannot add authority absent from the principal.

#### Approval

Gate baseline:

```text
low-risk read  no per-call approval when delegation permits
write          per-call approval
destructive    denied unless a purpose-built fixture is accepted
external       denied or separately gated; durable execution waits for Gate 3
```

Approval binds exact tool/version, normalized input digest, principal/session, expiry, and replay policy. Argument changes invalidate approval.

#### Required attacks

```text
approval replay
approval used by another actor/session
approval reused with changed arguments
expired/revoked delegation
agent attempts privilege elevation
session ID used as authentication
```

### P2A.6 — Implement write idempotency, budgets, and audit

#### Goal

Make retries and duplicate model/client calls safe and observable.

#### Idempotency

For write tools, key identity includes:

```text
application/principal scope
tool ID/version
idempotency key
normalized input digest
```

Same key/same input returns the same logical result. Same key/different input fails.

#### Budgets

Bound:

```text
input/output bytes and depth
timeout/cancellation
per-principal/tool concurrency
rate/burst
cost class
maximum catalog size/page
maximum calls per agent run
```

#### Audit

Record redacted tool/principal/session/delegation/approval/idempotency/outcome metadata. Do not store secrets or unrestricted prompts/results.

### P2A.7 — Implement the minimal MCP interoperability adapter

#### Goal

Prove external interoperable discovery/calling without making MCP the K-Nex internal contract.

#### Mapping

```text
catalog → tools/list
execution gateway → tools/call
input/output schemas → MCP schemas
safe structured result → structuredContent/content
effect metadata → annotations as hints only
```

#### Security requirements

- Use a pinned official/community-maintained TypeScript MCP SDK only after checking current official documentation, types, maintenance, and license; otherwise implement only the small protocol surface required by the proof.
- Remote HTTP authorization follows the current MCP authorization specification where used.
- Reject token passthrough; validate audience and scopes.
- Use least-privilege scopes and the same K-Nex delegation/authorization.
- MCP annotations never authorize a call.
- No `stdio` production mode or spawned local server is required by this gate.

#### Excluded MCP features

```text
resources
prompts
sampling
elicitation
UI extensions
general task execution
registry publication
```

### P2A.8 — Add Sales proof tools and deterministic agent client

#### Tools

Minimum:

```text
sales.tools.search-tasks
  read-only
  backed by sales.tasks source

sales.tools.create-task
  write
  backed by sales.task.create action
  per-call approval
  required idempotency
```

#### Scripted client flow

```text
authenticate principal/client
list actor-filtered tools
call read tool
attempt a forbidden tool
prepare write
observe approval required
approve exact arguments
execute write
repeat same idempotency key
verify one logical task/result
attempt changed-input replay
verify denial
audit and redact result
```

No LLM is part of this test. Later AI modules must pass the same gateway contract suite.

### P2A.9 — Attack, close Gate 2A, and authorize Phase 3

Create:

```text
pnpm gate:2a
docs/implementation/phase-2a-result.md
```

#### Required tests

```text
automatic source/action/collection exposure is impossible
cross-actor catalog and invocation isolation
direct tool-ID/version/input manipulation
forbidden target source/action
output-schema violation and undeclared field
approval replay and argument substitution
duplicate writes and idempotency conflict
expired/revoked delegation
budget/rate/timeout enforcement
secret/log/error redaction
runtime/CMS attempt to register or alter a tool
MCP annotations cannot bypass policy
invalid/foreign-audience token rejection when remote auth is exercised
tool result text treated as untrusted data
```

#### Acceptance

```bash
pnpm install --frozen-lockfile
pnpm phase:0
pnpm gate:1
pnpm gate:2
pnpm gate:2a
git diff --check
git status --porcelain --untracked-files=all
```

The result records exact protocol/SDK versions if MCP is used, fixtures, failure evidence, performance/budget measurements, known limitations, and one of:

```text
GO PHASE 3
REWORK AGENT TOOL CONTRACT
REJECT GENERIC AGENT TOOL EXPOSURE
```

## 8. Kill/rework criteria

Return `REWORK Phase 2A` when:

- a tool can bypass ordinary source/action authorization or domain policy;
- executable tools can be created or modified by runtime/database/untrusted content;
- agent calls cannot be bound to a principal, delegation, approval, and audit record;
- duplicate write calls can duplicate effects;
- protocol/model SDK types leak into K-Nex public or persisted contracts;
- safe structured input/output cannot be expressed without arbitrary code or URLs;
- model-specific behavior is required to prove the core tool layer;
- external protocol authentication requires token passthrough or broad wildcard authority.

## 9. Phase result and evidence

`phase-2a-result.md` must explicitly separate:

```text
proved internal catalog/gateway behavior
proved MCP adapter behavior, if any
not-yet-proved durable/asynchronous behavior
not-yet-proved AI model/orchestrator behavior
not-yet-proved production authorization/deployment behavior
```

Promote ADR-0018 only when its entire normative scope has executable evidence. Phase 3 ADRs remain design-only.
