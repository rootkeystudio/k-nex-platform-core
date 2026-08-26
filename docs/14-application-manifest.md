# Application Manifest

## Purpose

`k-nex.app.json` is the desired, machine-editable composition of one customer application. The normative schema is `schemas/application-manifest.v1.schema.json`.

It records non-secret source-controlled choices:

```text
application identity and runtime tuple
Payload Postgres adapter and local/external setup
exact K-Nex plugin requests
a selected provider for each replaceable single capability
optional builder profiles and installed themes
Docker/local infrastructure generation
environment variable names
```

## Canonical example

```json
{
  "$schema": "./schemas/application-manifest.v1.schema.json",
  "schemaVersion": 1,
  "application": {
    "id": "acme-cargo",
    "name": "Acme Cargo",
    "type": "customer-platform",
    "defaultLocale": "tr",
    "locales": ["tr", "en"]
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
      "id": "module.cms",
      "package": "@k-nex/module-cms",
      "version": "1.0.0",
      "enabled": true
    },
    {
      "id": "module.sales",
      "package": "@k-nex/module-sales",
      "version": "1.0.0",
      "enabled": true
    },
    {
      "id": "module.logistics.core",
      "package": "@k-nex/module-logistics-core",
      "version": "1.0.0",
      "enabled": true
    },
    {
      "id": "module.logistics.driver",
      "package": "@k-nex/module-logistics-driver",
      "version": "1.0.0",
      "enabled": true
    }
  ],
  "providers": {
    "realtime.gateway": {
      "plugin": "provider.realtime.socketio",
      "package": "@k-nex/provider-realtime-socketio",
      "version": "1.0.0",
      "options": { "adapter": "memory" }
    }
  },
  "themes": {
    "admin": { "installed": ["theme.minimal"], "default": "theme.minimal" },
    "public": { "installed": ["theme.neobrutalism"], "default": "theme.neobrutalism" }
  },
  "development": {
    "database": { "mode": "docker-postgres", "serviceName": "postgres" }
  },
  "build": {
    "dockerfile": true,
    "commitGeneratedRegistries": true,
    "validateGeneratedFilesInCI": true
  },
  "environment": {
    "required": ["DATABASE_URL", "PAYLOAD_SECRET", "DRIVER_TOKEN_SIGNING_KEY"]
  }
}
```

Production values never appear in this file.

`builder` is optional. Backend-only and pre-builder applications omit it entirely; when present, it is an executable composition request and must resolve to an installed builder package.

## Source-of-truth matrix

| Concern | Authority |
|---|---|
| Desired graph | `k-nex.app.json` |
| Installed bytes/integrity | `pnpm-lock.yaml` |
| Package claims | released static plugin manifest |
| Customer code registrations | hermetic `k-nex.config.ts` fingerprint |
| Executable graph | committed deterministic `k-nex.resolved.json` and registries |
| Runtime configuration | validated database records |
| Deployed truth | signed attestation, artifact digest, migration revision, deployment receipt |

Every edge is checked; there is no silent winner.

## Hermetic customer config

`k-nex.config.ts` can statically register customer extensions, policies, sources, actions, blocks, and overrides. During graph generation it cannot use network, current time, random IDs, secret/environment values, or ambient filesystem scanning to select contributions.

Environment names can be declared. Environment values configure already-resolved handlers at runtime.

The target application compiler fingerprints all transitive customer config source and performs a second clean generation in CI. Gate 1 proves only an inert direct-file fingerprint without config execution or transitive import discovery; the broader compiler boundary remains design-only in ADR-0004.

## Deterministic resolved graph

`.k-nex/generated/k-nex.resolved.json` records:

```text
schema/resolver version
application ID
exact package version + integrity + manifest digest
plugin IDs and selected capabilities
registration order and expected contributions
Payload/Node/pnpm exact tuple
environment variable names
customer-config fingerprint
```

It does not contain build time, hostname, absolute paths, random identifiers, or secrets. Build metadata belongs to signed CI provenance and deployment receipts.

## Generated registries

```text
plugin-registry.ts
provider-registry.ts
payload-contributions.ts
data-source-registry.ts
action-registry.ts
ui-registry.ts
theme-registry.ts
environment-schema.ts
k-nex.resolved.json
```

CI regenerates and compares bytes. Runtime verifies registry API version and actual registration inventory.

## Presets

A preset is expanded into explicit plugin/provider/theme choices before persistence. An application does not change because a preset recommendation later changes.

## Lifecycle state

The manifest can request installed/enabled or installed/disabled state when a plugin declares safe disable semantics. It cannot claim generic schema-owning retained-data uninstall. Purge is a separate migration/release operation, not a manifest boolean.

## Validation invariants

- IDs match canonical grammar.
- Versions are exact in the application manifest.
- Payload Postgres package/config matches lockfile.
- Explicit single-capability provider selection exists.
- plugin package name/version/manifest/integrity agree.
- required dependencies are satisfied; optional packages never auto-install.
- environment names derive exactly from the resolved graph.
- generated graph/registries are current and deterministic.
- customer config fingerprint matches.
- no secret or dynamic package path exists.
- runtime actual contributions match declared inventory.
