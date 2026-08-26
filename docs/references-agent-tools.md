# Agent Tool and MCP References

These references inform the Phase 2A interoperability adapter. K-Nex owns its internal agent-tool contracts, authorization, approval, idempotency, and audit semantics; external protocol behavior remains behind an adapter and must be rechecked when implementation begins or protocol versions change.

_Last reviewed: 2026-08-26._

## Model Context Protocol

- [Tools — specification 2025-11-25](https://modelcontextprotocol.io/specification/2025-11-25/server/tools) — tool discovery and invocation, `inputSchema`, optional `outputSchema`, structured results, annotations, and security guidance.
- [Authorization — specification 2025-11-25](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization) — HTTP authorization requirements and OAuth-based flows.
- [Security best practices](https://modelcontextprotocol.io/docs/2025-11-25/tutorials/security/security_best_practices) — confused-deputy risks, token audience validation, prohibition of token passthrough, least-privilege scopes, session security, and prompt-injection considerations.

## K-Nex interpretation

```text
MCP tools/list        → actor-filtered K-Nex tool catalog
MCP tools/call        → K-Nex tool execution gateway
MCP input/output      → mapped from K-Nex schemas
MCP annotations       → non-authoritative hints only
MCP authorization     → adapter auth mapped to K-Nex principal/delegation
```

Implementation rules:

- Do not expose all sources, actions, endpoints, or collections automatically.
- Do not trust annotations for authorization or approval.
- Do not pass upstream bearer tokens through to downstream services.
- Validate token audience and scopes for remote transports.
- Keep scopes minimal and progressively request greater authority only when justified.
- Treat tool-result text as untrusted data, not instructions.
- Require human confirmation for sensitive operations according to K-Nex policy.
- Pin and review the exact TypeScript SDK version, license, exports, and transport behavior before adoption.

## Future model-provider references

No model provider or orchestration framework is selected by Gate 2A. Provider documentation belongs in a later AI-module plan after the internal catalog and execution gateway have executable evidence.
