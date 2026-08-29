# CLI, Bundling, and Project Generation

## Separate tools

K-Nex needs distinct commands for static host composition, extension publication, development sync, and runtime operations.

```text
create-knex-app / k-nex app
  customer repository and Platform Plugin host composition

k-nex extension build
  deterministic Hot Application or Theme Skin artifact publication input

k-nex extension dev
  explicitly development-only local build/sync

k-nex extension plan/install/update/rollback
  PluginManager client for verified runtime artifacts

k-nex deploy plan/apply
  authorized Platform Plugin release request to deployment supervisor
```

One generic command must not silently choose between host package mutation and runtime app activation.

## Customer application compiler

Static flow:

```text
read/validate k-nex.app.json
load exact installed Platform Plugin manifests without executing code
resolve deterministic graph/providers
fingerprint hermetic customer config
emit canonical generated registries
verify frozen lockfile and package integrity
plan customer migrations/topology/references
build/test immutable host image
emit SBOM/provenance/deployment inputs
```

`create-knex-app` owns the customer shell, Docker development topology, baseline migrations, and first-run setup inputs. It does not preinstall arbitrary runtime catalog artifacts.

## Extension bundle builder

`k-nex extension build` runs in a protected development/publication environment, not the customer web container.

Hot Application output:

```text
closed app manifest
self-contained prebuilt server bundles
self-contained remote UI worker bundles
assets and JSON Schemas
file/digest inventory
SBOM
provenance predicate input
conformance report
```

Theme Skin output contains no executable entrypoints.

Builder requirements:

- exact frozen dependencies;
- deterministic normalized output;
- forbidden import/builtin analysis;
- no install scripts in published activation path;
- source maps/debug policy without source-secret leakage;
- file/count/byte/depth budgets;
- content-addressed digest;
- packed artifact conformance.

## Official catalog publication

Protected publication:

```text
build and test exact source commit
→ create immutable release artifact
→ attest artifact/SBOM/manifest
→ sign/version catalog entry
→ review support/capability/security impact
→ publish catalog index
```

The catalog entry points to an immutable release asset. Moving branches and arbitrary repository URLs are not production install sources.

## Runtime install client

The CLI/admin client submits a catalog identity and expected revision to PluginManager:

```text
plan
stage/download
validate
activate
observe receipt
```

It never sends a local package path to the production web process and never asks the web process to run a package manager.

## Platform Plugin deployment client

A full plugin change:

```text
modify desired static composition
resolve/update exact lock and generated graph
run full gates and migration compatibility
build verified target image
submit approved change request to DeploymentSupervisor
observe blue/green/maintenance result and receipt
```

The client does not receive direct Docker authority unless it is the explicitly deployed supervisor environment.

## Development live sync

`k-nex extension dev` may:

```text
watch local app/skin source
rebuild deterministic development bundle
push to a local development artifact endpoint
activate a dev-only generation
refresh remote UI/runner
```

Required safeguards:

```text
explicit development mode at both client and server
non-production customer/environment assertion
visible unsigned/dev artifact labeling
no catalog/provenance maturity claim
same closed manifest and runtime ABI where practical
no fallback to production endpoint
```

Platform Plugin development still restarts/rebuilds the local host as needed; it is not confused with Hot Application sync.

## Plan output

Every extension/deployment plan reports:

```text
execution class
current/target exact identity and digest
requested permissions/capabilities/secrets/network/storage
schema/data/settings/reference impact
resource budgets
download/build/deploy path
zero-downtime eligibility or maintenance requirement
rollback window and irreversible boundaries
approvals and evidence required
```

## Hermetic rules

- Graph/bundle output cannot depend on wall-clock time, randomness, hostname, absolute path, undeclared environment, network discovery, or secret values.
- Build metadata/time lives in signed provenance, not normalized bundle identity.
- Static customer config cannot dynamically discover plugins.
- Hot Application manifest cannot name arbitrary host imports.
- Runtime activation cannot rewrite customer source/lockfile.

## Required tests

```text
clean static double-generation
clean app/skin double-bundle generation
packed artifact identity and digest
forbidden import/install-script fixture
unsigned dev/prod crossing failure
catalog immutable-release enforcement
runtime client cannot submit arbitrary local path
Platform Plugin path always creates release plan
zero-downtime/maintenance result stability
no secrets in plan, bundle, generated files, logs, receipts
```
