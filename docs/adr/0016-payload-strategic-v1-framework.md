# ADR-0016: Payload Is the Strategic V1 Application Framework

- Status: accepted
- Date: 2026-08-25
- Decision owners: K-Nex platform maintainers
- Evidence: design-only
- Related: [Product vision](../01-product-vision.md), [System architecture](../02-system-architecture.md), [POC gates](../30-executable-poc-gates.md)

## Context

K-Nex uses Payload collections, access controls, request context, jobs, migrations, versions/drafts, admin integration, and its Postgres adapter. Describing Payload as merely a provisional interchangeable host understates the real coupling and creates misleading portability expectations.

## Decision

Payload is the strategic application framework for K-Nex V1.

The executable POC tests whether deterministic plugin composition, authenticated data sources, migrations, builder/runtime integration, process topology, and framework upgrades are sustainable on Payload without deep forks.

It does not test a framework-neutral abstraction or promise that another framework can replace Payload through a provider plugin.

K-Nex still separates Payload-specific code in `@k-nex/payload-adapter` so contracts, composition logic, UI documents, and domain code do not import unnecessary framework internals.

## Consequences

- Module authors can deliberately use documented Payload request/access/transaction patterns.
- Database selection follows Payload adapter configuration.
- A future move away from Payload is a platform migration with explicit cost.
- The POC can reject the current K-Nex-on-Payload composition approach if it requires deep framework forks or unreliable migrations; it cannot claim framework portability as the fallback.

## Validation

Gate 1 proves deterministic minimal composition and migration; later gates prove source, job, builder, publication, and upgrade behavior. Evidence registry remains design-only until those fixtures exist.
