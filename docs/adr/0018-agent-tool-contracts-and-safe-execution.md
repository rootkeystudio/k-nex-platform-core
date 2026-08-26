# ADR-0018: Agent Tool Contracts and Safe Execution Gateway

- Status: accepted
- Date: 2026-08-26
- Decision owners: K-Nex platform maintainers
- Evidence: executable-poc
- Related: [Agent tools and AI control plane](../31-agent-tools-and-ai-control-plane.md), [Phase 2A plan](../implementation/phase-2a-agent-tools.md), [Executable gates](../30-executable-poc-gates.md)

## Context

K-Nex plugins already expose deliberate data sources and registered business behavior. A future AI assistant or automation client should be able to discover and invoke selected plugin capabilities without hard-coded knowledge of every module.

Directly exposing Payload collections, arbitrary endpoints, raw service containers, or plugin handlers to a model would bypass the platform's authorization, validation, transaction, and audit boundaries. Automatically converting every source or action into a tool would also expand authority unintentionally and produce an unsafe, noisy catalog.

Model/tool protocols are implementation-facing interoperability layers. K-Nex needs a stable internal contract that remains provider- and protocol-neutral.

## Decision

1. Plugins may explicitly register versioned agent-tool descriptors. No source, action, endpoint, collection, or service is exposed automatically.
2. A tool is a bounded projection over one registered source or action/application command. Tool handlers do not duplicate domain business logic.
3. Tool descriptors are static trusted package/customer-code contributions resolved at build time. Runtime/database/CMS/model content cannot create or alter executable tools.
4. Tool discovery is actor-, delegation-, surface-, and composition-filtered, but every invocation is reauthenticated and reauthorized.
5. Every invocation is bound to a human or service principal, an identified agent client/session, a short-lived delegation, correlation metadata, and the customer/application boundary. Delegation can only reduce authority.
6. Tool contracts declare typed input and optional typed output, effect/risk class, approval policy, idempotency, truthful dry-run support, budgets, and redaction/audit metadata.
7. Low-risk reads may execute within delegation. Writes require the declared approval policy and idempotency. Destructive or external-side-effect tools fail closed unless separately proved; durable asynchronous semantics depend on Gate 3.
8. A standard K-Nex tool execution gateway validates input, reauthorizes, enforces budgets/approval/idempotency, dispatches through the target source/action, validates and redacts output, and records audit metadata.
9. Tool outputs are untrusted structured data for AI orchestration. Returned text cannot become system/developer instructions merely because it came from a tool.
10. Model Context Protocol is the first external interoperability adapter. MCP `tools/list` and `tools/call` map to the K-Nex catalog/gateway, but MCP annotations and SDK types are not K-Nex authorization rules or persisted contracts.
11. Remote protocol adapters must use audience-bound authorization, least-privilege scopes, and must reject token passthrough.
12. Gate 2A proves the core with a deterministic scripted client, not an LLM. A future AI module consumes the same catalog/gateway and cannot bypass it.

## Consequences

- Plugin authors can make selected capabilities AI-usable without depending on one model vendor.
- A future `module.ai-assistant` can discover installed plugin tools dynamically from the actor-filtered catalog.
- Tool descriptions and schemas become security-sensitive public contracts requiring fixtures and versioning.
- Writes incur approval, idempotency, and audit responsibilities.
- MCP remains replaceable and can evolve without changing module contracts.
- Phase 2A adds a minimal registered-action boundary where required, while preserving existing domain/application services as authoritative.
- Autonomous durable workflows cannot be claimed until transactional outbox and job/realtime behavior pass Gate 3.

## Alternatives considered

### Automatically expose all sources and actions

Rejected because it expands authority implicitly, leaks internal operations, and makes a safe catalog impossible to review.

### Let the AI module call plugin services directly

Rejected because it creates ambient authority, hard-codes modules, and bypasses the standard validation, authorization, approval, and audit pipeline.

### Make MCP the canonical K-Nex tool contract

Rejected because protocol fields, transports, SDKs, and lifecycle can change independently from K-Nex product semantics. MCP is an adapter over the internal contract.

### Implement the AI assistant before the tool gateway

Rejected because model behavior is nondeterministic and would obscure whether failures come from tool contracts, authorization, orchestration, or the model.

### Wait until after realtime and builder phases

Rejected. Safe tool discovery/execution depends directly on Phase 2 sources/actions and is independently falsifiable before durable/realtime or UI composition work.

## Validation

Gate 2A must prove:

```text
explicit static tool registration
actor-filtered discovery
execution-time authorization
source/action reuse
bounded delegation
write approval and replay protection
idempotent duplicate handling
schema-validated/redacted results
audit and error safety
minimal MCP list/call mapping without policy weakening
```

Gate 2A passed the complete scope above. The linked result records executable fixtures, failure tests, adapter evidence, attack coverage, and bounded performance measurements: [`docs/implementation/phase-2a-result.md`](../implementation/phase-2a-result.md).
