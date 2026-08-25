# Customer Applications

## Purpose

A customer application is the independently owned product assembled from K-Nex core, selected plugins, generated registries, customer code, runtime content/layout/theme data, final database migrations, and infrastructure.

The customer application is where product differentiation happens. Shared packages never need to know which customer consumes them.

## Repository decision

Use a **separate private repository per customer application**, generated and maintained through `create-k-nex-app` and the `k-nex` CLI.

Do not maintain customers as long-lived branches of the core repository.

Preferred model:

```text
k-nex-platform / @k-nex packages   shared versioned capabilities
k-nex customer starter/templates   generator inputs
client-acme-cargo                   independent customer repository
client-mamma-restaurant             independent customer repository
```

“Fork” can describe the feeling of creating a customer shell, but the repository does not contain copied/editable platform core source. It consumes exact package versions.

## Why separate customer repositories

- independent package/core/framework versions;
- separate CI/CD, secrets, domains, and environments;
- customer-specific repository access;
- separate issue, pull request, tag, and release history;
- easy archive/transfer/offboarding;
- customer-specific apps and infrastructure;
- fewer accidental cross-customer merges;
- no long-lived source merge from a shared core branch.

## Generated default structure

```text
client-acme-cargo/
├── apps/
│   ├── platform/
│   │   ├── src/
│   │   │   ├── app/
│   │   │   │   ├── (public)/
│   │   │   │   ├── (workspace)/
│   │   │   │   ├── (system)/
│   │   │   │   └── api/
│   │   │   ├── platform/
│   │   │   ├── extensions/
│   │   │   └── payload.config.ts
│   │   └── package.json
│   └── driver/
│       └── optional PWA/native-oriented customer app
├── packages/
│   ├── customer-components/
│   │   ├── blocks/
│   │   ├── screens/
│   │   └── render-overrides/
│   ├── customer-extensions/
│   │   ├── domain/
│   │   ├── integrations/
│   │   └── policies/
│   └── customer-theme/
│       ├── brand-assets/
│       ├── fonts/
│       └── primitive-overrides/
├── migrations/
├── tests/
│   ├── integration/
│   ├── access/
│   ├── builder-fixtures/
│   └── upgrade-fixtures/
├── infra/
├── .k-nex/
│   └── generated/
│       ├── plugin-registry.ts
│       ├── provider-registry.ts
│       ├── ui-registry.ts
│       ├── theme-registry.ts
│       ├── payload-contributions.ts
│       ├── environment-schema.ts
│       └── build-manifest.json
├── k-nex.app.json
├── k-nex.config.ts
├── pnpm-workspace.yaml
├── package.json
├── pnpm-lock.yaml
├── Dockerfile
├── docker-compose.yml
├── .env.example
└── README.md
```

Small applications can omit `apps/driver` or extra customer packages, but the architectural boundaries remain.

## Application manifest

`k-nex.app.json` is the declarative desired composition:

```json
{
  "$schema": "./node_modules/@k-nex/cli/schemas/app.schema.json",
  "schemaVersion": 1,
  "application": {
    "id": "acme-cargo",
    "name": "Acme Cargo",
    "type": "customer-platform"
  },
  "plugins": [
    {
      "id": "module.cms",
      "package": "@k-nex/module-cms",
      "version": "2.1.0",
      "enabled": true
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
      "version": "1.0.0"
    },
    "realtime.gateway": {
      "plugin": "provider.realtime-websocket-local",
      "package": "@k-nex/provider-websocket",
      "version": "1.2.1"
    }
  },
  "builder": {
    "plugin": "builder.puck",
    "package": "@k-nex/builder-puck",
    "version": "0.1.0",
    "profiles": {
      "cms": { "enabled": true },
      "workspace": { "enabled": true }
    }
  },
  "themes": {
    "admin": {
      "installed": ["theme.minimal", "theme.neobrutalism"],
      "default": "theme.minimal"
    },
    "public": {
      "installed": ["theme.neobrutalism"],
      "default": "theme.neobrutalism"
    }
  }
}
```

Secrets never appear in the manifest.

See [Application Manifest](./14-application-manifest.md).

## Programmatic customer config

`k-nex.config.ts` contains legitimate executable customer behavior:

```ts
import { defineCustomerConfig } from '@k-nex/core'
import { acmeShipmentNumberPolicy } from './packages/customer-extensions/domain/shipment-number'
import { acmeErpIntegration } from './packages/customer-extensions/integrations/erp'
import { trackingPerformanceBlock } from './packages/customer-components/blocks/tracking-performance'

export default defineCustomerConfig({
  extensions: [
    acmeShipmentNumberPolicy(),
    acmeErpIntegration(),
  ],
  ui: {
    blocks: [trackingPerformanceBlock],
  },
})
```

Customer code consumes documented public contracts. It does not import internal package paths or patch `node_modules`.

## Generated composition

The CLI resolves the manifest and generates static import registries.

Example:

```ts
// .k-nex/generated/plugin-registry.ts
// Generated. Do not edit.

import { cmsModule } from '@k-nex/module-cms/server'
import { logisticsCoreModule } from '@k-nex/module-logistics-core/server'
import { driverModule } from '@k-nex/module-driver/server'

export const generatedPlugins = [
  cmsModule(),
  logisticsCoreModule(),
  driverModule(),
]
```

The customer platform composition imports generated registries and `k-nex.config.ts`, then produces the final Payload/application config.

Generated files are committed in V1 and verified by:

```bash
k-nex generate --check
```

## Customer UI ownership

Customer UI ownership now has two layers.

### Reusable module UI

Modules may export style-agnostic:

```text
navigation
operational screens
blocks
headless hooks/controllers
data-source/action descriptors
extension slots
```

### Customer final presentation

Customer repository owns:

```text
brand assets
approved fonts
installed theme selection
customer theme profile values
public content composition
role/user workspace layouts
customer-specific blocks/screens
primitive or renderer overrides
special CSS/structural fixes where deliberate
mobile/driver application UI
```

The core remains style-free. Shared module UI does not encode customer colors, fonts, logo, or fixed visual language.

## Theme ownership

Code packages:

```text
@k-nex/theme-minimal
@k-nex/theme-neobrutalism
@k-nex/theme-glassmorphism
```

Runtime database profiles:

```text
admin published theme profile
public published theme profile
draft/archived revisions
validated token values
```

Brand identity assets remain customer-owned. A theme can be switched among installed packages without changing the stored builder document.

## Builder ownership

The customer application owns runtime content and layout records:

```text
CMS page drafts and publications
customer/role/user workspace layouts
theme-aware previews
customer block configuration
component migration state
```

The builder engine comes from an installed plugin. Domain modules provide K-Nex blocks; customer repository can add customer-specific blocks or renderer overrides.

The customer does not store arbitrary JavaScript, SQL, imports, secrets, or unrestricted CSS inside layout documents.

## Roles and permissions

Modules register permissions. Customer application defines role composition:

```ts
export const roles = defineRoles({
  dispatcher: [
    'logistics.shipments.read',
    'logistics.shipments.assign',
    'logistics.tracking.read',
    'ui.layouts.personalize',
  ],
  operationsManager: [
    'logistics.shipments.read',
    'logistics.shipments.assign',
    'logistics.tracking.read',
    'ui.layouts.publish',
    'ui.themes.publish',
  ],
})
```

Record-level policies remain module/domain-owned and can be extended through documented customer policy hooks.

## Customer extensions

Typical extension examples:

```text
custom identifier format
special pricing/eligibility rule
legacy ERP integration
customer-only report/data source
unusual approval policy
custom webhook payload
special public tracking projection
customer-specific builder block
```

Draft contract:

```ts
export interface KNeXExtension {
  id: string
  compatibility: {
    core: string
  }
  register(context: ExtensionRegistrationContext): void | Promise<void>
}
```

Extensions participate in the same collision, permission, event, UI, and diagnostics checks as plugins where applicable.

## Promotion rule

```text
first customer requirement
  → local extension/override

second similar requirement
  → compare real business rules
  → extract stable common contract
  → publish module/provider/integration/theme capability

customer-specific difference
  → remains in each customer repository
```

Do not generalize only because an extension is large.

## Dependency and version management

Customer applications pin exact package versions:

```json
{
  "dependencies": {
    "@k-nex/core": "1.4.2",
    "@k-nex/module-cms": "2.1.0",
    "@k-nex/module-driver": "1.3.0",
    "@k-nex/provider-websocket": "1.2.1",
    "@k-nex/builder-puck": "0.1.0",
    "@k-nex/theme-minimal": "1.0.0"
  }
}
```

Rules:

- commit lockfile;
- upgrades arrive as reviewable PRs;
- run `k-nex plan` and `doctor`;
- regenerate static registries;
- include migration/config/theme/block impact;
- test final composition, not only individual packages;
- deploy customers independently.

## Project creation

Example:

```bash
pnpm create k-nex-app acme-cargo
```

The wizard can select:

```text
preset and modules
providers
builder/profile
admin/public theme packages
database/local mode
Docker Compose services
production Dockerfile
Git initialization
install dependencies
```

The result is start-ready but not production-ready until secrets, migrations, customer design, tests, and infrastructure are completed.

See [CLI and Project Generation](./15-cli-and-project-generation.md).

## Plugin changes after creation

```bash
k-nex plan --add module.crm
k-nex add module.crm
k-nex disable module.crm
k-nex remove module.crm --mode uninstall
k-nex remove module.crm --mode purge
```

The CLI reports:

```text
dependency/provider changes
package/registry changes
environment/infrastructure requirements
schema/data migration impact
stored layout/theme references
rollback limitations
```

No command applies a production database migration as an incidental side effect.

## Customer data boundary

Each customer owns:

- Postgres database and credentials;
- object storage bucket/namespace;
- optional Redis/realtime storage;
- job/outbox/audit data;
- CMS/layout/theme/runtime settings;
- backups and restore policy;
- retention and deletion policy.

No shared package assumes access to another customer's environment.

## Migrations

Customer repository owns final migration sequence because it knows:

```text
installed plugin combination
exact previous deployed versions
customer extensions
stored UI/theme/content data
provider-specific persistence
```

Plugins provide schema intent, notes, helpers, and fixtures. Customer CI tests clean install and previous-release upgrade.

## Infrastructure

Default scaffold supports:

```text
Postgres (Docker local by default)
object storage (local/MinIO/S3 provider)
optional WebSocket/Redis
web and worker process
production Dockerfile
reusable GitHub Actions workflow calls
```

Infrastructure can vary per customer without modifying shared module code.

## Testing layers

Customer repositories run:

```text
manifest/package/generated-registry consistency
plugin/capability graph validation
Payload type generation and boot
clean-database migrations
upgrade from previous deployed release
permission and record access tests
API/action/data-source integration tests
builder document and component migration fixtures
theme profile/primitive compatibility tests
critical business journeys
container/process smoke tests
backup/restore exercise where required
```

## Healthy customer repository

A customer repository is healthy when:

- core/module source is not copied or patched;
- desired composition is clear in `k-nex.app.json`;
- package/lockfile and generated registries match;
- customer-specific code is isolated in extensions/components/overrides;
- final migrations recreate/upgrade the database;
- UI layouts/themes reference installed validated registries;
- production state can be recreated from code, migrations, secrets, and backups;
- another customer can run a different product graph without coordination;
- disabling/uninstalling a plugin does not silently destroy data;
- release inventory identifies the exact deployed application.
