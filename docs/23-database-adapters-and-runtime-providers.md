# Database Adapters and Runtime Providers

## Purpose

K-Nex treats database integration as part of the plugin system rather than as hard-coded project scaffolding. A customer application selects a database adapter through the application manifest, the CLI resolves it like every other provider, and enabled modules declare the database capabilities they require.

The desired long-term experience is:

```text
create-k-nex-app
  → choose application modules
  → choose a database family/adapter
  → choose a local or hosted connection target
  → generate environment, Docker, health, migration, and runtime wiring
```

Examples of future choices may include:

```text
Postgres + local Docker
Postgres + external URL
Postgres + Neon
SQLite local/demo
other adapters only after contract and migration compatibility are proven
```

The V1 decision is intentionally narrower:

> K-Nex V1 officially supports Postgres only. Local development defaults to Postgres in Docker Compose. Other adapters remain plugin-shaped extension points, not supported promises.

## Terminology

Database-related installables use the existing K-Nex `provider` plugin kind with a more specific subtype.

### Database adapter plugin

A database adapter plugin connects the K-Nex/Payload application model to one database family and owns dialect-specific runtime and migration integration.

Initial package and stable plugin ID:

```text
package:   @k-nex/database-postgres
plugin ID: provider.database-postgres
subtype:   database-adapter
```

Possible future adapter:

```text
package:   @k-nex/database-sqlite
plugin ID: provider.database-sqlite
subtype:   database-adapter
```

### Database target plugin

A database target plugin describes how an adapter is connected, provisioned, and operated in a particular environment. It does not redefine the SQL dialect or domain persistence semantics.

Examples:

```text
provider.database-target-local-postgres
provider.database-target-external-postgres
provider.database-target-neon
```

From the CLI user's perspective, “Neon Postgres” can appear as one selectable option. Internally it resolves to:

```text
Postgres adapter
+ Neon target/profile
```

This prevents every hosted Postgres service from duplicating the Postgres adapter contract, migrations, module compatibility, and test suite.

### Infrastructure recipe

A target can contribute generated infrastructure artifacts such as:

```text
docker-compose services
safe environment-variable names
health checks
connection/pooling recommendations
migration command wiring
backup/restore runbook metadata
```

It never stores production credentials in the application manifest.

## Why adapter and target are separate

Neon, a local Docker Postgres instance, a customer-managed Postgres server, and another managed Postgres service share the same database dialect but can differ in:

- connection strings and TLS requirements;
- pooling and connection lifetime;
- serverless/runtime constraints;
- local provisioning;
- branching/preview workflow;
- backup/restore integration;
- operational diagnostics.

Keeping the dialect adapter separate from the hosting target gives K-Nex one Postgres compatibility contract while still allowing provider-specific operational packages.

```text
modules
  require database capabilities
        │
        ▼
provider.database-postgres
  implements Postgres/Payload runtime and migrations
        │
        ▼
selected connection target
  local Docker | external URL | Neon | future target
```

## V1 decisions

| Area | V1 decision |
|---|---|
| Supported production database | Postgres |
| Local default | Postgres in Docker Compose |
| External development/production | Existing Postgres URL through environment variable |
| Neon | Planned target/profile for the Postgres adapter; not required for first POC |
| SQLite | Future experimental/demo adapter; not an official compatible production target in V1 |
| MongoDB/other databases | No K-Nex support claim until module and migration test matrices exist |
| Primary database count | Exactly one `database.primary` provider per application |
| Secondary/specialized stores | Separate capabilities/providers; not treated as another primary database |
| Final migration ownership | Customer application repository |

## Capability model

Modules do not depend on a package name. They declare the behavior they need.

The Postgres adapter can provide capabilities such as:

```text
database.primary@1
database.relational@1
database.transactions@1
database.migrations@1
database.json@1
database.constraints@1
database.indexes@1
database.full-text.basic@1
```

Optional capability packages or target configuration may provide:

```text
database.geospatial.postgis@1
database.advisory-locks@1
database.read-replica@1
database.branching@1
database.connection-pooling@1
```

A module manifest can express requirements without naming Postgres directly:

```json
{
  "id": "module.inventory",
  "requires": [
    { "capability": "database.primary", "version": "^1.0.0" },
    { "capability": "database.transactions", "version": "^1.0.0" },
    { "capability": "database.constraints", "version": "^1.0.0" }
  ]
}
```

A specialized module can be explicit:

```json
{
  "id": "module.live-tracking-history-postgis",
  "requires": [
    { "capability": "database.geospatial.postgis", "version": "^1.0.0" }
  ]
}
```

This makes incompatibility visible during `k-nex plan`, before package installation or application boot.

## Provider manifest

The static manifest for the first adapter can resemble:

```json
{
  "id": "provider.database-postgres",
  "kind": "provider",
  "subtype": "database-adapter",
  "version": "1.0.0",
  "apiVersion": 1,
  "compatibleCore": "^1.0.0",
  "singleton": ["database.primary"],
  "provides": [
    { "capability": "database.primary", "version": "1.0.0" },
    { "capability": "database.relational", "version": "1.0.0" },
    { "capability": "database.transactions", "version": "1.0.0" },
    { "capability": "database.migrations", "version": "1.0.0" },
    { "capability": "database.json", "version": "1.0.0" },
    { "capability": "database.constraints", "version": "1.0.0" },
    { "capability": "database.indexes", "version": "1.0.0" }
  ],
  "requiresEnvironment": ["DATABASE_URL"],
  "configurationSchema": "./schemas/options.json",
  "contributions": {
    "database": "./dist/database-contribution.js",
    "health": "./dist/health-contribution.js",
    "cli": "./dist/cli-contribution.js"
  }
}
```

The manifest is side-effect-free metadata. Runtime code is imported only from the generated static registry.

## Runtime contribution contract

K-Nex should wrap the framework database adapter rather than inventing a new ORM or persistence abstraction.

Conceptual contract:

```ts
export interface DatabaseProviderContribution {
  pluginId: string
  dialect: string

  capabilities: readonly CapabilityProvision[]

  createFrameworkAdapter(context: {
    environment: ValidatedEnvironment
    logger: PlatformLogger
  }): unknown

  migration: {
    dialect: string
    directoryConvention: string
    lockStrategy: 'framework' | 'advisory-lock' | 'external'
  }

  health: {
    check(): Promise<DatabaseHealthResult>
  }

  diagnostics?: {
    describeConnectionWithoutSecrets(): Promise<Record<string, unknown>>
  }
}
```

The concrete implementation can return the Payload Postgres adapter. Domain modules continue to use Payload/K-Nex repository and transaction services rather than importing the provider package directly.

## Application manifest

The manifest should make the adapter and target explicit while keeping secrets in environment storage.

Conceptual V1 form:

```json
{
  "providers": {
    "database.primary": {
      "plugin": "provider.database-postgres",
      "package": "@k-nex/database-postgres",
      "version": "1.0.0",
      "options": {
        "connectionEnvironmentVariable": "DATABASE_URL"
      }
    }
  },
  "development": {
    "database": {
      "target": "local-docker-postgres",
      "docker": {
        "serviceName": "postgres",
        "imagePolicy": "pinned",
        "persistentVolume": true
      }
    }
  }
}
```

A future Neon selection may resolve to:

```json
{
  "providers": {
    "database.primary": {
      "plugin": "provider.database-postgres",
      "package": "@k-nex/database-postgres",
      "version": "1.2.0",
      "options": {
        "connectionEnvironmentVariable": "DATABASE_URL"
      }
    },
    "database.target": {
      "plugin": "provider.database-target-neon",
      "package": "@k-nex/database-target-neon",
      "version": "1.0.0",
      "options": {
        "connectionEnvironmentVariable": "DATABASE_URL"
      }
    }
  }
}
```

The exact manifest shape remains schema-versioned. The architectural invariant is the separation of adapter, target, and secret value.

## CLI creation flow

Initial creation should ask for the database after module selection because module capability requirements affect valid choices.

```text
◇ Database adapter
  ● Postgres (supported)
  ○ SQLite (experimental; hidden unless --experimental)

◇ Postgres target for local development
  ● Local Docker Compose
  ○ Existing external Postgres URL

◇ Production connection
  ● Configure later through DATABASE_URL
  ○ Existing external Postgres URL in local .env only

◇ Generate database health check and migration scripts?
  ● Yes
```

A later catalog can expose:

```text
Postgres — Local Docker
Postgres — External
Postgres — Neon
SQLite — Local demo
```

The UI can present these as product choices while the resolver installs the correct adapter/target combination.

## CLI commands

Proposed commands:

```bash
k-nex database show
k-nex database plan
k-nex database set provider.database-postgres
k-nex database target provider.database-target-neon
k-nex database doctor
k-nex database migrate
k-nex database migration:create
k-nex database readiness
```

Changing a connection target inside the same dialect can be a configuration/deployment operation.

Changing the database adapter/dialect is not a normal package swap. It requires an explicit data-migration project:

```text
schema compatibility analysis
export/import or dual-write plan
migration transformation
verification and reconciliation
cutover/rollback plan
backup
```

The CLI must not imply that replacing Postgres with SQLite or another database is safe because two packages implement `database.primary`.

## Resolver rules

The resolved application is valid only when:

1. exactly one enabled provider supplies singleton capability `database.primary`;
2. every enabled schema-owning module's database requirements are satisfied;
3. the selected target is compatible with the adapter dialect;
4. required environment-variable names are present in the generated environment schema;
5. conflicting dialect/adapter packages are rejected;
6. migrations exist or readiness explicitly reports pending schema work;
7. production cannot silently use an experimental adapter;
8. the lockfile contains the exact provider package versions recorded by the manifest;
9. generated Payload/database composition matches the resolved provider;
10. destructive adapter changes require an explicit migration plan and confirmation.

## Module persistence rules

A module owns its data model and invariants, but the customer application owns the final schema/migration sequence.

Module packages should provide:

```text
collection/global/schema contributions
indexes and constraint intent
required database capabilities
migration notes
adapter-specific helpers only when unavoidable
readiness checks
data migration helpers
compatibility fixtures
```

Modules should avoid unguarded dialect-specific SQL in public contracts.

Because V1 officially supports Postgres, first implementations may use Postgres features deliberately. Such usage must be declared through capabilities so future adapter work can identify incompatibilities rather than pretending portability.

Example:

```ts
export const inventoryModule = definePlugin({
  id: 'module.inventory',
  requires: [
    capability('database.transactions', '^1'),
    capability('database.constraints', '^1'),
  ],
  optional: [
    capability('database.advisory-locks', '^1'),
  ],
})
```

## Transactions

Transaction behavior is a capability, not an assumption hidden in every module.

Modules such as inventory, dispatch, budgeting, and publication workflows can require transaction support. The runtime must pass transaction/session context through domain services, repositories, event outbox writes, and framework adapters consistently.

A provider claiming `database.transactions` must pass contract tests for:

```text
commit
rollback
nested/application transaction policy
concurrent conflict behavior
outbox atomicity strategy
connection cleanup
error translation
```

## Migrations

Database provider packages contribute dialect integration and tooling, but do not own each customer's final migration history.

Preferred flow:

```text
1. Change manifest/plugin versions.
2. Resolve final plugin graph.
3. Compose final Payload/schema configuration.
4. Generate or author customer migration.
5. Review SQL/data impact.
6. Test from empty database and a previous-version fixture.
7. Back up production.
8. Run migration as a controlled release step.
9. Start/roll forward the new application.
10. Verify readiness and business invariants.
```

The provider can contribute:

- migration command adapters;
- migration lock implementation;
- safe connection acquisition;
- dialect diagnostics;
- SQL-generation hooks;
- test containers/fixtures;
- rollback limitations.

It cannot auto-drop data because a plugin disappeared from the manifest.

## Postgres local-development target

The default generated `docker-compose.yml` should use a pinned Postgres image and a named volume.

Conceptual output:

```yaml
services:
  postgres:
    image: postgres:<pinned-major-and-patch>
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

Generated local credentials belong in ignored local environment files or generated safe development defaults. Production secrets never reuse them.

The CLI should support an alternate port and avoid overwriting an existing Compose service without presenting a plan.

## Neon target direction

A Neon-specific target/provider can add:

```text
connection string/TLS validation
pooling mode guidance
serverless/long-running runtime compatibility checks
preview/branch environment mapping
migration connection policy
health/latency diagnostics
safe environment schema
CLI documentation and deployment hints
```

It should not fork the Postgres domain adapter or claim different module compatibility unless a real behavior difference requires it.

A Neon target is not required for the first architecture POC. The Postgres adapter contract must be stable before target-specific convenience packages are added.

## SQLite future direction

SQLite can be valuable for:

```text
very small local demos
fast disposable POCs
offline/single-process experiments
test fixtures where semantics are sufficient
```

However, SQLite must not be advertised as a drop-in production equivalent until it passes the required module matrix.

Likely capability differences include:

```text
concurrency and locking behavior
migration/DDL behavior
constraint/index differences
JSON/query behavior
full-text/search behavior
outbox/job coordination
horizontal/multi-process runtime suitability
```

An experimental SQLite adapter should:

- declare only capabilities it genuinely passes;
- be hidden behind `--experimental` or an explicit manifest flag;
- reject modules requiring unavailable capabilities;
- carry a visible non-production warning;
- use separate fixtures and migration tests;
- never cause the Postgres test suite to be skipped.

## Specialized stores

Some workloads may need storage outside the primary application database:

```text
Redis for ephemeral current positions/cache
PostGIS for geospatial history/query
search provider for indexed search
analytics warehouse/read model
time-series provider
object storage for files
```

These are separate provider capabilities, not reasons to allow multiple uncoordinated `database.primary` providers.

Example:

```text
module.live-tracking
  requires database.primary
  optional/requires realtime.gateway
  optional/requires tracking.position-store
  optional/requires database.geospatial.postgis
```

The primary authoritative business records remain clear even when a module uses a specialized projection/store.

## Connection and pooling policy

Database packages must make connection behavior explicit:

```text
maximum/minimum pool size
idle timeout
connection timeout
TLS mode
migration connection mode
worker versus web-process pools
serverless compatibility
read-replica policy
statement/query timeout
```

Safe values can be defaults; customer-specific values remain validated runtime/deployment configuration.

A health endpoint must not print the database URL, username, password, or certificate material.

## Environment and secret handling

Allowed in `k-nex.app.json`:

```json
{
  "connectionEnvironmentVariable": "DATABASE_URL"
}
```

Forbidden:

```json
{
  "databaseUrl": "postgres://user:password@host/database"
}
```

Values belong in:

```text
.env.local (ignored)
CI/CD secret storage
deployment platform secret manager
customer-managed secret manager
```

CLI prompts mask secret values and redact them from plans, logs, crash reports, generated manifests, and diagnostics.

## Health and readiness

The database provider contributes checks for:

```text
connection acquisition
basic query
migration/version state
required extension availability
pool exhaustion indicators where available
read/write capability
clock/transaction assumptions where relevant
```

Readiness distinguishes:

```text
healthy and current
reachable but migrations pending
reachable but required extension missing
misconfigured
unreachable
experimental/unsupported adapter in production
```

## Backup, restore, and offboarding

Every customer has an independent database, so the target/provider documentation must define:

```text
backup mechanism
restore rehearsal procedure
retention expectation
encryption responsibility
point-in-time recovery support where available
export/offboarding format
migration-before-restore compatibility
verification checklist
```

K-Nex can standardize interfaces and runbooks, but backup execution ultimately depends on the chosen deployment target.

## Contract-test matrix

Every supported database adapter must pass:

```text
core boot and health
empty database initialization
migration from previous fixture
rollback/failure behavior
transaction commit/rollback
permission-filtered queries
jobs/outbox behavior
CMS draft/publish lifecycle
workspace layout/theme collections
plugin disable/uninstall retention behavior
backup/restore smoke test where target supports automation
```

Every officially compatible module adds fixtures to the supported matrix.

V1 CI can run one authoritative matrix:

```text
Postgres + core
Postgres + CMS/builder/theme
Postgres + CRM
Postgres + logistics fixture
Postgres + restaurant fixture
```

Future adapter support is earned by passing the same relevant contracts, not by compiling successfully.

## POC acceptance criteria

The Postgres provider architecture is accepted for implementation when the POC proves:

1. `create-k-nex-app` selects Postgres and generates a working local Docker environment;
2. the application boots only through a generated database-provider registry;
3. a module can require `database.transactions` and dependency resolution validates it;
4. CMS, workspace layouts, themes, CRM, and one vertical module migrate successfully;
5. final migrations live in the customer fixture repository;
6. switching local target from Docker Postgres to an external Postgres URL does not change module code;
7. `k-nex doctor` reports missing URL, pending migrations, and capability mismatch safely;
8. connection diagnostics do not leak credentials;
9. database-provider removal or conflict fails before application boot;
10. a fake/experimental adapter missing a required capability is rejected deterministically.

## Open implementation questions

The architectural direction is accepted; these details require the POC:

- exact TypeScript type of the framework adapter contribution;
- whether target plugins are code packages or catalog/CLI recipe packages in V1;
- how the provider declares required Postgres extensions;
- migration lock strategy for each deployment target;
- how preview databases/branches map to customer preview deployments;
- whether read replicas are a database-target feature or a separate query provider;
- exact boundaries between Payload transaction APIs and K-Nex transaction contracts;
- when PostGIS becomes a first-party capability package;
- whether SQLite is worth maintaining after the Postgres-first POC.

## Non-goals

V1 does not attempt to provide:

- transparent live switching between SQL dialects;
- one application writing authoritative records to multiple primary databases;
- automatic cross-database migration;
- a generic ORM replacing Payload/framework persistence;
- runtime installation of database driver packages from the admin panel;
- production support claims for untested adapters;
- automatic destructive schema cleanup when a module is removed.
