# Phase 3 Result — Transactions, Durable Events, and Realtime Convergence

- **Date:** 2026-08-26
- **Gate:** Gate 3
- **Baseline:** `ba25289`
- **Delivery:** direct coherent commits; no pull request
- **Decision:** **PENDING WHOLE-PHASE REVIEW**

## Scope proved

Phase 3 proves that correctness-relevant event intent is committed atomically with authoritative PostgreSQL state, processed through a leased and idempotent transactional outbox, relayed from a separate worker to web-owned realtime connections, and eventually converges after message loss or reconnect. Realtime clients subscribe only to typed, authorized topics through a provider-neutral gateway.

The Socket.IO candidate is implemented only in its honestly supported memory topology: one socket-owning web process, stop-before-start deployment, and direct publication or PostgreSQL outbox relay into that owner. Configuration and `k-nex doctor` reject incompatible multi-web, separate-direct-worker, separate-gateway, or overlapping-rollout paths unless a distributed adapter is selected.

## Completed tasks

| Task | Commit |
|---|---|
| P3.1 — event classes and transactional outbox schema | `d56e272` |
| P3.2 — transaction atomicity and rollback silence | `9b6aa14` |
| P3.3 — idempotent outbox processing | `7d3da7b` |
| P3.4 — realtime gateway and Socket.IO memory mode | `fa737ba` |
| P3.5 — process-topology compatibility | `b199191` |
| P3.6 — distributed publication path | `1ee51cd` |
| P3.7 — source revisions and convergence | `945e248` |
| P3.8 — subscription security and backpressure | `2f3f0b3` |
| P3.9 — failure injection and Gate 3 closeout | this closeout commit |

## Durable event proof

Versioned event envelopes classify ephemeral hints, reconstructible invalidations, durable integrations, and durable workflows. Durable classes persist in `k_nex_outbox` in the same Payload/PostgreSQL transaction as authoritative state. The real database fixture proves commit persists both records, rollback exposes neither, and a deliberate process exit after commit leaves pending outbox intent.

The outbox processor uses `FOR UPDATE SKIP LOCKED`, expiring leases, unique claim tokens, bounded retries/backoff, dead letters, safe error codes, durable checkpoints, backlog health, and least-privileged system context. Replacement workers may recover expired claims, while stale owners cannot complete them. Subscriber idempotency ensures retry and lease recovery produce one effect. Payload Jobs 3.88 was evaluated and rejected for this scope because its job ownership contract does not provide the required expiring owner token; the measured decision is documented in [`p3-3-payload-jobs-evaluation.md`](./p3-3-payload-jobs-evaluation.md).

## Realtime and convergence proof

Core contracts expose typed topic definitions and a provider-neutral `RealtimeGateway`; Socket.IO types remain inside `@k-nex/realtime-socketio`. The memory provider derives internal rooms from validated topic parameters, authenticates connections, authorizes subscriptions, revalidates sessions and topic permissions, and exposes counter-only health data. Exact origin/transport allowlists and bounds cover connection count, subscriptions, request rate/bytes, publication bytes, acknowledgement buffers, coalescing, and slow-consumer disconnects.

A separate fixture worker commits outbox events without importing the Socket.IO provider. The web process claims those events and publishes via the neutral relay. Publication checkpoints only after success; a simulated private backplane failure schedules a retry without checkpointing, and recovery delivers the same event before marking it complete.

Source clients treat realtime revisions only as hints. They perform authoritative authorization and fetch on initialization, newer hints, reconnect, focus, and bounded periodic ticks. A lost hint converges on the periodic path; lagging snapshots remain stale; revision regression cannot overwrite newer data; revocation or authorization failure clears cached private data.

## Failure-injection evidence

| Injection | Executable evidence |
|---|---|
| commit then process crash | real PostgreSQL child exits after commit; state and pending outbox remain |
| rollback | real PostgreSQL transaction rolls back state and outbox; no publication occurs |
| duplicate outbox delivery | retry and expired-lease replacement invoke the subscriber twice but persist one idempotent effect |
| worker-to-web invalidation | separate worker commits; web relay publishes; real Socket.IO client acknowledges |
| lost Pub/Sub message | bounded periodic authoritative revalidation converges without receiving a hint |
| socket reconnect during rolling deployment | stop-before-start topology plus reconnect, reauthorization, resubscription, and delivery proof |
| permission revocation during subscription | topic revocation removes the subscription; actor revocation disconnects the session |
| slow consumer | acknowledgement buffer exhaustion disconnects the client |
| backplane unavailable/recovered | failed publication leaves no checkpoint, schedules retry, then recovered publication delivers and completes attempt two |

## Commands executed

On exact Node.js `24.19.0` and pnpm `11.9.0`:

```bash
pnpm gate:3
git diff --check
```

`pnpm gate:3` includes Gate 2A, the complete Socket.IO provider suite, and a focused runner that requires exactly one named passing test for each non-database failure scenario. The real customer PostgreSQL gate carries explicit markers for atomicity, duplicate idempotent effect, distributed invalidation, and outage recovery. CI runs Gate 3 after the earlier gates.

## Explicitly not proved

- The shipped Socket.IO provider is memory-only; selecting `distributed` is a topology contract, not an implemented distributed adapter.
- Production multi-node backplane capacity, availability, and operations remain unqualified.
- Realtime messages are invalidation hints, not a durable source of record or full business-record transport.
- The processor proves bounded direct PostgreSQL leasing; it does not claim Payload Jobs compatibility for the rejected ownership contract.
- Production load, long-duration soak, regional failover, deploy rollback, and operational alerting remain later-phase evidence.

## Kill/rework assessment

No Gate 3 kill criterion fired in the executable gate: committed durable intent survives process exit, topology and durability contracts reject unsupported paths, bounded revalidation converges after message loss, and revocation constrains or terminates existing subscriptions.

The final `GO PHASE 4` decision remains withheld until a fresh independent Sol/high review of the whole Phase 3 diff passes.
