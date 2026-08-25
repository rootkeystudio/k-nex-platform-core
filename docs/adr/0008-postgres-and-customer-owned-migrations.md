# ADR-0008: Postgres Default and Customer-Owned Final Migrations

- Status: accepted
- Date: 2026-08-25
- Decision owners: K-Nex platform maintainers
- Related: [Data, migrations, and versioning](../10-data-migrations-and-versioning.md), [CLI and project generation](../15-cli-and-project-generation.md)

## Context

K-Nex modules contribute schema and data behavior, but every customer application installs a different combination of modules, providers, options, and customer extensions. Only the final customer composition knows the complete database schema and the exact previously deployed state.

CRM, dispatch, inventory, budgeting, permissions, reporting, and tracking metadata are strongly relational. Using a local database different from production can hide migration and behavior differences until late.

## Decision

Use Postgres as the supported K-Nex V1 production default and local-development default.

```text
production default      external/managed Postgres
local default           Postgres through Docker Compose
SQLite                  demo/fast POC mode only
MongoDB                  not officially supported by K-Nex V1 until compatibility is proven
```

Plugins own reusable schema contributions, migration notes, compatibility/readiness checks, and data migration helpers.

The customer application owns:

- final generated migration files;
- cross-plugin/customer-extension migration ordering;
- the migration history already deployed to that customer;
- production execution, backup, and rollback procedure;
- clean-install and previous-version upgrade tests.

Removing a plugin package does not automatically drop its schema or data. Disable, uninstall, and purge remain separate operations.

## Consequences

### Positive

- Development exercises the same primary database family as production.
- Relational domain models, transactions, indexes, and reporting have a consistent baseline.
- Customer-specific plugin combinations produce reviewable final migrations.
- One customer can upgrade without coordinating every other customer.
- Shared modules can publish reusable data helpers without pretending to know final schema order.

### Costs

- Local development normally requires Docker or an external Postgres instance.
- Supporting another database requires module contract/migration test matrices.
- Customer repositories carry migration artifacts and upgrade fixtures.
- Plugin uninstall with retained data requires careful framework/schema compatibility design.

### Migration rules

- no development auto-push in production;
- never edit a migration already run in a deployed environment;
- destructive changes require explicit reviewed migration and backup decision;
- large backfills use resumable jobs where appropriate;
- prefer expand/contract for compatibility across rolling processes/clients;
- test from empty database and actual/representative previous customer version;
- application rollback and database rollback are separate decisions.

## Alternatives considered

### MongoDB default

Not selected because the initial expected domain mix is relational and Postgres gives a consistent transaction/reporting/geospatial path. It can be evaluated later through explicit provider/module compatibility.

### SQLite local default with Postgres production

Rejected as default because migration/query/transaction differences can be discovered too late. Retained as demo mode.

### Module-owned independent migration histories applied directly

Rejected because schema contributions interact in the final customer application and ordering/collisions/customer extensions are composition-specific.

### Automatic destructive cleanup on uninstall

Rejected because package removal is not evidence that data retention, dependent references, legal obligations, or rollback needs have been satisfied.

## Validation or revisit trigger

Validate with two customer compositions, clean install, previous-version upgrade, module addition, disabled module, uninstall-with-data-retention experiment, and explicit purge.

Revisit database support after a concrete customer requirement and a complete module/provider compatibility test suite—not only because the underlying framework exposes another adapter.
