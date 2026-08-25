# ADR-0009: Database Adapter and Connection Target Plugins

- Status: accepted
- Date: 2026-08-25
- Decision owners: K-Nex platform maintainers
- Related: [ADR-0008](./0008-postgres-and-customer-owned-migrations.md), [Database adapters and runtime providers](../23-database-adapters-and-runtime-providers.md), [Plugin taxonomy](../13-plugin-taxonomy-and-capabilities.md), [Application manifest](../14-application-manifest.md)

## Context

K-Nex customer applications must be independently deployable and generated through one manifest-driven composition system. Database selection, local development provisioning, environment requirements, health checks, migration wiring, and future managed-host targets should therefore participate in the same plugin/catalog/resolver model as other infrastructure providers.

At the same time, a hosted Postgres service such as Neon and a local Docker Postgres instance do not represent different domain persistence dialects. Treating every hosting target as a complete independent database adapter would duplicate module compatibility, migration logic, transaction contracts, and test matrices.

The architecture also needs an honest boundary around support. Underlying framework adapter availability does not mean every K-Nex module has been verified on that database.

## Decision

Database integration is implemented through K-Nex `provider` plugins with two explicit subtypes:

```text
database-adapter
  owns database family/dialect runtime integration,
  framework adapter composition, migration integration,
  capability claims, health, and contract tests

database-target
  owns local/managed/external connection and operational profile,
  environment schema, infrastructure generation, pooling/TLS guidance,
  and target-specific diagnostics
```

Initial adapter:

```text
provider.database-postgres
@k-nex/database-postgres
```

Initial targets:

```text
local Docker Postgres
existing external Postgres URL
```

A future Neon user-facing option resolves to:

```text
provider.database-postgres
+ provider.database-target-neon
```

rather than duplicating the Postgres adapter.

K-Nex V1 officially supports Postgres only. SQLite and other adapters can exist as experimental packages only after they declare truthful capabilities and are rejected for incompatible production compositions.

Exactly one enabled provider supplies singleton capability `database.primary` in V1. Specialized stores such as Redis, PostGIS projections, search, analytics, or time-series systems use separate capabilities and do not become additional primary databases.

Modules declare database capability requirements rather than provider package names.

## Consequences

### Positive

- Database selection is visible in `k-nex.app.json`, package inventory, plans, and generated registries.
- Modules can require transactions, constraints, geospatial behavior, or other explicit capabilities.
- Hosted Postgres targets reuse one Postgres compatibility and migration model.
- Local Docker and external/managed targets can differ operationally without changing module code.
- The CLI can reject incompatible modules before application boot.
- Future adapters are possible without pretending they are already compatible.
- Database credentials remain environment values rather than manifest data.

### Costs

- The resolver needs singleton provider and capability validation.
- Adapter and target manifests require a compatibility relationship.
- Provider packages need health, diagnostics, and contract-test fixtures.
- Changing database dialect remains a data-migration project, not a simple plugin replacement.
- Supporting SQLite or another database requires meaningful module and migration test matrices.

### Required invariants

- one `database.primary` provider;
- target dialect compatible with adapter dialect;
- exact provider package versions in manifest/lockfile;
- no runtime package import selected from database data;
- no secrets in the application manifest or generated registry;
- final migrations remain customer-owned;
- experimental adapters cannot be used silently in production;
- provider diagnostics redact connection credentials;
- provider removal/conflict fails during plan/generation/readiness.

## Alternatives considered

### Hard-code Postgres in the platform core

Rejected because provider selection, local setup, diagnostics, and future adapter work would remain special-case CLI/framework code instead of using the common composition model.

### One complete adapter package per hosting vendor

Rejected as the default because local Postgres, Neon, and other hosted Postgres services share dialect/module compatibility. Hosting-specific behavior belongs in a target/profile unless it genuinely changes runtime semantics.

### Advertise every framework-supported adapter immediately

Rejected because K-Nex modules, migrations, transactions, jobs, and uninstall behavior must be verified as a complete system.

### Use SQLite as the default local database and Postgres in production

Rejected as the standard path because dialect and migration differences can be discovered too late. SQLite may remain an explicit experimental/demo mode.

### Allow multiple primary databases in V1

Rejected because ownership, transactions, migrations, and consistency would become ambiguous. Specialized stores use explicit secondary capabilities.

## Validation or revisit trigger

Validate through a POC proving:

- generated Postgres adapter registration;
- local Docker and external URL targets;
- capability-based module rejection;
- customer-owned migrations;
- safe diagnostics;
- target switching without module changes;
- experimental adapter rejection.

Revisit the adapter/target split only when a real provider cannot be represented without duplicating or violating Postgres adapter semantics.