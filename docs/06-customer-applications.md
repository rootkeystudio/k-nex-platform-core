# Customer Applications

## Purpose

A customer application is the independently owned composition of K-Nex core, selected modules, design, custom behavior, and infrastructure for one customer.

The customer application is where product differentiation happens. Shared packages should not need to know which customer consumes them.

## Repository decision

Use a **separate private repository per customer application**, generated from a starter/template repository.

Do not maintain customers as long-lived branches of the core repository.

Preferred model:

```text
k-nex-platform-core             shared versioned kernel
k-nex-module-*                  shared versioned modules
k-nex-customer-starter          template application
client-acme-cargo               independent customer repository
client-mamma-restaurant         independent customer repository
```

The word “fork” can describe the initial generation experience, but the customer repository should not contain a copied, editable version of platform core source. It should consume released packages.

## Why not customer branches

Long-lived customer branches make the following harder:

- independent dependency versions;
- separate secrets and deployment permissions;
- customer-specific CI/CD;
- issue and pull request history;
- release tags and changelogs;
- selective repository access;
- upstream upgrades without merge conflicts;
- transfer or archival of one customer;
- preventing accidental cross-customer merges.

Separate repositories preserve isolation while package releases provide reuse.

## Suggested repository structure

```text
client-acme-cargo/
├── src/
│   ├── app/
│   │   ├── (public)/
│   │   ├── (admin)/
│   │   ├── tracking/
│   │   └── api/
│   ├── platform/
│   │   ├── modules.ts
│   │   ├── roles.ts
│   │   ├── providers.ts
│   │   └── platform.ts
│   ├── payload.config.ts
│   ├── theme/
│   │   ├── tokens.css
│   │   ├── typography.css
│   │   ├── globals.css
│   │   └── admin.css
│   ├── components/
│   ├── page-builder/
│   │   ├── config.tsx
│   │   └── components/
│   └── extensions/
│       ├── pricing-policy.ts
│       ├── shipment-number.ts
│       └── erp-integration.ts
├── apps/
│   └── driver/
├── migrations/
├── tests/
├── infra/
├── Dockerfile
├── package.json
└── pnpm-lock.yaml
```

The exact frontend structure can change, but the boundaries should remain clear.

## Composition root

`src/platform/modules.ts` should make the installed product visible at a glance.

```ts
import { cmsModule } from '@k-nex/module-cms/server'
import { crmModule } from '@k-nex/module-crm/server'
import { pageBuilderModule } from '@k-nex/module-page-builder/server'
import { websocketModule } from '@k-nex/module-websocket/server'
import { logisticsCoreModule } from '@k-nex/module-logistics-core/server'
import { dispatchModule } from '@k-nex/module-dispatch/server'
import { liveTrackingModule } from '@k-nex/module-live-tracking/server'
import { driverModule } from '@k-nex/module-driver/server'

export const modules = [
  cmsModule(),
  crmModule(),
  pageBuilderModule(),
  websocketModule(),
  logisticsCoreModule(),
  dispatchModule({ assignmentMode: 'manual' }),
  liveTrackingModule({ publicTracking: true }),
  driverModule(),
]
```

Then `platform.ts` composes core, modules, providers, and extensions:

```ts
import { createPlatform } from '@k-nex/core'
import { modules } from './modules'
import { roles } from './roles'
import { providers } from './providers'
import { acmeCargoExtension } from '../extensions/acme-cargo'

export const platform = createPlatform({
  app: {
    id: 'acme-cargo',
    name: 'Acme Cargo',
    environment: process.env.NODE_ENV,
  },
  modules,
  roles,
  providers,
  extensions: [acmeCargoExtension()],
})
```

## Styling boundary

All final presentation belongs to the customer repository:

- design tokens;
- typography;
- responsive layout;
- public website components;
- customer admin styling;
- page-builder component renderers;
- email templates when brand-specific;
- mobile or driver application UI.

The platform core contains no styles. Backend modules should be headless by default. A module may provide optional UI primitives, but the customer application decides whether and how to use them.

## Customer extensions

Local extensions are the escape hatch for true customer-specific behavior.

```ts
export interface KNeXExtension {
  id: string
  compatibility: {
    core: string
  }
  register(context: ExtensionRegistrationContext):
    | void
    | Promise<void>
}
```

Typical extension examples:

- custom identifier format;
- special pricing rule;
- legacy ERP integration;
- customer-only report;
- unusual approval policy;
- custom webhook payload.

Extensions may consume documented module contracts. They must not patch package files or import internal module paths.

## Promotion rule

Use this lifecycle:

```text
first customer request
  → local extension

second similar request
  → compare business rules
  → extract shared contract and configuration
  → publish reusable module or integration package

customer-specific difference
  → remains in each customer extension
```

A local extension should not be promoted merely because it is large. Reusability is proven by repeated need and stable boundaries.

## Dependency management

Customer applications should pin exact package versions:

```json
{
  "dependencies": {
    "@k-nex/core": "1.4.2",
    "@k-nex/module-cms": "2.1.0",
    "@k-nex/module-websocket": "1.2.1",
    "@k-nex/module-driver": "1.0.4"
  }
}
```

Also:

- commit the lockfile;
- use automated dependency PRs rather than automatic production upgrades;
- include migration notes in upgrade PRs;
- test the final composed application, not only individual modules;
- upgrade customers independently.

## Starter repository

The starter should contain only the repeatable shell:

- minimal Next.js/Payload application;
- platform composition files;
- environment validation;
- test setup;
- Dockerfile;
- migration scripts;
- reusable deployment workflow calls;
- empty theme and extension directories;
- documentation for selecting modules.

It should not pre-install every module. Presets or a creation CLI can add packages intentionally.

## Creation workflow

A future CLI may support:

```bash
pnpm create k-nex-app acme-cargo \
  --preset logistics \
  --modules cms,crm,page-builder,dispatch,tracking,driver
```

Expected result:

1. Generate a new private repository from the starter.
2. Install selected exact package versions.
3. Write the module composition file.
4. Generate environment and infrastructure templates.
5. Create a clean initial migration.
6. Run module graph validation and smoke tests.
7. Leave customer theme and extension areas ready for implementation.

## Customer data boundary

Each customer application owns:

- its own database;
- object storage bucket or namespace;
- environment secrets;
- background job storage;
- optional Redis/realtime infrastructure;
- backup and restore schedule;
- data retention and deletion policy.

No shared package should assume access to another customer environment.

## Testing layers

Customer repositories should run:

- module graph validation;
- type generation and type checking;
- clean-database migration test;
- upgrade migration test from the previous deployed version;
- access-control tests for configured roles;
- API integration tests;
- critical customer journey tests;
- build and container smoke test.

## Definition of a healthy customer repository

A repository is healthy when:

- core source is not copied or locally patched;
- all reusable capabilities are versioned dependencies;
- customer differences are visible in theme, configuration, or extensions;
- production state can be recreated from code, migrations, secrets, and backups;
- another customer can run different module versions without coordination;
- removing the customer repository cannot affect shared package source or another deployment.