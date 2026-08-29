# Customer Applications

## Ownership model

Each customer application owns:

```text
repository and static application manifest
exact lockfile and generated Platform Plugin graph
Payload/Postgres database and migrations
object storage and content-addressed extension artifacts
secrets and network policy
Hot Application/Theme Skin lifecycle state
content, settings, layouts, theme profiles, app storage
roles/grants/assignments after Phase 10
web/worker/runner/gateway topology
backups, observability, deployment and activation receipts
release cadence
```

Customers do not receive long-lived branches of one shared core deployment.

## Static desired state

`k-nex.app.json` describes the reviewable host composition:

```text
application identity/runtime
Payload database adapter
Platform Plugin exact requests
provider selections
full Theme Package selection
static build/deployment requirements
required environment names
```

The frozen lockfile, package manifests, generated graph/registries, customer config fingerprint, and customer migrations reconcile that desired state into one immutable host artifact.

## Dynamic observed state

Hot Applications and Theme Skins are not arbitrary executable paths inside `k-nex.app.json`. Their authoritative customer state lives in PostgreSQL and verified artifact storage:

```text
catalog/release identity
artifact/manifest/SBOM/provenance digests
installed/staged/active/rollback generation
configuration and capability grants
app storage/profile references
activation/retirement receipts
runtime extension revision
```

Protected runtime inventory combines static and dynamic truth.

## Why the sources differ

Static Platform Plugins can change Payload config, schema, migrations, providers, and native host code, so source-controlled review and image delivery are required.

Hot Applications and Theme Skins use a fixed preinstalled host ABI, so immutable verified generations can activate live without mutating the host artifact.

Neither layer silently overrides the other.

## Repository layout direction

```text
k-nex.app.json
k-nex.config.ts
package.json
pnpm-lock.yaml
.k-nex/generated/
src/payload.config.ts
src/migrations/
infrastructure/
tests/
release evidence inputs
```

Runtime app/skin artifacts are referenced by digest and normally stored outside the Git working tree. A desired extension policy/export may be source-controlled later, but it cannot override observed activation receipts.

## Local development

A local customer may use Docker Postgres, web, worker, extension runner, artifact store, and gateway. Development-only Hot Application sync can watch local source, build a bundle, and replace a dev generation.

Development sync:

- is explicitly disabled in production;
- does not weaken production manifest/bundle schemas;
- never becomes proof of signed catalog activation;
- uses the same remote UI/runner/host capability interfaces where possible.

## Production delivery

### Hot Application / Theme Skin

```text
approved catalog request
→ verify/stage/warm
→ atomic generation activation
→ revision convergence
→ activation receipt
```

### Platform Plugin

```text
approved source/package change
→ deterministic host release
→ migration compatibility plan
→ blue/green start/warm/promotion
→ deployment receipt
```

## Customer customizations

Customer code requiring host Payload/schema/native UI belongs in the static customer release and follows Platform Plugin-class tests.

Customer app-like logic/UI that fits the bounded runtime ABI may be published as a private Hot Application bundle and activated through the same verifier/runner path. It is never imported directly from mutable customer storage.

## Backup and restore

A restore must reproduce:

```text
host artifact and migration revision
static Platform Plugin graph
active/rollback app and skin generations
verified artifact references or backed-up bytes
app settings/storage and theme profiles
outbox/idempotency/audit
roles and assignments when implemented
runtime/deployment receipts
```

External integrations are disabled or redirected during restore proof.

## Fleet operations

Fleet metadata derives from signed host deployment receipts and runtime activation inventory. It can answer:

```text
which customers run an affected Platform Plugin package/range
which customers run an affected Hot Application/Skin version or digest
which host/runtime ABI combinations are incompatible
which activations/deployments lack fresh restore evidence
```

Manual desired targets cannot falsify observed versions.
