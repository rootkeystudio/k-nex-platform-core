# Research Plan and Proof Strategy

## Principle

The architecture is validated through independent kill gates, not one small-platform implementation. The normative gate definitions are in [Executable POC Gates](./30-executable-poc-gates.md).

## Sequence

```text
Gate 0   contract freeze and repository governance
Gate 1   minimal deterministic Payload composition
Gate 2   source authorization and output contracts
Gate 2A  agent tool contracts and safe execution
Gate 3   outbox and realtime convergence
Gate 4   builder engine kill-spike
Gate 5   UI themes, accessibility, atomic publication
Gate 6   lifecycle and migration safety
Gate 7   second customer and fleet operations
```

Each gate has explicit exclusions so failure identifies the wrong assumption.

## First customer slice

After Gates 0–2:

```text
Payload + Postgres
module.sales
one opportunity metric source
one task table source
source/record/field authorization
```

Gate 2A adds only the model-independent agent-tool proof:

```text
one source-backed read tool
one approved idempotent action-backed write tool
actor/delegation-filtered discovery
safe execution gateway and audit
minimal MCP list/call adapter
deterministic scripted client, not an LLM
```

Gate 3 then adds outbox, durable event processing, and realtime invalidation/refetch. Durable autonomous agent workflows are not claimed before Gate 3.

After Gates 4–5 add one CMS page and one workspace dashboard, Minimal/Neobrutalism themes, and atomic publication.

After Gate 6 add controlled logistics Driver proof:

```text
module.logistics.core
module.logistics.driver
provider.realtime.socketio
one assignment/task projection and secure driver client
```

## Second customer slice

Only Gate 7 introduces a restaurant repository:

```text
module.cms
module.restaurant.core
module.restaurant.qr-menu
module.visualization
builder.puck
theme.minimal
theme.glassmorphism
explicit public menu source excluding internal cost data
```

This proves package reuse and independent composition/release—not completeness of either vertical.

## Evidence discipline

A gate result links:

```text
implementation PR/commit
contract and failure fixtures
CI run
benchmark where performance matters
migration/restore fixture
deployment receipt for production-observed evidence
```

Update `docs/adr/evidence-registry.json` only with real evidence. A document or mock interface is not executable proof.

## Immediate work

- execute Gate 1 from the active status and master plan;
- keep Gate 2A design-only until Gate 2 passes;
- do not select an LLM provider merely to prove the agent-tool control plane;
- do not begin Puck/theme/realtime breadth until their predecessor gate exits.
