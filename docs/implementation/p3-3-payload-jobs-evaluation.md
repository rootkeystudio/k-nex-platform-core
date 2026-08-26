# P3.3 Payload Jobs Queue Evaluation

Date: 2026-08-26

## Decision

Reject Payload Jobs Queue 3.88.0 for the Gate 3 durable outbox processor. Use the existing PostgreSQL outbox as the single durable queue with an atomic claim, expiring lease, owner token, retry/backoff, checkpoint, and dead-letter state.

## Evidence

Payload Jobs Queue was evaluated first, as required by P3.3. Current Payload documentation describes recoverable job processing with expiring ownership. The fixture's pinned and installed Payload 3.88.0 implementation does not provide that contract:

- the generated jobs schema records only a `processing` boolean;
- `runJobs` selects rows with `processing = false` and then marks them as processing;
- the installed queue implementation has no processing owner token or lease-expiry field;
- a worker exit after the processing flag is set can therefore leave a job unavailable indefinitely.

This fails the P3.3 claim/lease and crash-recovery acceptance criteria. Adding the Payload queue beside `k_nex_outbox` would also create a second durable handoff without solving that gap.

## Accepted adapter

The direct outbox processor uses PostgreSQL `FOR UPDATE SKIP LOCKED` for atomic claims. Every claim receives an expiring lease and random owner token. Only the current token may checkpoint, deliver, retry, or dead-letter the event. Expired work can be reclaimed, while a stale worker loses authority to mutate the row.

Subscribers receive only the validated event, its event ID as the idempotency key, a fixed least-privileged system actor, the last safe checkpoint, and a checkpoint writer. They do not receive Payload, the raw database adapter, request objects, or provider credentials.

Payload Jobs Queue can be reconsidered after the pinned version exposes expiring, owner-scoped claims and passes the same real-PostgreSQL lease-loss acceptance test.
