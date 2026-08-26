# Project Status

- **Updated:** 2026-08-26
- **Phase:** Phase 3 — Transactions, Durable Events, and Realtime Convergence
- **Active task:** P3.2 — Transaction atomicity and rollback silence
- **State:** Active

## Last completed

Completed P3.1. Added the four event durability classes, a generated strict durable-event envelope with bounded secret-safe JSON payloads, and a customer-owned PostgreSQL outbox schema with durable-only constraints, scoped idempotency, claim/dead-letter/checkpoint state, explicit retention, and real schema/index rejection evidence.

## Validation

On Node.js 24.19.0 and pnpm 11.9.0: 82 contract tests, generated-schema validation, customer fixture build, and the real-PostgreSQL migration/outbox schema gate pass. Frozen install, documentation validation, and `git diff --check` pass.

## Next

Implement P3.2 with real PostgreSQL and Payload transaction behavior: commit must persist authoritative state plus outbox intent, rollback must expose neither, commit-then-crash must retain intent, and no external network effect may occur inside the transaction.

## Blockers

None.
