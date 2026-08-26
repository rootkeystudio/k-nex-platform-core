# Project Status

- **Updated:** 2026-08-26
- **Phase:** Phase 3 — Transactions, Durable Events, and Realtime Convergence
- **Active task:** P3.4 — `realtime.gateway` and Socket.IO memory mode
- **State:** Active

## Last completed

Completed P3.3. Measured and rejected Payload Jobs Queue 3.88.0 because its pinned processing flag has no expiring owner-scoped lease. Added a direct PostgreSQL outbox processor with atomic skip-locked claims, owner tokens, lease renewal/recovery, bounded retry/backoff, attempt-ceiling dead-lettering, safe checkpoints, least-privileged subscriber context, idempotent effects, and backlog/failure health.

## Validation

On Node.js 24.19.0 and pnpm 11.9.0: frozen install, Phase 0, Gate 1, 38 payload-adapter tests, the customer fixture build, the real-PostgreSQL gate, and `git diff --check` pass. PostgreSQL evidence includes duplicate-safe effects, checkpoint resume, retry/backoff, lease recovery, poison dead-lettering, and health reporting.

## Next

Implement P3.4 typed `realtime.gateway` registration and Socket.IO memory mode. Keep provider types private, authorize subscriptions through registered channel/topic factories, and prevent clients from inventing room strings.

## Blockers

None.
