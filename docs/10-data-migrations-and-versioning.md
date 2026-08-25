# Data, Migrations, and Versioning

## Principle

Modules define reusable schema and data evolution intent, but the **customer application owns the final migration history** because only the customer application knows the exact installed module combination and database state.

Each customer has an independent database and can upgrade on its own schedule.

## Sources of schema change

The final Payload/database schema may change because of:

- core infrastructure updates;
- module version upgrades;
- module installation or removal;
- customer extension changes;
- customer-specific collection or field additions;
- page-builder component data evolution;
- infrastructure provider changes requiring persisted data.

All production changes must result in reviewed migration artifacts.

## Migration ownership

### Shared module package

A module release should provide:

- schema/config changes;
- migration notes;
- reusable data migration helpers where needed;
- compatibility ranges;
- fixtures representing old and new data shapes;
- upgrade and rollback limitations;
- destructive-change warnings.

Example export:

```ts
export {
  migrateCrmContactsV1ToV2,
  validateCrmV2Readiness,
} from '@k-nex/module-crm/migrations'
```

### Customer application

The customer repository owns:

- the final generated Payload migration files;
- calls to module data migration helpers;
- ordering across changes from multiple modules;
- customer extension data migration;
- environment-specific execution and backup procedure;
- proof that the migration works from the currently deployed version.

## Upgrade workflow

```text
1. Create customer upgrade branch.
2. Update exact core/module package versions.
3. Resolve and validate the module graph.
4. Build final Payload configuration.
5. Generate types.
6. Generate/review schema migration.
7. Add explicit data migration steps where required.
8. Test against a clean database.
9. Test against a copy/fixture of the previous production schema and data.
10. Run application integration and access tests.
11. Document backup, deployment, and rollback procedure.
12. Merge and deploy that customer only.
```

## Migration rules

- Never depend on development-time automatic schema push in production.
- Never edit a migration that has already run in a deployed environment.
- New corrective behavior gets a new migration.
- Use transactions where supported and safe.
- Large data backfills may require resumable jobs rather than one long blocking migration.
- Index creation strategy must consider table size and production locking.
- Destructive changes require explicit approval and verified backup.
- Data transformations should be deterministic and testable.

## Expand and contract

For breaking data-shape changes, prefer a multi-release expand/contract sequence.

Example field rename:

```text
Release A
- add new field
- write both old and new fields
- backfill existing rows
- read with fallback

Release B
- read new field only
- stop writing old field
- verify no old clients depend on it

Release C
- remove old field with explicit destructive migration
```

This is especially useful when driver/mobile clients or workers may not update at the exact same moment as the backend.

## Module installation states

Do not treat removing a package from configuration as automatic data deletion.

### Installed and enabled

- schema active;
- routes/jobs/events active;
- UI/navigation may be active;
- data retained.

### Installed and disabled

- package and schema remain;
- selected behavior, routes, or UI are disabled;
- data retained;
- useful for temporary suspension or phased rollout.

### Uninstalled

- package code is removed;
- historical tables/fields may remain intentionally;
- no destructive cleanup is implied.

### Purged

- explicit reviewed migration deletes module data and schema;
- backup/retention policy has been satisfied;
- dependent modules and integrations have been checked;
- operation is normally irreversible without restore.

## Versioning model

### Core

Semantic versioning:

- patch: compatible bug/security fixes;
- minor: backward-compatible contracts/features;
- major: breaking public contract changes.

### Modules

Modules version independently and declare compatibility:

```json
{
  "peerDependencies": {
    "@k-nex/core": ">=1.4.0 <2.0.0",
    "payload": ">=3.0.0 <4.0.0"
  }
}
```

Customer repositories install exact versions:

```json
{
  "dependencies": {
    "@k-nex/core": "1.4.2",
    "@k-nex/module-driver": "1.3.0",
    "@k-nex/module-websocket": "1.4.2"
  }
}
```

The lockfile is part of the release artifact.

## Compatibility matrix

Every release should make compatibility machine-readable.

Example generated inventory:

```json
{
  "application": "acme-cargo",
  "core": "1.4.2",
  "payload": "3.x",
  "modules": {
    "transport.websocket": "1.4.2",
    "logistics.core": "1.8.0",
    "logistics.dispatch": "1.5.1",
    "logistics.driver": "1.3.0"
  },
  "schemaRevision": "2026-08-25-01"
}
```

Exact Payload ranges should be produced from real package manifests rather than hard-coded documentation examples.

## Release notes

A package release must state:

- added behavior;
- changed public contracts;
- security impact;
- configuration changes;
- migration requirement;
- data backfill requirement;
- worker or infrastructure changes;
- minimum compatible core/Payload version;
- known rollback limitations.

## Rollback

Application rollback and database rollback are separate decisions.

Safe patterns:

- deploy backward-compatible schema before new application code;
- retain old fields during expand/contract;
- keep previous container image and package lockfile;
- take a verified database backup before destructive migration;
- provide compensating migration where practical;
- use feature disablement to stop behavior without deleting data.

A database restore may be the only safe rollback after a destructive transformation. This must be stated before deployment.

## Page-builder data

Builder component IDs and property schemas are persisted application data. Their changes require the same discipline as ordinary schema changes:

- keep old renderers during migration;
- migrate stored documents with fixtures and validation;
- verify drafts and published versions;
- do not remove a component until no document references it.

## High-volume data

Location history, audit logs, imports, and event/outbox tables may be too large for ordinary synchronous migration behavior.

Use:

- partitioning where appropriate;
- batch cursors;
- resumable backfill jobs;
- progress checkpoints;
- bounded transaction sizes;
- retention and archival jobs;
- observability and cancellation.

## Customer fleet upgrades

Customers do not need to run the same versions simultaneously.

An operations inventory should answer:

- Which core version does each customer run?
- Which module versions are installed?
- Which migrations are pending?
- Which versions contain a security issue?
- Which customers require infrastructure changes before upgrade?

Automated dependency pull requests can prepare upgrades, but deployment remains deliberate per customer.

## Required tests

- Fresh install reaches the latest schema from an empty database.
- Upgrade from the previous deployed customer version succeeds.
- Re-running idempotent data helpers produces no duplication.
- Failed backfill can resume from a checkpoint.
- Module graph and migration state agree.
- Old app version remains compatible during an expand phase where promised.
- Destructive purge fails when dependent modules remain installed.
- Backup and restore procedure is exercised, not merely documented.