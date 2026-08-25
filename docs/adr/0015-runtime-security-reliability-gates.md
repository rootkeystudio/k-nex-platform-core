# ADR-0015: Runtime Security, Reliability, Accessibility, and Provenance Gates

- Status: accepted
- Date: 2026-08-25
- Decision owners: K-Nex platform maintainers
- Evidence: design-only
- Related: [Runtime gates](../29-runtime-security-reliability-and-quality-gates.md), [POC gates](../30-executable-poc-gates.md)

## Context

The platform combines authenticated data-source execution, field-level authorization, client caching, WebSocket invalidation, durable business events, schema migrations, visual composition, themes, trusted in-process plugins, and per-customer deployments. High-level security intentions are insufficient unless the order, limits, durability, convergence, accessibility, and release evidence are explicit.

## Decision

- The data-source gateway is a pipeline of independently testable stages.
- Requested fields are authorized before querying; only permitted projections enter validation, cache, telemetry, and serialization.
- Bindings distinguish required and optional fields.
- Cache classes are `no-store`, `actor`, `authorization-context`, and explicit `public`; role name alone is not a cache boundary.
- External HTTP errors use RFC 9457 Problem Details with safe K-Nex extensions.
- Gateway request depth, size, fields, rows, points, time, concurrency, rate, and cost are bounded centrally.
- Durable integration/workflow events require transactional outbox; reconstructible invalidations add convergence mechanisms.
- In-memory realtime is valid only for compatible single-process topology; split processes require a backplane or outbox relay.
- Supported web surfaces target WCAG 2.2 AA.
- Schema migrations use a PostgreSQL advisory lock, expected predecessor revision, and stale-artifact readiness fence.
- Production package/application releases require SBOM, artifact and lock digests, protected publishing, signed provenance, and deployment receipts.
- Builder engine, document runtime, and document repository are separate boundaries.
- Theme V1 exposes a small primitive ABI; complex interactions are separate versioned adapters.

## Consequences

- A simpler demo implementation cannot silently weaken production durability or authorization semantics.
- Cache and realtime adapters remain replaceable, but must satisfy explicit security and convergence contracts.
- Themes customize presentation without reimplementing every complex widget engine.
- Customer deployments remain independent while fleet state becomes verifiable from release/deployment evidence.
- Claims such as WCAG or SLSA maturity require linked evidence, not documentation alone.

## Validation

Gates 2–7 provide authorization, performance, crash, topology, accessibility, migration, provenance, and fleet evidence before relevant ADRs are promoted beyond design-only.
