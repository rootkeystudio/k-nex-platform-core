# Plugin Lifecycle and Package Management

## Independent lifecycle dimensions

```text
catalog support status
package installed bytes
application enabled state
runtime configuration/features
migration readiness
data retention/archive state
release/support status
```

One boolean cannot represent these safely.

## V1 operations

### Add/install

Source-controlled plan resolves exact package, dependencies/providers, environment names, process topology, schema/migration impact, UI/source references, tests, and deployment. Runtime panel never installs packages.

### Enable/disable

Only when the plugin manifest declares safe semantics. Package/schema remain present. Disable can hide navigation/palette, block writes/actions, stop schedules/subscribers, remove public behavior, and preserve export/read compatibility as documented.

Disable may require build/deploy; it is not promised as one runtime toggle.

### Re-enable

Restores declared behavior after config/migration/readiness checks without reinstalling or losing retained data.

### Archive/export

An explicit project for legal retention, offboarding, or migration. It defines export format, encryption/access, restore/read path, external references, and whether schema can later be purged.

### Purge

Explicit destructive migration/release after dependents, events/jobs, integrations, stored documents, retention, export, backup, approval, and rollback limitations are resolved.

## Schema-owning plugins

V1 does **not** promise generic package uninstall while preserving readable Payload schema/data.

```text
supported reversible path  disable → re-enable
supported destructive path explicit purge
optional project path      archive/export
unsupported base promise   remove schema code but retain active schema compatibility
```

A future plugin-specific compatibility package must be separately designed, installed, versioned, and evidenced; it is not called a free uninstall.

Schema-less providers/builders/themes can uninstall after dependency, active-use, and stored-reference checks.

## Lifecycle manifest

```json
{
  "lifecycle": {
    "ownsPayloadSchema": true,
    "ownsPersistentData": true,
    "disable": "supported",
    "uninstall": "unsupported",
    "purge": "supported"
  }
}
```

This is the only V1 shape. Documents and CLI do not infer semantics from plugin kind.

## Theme/builder/provider specifics

- Active theme cannot be removed until a replacement profile is published; profile history has separate retention.
- Builder engine replacement keeps canonical documents renderable and validates engine metadata migration.
- Stateful provider replacement is a data/infrastructure migration; stateless realtime replacement still has rolling/topology implications.

## Runtime plugin screen

Can show inventory, state, health, migration/reference warnings, and edit validated runtime settings/features.

Cannot:

```text
install/remove packages
change versions
write Git
apply migrations
purge data
execute install scripts
bypass deployment approval
```

## Upgrade

Plan includes package/capability/source/block/schema versions, Payload/Node compatibility, settings, database/UI/theme migrations, process/infrastructure changes, security relevance, and rollback limitations.

Each customer upgrades through its own branch, frozen lockfile, fixtures, artifact, migration gate, deployment receipt, and runtime verification.

## Required tests

- add resolves explicit providers and rejects conflicts;
- disable blocks exactly declared behavior while data remains;
- re-enable restores behavior;
- schema-owning generic uninstall is refused;
- purge refuses without dependency/reference/retention/backup/migration evidence;
- active theme/builder/provider removal is refused safely;
- actual release inventory matches manifest/lockfile/runtime registration;
- runtime panel cannot install executable code.
