# ADR-0011: Select Payload Database Adapter at Scaffold Time

- Status: accepted
- Date: 2026-08-25
- Decision owners: K-Nex platform maintainers
- Supersedes: [ADR-0009](./0009-database-adapter-and-target-plugins.md)
- Related: [ADR-0008](./0008-postgres-and-customer-owned-migrations.md), [Payload database selection](../23-database-adapters-and-runtime-providers.md), [CLI and project generation](../15-cli-and-project-generation.md)

## Context

K-Nex is built directly on Payload. Payload already defines database adapter APIs, collection/global persistence, request-scoped Local API access, transaction behavior, and database migration integration.

The earlier architecture proposed an additional K-Nex database-provider plugin layer. That would duplicate Payload concepts and imply a degree of framework-independent database portability that is not required by the product.

The customer application generator still needs to choose a database, install the correct package, generate framework configuration, optionally generate local Docker infrastructure, and validate environment requirements.

## Decision

Database selection is a scaffold/framework decision, not a K-Nex plugin capability.

```text
create-k-nex-app
  → choose Payload database adapter
  → install the selected @payloadcms/db-* package
  → generate Payload db configuration
  → generate local infrastructure when requested
  → reference credentials through environment variables
```

K-Nex V1 officially supports:

```text
Payload Postgres adapter
local Docker Postgres
external/managed Postgres through DATABASE_URL
```

K-Nex modules access persistence through the authenticated Payload request/application instance and module domain services. They do not import a K-Nex database provider or a universal K-Nex ORM.

A hosted Postgres service such as Neon uses the same Payload Postgres adapter. Provider-specific setup can be represented by CLI/deployment recipes and documentation rather than a new persistence plugin.

## Consequences

### Positive

- The architecture matches the actual Payload foundation.
- No duplicate adapter, transaction, migration, or health abstraction is required.
- Module authors use familiar Payload APIs and request context.
- The scaffold installs only the database package that is actually needed.
- Postgres support remains explicit and honest.
- Hosted Postgres choices do not fragment module compatibility.
- Framework upgrades have one database integration surface rather than two.

### Costs

- K-Nex is intentionally coupled to Payload database APIs.
- Supporting another database family requires full K-Nex module/migration testing, not merely a new provider package.
- Migrating away from Payload would be a platform migration.
- Modules must correctly propagate Payload request/transaction context.

### Required invariants

- V1 generated applications use Payload's Postgres adapter.
- Database secrets are stored only in environment/secret systems.
- The customer repository owns final migrations.
- Module user-facing queries preserve Payload access controls and record policy.
- The CLI cannot imply that changing a JSON/plugin ID safely migrates database families.
- Admin runtime configuration cannot install or replace the primary adapter.

## Alternatives considered

### K-Nex database provider plugins

Rejected and superseded because they duplicate Payload adapter responsibilities and imply a false portability boundary.

### Universal K-Nex repository/ORM abstraction

Rejected because it would become a lowest-common-denominator persistence framework and obscure Payload behavior.

### Hard-code Postgres without a scaffold choice model

Not selected as the complete design. Postgres is the only V1 option, but the manifest/scaffold still records the Payload adapter and local/external setup so project generation is deterministic and a future tested adapter can be introduced explicitly.

### SQLite local development with Postgres production

Rejected as the default because database differences can hide migration, transaction, concurrency, and query issues until deployment.

## Validation or revisit trigger

Validate through a POC proving:

- generated Payload Postgres configuration;
- Docker Postgres and external Postgres operation;
- authenticated module data-source handlers using `req.payload`;
- transaction commit/rollback and event timing;
- clean and previous-version customer migrations;
- no K-Nex database provider package in the resolved graph.

Revisit only when a real customer requires another Payload adapter and the complete K-Nex compatibility matrix is implemented.
