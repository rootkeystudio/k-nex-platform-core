# Phase 2A Result — Agent Tool Contracts and Safe Execution

- **Date:** 2026-08-26
- **Gate:** Gate 2A
- **Baseline:** `831ee4b60f1cad2bd8332648444eb949ccc9ca81`
- **Delivery:** direct phase commits; no pull request
- **Decision:** **GO PHASE 3**

## Scope proved

Phase 2A proves a model- and protocol-independent control plane for explicitly registered agent tools. Static descriptors project one registered source or action; discovery is actor/delegation/surface filtered; invocation reauthenticates and applies exact input, authorization, budget, approval, idempotency, dispatch, output, redaction, and audit stages.

The proof adopts `@payloadcms/plugin-mcp@3.88.0` only as a bounded transport adapter. It does not expose Payload CRUD, make MCP metadata authoritative, select an LLM, implement autonomous loops, claim durable asynchronous execution, or prove production authorization/deployment capacity.

## Completed tasks

| Task | Commit |
|---|---|
| P2A.1 — agent-tool identity, descriptor, and manifest contracts | `c31c78e` |
| P2A.2 — actor-filtered tool catalog | `e3fb288` |
| P2A.3 — registered actions and source/action bindings | `0ee57eb` |
| P2A.4 — staged tool execution gateway | `4c0df65` |
| P2A.5 — delegation, approval, and replay protection | `5f13e04` |
| P2A.6 — write idempotency, budgets, and audit | `c05ebb5` |
| P2A.7 — official Payload MCP adapter evaluation | `f7e473b` |
| P2A.8 — Sales proof tools and deterministic client | `e2e62a3` |
| P2A.9 — attack corpus, benchmark, and closeout | this closeout commit |

## Internal catalog and gateway proof

Tool descriptors are strict serializable package metadata. They bind exact tool/target IDs and versions, audience/surfaces, permission/policy, effect/risk, approval, idempotency, truthful dry-run support, limits, redaction, and audit category. Executable handlers and schemas remain server-owned registrations. Runtime, database, CMS, and model content cannot create or alter the frozen catalog.

Discovery considers the resolved inventory, effective actor, authorization context, delegation, surface, features, descriptor version, and policy. It is bounded, paginated, revisioned, mutation-isolated, and omits forbidden tools. Invocation never trusts prior discovery and runs:

```text
principal → agent client/session → delegation → catalog lookup → input
→ authorization → budget → approval → idempotency → authoritative audit attempt
→ source/action dispatch → output validation → redaction → completion audit → safe envelope
```

Delegation binds the exact principal, client, application, tool/version, effects, resource scope, expiry, revision, and parent authority. It can only reduce authority. Per-call approvals bind the exact principal/session/tool/version/canonical input digest and are expiring, issuer-authorized, and single-use.

Writes require bounded idempotency keys scoped by application, principal, tool/version, and canonical input. Same-input retries return the frozen first safe envelope without redispatch; changed-input reuse conflicts; pending or uncertain post-dispatch outcomes remain blocked. The Sales vertical proof creates one logical task across the first call and replay.

Budgets cover JSON bytes/depth, enforced timeout/cancellation even for non-cooperative handlers, principal/tool concurrency, rate/burst, cost, calls per run, and catalog/page bounds. A timed-out write retains its uncertain idempotency claim until the handler settles. Audit fails closed before dispatch, then records bounded identities, references, digests, and outcomes without raw prompts, inputs, results, credentials, private notes, or key values. Result text is marked `structured-untrusted-content`.

## Payload MCP adapter proof

The frozen interoperability tuple is:

| Component | Exact version |
|---|---|
| Node.js | `24.19.0` |
| pnpm | `11.9.0` |
| Payload | `3.88.0` |
| Next.js | `16.3.1` |
| React / React DOM | `19.2.8` |
| `@payloadcms/plugin-mcp` | `3.88.0` |
| `@modelcontextprotocol/sdk` | `1.30.0` |
| `mcp-handler` | `1.1.0` |
| adapter Zod | `3.25.76` |

The exact plugin has an internal peer-metadata mismatch: `mcp-handler@1.1.0` declares SDK `1.26.0` while the plugin pins SDK `1.30.0`. The workspace permits only those two versions for that peer and retains strict peer checking; build, adapter, protocol, and integration tests are authoritative.

The adapter supplies empty collection/global maps, no experimental tools, and only generated K-Nex custom tools. `overrideAuth` intersects the current actor/delegation catalog with API-key toggles, so keys can narrow but never add authority. Every handler maps an exact tool ID/version back into the K-Nex gateway and does not expose ambient `req.payload` to module contracts. `onEvent` is telemetry-only and handler duration is bounded.

Declared-versus-actual inventory covers `payload-mcp-api-keys`, `GET/POST /api/mcp`, the MCP admin group, per-tool fields, and the expiry migration field. Customer migration `20260826_000003_payload_mcp` owns the collection, relation columns, 30-day expiry, unique key-digest index, capability toggles, user-deletion cascade, and revision `2 → 3`. The real PostgreSQL boot and API-key lifecycle gate passes. Full evaluation and kill-criteria evidence are in [`p2a-7-payload-mcp-evaluation.md`](./p2a-7-payload-mcp-evaluation.md).

Internal consumers can call the same catalog and gateway directly. The deterministic client proof contains no LLM, MCP, Payload, or model-provider type.

## Sales proof

The packed Sales module explicitly registers:

```text
sales.tools.search-tasks → sales.tasks source (read-only)
sales.tools.create-task  → sales.task.create action (write)
```

The create tool requires per-call approval and idempotency, redacts its private-note input path, and dispatches through the registered action. The action uses Payload Local API once with `overrideAccess: false`, the effective actor user, depth zero, and the existing request context. Its strict output exposes only task ID, title, and status.

The scripted flow composes the bound delegation evaluator, delegated catalog policy, registration-backed target resolution/policy/input/output/dispatch/redaction stages, and the Phase 2 data-source gateway. It authenticates, lists, reads, attempts a concealed forbidden tool, prepares approval, approves exact arguments, executes one write, repeats with the same key, rejects changed-input reuse, checks safe audit, and repeats discovery/read through an actual MCP `tools/list`/`tools/call` protocol path. Gateway failures use MCP `isError`; successful object data uses `structuredContent`.

## Attack evidence

| Required attack | Executable evidence |
|---|---|
| automatic source/action/collection/global exposure | explicit manifest/registration reconciliation and empty Payload collection/global maps |
| cross-actor catalog and invocation isolation | catalog audience/policy/delegation tests and gateway reauthorization |
| direct tool ID/version/input manipulation | strict descriptor fixtures, lookup identity, and input validation tests |
| forbidden target source/action | registration owned-binding checks and concealed unknown-tool response |
| output violation and undeclared field | action/source output schemas, gateway validation, malformed replay rejection |
| approval replay and argument substitution | atomic single-use digest-bound approval tests, including concurrent gateway calls |
| duplicate writes and idempotency conflict | coordinator tests plus one-create Sales vertical replay/conflict proof |
| expired/revoked delegation | delegation clock/revision corpus |
| budget/rate/timeout enforcement | concrete budget tests and a non-cooperative dispatcher timeout proof |
| secret/log/error redaction | audit, problem serializer, and Sales private-note absence checks |
| runtime/CMS registration or mutation | frozen registration and descriptor snapshot tests; executable metadata rejection |
| API-key toggle authority expansion | actor catalog/API-key intersection tests |
| MCP metadata policy bypass | exact generated handlers, foreign metadata denial, gateway re-entry, and protocol round-trip tests |
| invalid/foreign-audience identity | invalid actor and foreign audience catalog probe; no remote token exchange is exercised in this phase |
| tool text instruction injection | safe envelope provenance/trust assertions |

## Representative benchmark

Runner: Apple M1 Max, arm64, 64 GiB RAM, macOS 26.6, Node.js 24.19.0, one warm local process.

| Path | Dataset | Iterations | Representative p95 | Accepted p95 ceiling |
|---|---:|---:|---:|---:|
| actor-filtered catalog list | 100 explicit descriptors | 100 | 2.337 ms | 250 ms |
| bounded read gateway pipeline | one validated read call | 200 | 0.007 ms | 250 ms |

These characterize bounded local catalog/gateway overhead and detect order-of-magnitude regressions. They are not production throughput, concurrency, network, database, model, or capacity claims.

## Commands executed

On exact Node.js `24.19.0` and pnpm `11.9.0`:

```bash
pnpm install --frozen-lockfile
pnpm phase:0
pnpm gate:1
pnpm gate:2
pnpm gate:2a
pnpm audit --audit-level high
git diff --check
git status --porcelain --untracked-files=all
```

`pnpm gate:2a` builds the workspace, runs contract/runtime/Payload-adapter/Sales suites, verifies the packed module, runs the real customer PostgreSQL migration/boot proof, executes each attack through an exact named test or a direct production-composition probe, verifies that every selected test actually ran alone and passed, and enforces the representative benchmark ceilings. CI runs Gate 2A after the earlier gates.

## Explicitly not proved

- Durable or distributed idempotency, asynchronous workflows, transactional outbox, jobs, or realtime progress remain Phase 3 work.
- No LLM provider, autonomous loop, prompt system, conversation retention policy, model evaluation, or instruction hierarchy is selected or proved.
- Remote OAuth/token audience validation is not exercised because this phase exposes no remote token exchange; future remote adapters must prove it before use.
- The in-memory approval, idempotency, rate, and concurrency stores are executable proof implementations, not multi-process production stores.
- Production deployment, capacity, operational key rotation, legal retention, and customer-specific authorization policy remain later evidence.

## Kill/rework assessment and decision

No Gate 2A kill or rework criterion fired. Tools cannot bypass ordinary source/action policy, executable catalog content is static and frozen, calls bind principal/client/delegation/approval/idempotency/audit, duplicate writes do not duplicate effects, protocol types remain adapter-local, and the complete core proof requires no model-specific behavior or broad token passthrough.

ADR-0018 is promoted atomically to `executable-poc`. ADR-0019 remains `design-only`; this phase records executable evidence only for the official MCP candidate and does not promote unrelated official plugin decisions.

**Decision: GO PHASE 3.** Phase 3 may add transactional outbox, durable event processing, and realtime convergence without weakening the Gate 2A catalog/gateway boundary.
