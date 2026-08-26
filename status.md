# Project Status

- **Updated:** 2026-08-26
- **Phase:** Phase 3 — Transactions, Durable Events, and Realtime Convergence
- **Active task:** P3.7 — Source revisions and convergence
- **State:** Active

## Last completed

Completed P3.6 using the accepted PostgreSQL outbox relay option. The deployment contract explicitly records a separate worker using `postgres-outbox-relay`; a real worker process commits an event, the socket-owning web process consumes and checkpoints it through only `realtime.gateway`, and an authorized Socket.IO client receives the projected revision. Failed gateway publication remains uncheckpointed for retry.

## Validation

On Node.js 24.19.0 and pnpm 11.9.0: frozen install, Phase 0, Gate 1, contracts/runtime/payload-adapter/customer builds, 84 contract tests, 138 runtime tests, 40 payload-adapter tests, relay-aware doctor output, the real-PostgreSQL worker-to-web-to-Socket.IO proof, and `git diff --check` pass.

## Next

Implement P3.7 source/snapshot revisions and client convergence: authoritative initial fetch, newer-revision invalidation, reconnect uncertainty refetch, focus and bounded freshness revalidation, and permission/subscription reauthorization.

## Blockers

None.
