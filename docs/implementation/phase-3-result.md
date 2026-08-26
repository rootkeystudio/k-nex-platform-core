# Phase 3 Result — Transactions, Durable Events, and Realtime Convergence

- **Date:** 2026-08-26
- **Gate:** Gate 3
- **Baseline:** `ba25289`
- **Delivery:** direct coherent commits; no pull request
- **Decision:** **GO PHASE 4**

## Scope proved

Phase 3 proves that correctness-relevant event intent is committed atomically with authoritative PostgreSQL state, processed through a leased and idempotent transactional outbox, relayed from a separate worker to web-owned realtime connections, and eventually converges after message loss or reconnect. Realtime clients subscribe only to typed, authorized topics through a provider-neutral gateway.

The Socket.IO candidate is implemented only in its honestly supported memory topology: one socket-owning web process, stop-before-start deployment, and direct publication or PostgreSQL outbox relay into that owner. Configuration and `k-nex doctor` reject incompatible multi-web, separate-direct-worker, separate-gateway, overlapping-rollout, and unimplemented distributed-adapter selections.

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
| P3.9 — failure injection and Gate 3 closeout | `5c74578` |

## Durable event proof

Versioned event envelopes classify ephemeral hints, reconstructible invalidations, durable integrations, and durable workflows. Durable classes persist in `k_nex_outbox` in the same Payload/PostgreSQL transaction as authoritative state. The real database fixture proves commit persists both records, rollback exposes neither, and a deliberate process exit after commit leaves pending outbox intent.

The outbox processor uses `FOR UPDATE SKIP LOCKED`, expiring leases, unique claim tokens, bounded retries/backoff, dead letters, safe error codes, durable checkpoints, backlog health, and least-privileged system context. Replacement workers may recover expired claims, while stale owners cannot complete them. Subscriber idempotency ensures retry and lease recovery produce one effect. Payload Jobs 3.88 was evaluated and rejected for this scope because its job ownership contract does not provide the required expiring owner token; the measured decision is documented in [`p3-3-payload-jobs-evaluation.md`](./p3-3-payload-jobs-evaluation.md).

## Realtime and convergence proof

Core contracts expose typed topic definitions and a provider-neutral, classified `RealtimeGateway`; it accepts only `ephemeral-hint` or `reconstructible-invalidation` envelopes with correlation identity. Durable classes cannot enter this API. Socket.IO types remain inside the selected `provider.realtime.socketio` / `@k-nex/provider-realtime-socketio` package. The customer manifest selects that provider and the registration runtime binds its `realtime.gateway@1.0.0` capability. The memory provider derives internal rooms from validated topic parameters, reserves the connection cap before authentication, bounds authentication time, rejects failed handshakes, and retains accounting for disconnected or timed-out middleware work until the underlying authenticator settles. Authentication returns a server-owned login-session identity alongside the actor, so periodic revalidation can revoke one session without disconnecting another session for the same active actor. It snapshots publications into canonical caller-detached data before validating bytes or queueing delivery, rejects distinct-room growth at a configured global pending-publication ceiling, serializes subscription mutation, and exposes counter-only health data. Automatic session and topic-permission revalidation is globally single-flight, coalesces per-session checks, prevents a hanging callback from blocking peer sessions, and disconnects a session whose revalidation exceeds its deadline. Exact origin/transport allowlists and bounds cover pending plus established connections, subscriptions, request rate/bytes, publication bytes and pending items, acknowledgement buffers, coalescing, and slow-consumer disconnects.

A separate fixture worker commits outbox events without importing the Socket.IO provider. The web process claims those events and publishes via the neutral relay. Publication checkpoints only after success. Gate 3 pauses the actual Testcontainers PostgreSQL process while the recovered relay is starting, time-bounds and terminates that unavailable attempt, then unpauses the same database and proves the pending event and its empty checkpoint survive before recovery delivers and completes it.

Source clients treat realtime revisions only as hints. Their executable lifecycle attaches invalidation, reconnect, and focus signals and schedules its own bounded periodic revalidation. It performs authoritative authorization and fetch on initialization, newer hints, reconnect, focus, and periodic ticks. Refresh callbacks receive an abort signal and a strict deadline; timeout clears cached private data without discarding the newest observed revision watermark, late success or rejection cannot overwrite a fail-closed state or a newer successful retry, and a later cycle retries after the dependency recovers. A lost hint converges automatically; lagging snapshots remain stale until the authoritative source reaches the watermark; revision regression cannot overwrite newer data; revocation or authorization failure clears cached private data.

## Failure-injection evidence

| Injection | Executable evidence |
|---|---|
| commit then process crash | real PostgreSQL child exits after commit; state and pending outbox remain |
| rollback | real PostgreSQL transaction rolls back state and outbox; no publication occurs |
| duplicate outbox delivery | retry and expired-lease replacement invoke the subscriber twice but persist one idempotent effect |
| worker-to-web invalidation | separate worker commits; web relay publishes; real Socket.IO client acknowledges |
| lost Pub/Sub message | bounded periodic authoritative revalidation converges without receiving a hint |
| socket reconnect during rolling deployment | old server/gateway is closed, a replacement owner starts, and the client reauthenticates, resubscribes, and receives delivery |
| permission revocation during subscription | topic revocation removes the subscription; actor revocation disconnects the session |
| slow consumer | acknowledgement buffer exhaustion disconnects the client |
| backplane unavailable/recovered | actual PostgreSQL container is paused, the relay process is bounded and terminated, then the same database is unpaused and the still-pending uncheckpointed event is delivered |

## Commands executed

On exact Node.js `24.19.0` and pnpm `11.9.0`:

```bash
pnpm phase:0
pnpm gate:3
git diff --check
```

`pnpm gate:3` includes Gate 2A, the complete Socket.IO provider suite, and a focused runner that requires exactly one named passing test for each non-database failure scenario. The real customer PostgreSQL gate carries explicit markers for atomicity, duplicate idempotent effect, distributed invalidation, and outage recovery. CI runs Gate 3 after the earlier gates.

The provider suite also runs `pnpm pack` into an isolated directory and compares every unpacked entry with the committed customer fixture archive, including the publish-time peer dependency rewrite, preventing workspace-dependent or stale package evidence.

Generated event JSON Schema uses the registered `kNexMaxCanonicalBytes` AJV keyword to enforce the same canonical UTF-8 payload budget as the Zod authoring/writer contract and `kNexNoSecretFields` to apply the same recursive normalized secret-name rule, including leading, trailing, Unicode, and punctuation separators. Selecting `realtime.gateway` requires an explicit `runtime.realtime` topology in both the Zod authoring contract and generated AJV schema, so omission cannot bypass the fail-closed topology checks.

## Explicitly not proved

- The shipped Socket.IO provider is memory-only; `distributed` is rejected until an executable distributed provider/backplane is installed and validated.
- Production multi-node backplane capacity, availability, and operations remain unqualified.
- Realtime messages are invalidation hints, not a durable source of record or full business-record transport.
- The processor proves bounded direct PostgreSQL leasing; it does not claim Payload Jobs compatibility for the rejected ownership contract.
- Production load, long-duration soak, regional failover, deploy rollback, and operational alerting remain later-phase evidence.

## Kill/rework assessment

No Gate 3 kill criterion fired in the executable gate: committed durable intent survives process exit, topology and durability contracts reject unsupported paths, bounded revalidation converges after message loss, and revocation constrains or terminates existing subscriptions.

## Whole-phase review

Independent Sol/high reviews were run over the complete Phase 3 diff after each correction cycle. Findings covering contract classification, provider selection, topology enforcement, authentication accounting, publication immutability and bounds, revalidation, source convergence, schema parity, real failure injection, session identity, and package reproducibility were corrected and re-gated. The final fresh review of `ba25289..6e1f7f2` returned **PASS** with no blocking findings after independently confirming Phase 0, Gate 3, exact-session revocation, watermark preservation, canonical provider packing/installability, generated-schema parity, and PostgreSQL durability/outage evidence.

Phase 3 is closed. Phase 4 begins at P4.1 under the user-directed direct-commit workflow; no pull request is required.
