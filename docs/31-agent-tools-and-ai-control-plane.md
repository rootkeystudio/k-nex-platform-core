# Agent Tools and AI Control Plane

## Purpose

K-Nex plugins may expose selected business capabilities as machine-callable tools so a future AI assistant, an automation agent, or an external interoperable client can discover and invoke them safely.

The tool layer is **not** the AI model and is not a second business-logic framework. It is a bounded projection over existing K-Nex data sources and registered actions:

```text
plugin-owned source/action
        ↓ explicit opt-in
K-Nex agent-tool descriptor
        ↓ actor-filtered catalog
K-Nex tool execution gateway
        ↓ policy, approval, idempotency, audit
AI module or protocol adapter
```

The architectural goal is:

> A plugin can publish safe, typed, permission-aware tools once; future AI modules can read the catalog without hard-coding plugin internals, and every invocation still passes through ordinary K-Nex authorization and domain services.

## Position in the phase plan

This capability is implemented in **Phase 2A / Gate 2A**, between:

```text
Phase 2  authenticated data sources and output contracts
   ↓
Phase 2A agent tool contracts and safe execution
   ↓
Phase 3  transactions, durable events, and realtime convergence
```

Phase 2A depends on the authenticated source gateway and authorization model from Phase 2. It deliberately precedes Phase 3 so the platform can prove safe tool discovery and synchronous execution before adding durable workflows, outbox processing, and realtime orchestration.

Tools that require correctness-relevant asynchronous work, durable external effects, or realtime completion signals cannot claim those semantics until Phase 3 passes.

## Core boundaries

### Agent tool

An agent tool is a versioned, serializable descriptor plus a trusted server-side binding. It is explicitly registered by an installed plugin.

A tool does not contain:

```text
arbitrary JavaScript
SQL or raw Payload queries
package paths or dynamic imports
unrestricted URLs
secrets or credentials
model prompts sourced from runtime content
business logic duplicated from the owning module
```

### Tool catalog

The catalog lists only tools available to the current actor, surface, delegation, and installed composition. Catalog filtering improves safety and model quality, but it is not authorization; every invocation is reauthorized.

### Tool execution gateway

The gateway is the only supported generic invocation path. An AI module cannot call plugin handlers, Payload collections, or infrastructure providers directly.

### Agent client

An agent client may be:

```text
future module.ai-assistant
customer-owned automation
an MCP-compatible external client
an internal deterministic test client
```

The client selects tools. The server owns identity, authorization, approval, budgets, execution, and audit.

## Tool descriptor

The exact TypeScript API will be frozen in Gate 2A, but the V1 descriptor must carry the following semantics:

```text
stable tool ID and major version
owner plugin ID
human title and trusted description
input JSON Schema
optional output JSON Schema or K-Nex output contract
invocation target: source or registered action
audience/surface
required permissions and policy reference
effect class
risk class
approval policy
idempotency policy
dry-run support when truthful
timeout, concurrency, rate, and cost limits
input/output redaction metadata
audit category
```

Example direction:

```ts
defineAgentTool({
  id: 'sales.tools.create-task',
  version: 1,
  invocation: {
    kind: 'action',
    actionId: 'sales.task.create',
  },
  input: CreateTaskInputSchema,
  output: CreateTaskResultSchema,
  effects: {
    readOnly: false,
    destructive: false,
    externalSideEffect: false,
  },
  approval: 'per-call',
  idempotency: 'required',
})
```

The descriptor is static trusted package metadata. Database content, CMS text, external documents, and model output cannot create or modify executable tools.

## Source and action reuse

Tools are explicit projections, not automatic exposure.

```text
read tool
  → delegates to one registered source with bounded input/fields

write tool
  → delegates to one registered action/application command
```

A plugin must opt in tool by tool. K-Nex never converts every source, action, endpoint, or Payload collection into an AI tool.

The source/action remains authoritative for:

```text
input semantics
domain invariants
record and field authorization
transactions
idempotency where applicable
business errors
audit-relevant resource identity
```

The tool layer adds agent-facing description, delegation, approval, execution budgets, result validation, and protocol mapping.

## Discovery model

Tool discovery is actor-filtered and paginated. The catalog response includes a structural revision so clients can detect a changed tool set.

Catalog identity depends on:

```text
resolved application/plugin graph
actor and authorization-context revision
delegation grant
surface/audience
feature/publication revision where semantic
tool descriptor versions
```

Rules:

- Discovery never reveals a forbidden tool or sensitive schema description.
- A tool disappearing from the catalog invalidates cached availability.
- The model receives only the current allowed subset, not the global catalog.
- Tool descriptions are trusted package text and cannot be overridden by untrusted runtime content.
- Discovery approval does not authorize execution.

## Execution pipeline

The standard execution order is:

```text
1. authenticate principal and agent client
2. resolve and validate agent session/delegation
3. look up exact tool ID/version in the actor-filtered catalog
4. validate input against the declared schema
5. reauthorize tool, source/action, record, and fields
6. enforce effect/risk policy and execution budgets
7. obtain and verify required human/external approval
8. claim or resolve idempotency key for writes
9. dispatch through the registered source or action
10. validate and redact structured output
11. commit audit/result metadata and return a stable envelope
```

No model-generated claim, tool annotation, cached catalog entry, or prior approval replaces server-side authorization at step 5.

## Principal, delegation, and session

An AI model is not an all-powerful K-Nex actor. Every invocation is bound to:

```text
human or service principal
agent client identity
short-lived agent session
delegated permission/tool scope
application/customer boundary
expiry and revocation state
correlation ID
```

The delegation grant can only reduce the principal's authority. It cannot introduce permissions the principal does not possess.

Session IDs are coordination identifiers, not authentication. Every request is authenticated and the session is bound to the authorized principal.

## Effect and approval policy

V1 effect metadata distinguishes:

```text
read-only
write
potentially destructive
external side effect
```

Server policy, not descriptive metadata, determines enforcement.

Gate 2A baseline:

```text
low-risk read      may execute without per-call confirmation when delegation allows
ordinary write     requires explicit per-call approval and idempotency
destructive        denied unless a purpose-built policy and confirmation fixture exists
external effect    denied or limited to a separately approved proof; durable delivery waits for Phase 3
```

Approval records bind the exact tool ID/version, normalized input digest, principal, agent session, expiry, and one-time/replay policy. Changing the arguments invalidates approval.

A tool may advertise dry-run only when the underlying action implements a truthful, side-effect-free preview. K-Nex does not simulate a fake dry-run after mutation logic has begun.

## Idempotency and duplicate calls

Models and clients may retry or issue duplicate calls. Every write-capable tool therefore declares and enforces an idempotency policy.

The gateway records:

```text
principal/application scope
tool ID/version
idempotency key
normalized input digest
result or stable in-progress reference
expiry/retention
```

Reusing a key with different arguments fails. Repeating the same accepted call returns the same logical result rather than duplicating the effect.

Phase 3 extends this model for durable asynchronous workflows and outbox-backed effects.

## Output safety

Tool outputs are structured data, not trusted instructions.

The gateway:

- validates output against the exact source/action and optional tool output schema;
- redacts undeclared or unauthorized values before serialization;
- limits bytes, nesting, arrays, and resource links;
- labels provenance and trust class for the agent client;
- never returns secrets, raw credentials, SQL, stack traces, or internal policy predicates;
- treats external/user-authored text inside results as untrusted content.

A future AI orchestrator must not promote text returned by tools into system/developer instructions.

## Audit and observability

Every attempted invocation records bounded, redacted metadata:

```text
tool ID/version and owner
principal and agent-client/session identity
delegation and approval reference
correlation and idempotency IDs
normalized input digest and safe selected fields
start/end/outcome/error code
resource identity where policy permits
model/provider/run metadata when supplied by the AI module
```

Audit does not store secrets or unrestricted prompts/results. Full conversation retention is a separate customer privacy decision.

Metrics include catalog size, denials, approvals, duplicates, validation failures, timeouts, latency, and per-tool error rate.

## MCP interoperability adapter

K-Nex owns its internal tool contracts. Model Context Protocol (MCP) is the first interoperability adapter, not the platform's source of truth.

Mapping:

```text
K-Nex actor-filtered catalog  → MCP tools/list
K-Nex tool execution gateway → MCP tools/call
input/output schemas          → MCP JSON Schema fields
safe result envelope          → MCP structuredContent/content
K-Nex effect metadata         → MCP annotations as non-authoritative hints
```

The MCP specification defines discoverable tools with `inputSchema`, optional `outputSchema`, structured results, and list/call operations. It also states that annotations are untrusted unless they come from a trusted server and recommends human confirmation for sensitive operations. K-Nex continues to enforce its own server-side policies regardless of adapter metadata.

Remote MCP exposure must:

```text
use supported HTTP authorization/OAuth semantics
validate token audience and scopes
reject token passthrough
minimize scopes progressively
bind every request to a K-Nex principal/delegation
apply the same tool gateway, limits, audit, and approvals
```

The first proof does not require MCP resources, prompts, sampling, UI extensions, or a general remote marketplace.

Official protocol references are maintained in [`references.md`](./references.md).

## Future AI module

A future `module.ai-assistant` can consume this layer without knowing plugin internals:

```text
model provider adapter
        ↓
AI orchestrator / conversation policy
        ↓
actor-filtered K-Nex tool catalog
        ↓
K-Nex tool execution gateway
        ↓
plugin sources and actions
```

The AI module may:

- present the allowed tools to a selected model provider;
- translate model tool-call requests to the K-Nex gateway;
- display inputs, approvals, execution state, and results;
- maintain bounded conversation/run state;
- apply customer-specific model/provider/data-retention policy.

It may not:

- bypass the gateway or call Payload directly;
- grant itself or the user new permissions;
- install plugins or register executable tools at runtime;
- turn arbitrary page content into a tool definition;
- execute destructive writes silently;
- use a model provider's tool schema as the persisted K-Nex contract.

A simple chat/assistant proof can begin after Gate 2A. Autonomous durable workflows that must survive crashes or continue asynchronously wait for Gate 3.

## Package direction

Expected boundaries, subject to Gate 2A proof:

```text
@k-nex/contracts
  agent-tool IDs, descriptor/value schemas, result/error contracts

@k-nex/runtime
  catalog, delegation, approval, idempotency, execution pipeline, audit ports

@k-nex/agent-tools-mcp
  MCP protocol mapping and transport/auth adapter

module.*
  explicit tool descriptors plus source/action bindings

future module.ai-assistant
  model-provider/orchestration UI using the catalog and gateway
```

MCP SDK types, model-provider SDK types, and prompt-framework types do not enter K-Nex public or persisted contracts.

## Security invariants

- No automatic source/action/collection exposure.
- Tool definitions come only from resolved trusted packages/customer code at build time.
- Catalog filtering and execution authorization are both enforced.
- Agent delegation can only reduce principal authority.
- Every write is idempotent and approval-bound according to policy.
- High-risk operations fail closed.
- Tool input/output is schema-validated and bounded.
- Tool results are untrusted data from the AI orchestrator's perspective.
- Secrets and broad bearer tokens are never passed through tools.
- Public and authenticated tool IDs/policies are distinct.
- External protocol adapters cannot weaken K-Nex authorization, approvals, budgets, or audit.

## Gate 2A proof

Gate 2A uses a deterministic scripted client rather than an LLM so pass/fail behavior remains reproducible.

Minimum proof:

```text
one read-only Sales tool backed by a Phase 2 source
one approved idempotent Sales write tool backed by a registered action
actor-filtered discovery
manual tool-ID/input manipulation denial
per-call approval and replay protection
duplicate write suppression
output-schema failure closes safely
audit/redaction evidence
minimal MCP tools/list and tools/call adapter
```

The full work packages and kill criteria are defined in [`implementation/phase-2a-agent-tools.md`](./implementation/phase-2a-agent-tools.md).
