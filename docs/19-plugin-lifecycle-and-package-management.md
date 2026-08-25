# Plugin Lifecycle and Package Management

## Purpose

A K-Nex plugin has both a source-control/package lifecycle and a runtime configuration lifecycle. These must remain distinct so that an administrator cannot accidentally equate “turn this feature off” with “remove code and destroy its data.”

The lifecycle model applies to modules, providers, builders, themes, and integrations. Presets are expanded during project composition and do not remain runtime dependencies unless a preset package deliberately contributes separate behavior.

## Lifecycle dimensions

A plugin can be described along several independent dimensions:

```text
catalog status
package installation
application enablement
runtime configuration
feature flags
migration state
data retention state
release/support status
```

A single boolean cannot represent all of these safely.

## Catalog status

The trusted plugin catalog can mark a package as:

```text
experimental   API and behavior may change rapidly
preview        suitable for POC/staging, not generally recommended for production
stable         supported for production within declared compatibility ranges
deprecated     still usable, replacement or removal timeline documented
retired        no longer selectable for new projects; existing projects require a migration plan
blocked        known security/license/compatibility issue; installation or deployment must stop
```

Catalog status affects CLI recommendations and CI policy but does not silently remove an installed package.

## Package installation state

### Not installed

The package does not exist in `package.json` or the lockfile and is not part of the generated registry.

### Installed

The exact package artifact exists in the customer repository dependency graph and can participate in generation.

Installation is a build-time/source-control operation:

```bash
k-nex add module.crm
```

It requires review, package installation, registry generation, testing, and deployment.

## Application enablement state

### Enabled

The resolved application activates the plugin's declared behavior according to its options. Schema, routes, services, jobs, UI, or other contributions are active.

### Disabled

The package remains installed and the plugin remains known to the resolved application, but selected behavior is gated according to the plugin's declared disable contract.

For a schema-owning module, disablement usually means:

```text
retain collections/tables and read compatibility
hide navigation and builder palette entries
block or limit write commands
stop schedules/subscribers when safe
remove public routes when safe
preserve data and layout references
expose diagnostics and re-enable path
```

A plugin must explicitly declare `supportsDisable: true` and document which contributions remain active. The platform must not invent disable semantics for an unknown plugin.

## Runtime configuration state

An enabled plugin can be:

```text
unconfigured    required runtime settings are missing; behavior is unavailable/readiness fails
configured      valid runtime settings exist
partially configured optional features remain inactive
misconfigured   stored values fail current schema/provider validation
```

Examples:

- CRM can be installed and enabled before email sync credentials are configured.
- A theme package can be installed but have no published profile.
- S3 storage provider can be installed while required environment credentials are missing, causing readiness failure.

## Feature state inside a plugin

A module can expose runtime feature switches for behavior that does not require package/schema composition changes.

Examples:

```text
cms.livePreview
cms.localization
crm.emailSync
tracking.publicMap
inventory.lowStockAlerts
```

Feature switches are owned and schema-validated by the plugin. They do not remove package code, schema, or stored data. A feature that changes collections, indexes, routes requiring bundler imports, or infrastructure belongs in build-time manifest options instead.

## Data lifecycle

### Active data

Owned by an enabled plugin and used by current behavior.

### Retained data

Plugin disabled or uninstalled, but data remains for history, reinstallation, legal retention, export, or migration.

### Archived data

Data is intentionally moved to an archive representation/storage according to policy. The plugin or a migration tool must document restore/read behavior.

### Purged data

Data and schema are removed through an explicit destructive process after dependency, retention, backup, and stored-reference checks.

Package removal never implies purge.

## State model

Typical progression:

```text
cataloged
  → requested
  → installed
  → enabled
  → configured
  → operational
  → disabled
  → enabled again
  → uninstalled with data retained
  → reinstalled or purged
```

Upgrade/deprecation can happen at any installed stage.

## Add flow

Command:

```bash
k-nex add module.logistics-driver
```

Planning stages:

1. Resolve catalog ID/package/version.
2. Read static plugin manifest.
3. Check core/Payload/Node/database compatibility.
4. Resolve required plugin/capability dependencies.
5. Select providers for unresolved single capabilities.
6. Detect conflicts and cycles.
7. Calculate package/manifest/generated-file changes.
8. Calculate environment and infrastructure changes.
9. Classify schema/data migration impact.
10. Calculate UI/theme/layout implications.
11. Present the plan.
12. Apply only after explicit confirmation or complete non-interactive input.

Example:

```text
Add module.logistics-driver@1.3.0

Required additions:
  module.logistics-core@1.8.0
  provider.realtime-websocket-local@1.2.1

New environment requirements:
  DRIVER_TOKEN_SIGNING_KEY (secret)

New runtime processes:
  none; WebSocket hosted by web process for local adapter

Database impact:
  additive schema migration required

UI impact:
  adds Driver navigation, task screen, driver status blocks

Apply? yes
```

After apply:

```text
package.json updated
pnpm-lock.yaml updated
k-nex.app.json updated
static registries regenerated
.env.example updated
migration generation required
```

The application is not considered operational until migrations, configuration, and readiness checks pass.

## Disable flow

Command:

```bash
k-nex disable module.crm
```

Preconditions:

- plugin declares safe disable support;
- required dependents either tolerate disabled state or are also disabled;
- pending critical jobs/workflows are handled;
- public routes and integrations have a defined response;
- UI fallback behavior is available;
- current data remains readable/exportable as promised.

Disable plan reports:

```text
navigation and palette entries removed
write actions blocked
scheduled CRM synchronization stopped
collections retained
stored dashboard blocks marked unavailable
CRM data retained
re-enable requires no reinstall
```

Disablement may require build/deploy if generated imports or route configuration change. K-Nex does not promise that every plugin can be toggled solely through a database flag.

## Uninstall flow

Command:

```bash
k-nex remove module.crm --mode uninstall
```

Uninstall removes the package and active registration while preserving owned data unless a separate migration is explicitly selected.

Checks:

- required dependents;
- integration packages;
- capability consumers;
- stored CMS/workspace blocks;
- theme/component references;
- events/jobs still awaiting processing;
- external webhooks/integrations;
- data export/retention requirements;
- schema compatibility of future application boot.

A schema-owning plugin may require a **retention stub** or generated compatibility contribution so Payload/database startup remains safe while tables/fields persist. The POC must validate how this works with final Payload schema composition.

Uninstall output includes a machine-readable orphan report.

## Purge flow

Command:

```bash
k-nex remove module.crm --mode purge --confirm-purge module.crm
```

Required conditions:

- no enabled dependents;
- no selected integration requires the data;
- required exports completed;
- retention/legal policy allows deletion;
- verified backup exists or explicit no-backup decision is audited;
- stored builder/layout references are migrated or deliberately deleted;
- purge migration is generated and reviewed;
- rollback limitation is documented;
- production maintenance/deployment ordering is defined.

Purge does not run as an incidental `pnpm remove`. It is a migration/release operation.

## Theme lifecycle

Theme package states:

```text
installed but inactive
active for admin
active for public
used by draft profiles
used by archived profiles
uninstalled after replacement
profile data purged separately
```

A theme cannot be uninstalled while it is the published active theme for a surface. Activation among installed themes is runtime profile publication; installation/removal is build-time package management.

## Builder lifecycle

The builder adapter is a provider of `builder.engine`.

Removing/replacing it requires:

- canonical K-Nex documents remain renderable by `ui-runtime`;
- no engine-specific data lacks migration;
- editing is unavailable or another provider is installed;
- profile/storage schema compatibility is verified;
- stored content is not deleted.

The renderer should not require the editor package in processes/routes that only display content, where bundling separation permits.

## Provider replacement

Capability-based dependencies allow replacement:

```text
provider.realtime-websocket-local
  → provider.realtime-websocket-redis
```

Replacement plan checks:

- capability version compatibility;
- new environment variables;
- new infrastructure services;
- state migration (for example connection presence is ephemeral; queued messages may not be);
- deployment overlap/rolling behavior;
- health checks;
- operational runbook.

Providers with persistent data require explicit migration/export/import semantics.

## Upgrade lifecycle

A package upgrade plan includes:

```text
current and target package versions
plugin/capability contract versions
core/Payload/Node compatibility
configuration schema changes
database/schema/data migration requirements
UI block/theme profile migrations
environment/infrastructure changes
security relevance
rollback limitations
related plugin upgrades
```

Customer repositories upgrade independently.

Recommended sequence:

```text
create customer upgrade branch
  → update exact requested versions
  → resolve full graph
  → regenerate registries
  → generate/review migrations
  → run clean-install and previous-version tests
  → preview UI/theme/content migrations
  → build immutable artifact
  → deploy one customer
  → verify release inventory
```

## Deprecation

A plugin release can deprecate:

- the entire plugin;
- one capability version;
- a configuration option;
- an event version;
- a UI block;
- a theme token or component variant;
- an endpoint/client method.

Deprecation metadata includes:

```text
first deprecated version
recommended replacement
last supported version/date if known
migration command/helper
runtime and data impact
```

The CLI and `doctor` surface deprecations without changing code automatically.

## Plugin manager in the runtime panel

A privileged system screen can display:

- installed plugin ID, kind, package, and version;
- enabled/disabled/configuration state;
- capabilities provided/consumed;
- health/readiness;
- pending migration or compatibility warnings;
- runtime settings supported by the plugin;
- UI blocks/routes/jobs/events inventory;
- links to repository/CLI instructions.

V1 runtime panel can:

- edit validated runtime settings;
- enable/disable runtime features;
- publish theme/layout configuration;
- show operational diagnostics;
- possibly request/download a change plan artifact for a developer.

V1 runtime panel cannot:

- run `pnpm add` or download executable packages;
- modify Git repositories;
- change package versions;
- apply schema migrations;
- run destructive purge;
- execute arbitrary plugin install scripts;
- bypass deployment review.

## Generated build inventory

Every release records:

```json
{
  "applicationId": "acme-cargo",
  "releaseSha": "...",
  "core": "1.4.2",
  "plugins": [
    {
      "id": "module.crm",
      "package": "@k-nex/module-crm",
      "version": "1.4.2",
      "enabled": true,
      "catalogStatus": "stable"
    }
  ],
  "capabilities": {
    "realtime.gateway": {
      "provider": "provider.realtime-websocket-local",
      "version": "1.0.0"
    }
  },
  "migrationRevision": "2026-08-25-01"
}
```

This supports fleet security and upgrade analysis without creating shared runtime tenancy.

## Fleet operations

A separate private operations inventory can answer:

- which customer applications run an affected package version;
- which customers use a deprecated provider;
- which theme versions need migration;
- which deployments have pending destructive changes;
- which customers require Redis or another infrastructure upgrade;
- which releases contain a security fix.

Automated pull requests can propose upgrades; deployments remain deliberate per customer.

## Supply-chain policy

Installed plugins execute as trusted application code. V1 package policy:

- first-party/reviewed private packages only;
- exact package versions;
- lockfile committed;
- no runtime dynamic package download;
- package provenance and publish workflow controlled;
- vulnerability/license scanning in CI;
- no unreviewed install-script side effects;
- immutable release tags and changelog/migration metadata;
- release inventory embedded in application artifact.

## Required tests

- Add resolves required capability providers and rejects conflicts.
- Disable prevents writes/UI/jobs as declared while retaining data.
- Re-enable restores behavior without data loss.
- Uninstall detects dependent modules and stored blocks.
- Purge refuses without confirmation, dependency cleanup, and migration plan.
- Provider replacement leaves consumer module code unchanged.
- Theme removal refuses while active.
- Builder replacement preserves canonical documents or fails before deployment.
- Upgrade plan reports configuration/data/UI/theme migrations.
- Runtime panel cannot install executable code.
- Generated release inventory matches the actual lockfile and resolved graph.
