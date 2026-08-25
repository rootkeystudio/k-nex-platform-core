# Payload Database Selection and Scaffold Configuration

## Purpose

K-Nex is intentionally built on top of Payload. It does not introduce a second database abstraction, ORM, repository dialect, or database-provider plugin system above Payload.

The database choice is a **project-generation and framework-configuration choice**:

```text
create-k-nex-app
  → choose the Payload database adapter
  → install only that Payload adapter package
  → generate Payload database configuration
  → generate local infrastructure when requested
  → keep credentials in environment variables
```

After generation, K-Nex modules use Payload's server APIs and request context:

```ts
req.payload.find(...)
req.payload.findByID(...)
req.payload.create(...)
req.payload.update(...)
req.payload.delete(...)
req.payload.db
```

K-Nex modules do not import a K-Nex database provider and do not depend on a K-Nex-defined generic query API.

## Accepted decision

> K-Nex delegates primary database integration to Payload. The CLI selects and configures a Payload-supported adapter during scaffold generation. K-Nex V1 supports Postgres only.

This supersedes the earlier proposal to model primary database adapters and hosted database targets as K-Nex provider plugins.

## Why K-Nex does not wrap Payload database adapters

Payload already owns:

- adapter integration;
- database connection lifecycle;
- collection/global persistence;
- Local API access;
- request-scoped database access;
- transaction integration;
- framework migrations;
- schema generation and adapter-specific behavior.

Adding a K-Nex adapter layer would create duplicated concepts without improving the intended product:

```text
Payload adapter
  wrapped by K-Nex adapter
    wrapped by module repository
```

That additional layer would increase:

- migration and transaction ambiguity;
- adapter compatibility testing;
- framework upgrade surface;
- error translation;
- developer confusion;
- risk of accidentally promising database portability K-Nex does not need.

K-Nex remains tightly coupled to Payload by design. A future move away from Payload would be a platform migration, not a provider swap.

## V1 database policy

| Area | V1 decision |
|---|---|
| Framework database layer | Payload database adapter |
| Officially supported adapter | Payload Postgres adapter |
| Local default | Postgres through generated Docker Compose |
| External/managed database | Existing Postgres URL through `DATABASE_URL` |
| Neon, Supabase, RDS, Railway, other hosted Postgres | Connection/deployment choices using the same Payload Postgres adapter |
| SQLite | Not supported by K-Nex V1; may be evaluated later for demos |
| MongoDB | Not supported by K-Nex V1 |
| Database abstraction plugins | Not part of the K-Nex plugin model |
| Final migration history | Customer application repository |

K-Nex support is intentionally narrower than Payload's complete adapter catalog. The fact that Payload supports an adapter does not automatically mean every K-Nex module, migration, job, transaction, or deployment topology supports it.

## CLI creation flow

The first scaffold can ask:

```text
◇ Database
  ● Postgres

◇ Postgres connection for local development
  ● Generate Docker Compose service
  ○ Use an existing DATABASE_URL

◇ Generate production Dockerfile?
  ● Yes
  ○ No
```

Future versions may expose more Payload adapters after compatibility work:

```text
◇ Database
  ● Postgres (supported)
  ○ SQLite (experimental)
```

This selection controls generated source and installed dependencies. It is not a runtime plugin toggle.

## Generated Postgres configuration

Conceptual generated configuration:

```ts
import { postgresAdapter } from '@payloadcms/db-postgres'

export const database = postgresAdapter({
  pool: {
    connectionString: process.env.DATABASE_URL,
  },
})
```

The generated Payload configuration composes it directly:

```ts
import { buildConfig } from 'payload'
import { database } from './generated/database'

export default buildConfig({
  db: database,
  // collections, globals, plugins, admin, jobs, and other contributions
})
```

The exact code follows the supported Payload adapter API at implementation time. K-Nex owns generation and validation of the scaffold, not a replacement adapter contract.

## Application manifest representation

Database selection belongs to framework/scaffold configuration rather than the K-Nex plugin provider map.

Conceptual manifest:

```json
{
  "framework": {
    "payload": {
      "database": {
        "adapter": "postgres",
        "connectionEnvironmentVariable": "DATABASE_URL"
      }
    }
  },
  "development": {
    "database": {
      "mode": "docker-postgres",
      "serviceName": "postgres"
    }
  }
}
```

An externally hosted Postgres database changes connection/deployment configuration:

```json
{
  "framework": {
    "payload": {
      "database": {
        "adapter": "postgres",
        "connectionEnvironmentVariable": "DATABASE_URL"
      }
    }
  },
  "development": {
    "database": {
      "mode": "external"
    }
  }
}
```

Neon does not require a K-Nex database plugin:

```text
Payload Postgres adapter
+ Neon DATABASE_URL
+ deployment-specific pooling/TLS guidance when needed
```

If K-Nex later adds a Neon helper, it should be a CLI/deployment recipe or integration—not a replacement persistence abstraction.

## Dependency installation

The generator installs only the selected Payload adapter package.

For V1:

```text
@payloadcms/db-postgres
```

It does not install conceptual packages such as:

```text
@k-nex/database-postgres
@k-nex/database-neon
provider.database-postgres
```

Those names are not part of the accepted architecture.

## Environment and secrets

The committed manifest stores only the environment variable name:

```json
{
  "connectionEnvironmentVariable": "DATABASE_URL"
}
```

It never stores:

```text
username
password
hosted database token
full production connection URL
```

Secret values belong in:

- ignored `.env.local` files for development;
- CI/CD secret storage;
- deployment-platform secret storage;
- a dedicated secret manager.

The CLI may write a safe local Docker connection string into an ignored local environment file. It must never print or commit a production URL.

## Local Docker Postgres

When selected, the CLI generates a local development service and environment template.

Conceptual Compose output:

```yaml
services:
  postgres:
    image: postgres:<pinned-version>
    environment:
      POSTGRES_DB: app
      POSTGRES_USER: app
      POSTGRES_PASSWORD: local-development-only
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U app -d app"]
      interval: 5s
      timeout: 5s
      retries: 20

volumes:
  postgres_data:
```

Generation rules:

- pin the image version through the scaffold/template version;
- avoid overwriting existing services without a plan;
- permit an alternate host port;
- use named volumes;
- mark credentials as local-only;
- generate `.env.example` without real secrets;
- expose normal Payload migration commands.

## Module persistence contract

K-Nex modules declare Payload collections, globals, fields, hooks, indexes, endpoints, jobs, and services. They access persistence through the Payload request/application instance.

Example module query handler:

```ts
export async function listTasks({
  req,
  where,
  page,
  limit,
}: ListTasksInput) {
  return req.payload.find({
    collection: 'sales-tasks',
    where,
    page,
    limit,
    overrideAccess: false,
    req,
  })
}
```

Important rules:

- pass the authenticated request context where Payload access controls depend on it;
- do not set `overrideAccess: true` for ordinary user-facing data sources;
- keep authoritative business rules in domain/application services;
- use Payload transactions/request context consistently for multi-step behavior;
- do not expose raw database handles to builder documents or browser code;
- do not promise cross-adapter compatibility unless tested.

## Migrations

Payload provides database adapter and migration tooling. K-Nex defines the product workflow around final customer composition.

The customer repository owns:

- final migration files;
- ordering across installed modules and customer extensions;
- migrations already applied to that deployment;
- clean-install and previous-version upgrade tests;
- production backup and release procedure.

Preferred flow:

```text
1. Change module versions or schema contributions.
2. Compose the final Payload configuration.
3. Generate or author a customer migration.
4. Review schema and data impact.
5. Test from an empty database.
6. Test from a representative previous release.
7. Back up production.
8. Run migrations as a controlled release step.
9. Deploy the new application.
10. Verify health and business invariants.
```

K-Nex modules can publish:

- migration notes;
- compatibility warnings;
- data-migration helpers;
- readiness checks;
- fixtures;
- upgrade tests.

They do not own an independent production migration history detached from the customer application.

## Transactions

K-Nex uses the transaction behavior exposed by Payload and its selected adapter. It does not invent a parallel transaction manager.

Domain services that perform multiple writes should receive and propagate request/transaction context according to the selected Payload API.

Examples:

```text
assign shipment and record assignment history
consume inventory and write stock movements
approve budget and create audit/event records
publish content and record after-commit invalidation
```

The POC must prove commit, rollback, event timing, and request-context propagation using the Payload Postgres adapter.

## Hosted Postgres services

Managed services such as Neon can differ operationally in:

- pooled versus direct connection URL;
- TLS requirements;
- connection limits;
- serverless process lifetime;
- migration connection recommendations;
- preview database workflow;
- backup/branch tooling.

These differences belong to deployment documentation, CLI recipes, and environment validation. They do not create a new K-Nex persistence interface.

A future command may generate guidance:

```bash
k-nex scaffold database --target neon
```

That command would still configure Payload's Postgres adapter.

## Future adapter support

Another Payload adapter can be considered when a real customer need exists.

Adding official K-Nex support requires more than making the scaffold boot. It requires a compatibility matrix covering:

```text
all foundational collections
module schemas
indexes and relationships
transactions
migrations
jobs and workers
events/outbox strategy
query behavior
pagination/sorting/filtering
backup/restore
production deployment
```

Until that matrix passes, the adapter remains unsupported or experimental.

## POC acceptance criteria

The Postgres scaffold is accepted when:

1. `create-k-nex-app` installs only the Payload Postgres adapter.
2. Generated Payload config boots against Docker Postgres.
3. The same application boots against an external Postgres URL without changing module code.
4. Two customer manifests generate independent databases and migrations.
5. Module handlers use authenticated Payload request context.
6. Access controls are enforced when data is queried through module data-source endpoints.
7. Multi-step transactions commit and roll back correctly.
8. Migration generation and execution work from clean and previous-version fixtures.
9. Secrets are absent from committed manifests and logs.
10. No K-Nex database provider package or universal persistence abstraction is required.

## Non-goals

K-Nex does not initially provide:

- a database marketplace;
- hot-swappable database adapters;
- one universal repository/query abstraction;
- transparent migration between database families;
- runtime database selection from the admin panel;
- provider-specific database SDKs inside domain modules;
- direct database access from builder components.
