# Application Manifest

## Purpose

Every customer repository has a declarative source of truth describing which K-Nex plugins are installed, which providers satisfy infrastructure capabilities, which builder and theme packages are available, and which project-generation choices were made.

The manifest is designed for three audiences:

- humans reviewing the product composition;
- the `k-nex` CLI planning and applying changes;
- CI validating that generated registries and installed packages match the declared application.

The primary file is:

```text
k-nex.app.json
```

Customer-specific executable behavior lives separately in:

```text
k-nex.config.ts
```

This split keeps routine package operations machine-editable without removing the ability to write custom TypeScript extensions.

## Sources of truth

The customer repository has four complementary sources of truth:

| Source | Owns |
|---|---|
| `k-nex.app.json` | desired K-Nex composition and non-secret build-time options |
| `k-nex.config.ts` | customer-specific executable extensions and overrides |
| `package.json` + `pnpm-lock.yaml` | exact package artifacts and full dependency graph |
| customer migrations | final deployed database evolution |

Generated files are derived from these sources and must not be edited manually.

## Complete example

```json
{
  "$schema": "./node_modules/@k-nex/cli/schemas/app.schema.json",
  "schemaVersion": 1,

  "application": {
    "id": "acme-cargo",
    "name": "Acme Cargo",
    "type": "customer-platform",
    "defaultLocale": "tr",
    "locales": ["tr", "en"]
  },

  "runtime": {
    "node": "22",
    "packageManager": "pnpm",
    "packageManagerVersion": "10",
    "deploymentMode": "container"
  },

  "plugins": [
    {
      "id": "module.cms",
      "package": "@k-nex/module-cms",
      "version": "2.1.0",
      "enabled": true,
      "options": {
        "drafts": true,
        "localization": true,
        "visualPages": true
      }
    },
    {
      "id": "module.crm",
      "package": "@k-nex/module-crm",
      "version": "1.4.2",
      "enabled": true
    },
    {
      "id": "module.logistics-core",
      "package": "@k-nex/module-logistics-core",
      "version": "1.8.0",
      "enabled": true
    },
    {
      "id": "module.logistics-dispatch",
      "package": "@k-nex/module-dispatch",
      "version": "1.5.1",
      "enabled": true,
      "options": {
        "assignmentMode": "manual",
        "enforceVehicleCapacity": true
      }
    },
    {
      "id": "module.logistics-driver",
      "package": "@k-nex/module-driver",
      "version": "1.3.0",
      "enabled": true
    }
  ],

  "providers": {
    "database.primary": {
      "plugin": "provider.database-postgres",
      "package": "@k-nex/database-postgres",
      "version": "1.0.0",
      "options": {
        "connectionEnvironmentVariable": "DATABASE_URL"
      }
    },
    "realtime.gateway": {
      "plugin": "provider.realtime-websocket-local",
      "package": "@k-nex/provider-websocket",
      "version": "1.2.1",
      "options": {
        "adapter": "local"
      }
    },
    "storage.objects": {
      "plugin": "provider.storage-s3",
      "package": "@k-nex/storage-s3",
      "version": "1.1.0",
      "options": {
        "endpointEnvironmentVariable": "S3_ENDPOINT",
        "bucketEnvironmentVariable": "S3_BUCKET"
      }
    }
  },

  "builder": {
    "plugin": "builder.puck",
    "package": "@k-nex/builder-puck",
    "version": "0.1.0",
    "profiles": {
      "cms": {
        "enabled": true,
        "drafts": true,
        "surfaces": ["cms", "public"]
      },
      "workspace": {
        "enabled": true,
        "editablePageKinds": [
          "dashboard",
          "module-overview",
          "report"
        ]
      }
    }
  },

  "themes": {
    "admin": {
      "installed": [
        {
          "plugin": "theme.minimal",
          "package": "@k-nex/theme-minimal",
          "version": "1.0.0"
        },
        {
          "plugin": "theme.neobrutalism",
          "package": "@k-nex/theme-neobrutalism",
          "version": "1.0.0"
        }
      ],
      "default": "theme.minimal"
    },
    "public": {
      "installed": [
        {
          "plugin": "theme.neobrutalism",
          "package": "@k-nex/theme-neobrutalism",
          "version": "1.0.0"
        },
        {
          "plugin": "theme.glassmorphism",
          "package": "@k-nex/theme-glassmorphism",
          "version": "1.0.0"
        }
      ],
      "default": "theme.neobrutalism"
    }
  },

  "development": {
    "database": {
      "mode": "docker-postgres"
    },
    "services": {
      "redis": false,
      "minio": true
    },
    "dockerCompose": true
  },

  "build": {
    "dockerfile": true,
    "commitGeneratedRegistries": true,
    "validateGeneratedFilesInCI": true
  },

  "environment": {
    "required": [
      "DATABASE_URL",
      "PAYLOAD_SECRET",
      "S3_ENDPOINT",
      "S3_BUCKET",
      "S3_ACCESS_KEY_ID",
      "S3_SECRET_ACCESS_KEY"
    ]
  }
}
```

The manifest contains environment variable names, never secret values.

## JSON schema

`@k-nex/cli` publishes a versioned JSON schema. Editors can provide validation and autocomplete through the `$schema` property.

Schema responsibilities:

- validate top-level structure and `schemaVersion`;
- validate plugin and provider identifiers;
- validate common option types;
- reject unknown keys by default where forward compatibility allows;
- validate identifier format and duplicate entries;
- ensure secret values are not embedded in known secret fields;
- express discriminated unions for database and deployment modes.

Plugin-specific options cannot all be hard-coded into the root schema. The CLI loads the selected plugin's static option schema and performs a second validation pass.

## Declarative versus programmatic configuration

### `k-nex.app.json`

Use the JSON manifest for:

- installed packages;
- exact requested plugin versions;
- enabled/disabled state;
- plugin build-time options;
- provider selection;
- builder selection and profiles;
- installed themes and defaults;
- local infrastructure generation;
- Docker and scaffold choices;
- required environment variable names.

The CLI can safely add, remove, sort, normalize, and validate these values.

### `k-nex.config.ts`

Use TypeScript for behavior that cannot be represented safely as data:

- customer-specific extensions;
- custom domain policies;
- custom commands or jobs;
- custom UI blocks and screens;
- custom data sources and actions;
- integration adapters implemented inside the customer repository;
- deliberate overrides at documented extension points.

Example:

```ts
import { defineCustomerConfig } from '@k-nex/core'
import { acmePricingExtension } from './packages/customer-extensions/pricing'
import { trackingPerformanceBlock } from './packages/customer-components/tracking-performance'

export default defineCustomerConfig({
  extensions: [
    acmePricingExtension({
      contractSource: 'legacy-erp',
    }),
  ],
  ui: {
    blocks: [trackingPerformanceBlock],
  },
})
```

The TypeScript config may consume public K-Nex/module contracts. It must not patch files inside installed packages.

## Requested versus resolved composition

The manifest expresses the desired composition. The resolver produces an immutable resolved application graph containing:

- selected plugin packages and exact installed versions;
- expanded preset results;
- capability providers;
- enabled optional integrations;
- registration order;
- environment requirements;
- routes, permissions, events, jobs, data ownership, and UI inventory;
- compatibility and migration warnings.

Generated inventory example:

```json
{
  "schemaVersion": 1,
  "applicationId": "acme-cargo",
  "generatedAt": "2026-08-25T12:00:00.000Z",
  "coreVersion": "1.4.2",
  "payloadVersion": "3.x",
  "plugins": [
    {
      "id": "module.logistics-driver",
      "package": "@k-nex/module-driver",
      "version": "1.3.0",
      "state": "enabled"
    }
  ],
  "capabilities": {
    "realtime.gateway": {
      "version": "1.0.0",
      "provider": "provider.realtime-websocket-local"
    }
  }
}
```

This generated inventory is diagnostic and operational data. It is not a second editable manifest.

## Generated files

The CLI writes deterministic files under:

```text
.k-nex/generated/
├── plugin-registry.ts
├── provider-registry.ts
├── ui-registry.ts
├── theme-registry.ts
├── payload-contributions.ts
├── environment-schema.ts
└── build-manifest.json
```

Current decision: generated registries and `build-manifest.json` are committed to the customer repository.

Reasons:

- pull requests show the exact runtime composition change;
- security and architecture review can inspect imports before deployment;
- local development does not depend on hidden generation side effects;
- release metadata is reproducible from the repository state.

CI runs:

```bash
k-nex generate --check
```

and fails when committed generated files are stale.

Generated files include a header:

```ts
// Generated by @k-nex/cli. Do not edit.
// Source: k-nex.app.json + k-nex.config.ts + pnpm-lock.yaml
```

## Manifest normalization

`k-nex sync` rewrites the manifest into canonical form:

- stable key order;
- sorted plugin lists by ID;
- explicit versions;
- normalized booleans and defaults;
- removed deprecated aliases;
- expanded preset output when requested;
- no secret material;
- deterministic newline/formatting.

Canonical formatting prevents noisy diffs and makes composition changes reviewable.

## Manual editing workflow

Manual editing is supported and expected.

```text
1. Edit k-nex.app.json.
2. Run k-nex plan.
3. Review dependency/provider/package/migration changes.
4. Run k-nex sync or k-nex apply.
5. Review package.json, lockfile, generated files, and migrations.
6. Run k-nex doctor and tests.
7. Commit all resulting artifacts together.
```

The CLI never assumes the JSON file is only machine-written.

## Presets

A preset is selected during creation or added later, but the resulting customer manifest should become explicit.

Input:

```json
{
  "preset": "preset.logistics"
}
```

Resolved and persisted result:

```json
{
  "plugins": [
    { "id": "module.cms", "package": "@k-nex/module-cms", "version": "2.1.0" },
    { "id": "module.crm", "package": "@k-nex/module-crm", "version": "1.4.2" },
    { "id": "module.logistics-core", "package": "@k-nex/module-logistics-core", "version": "1.8.0" },
    { "id": "module.logistics-dispatch", "package": "@k-nex/module-dispatch", "version": "1.5.1" },
    { "id": "module.logistics-driver", "package": "@k-nex/module-driver", "version": "1.3.0" }
  ]
}
```

This prevents the meaning of an existing application from changing when a preset package later adds a new recommendation.

## Enabled state

The manifest distinguishes package installation from plugin enablement.

```json
{
  "id": "module.crm",
  "package": "@k-nex/module-crm",
  "version": "1.4.2",
  "enabled": false
}
```

An installed-but-disabled schema-owning plugin may still need its collections registered so historical data remains readable. The plugin manifest declares whether disablement is supported and what is gated:

- navigation and UI blocks;
- public routes;
- commands/actions;
- jobs and schedules;
- event subscribers;
- write operations.

Disablement does not remove tables or data.

## Environment and secrets

The manifest references secrets by logical environment name only.

Allowed:

```json
{
  "connectionEnvironmentVariable": "DATABASE_URL"
}
```

Forbidden:

```json
{
  "databaseUrl": "postgres://user:password@example.com/prod"
}
```

Secret values belong in:

- `.env.local` for local development and never committed;
- CI/CD encrypted secrets;
- a deployment platform secret store;
- a dedicated secret manager.

`.env.example` contains names and safe placeholders.

The resolved plugin graph produces the final environment schema. `k-nex doctor` reports missing, unexpected, or malformed variables without printing secret values.

## Schema versioning

`schemaVersion` versions the K-Nex application manifest format, not the installed application.

When the manifest schema changes:

```bash
k-nex manifest migrate
```

performs a deterministic source transformation and presents the diff. A CLI major release must either support the previous manifest version or fail with a specific upgrade command.

Manifest migrations never perform database migrations.

## Validation invariants

The application manifest is valid only when:

- application ID is stable and unique within operations inventory;
- every plugin ID maps to exactly one installed package;
- exact package versions agree with `package.json` and the lockfile;
- required capabilities have compatible providers;
- single-provider capabilities have one selected implementation;
- selected themes are installed for the relevant surface;
- the builder is installed when a selected module requires `builder.engine`;
- environment requirements can be derived and validated;
- no build-time secret value is embedded;
- generated registries are current;
- plugin-specific option schemas pass;
- disabled/uninstalled states are compatible with dependent plugins.

## Application identity stability

`application.id` becomes part of:

- logs and traces;
- audit records;
- release inventory;
- WebSocket/internal channel metadata;
- storage prefixes where configured;
- backup and operations metadata.

It should not be casually renamed. A rename requires an explicit migration/runbook and does not change customer data ownership.

## Non-goals

The manifest is not:

- a place to store arbitrary executable JavaScript;
- a secret vault;
- a runtime package marketplace;
- a database migration history;
- a replacement for `package.json` or `pnpm-lock.yaml`;
- a shared SaaS tenant configuration file;
- a promise that every option can change without rebuild/deployment.
