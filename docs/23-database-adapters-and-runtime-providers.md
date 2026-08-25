# Payload Database Selection and Scaffold Configuration

## Decision

K-Nex is built directly on Payload and does not introduce a second primary-database abstraction, ORM, or provider capability.

```text
create-k-nex-app
  → select supported Payload database adapter
  → install that @payloadcms/db-* package
  → generate Payload db configuration
  → optionally generate local infrastructure
```

## V1 support

```text
Payload adapter       Postgres
local development     generated Docker Postgres by default
external/managed      DATABASE_URL
hosted Postgres       same Payload Postgres adapter and deployment guidance
SQLite/Mongo/other    unsupported until complete K-Nex compatibility evidence
```

A hosted service such as Neon changes connection, pooling, TLS, preview, and deployment guidance; it does not create another K-Nex persistence contract.

## Module access

Module handlers use authenticated Payload request/application context and domain services:

```ts
await req.payload.find({
  collection: 'sales-tasks',
  req,
  overrideAccess: false,
  where: authorizedWhere,
})
```

Modules propagate request/transaction context correctly and do not depend on a K-Nex generic repository API.

## Manifest

```json
{
  "framework": {
    "payload": {
      "database": {
        "adapter": "postgres",
        "package": "@payloadcms/db-postgres",
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

Secrets remain outside committed source.

## Migrations

Payload integrates database migrations, but each customer repository owns final migration files and production execution. Module packages provide schema contributions, notes, readiness, and deterministic helpers.

Production migration uses:

```text
reviewed customer artifact
dedicated migration role where practical
PostgreSQL advisory lock
expected predecessor revision
backup/rollback plan
new revision record
stale artifact readiness fence
```

## Compatibility

A plugin manifest declares tested Payload adapter names under `compatibility.payloadDatabaseAdapters`. This is a compatibility claim, not an interchangeable K-Nex capability.

Adding another Payload adapter later requires full module, transaction, job, migration, concurrency, lifecycle, and deployment fixtures.
