# Application Manifest

## Purpose

Every customer repository has a declarative source of truth describing:

- application identity and runtime expectations;
- selected Payload framework options, including database adapter;
- installed K-Nex plugins and exact requested versions;
- selected replaceable providers such as realtime or storage;
- builder profiles;
- installed themes and defaults;
- local development and deployment scaffold choices;
- required environment variable names.

The primary file is:

```text
k-nex.app.json
```

Customer-specific executable behavior lives separately in:

```text
k-nex.config.ts
```

This split allows the CLI to safely edit routine composition while preserving typed customer code for real extensions.

## Sources of truth

| Source | Owns |
|---|---|
| `k-nex.app.json` | desired composition, Payload/scaffold choices, non-secret build options |
| `k-nex.config.ts` | customer-specific executable extensions/overrides |
| `package.json` + lockfile | exact installed artifacts and transitive graph |
| `.k-nex/generated/*` | deterministic generated registries/inventory |
| customer migrations | final deployed database evolution |
| runtime database records | published pages/layouts/themes and validated runtime settings |

Generated files are derived and must not be edited manually.

# Complete example

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

  "framework": {
    "payload": {
      "database": {
        "adapter": "postgres",
        "package": "@payloadcms/db-postgres",
        "connectionEnvironmentVariable": "DATABASE_URL"
      }
    }
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
      "id": "module.sales",
      "package": "@k-nex/module-sales",
      "version": "1.4.2",
      "enabled": true
    },
    {
      "id": "module.visualization",
      "package": "@k-nex/module-visualization",
      "version": "1.0.0",
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
      "mode": "docker-postgres",
      "serviceName": "postgres"
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

# Payload framework configuration

## Database adapter

The Payload database adapter is a framework/scaffold choice, not a K-Nex provider plugin.

V1:

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
  }
}
```

The CLI installs the adapter package and generates the Payload `db` configuration.

The manifest must not contain conceptual entries such as:

```text
provider.database-postgres
@k-nex/database-postgres
database.primary
```

K-Nex does not add a second primary-database provider abstraction above Payload.

## Local versus external Postgres

Local Docker:

```json
{
  "development": {
    "database": {
      "mode": "docker-postgres",
      "serviceName": "postgres"
    }
  }
}
```

Existing/managed Postgres:

```json
{
  "development": {
    "database": {
      "mode": "external"
    }
  }
}
```

Neon or another hosted Postgres service uses the same Payload Postgres adapter and a `DATABASE_URL`. Future CLI recipes can add provider-specific deployment guidance without introducing a K-Nex persistence interface.

# JSON schema

`@k-nex/cli` publishes a versioned JSON schema for editor validation/autocomplete.

Responsibilities:

- validate top-level structure and `schemaVersion`;
- validate application identity;
- validate supported Payload framework choices;
- validate plugin/provider/builder/theme identifiers;
- validate exact requested versions;
- reject duplicate IDs and unknown keys where appropriate;
- validate common options;
- prevent known secret values from being embedded;
- validate local infrastructure/deployment discriminated unions;
- validate environment variable names;
- support deterministic normalization.

Plugin-specific options are validated through each selected plugin's static option schema after root manifest validation.

# Declarative versus programmatic configuration

## `k-nex.app.json`

Use JSON for:

- Payload database adapter selection;
- local/external database scaffold mode;
- installed plugin packages and exact versions;
- plugin enabled state and build-time options;
- replaceable provider selection;
- builder selection/profiles;
- installed themes/defaults;
- Docker/local infrastructure generation;
- required environment variable names;
- generated-file policy.

The CLI can safely add, remove, normalize, sort, and validate this data.

## `k-nex.config.ts`

Use TypeScript for:

- customer-specific domain policies;
- custom commands/jobs;
- custom data-source handlers/descriptors;
- custom actions;
- custom UI blocks/screens;
- integration adapters implemented in the customer repository;
- deliberate renderer/primitive overrides;
- explicit framework extension points.

Example:

```ts
import { defineCustomerConfig } from '@k-nex/core'
import { acmePricingExtension } from './packages/customer-extensions/pricing'
import { trackingPerformanceBlock } from './packages/customer-components/tracking-performance'
import { customMarginSource } from './packages/customer-extensions/custom-margin-source'

export default defineCustomerConfig({
  extensions: [
    acmePricingExtension({
      contractSource: 'legacy-erp',
    }),
  ],
  ui: {
    blocks: [trackingPerformanceBlock],
    dataSources: [customMarginSource],
  },
})
```

Customer code uses documented public contracts and must not patch installed package files.

# Requested versus resolved composition

The manifest expresses desired composition. The resolver produces an immutable graph/inventory containing:

- selected plugins and exact installed versions;
- expanded preset results;
- selected replaceable capability providers;
- selected Payload framework adapter package;
- registration order;
- environment requirements;
- routes, permissions, events, jobs, actions, sources, fields, UI blocks, themes;
- compatibility/collision/migration warnings.

Example build inventory:

```json
{
  "schemaVersion": 1,
  "applicationId": "acme-cargo",
  "generatedAt": "2026-08-25T12:00:00.000Z",
  "coreVersion": "1.4.2",
  "payloadVersion": "3.x",
  "framework": {
    "payload": {
      "databaseAdapter": {
        "id": "postgres",
        "package": "@payloadcms/db-postgres"
      }
    }
  },
  "plugins": [
    {
      "id": "module.sales",
      "package": "@k-nex/module-sales",
      "version": "1.4.2",
      "state": "enabled"
    }
  ],
  "capabilities": {
    "realtime.gateway": {
      "version": "1.0.0",
      "provider": "provider.realtime-websocket-local"
    }
  },
  "dataSources": [
    {
      "id": "sales.total-opportunities",
      "version": 1,
      "plugin": "module.sales",
      "outputContract": "metric.money@1"
    },
    {
      "id": "sales.tasks",
      "version": 1,
      "plugin": "module.sales",
      "outputContract": "table.records@1"
    }
  ]
}
```

This is generated diagnostic/operational data, not a second editable manifest.

# Generated files

```text
.k-nex/generated/
├── plugin-registry.ts
├── provider-registry.ts
├── ui-registry.ts
├── data-source-registry.ts
├── action-registry.ts
├── state-registry.ts
├── theme-registry.ts
├── payload-contributions.ts
├── payload-database.ts
├── environment-schema.ts
└── build-manifest.json
```

Generated registries are committed in V1.

CI:

```bash
k-nex generate --check
```

Generated headers:

```ts
// Generated by @k-nex/cli. Do not edit.
// Source: k-nex.app.json + k-nex.config.ts + pnpm-lock.yaml
```

# Manifest normalization

`k-nex sync` produces canonical formatting:

- stable key order;
- plugin lists sorted by stable ID;
- explicit versions;
- normalized defaults;
- deprecated aliases removed;
- preset expansion where requested;
- no secret material;
- deterministic newline/formatting;
- supported framework choices only.

# Manual editing workflow

```text
1. Edit k-nex.app.json.
2. Run k-nex plan.
3. Review package/framework/provider/UI/source/infrastructure/migration impact.
4. Run k-nex sync or k-nex apply.
5. Review package.json, lockfile, generated files, and migrations.
6. Run k-nex doctor and tests.
7. Commit all resulting artifacts together.
```

Manual editing is a supported first-class workflow.

# Presets

A preset expands into explicit choices. Existing applications should not silently change when a preset package later changes.

Input:

```json
{
  "preset": "preset.logistics"
}
```

Resolved persisted output:

```json
{
  "plugins": [
    { "id": "module.cms", "package": "@k-nex/module-cms", "version": "2.1.0" },
    { "id": "module.sales", "package": "@k-nex/module-sales", "version": "1.4.2" },
    { "id": "module.logistics-core", "package": "@k-nex/module-logistics-core", "version": "1.8.0" },
    { "id": "module.logistics-dispatch", "package": "@k-nex/module-dispatch", "version": "1.5.1" },
    { "id": "module.logistics-driver", "package": "@k-nex/module-driver", "version": "1.3.0" }
  ]
}
```

# Enabled state

```json
{
  "id": "module.sales",
  "package": "@k-nex/module-sales",
  "version": "1.4.2",
  "enabled": false
}
```

Disablement can gate:

- navigation/screens/blocks;
- source discovery/execution;
- public routes;
- actions/commands;
- jobs/schedules;
- event subscribers;
- writes.

Disablement does not automatically remove Payload collections/tables/data. Schema-owning disable/uninstall behavior requires module-declared lifecycle support.

# Environment and secrets

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

Secrets belong in ignored local environment files, CI/CD secret storage, deployment platform secrets, or dedicated secret managers.

The final framework/plugin graph generates the environment schema. `k-nex doctor` reports missing/malformed variables without printing values.

# Schema versioning

`schemaVersion` versions the manifest format, not the application database.

```bash
k-nex manifest migrate
```

performs deterministic source transformation and presents a diff. Manifest migrations never execute Payload/database migrations.

# Validation invariants

A valid manifest requires:

- stable application ID;
- supported Payload database adapter selection;
- adapter package/version consistency with `package.json`/lockfile;
- every K-Nex plugin ID mapped to one installed package;
- exact requested versions resolved;
- required capabilities satisfied by compatible providers;
- selected themes installed for their surfaces;
- builder present when required;
- environment requirements derivable;
- no committed secret values;
- generated registries current;
- plugin-specific option schemas valid;
- disabled/uninstalled states compatible with dependents;
- no duplicate route/permission/block/source/action/state IDs;
- source output/field contracts valid.

# Application identity stability

`application.id` appears in logs, traces, audits, release inventory, internal realtime metadata, storage prefixes where configured, backups, and operational inventory.

Renaming requires an explicit runbook/migration.

# Non-goals

The manifest is not:

- a secret vault;
- arbitrary executable JavaScript;
- a runtime package marketplace;
- a database migration history;
- a replacement for `package.json`/lockfile;
- a raw Payload configuration dump;
- a shared SaaS tenant file;
- a promise that every setting changes without rebuild/deployment;
- a place to store data-source results or arbitrary query definitions.
