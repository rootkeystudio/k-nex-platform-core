# Research Plan and Proof Strategy

## Principle

The architecture is validated through independent kill gates, not one small-platform implementation. The normative gate definitions are in [Executable POC Gates](./30-executable-poc-gates.md).

## Sequence

```text
Gate 0  contract freeze and repository governance
Gate 1  minimal deterministic Payload composition
Gate 2  source authorization and output contracts
Gate 3  outbox and realtime convergence
Gate 4  builder engine kill-spike
Gate 5  UI themes, accessibility, atomic publication
Gate 6  lifecycle and migration safety
Gate 7  second customer and fleet operations
```

Each gate has explicit exclusions so failure identifies the wrong assumption.

## First customer slice

After Gates 0–3:

```text
Payload + Postgres
module.sales
one opportunity metric source
one task table source
one category/time aggregate source
source/record/field authorization
outbox + realtime invalidation/refetch
```

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

- make Gate 0 validator pass;
- configure PR-only main and required check/review in GitHub settings;
- choose monorepo/package scope/private registry through a publish/install spike;
- start Gate 1 with one customer, one module, one collection, one authenticated query, one migration;
- do not begin Puck/theme/realtime breadth until their predecessor gate exits.
