# Data, Migrations, and Versioning

## Principle

Plugins define reusable schema/data evolution intent, but the **customer application owns the final migration history** because only the final application knows:

```text
exact installed plugin versions
provider selections
module options
customer extensions
previous deployed database state
stored CMS/workspace documents
theme profile revisions
infrastructure constraints
```

Each customer has an independent database and upgrades on its own schedule.

Postgres is the supported V1 production and local-development default. SQLite is a demo/fast POC mode; additional database support requires explicit module/provider compatibility testing.

## Distinct kinds of evolution

K-Nex has several related but separate version/migration domains.

### Application manifest migration

Changes the source format of `k-nex.app.json`.

```bash
k-nex manifest migrate
```

This is a deterministic source transformation and never changes the customer database.

### Package/plugin upgrade

Changes installed artifacts and can imply config, schema, runtime, UI, theme, or infrastructure evolution.

### Database schema migration

Changes tables, columns, indexes, relationships, constraints, or framework persistence structures.

### Domain data migration

Transforms business/configuration records.

### UI document migration

Transforms persisted block IDs/versions/properties/layout shape across CMS and workspace revisions.

### Theme profile migration

Transforms runtime token/profile schemas after a theme package upgrade.

### Provider data migration

Moves persistent provider state, such as storage metadata or durable queue/event records.

### Infrastructure migration

Changes deployment services/configuration, such as local WebSocket to Redis-backed realtime.

These migrations can appear in one customer upgrade, but they have different artifacts and rollback behavior.

## Sources of database/schema change

- core infrastructure update;
- plugin version upgrade;
- plugin install/enable/uninstall/purge;
- provider replacement with persistence;
- customer extension change;
- customer-specific collection/field/index;
- UI layout/theme/content storage changes;
- framework/database adapter update;
- high-volume storage strategy change.

All production changes result in reviewed, customer-owned artifacts/runbooks.

## Ownership

### Shared plugin package owns

- static manifest compatibility ranges;
- schema/config contribution changes;
- release/migration notes;
- reusable data migration helpers;
- readiness/preflight validators;
- old/new fixtures;
- UI block migrations;
- theme profile migrations where applicable;
- upgrade and rollback limitations;
- data ownership, disable/uninstall/purge metadata.

Example:

```ts
export {
  validateCrmV2Readiness,
  migrateCrmContactsV1ToV2,
} from '@k-nex/module-crm/migrations'
```

### Customer application owns

- final Payload/database migration files;
- ordering across several plugin/customer changes;
- calls to shared data/UI/theme helpers;
- currently deployed version baseline;
- backup and production execution;
- upgrade tests from that customer's prior release;
- final rollback/restore plan;
- immutable release inventory.

### CLI owns

- planning/classifying impact;
- checking manifest/package/generated registry agreement;
- exposing plugin notes/readiness checks;
- invoking/wrapping generation commands;
- refusing unknown/destructive automation without explicit plan;
- never hiding final migration source from review.

## Customer upgrade workflow

```text
1. Create customer upgrade branch.
2. Update k-nex.app.json requested exact versions/options.
3. Run k-nex plan and review dependencies/providers/conflicts.
4. Apply package and lockfile changes.
5. Regenerate static plugin/provider/UI/theme registries.
6. Run k-nex doctor.
7. Build final Payload/application configuration.
8. Generate types.
9. Generate and review schema migration.
10. Add explicit domain/UI/theme/provider data migrations.
11. Test from empty database.
12. Test from the customer's currently deployed schema/data fixture/copy.
13. Preview CMS/layout/theme changes.
14. Run access/security/integration tests.
15. Document backup, deployment order, and rollback limitations.
16. Build immutable artifact and deploy that customer only.
17. Verify release and migration inventory.
```

## Impact classification

The CLI classifies a proposed plugin/package change:

```text
none
  no schema/persisted-data change

additive
  new tables/fields/indexes/default records; review still required

transform
  existing data/UI/theme/profile values need deterministic migration

infrastructure
  provider/service/deployment topology changes

destructive
  drop/delete/irreversible conversion; explicit confirmation and backup policy

unknown
  plugin metadata insufficient; automation stops
```

Classification is diagnostic, not proof of production safety.

## Migration rules

- Never rely on development auto-push in production.
- Never edit a migration already executed in a deployed environment.
- Correct previous migration behavior with a new migration.
- Use transactions where supported and operationally safe.
- Use resumable jobs for large backfills rather than one unbounded migration.
- Consider production locking for indexes/constraints/table rewrites.
- Destructive changes require explicit approval and verified backup or audited no-backup decision.
- Transformations are deterministic and fixture-tested.
- Migrations do not silently call external systems without idempotency/retry design.
- Builder/theme/profile publication is separate from merely migrating a draft.

## Expand and contract

Prefer multi-release evolution when old/new processes or mobile clients overlap.

Example field rename:

```text
Release A
  add new field
  write old and new
  backfill existing rows
  read new with old fallback

Release B
  read/write new only
  verify old clients/workers retired

Release C
  explicitly drop old field
```

Use similar patterns for:

- event payload versions;
- action/data-source DTOs;
- WebSocket messages;
- UI block properties;
- theme token schemas;
- provider API transitions.

## Plugin lifecycle and data

### Installed and enabled

Schema/behavior active; data retained.

### Installed and disabled

Package/schema compatibility remains; declared behavior is gated; data retained.

### Uninstalled with retained data

Package is absent but historical data remains intentionally. How Payload/schema boots in this state is a provisional POC question. Possible retention stub/archive patterns must be validated before promising universal uninstall support.

### Purged

Explicit reviewed migration deletes module data/schema after dependency, UI reference, retention, export, and backup checks.

Package removal alone never triggers purge.

## Plugin installation and schema generation

After adding a schema-owning plugin:

```text
resolve graph
  → generate final config/types
  → produce schema diff
  → generate customer migration
  → inspect indexes/defaults/backfill needs
  → test clean and upgrade paths
```

Plugin manifests can describe expected data ownership and risk, but final migration output depends on customer composition.

## Manifest and generated registry versioning

### Manifest schema version

`k-nex.app.json.schemaVersion` versions the source schema. CLI migrations update it without database changes.

### Generated code API version

Generated registry headers record CLI/generator version and expected runtime API. `k-nex generate --check` and `doctor` fail stale/incompatible output.

### Build manifest

Generated inventory records exact package/plugin/capability/builder/theme versions. It is diagnostic/release metadata, not a migration history.

## Core and package versioning

### Core

Semantic versioning:

```text
patch   compatible fixes/security patches
minor   backward-compatible contracts/features
major   breaking public contracts
```

### Plugin packages

Version independently and declare compatibility:

```json
{
  "peerDependencies": {
    "@k-nex/core": ">=1.4.0 <2.0.0",
    "payload": ">=3.0.0 <4.0.0"
  }
}
```

Customer repositories use exact versions and commit lockfiles.

### Capability versions

Version the service/public contract separately from package version.

### Event/action/data-source/message versions

Persisted or externally consumed schemas have explicit versions and supported ranges.

### UI block versions

Persisted component identity:

```text
block ID + block version
```

### Theme schema versions

Profiles record theme package/schema version and migrate through package-owned helpers.

## UI document migrations

Builder content is application data and receives the same discipline as database schema.

Example:

```ts
registerUiMigration({
  blockId: 'crm.pipeline-summary',
  from: 1,
  to: 2,
  migrate: old => ({
    pipelineIds: [old.pipelineId],
    period: old.period ?? 'month',
  }),
})
```

Migration scope includes:

```text
CMS drafts
CMS published versions
locale variants
workspace customer layouts
role layouts
user overrides
retained revisions according to policy
reusable templates/symbols if introduced
```

Rules:

- keep old renderer until references are migrated/retention policy allows removal;
- validate migrated document against current registry/profile;
- preview representative content;
- record migration/checkpoint state;
- do not delete orphan blocks automatically on module uninstall;
- readiness checks block publication/deployment when a known required renderer is missing.

## Layout inheritance migration

When a base customer/role layout changes, dependent patches/snapshots need reconciliation.

Required metadata:

```text
base layout ID and revision
resolved document revision
patch/snapshot lineage
migration/rebase status
last valid resolved layout
```

V1 implementation (patch, snapshot, or hybrid) is provisional, but migrations must always preserve a last valid fallback and report conflicts rather than silently dropping user customization.

## Theme profile migrations

Theme package upgrade can change token schema/primitives.

Flow:

```text
install upgraded theme package
  → detect profile schema mismatch
  → migrate to new draft revisions
  → validate/accessibility check
  → preview CMS/workspace fixtures
  → publish deliberately
  → retain prior published revision for rollback
```

Package upgrade must not silently publish visual changes.

Example:

```ts
registerThemeMigration({
  themeId: 'theme.neobrutalism',
  fromSchemaVersion: 1,
  toSchemaVersion: 2,
  migrate: old => ({
    ...old,
    brutal: {
      shadowOffsetX: old.shadow.x,
      shadowOffsetY: old.shadow.y,
      shadowBlur: old.shadow.blur,
    },
  }),
})
```

## Builder engine migration

Canonical K-Nex documents should remain engine-independent. Replacing/upgrading a builder engine can still require adapter metadata migration.

Requirements:

- runtime renderer does not depend on editor availability;
- adapter-specific metadata is namespaced/versioned;
- canonical document round-trip fixtures exist;
- no engine replacement deletes content;
- editing can be temporarily unavailable while rendering remains possible.

## Provider migration

Provider replacement can be stateless or stateful.

### Stateless/ephemeral

Example local WebSocket presence to Redis-backed presence. Deployment ordering/reconnect behavior matter, but long-term data migration may not.

### Persistent

Storage, queue/outbox, search, or history providers can require export/import/rebuild/checkpoint logic.

Provider manifest/release notes must state:

```text
state ownership
migration/export support
downtime/dual-write requirements
rollback limitations
environment/infrastructure changes
```

## Release notes contract

Every package release should state:

- added/changed behavior;
- public contract/capability changes;
- security impact;
- manifest/build-time option changes;
- runtime setting schema changes;
- database migration requirement;
- UI document migration;
- theme profile migration;
- provider/infrastructure changes;
- minimum compatible core/Payload/Node/database versions;
- deprecations;
- known rollback limitations.

## Rollback

Application, database, content/layout, theme, and provider rollback are separate decisions.

Safe practices:

- expand schema before new code and contract later;
- retain previous container image, lockfile, manifest, generated registries;
- retain previous published page/layout/theme revision;
- verify backup before destructive changes;
- use feature/plugin disablement to stop behavior without deletion where supported;
- provide compensating migration when practical;
- state when restore is the only safe rollback.

A theme publication rollback can be simple while a destructive database transformation may require full restore.

## High-volume data

Location history, audit, imports, events/outbox, and analytics can outgrow ordinary synchronous migrations.

Use:

```text
partitioning
batch cursors
resumable jobs
progress/checkpoint records
bounded transactions
retention/archive processes
cancel/retry/observability
```

Specialized stores remain behind provider/module contracts.

## Fleet upgrades

A private fleet inventory should answer:

```text
Which core/plugin/theme/builder/provider versions does each customer run?
Which capability contracts are present?
Which migrations are pending?
Which stored layouts/themes require migration?
Which versions contain a security issue?
Which infrastructure changes are required before upgrade?
```

Automated PRs can propose upgrades, but each customer deployment remains deliberate.

## Required tests

- Fresh install reaches current schema from empty Postgres.
- Upgrade from each customer's previous deployed release succeeds.
- Manifest migration changes no database state.
- Generated registries match manifest/lockfile.
- Data helpers are retry-safe/idempotent where declared.
- Failed backfill resumes from checkpoint.
- Old/new application overlap works during promised expand phase.
- UI documents migrate across drafts/published/scopes.
- Theme migration creates validated draft and does not auto-publish.
- Disabled module retains data and declared read compatibility.
- Uninstall/purge readiness detects dependents and stored UI references.
- Backup/restore procedure is exercised.
- Release inventory matches the deployed artifact and migration revision.
