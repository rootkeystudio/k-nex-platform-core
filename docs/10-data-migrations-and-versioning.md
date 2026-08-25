# Data, Migrations, and Versioning

## Principle

Plugins contribute reusable schema/evolution intent, but every customer repository owns final Payload/Postgres migrations because only the final composition knows installed versions, options, customer extensions, prior deployed schema/data, stored documents, and process topology.

Postgres is the only supported V1 database for local and production paths.

## Evolution domains

```text
application manifest
package/plugin version
Payload/Postgres schema
domain data
source/action/event contracts
UI documents and layout assignments
theme profiles
provider/infrastructure state
mobile/driver client compatibility
```

Each domain has its own artifact, version, rollback, and evidence.

## Ownership

Plugin package:

```text
schema contributions and compatibility
release/migration notes
readiness and deterministic helper functions
old/new fixtures
source/block/theme migrations
durability/lifecycle/rollback limitations
```

Customer repository:

```text
final ordered migration files
currently deployed predecessor revision
previous-release upgrade fixture
backup/deployment/rollback plan
migration execution and release evidence
```

CLI plans/classifies but never hides migration source or runs production migrations incidentally.

## Migration execution fence

A production migration job:

1. verifies approved artifact and expected predecessor revision;
2. derives a lock key from application ID and database identity;
3. obtains a PostgreSQL advisory lock on one dedicated session;
4. performs reviewed migration/backfill steps;
5. records new migration and release revision;
6. releases the lock;
7. makes an older incompatible artifact fail readiness.

A second migration attempt must fail/wait predictably, never race.

## Migration rules

- no production auto-push;
- never edit an executed migration;
- use a new corrective migration;
- use transactions where safe;
- use expand/contract for overlapping web/worker/mobile releases;
- large backfills are resumable jobs with checkpoints;
- indexes/table rewrites account for production locking;
- destructive change requires explicit approval and restorable backup or audited exception;
- external side effects are not hidden inside non-idempotent migration code;
- application, database, content, layout, and theme rollback remain separate.

## Schema-owning lifecycle

V1:

```text
installed/enabled
installed/disabled
re-enabled
explicit archive/export project
explicit purge migration
```

Generic package removal while preserving active Payload schema/readability is not supported. A plugin-specific compatibility package can be researched later and must earn evidence without changing the V1 base promise.

Schema-less providers/themes/builders may be removed after dependency/reference checks.

## Source and output-contract evolution

Package version, source major, output-contract major, descriptor structural hash, and presentation metadata revision are independent.

- additive display label changes update presentation revision;
- additive optional compatible fields can update structural hash without source-major change;
- removed/renamed/semantically changed selected field requires source migration/major;
- output-contract breaking shape requires contract major;
- stored documents are scanned across draft, published, archived, customer, assignment, and user revisions.

## UI document and theme migrations

Trusted deterministic migrations transform canonical documents/profiles into new drafts. Publication remains explicit after validation and preview. Last-valid published revisions remain available.

Missing renderer/source/field does not silently delete content; readiness reports it and runtime uses safe fallback.

## Testing

- fresh empty Postgres to current schema;
- each customer’s prior deployed revision to target;
- concurrent migration lock;
- stale artifact readiness fence;
- rollback/restore or documented irreversibility;
- resumable interrupted backfill;
- old/new process overlap where promised;
- source/block/theme/document migration fixtures;
- disable/re-enable data preservation;
- purge dependency/reference/backup refusal;
- restored environment does not replay unsafe external effects.
