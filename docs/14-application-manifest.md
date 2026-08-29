# Application Manifest

## Purpose

`k-nex.app.json` is the non-secret source-controlled desired state for one customer's **static host application**. It is not a runtime package list and does not contain arbitrary executable URLs.

## Static authority

The manifest selects:

```text
application identity and runtime tuple
Payload/Postgres adapter configuration
exact Platform Plugin requests
provider selections
full Theme Package
static build/deployment mode
required environment names
```

It reconciles with:

```text
package.json and frozen pnpm-lock.yaml
installed package manifests and integrity
hermetic k-nex.config.ts fingerprint
.k-nex/generated resolved graph/registries
customer-owned migrations
release artifact and deployment receipt
```

A mismatch fails closed.

## Dynamic extensions are separate

Hot Applications and Theme Skins are installed from verified catalog artifacts after host boot. Their authoritative state is not a mutable executable section inside `k-nex.app.json`.

Runtime records bind:

```text
extension class and identity/version
catalog/publisher/source/release
artifact/manifest/SBOM/provenance digest
staged/active/rollback generation
configuration/capability state
activation/retirement receipt
runtime extension revision
```

This separation preserves reviewable static host composition while allowing live app/skin activation.

## Desired runtime extension policy

A future optional source-controlled policy file may constrain runtime operations, for example:

```text
allowed official catalog keys/publishers
allowed app/skin IDs or support channels
maximum resource budgets
network/secret/storage policy
approval requirements
auto-update policy
```

It may restrict runtime state but cannot assert that an artifact is installed/active or override observed receipts.

## Platform Plugin example

Illustrative only; generated schemas and canonical fixtures are normative:

```json
{
  "schemaVersion": 1,
  "application": {
    "id": "customer-alpha",
    "name": "Customer Alpha",
    "type": "customer-platform"
  },
  "runtime": {
    "node": "24.19.0",
    "packageManager": "pnpm",
    "packageManagerVersion": "11.9.0",
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
      "id": "module.sales",
      "package": "@k-nex/module-sales",
      "version": "1.0.0",
      "enabled": true
    }
  ],
  "providers": {},
  "themes": {
    "active": "minimal",
    "package": "@k-nex/theme-minimal",
    "version": "1.0.0"
  },
  "build": {
    "dockerfile": true,
    "commitGeneratedRegistries": true,
    "validateGeneratedFilesInCI": true
  },
  "environment": {
    "required": ["DATABASE_URL", "PAYLOAD_SECRET"]
  }
}
```

Do not copy this prose example into a new contract. Use the generated application-manifest schema and fixtures.

## Environment and secrets

The manifest records environment variable names and conditions only. Secret values remain in the customer deployment secret store.

Hot Applications declare secret-reference names in their signed manifest. The host resolves approved references at invocation and never exposes values to remote UI, artifact, app storage, logs, receipts, or inventory.

## Enabled state

A Platform Plugin's desired initial state may be source-controlled, but current effective state is reconciled with installed bytes, migration/configuration/dependency readiness, lifecycle revision, and runtime authorization.

A Hot Application/Skin's active generation is runtime state and cannot be selected by a raw package path in this manifest.

## Determinism

Committed static artifacts contain no wall-clock timestamp, host path, hostname, random identifier, or secret. Build/deployment/activation time belongs in signed evidence and receipts.

## Validation

- only exact supported runtime/package-manager/framework tuples;
- canonical unique plugin IDs/packages;
- explicit provider selection;
- Platform Plugin package version/integrity/manifest match;
- no app/skin executable URL or arbitrary runtime package section;
- required environment names only;
- generated graph and clean double-generation match;
- release artifact and runtime inventory reconcile.
