# ADR-0009: Database Adapter and Connection Target Plugins

- Status: superseded
- Date: 2026-08-25
- Superseded by: [ADR-0011](./0011-payload-database-adapter-selected-at-scaffold.md)
- Decision owners: K-Nex platform maintainers

## Original decision

This ADR originally proposed modeling the primary application database as K-Nex `provider` plugins with separate database-adapter and connection-target packages.

The proposal included conceptual packages and capabilities such as:

```text
@k-nex/database-postgres
provider.database-postgres
database.primary
provider.database-target-neon
```

## Why it was superseded

K-Nex is intentionally built on top of Payload rather than attempting to abstract Payload away.

Payload already owns:

- database adapter integration;
- database connection lifecycle;
- collection/global persistence;
- Local API and request-scoped database access;
- transaction integration;
- migration integration;
- adapter-specific behavior.

A second K-Nex database-provider layer would duplicate framework responsibilities, create unnecessary compatibility contracts, and incorrectly imply that the K-Nex platform can hot-swap persistence implementations independently from Payload.

The desired workflow is simpler:

```text
create-k-nex-app
  → select a Payload database adapter
  → install that Payload adapter package
  → generate Payload configuration and local infrastructure
```

K-Nex V1 selects Payload's Postgres adapter and supports Postgres only. A hosted service such as Neon is a Postgres connection/deployment choice, not a separate K-Nex persistence plugin.

## Preserved decisions

The following parts of the original discussion remain valid:

- Postgres is the V1 production and local-development default.
- Database credentials remain environment secrets.
- The customer repository owns final migration history.
- A different database family requires explicit compatibility testing.
- Hosted Postgres environments can need deployment-specific pooling/TLS/runbook guidance.
- Runtime admin UI cannot change the primary database adapter.

The accepted replacement architecture is documented in [ADR-0011](./0011-payload-database-adapter-selected-at-scaffold.md) and [Payload database selection](../23-database-adapters-and-runtime-providers.md).
