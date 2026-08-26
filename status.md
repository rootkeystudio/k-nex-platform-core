# Project Status

- **Updated:** 2026-08-26
- **Phase:** Phase 3 — Transactions, Durable Events, and Realtime Convergence
- **Active task:** P3.3 — Idempotent outbox processing
- **State:** Active

## Last completed

Completed P3.2. Added a fail-closed Payload/Postgres outbox writer that requires the active transaction session and proved with real PostgreSQL that authoritative state and durable intent commit together, roll back without visibility or HTTP publication, and survive an immediate post-commit process crash as pending work.

## Validation

On Node.js 24.19.0 and pnpm 11.9.0: frozen install, Phase 0, Gate 1, 30 payload-adapter tests, customer fixture build, the real-PostgreSQL atomicity/crash gate, and `git diff --check` pass.

## Next

Implement P3.3 idempotent outbox processing using Payload Jobs Queue first unless measured evidence rejects it. Prove claim/lease, retry/backoff, duplicate-safe subscriber effects, poison/dead-letter handling, checkpointing, and observable backlog/failure under least-privileged capability-scoped context.

## Blockers

None.
