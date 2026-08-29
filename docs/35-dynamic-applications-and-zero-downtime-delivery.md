# Dynamic Applications and Zero-Downtime Extension Delivery

## Decision summary

K-Nex will support a user experience in which an authorized operator can select an official extension, let the platform download and validate it in the background, and activate it without making the customer site unavailable.

That outcome is delivered through **two execution paths**, not by mutating the main Node.js process:

```text
Hot Application Bundle
  signed prebuilt server/UI artifacts
  isolated runner + remote UI
  no host restart

Platform Plugin Release
  existing full K-Nex plugin package
  new immutable container generation
  blue/green traffic promotion
  no user-visible outage when compatibility permits
```

A raw `pnpm add` followed by `import()` inside the running web process is not an accepted production mechanism. It would bypass the resolved graph, static registration, Payload config, SBOM/provenance, migration fence, rollback, multi-process consistency, and reliable unload boundaries.

## Why the current plugin cannot be hot-injected

The accepted plugin contract can contribute:

```text
Payload collections and schema
customer migrations
server services and policies
jobs, events, realtime topics
sources, actions, agent tools
Next/Payload routes and admin behavior
browser components and Puck blocks
theme/build/provider code
```

Those contributions are currently composed before Payload boot, generated as static package imports, reconciled, and frozen. Payload collections and production migrations are part of the boot-time config. Therefore a full `module.sales`-style package is a **Platform Plugin**, not a hot application.

This boundary is preserved rather than weakened.

## Reference from Twenty

Twenty's application installer resolves NPM or tarball packages, securely extracts them, reads a manifest, stores application files, applies metadata migrations, refreshes caches, and runs application logic through a separate execution driver. Its local logic-function driver launches child Node processes; it does not install arbitrary application dependencies into the main CRM module graph. This validates the product pattern—live application installation—while also showing that isolation and a metadata/runtime substrate are prerequisites.

K-Nex adopts the pattern, not Twenty's internal contracts.

## Extension classes

| Class | Identity | Can install live? | Execution | May alter host Payload config? |
|---|---|---:|---|---:|
| Platform Plugin | existing `module.*`, `provider.*`, `builder.*`, `theme.*`, `integration.*`, `preset.*` | through zero-downtime release | trusted host/container code | yes, through reviewed release/migration |
| Hot Application | `app.*` | yes | isolated server runner + remote UI | no |
| Theme Skin | `skin.*` | yes | declarative tokens/recipes/scoped CSS/assets | no |

All three appear in the future Plugin Manager. Their lifecycle buttons and guarantees differ truthfully.

### Platform Plugin

The existing exact-version K-Nex package. It may own schema and deep framework integration. Add, upgrade, or removal creates a new application release.

### Hot Application

A signed, immutable, prebuilt bundle that uses fixed host capabilities. Initial V1 contributions are bounded to:

```text
declarative app metadata and settings
permission and role-template descriptors
navigation and generic /apps/:appId/* routes
remote UI screens/blocks using allowlisted K-Nex components
isolated logic functions
source/action/tool descriptors dispatched through fixed host gateways
event subscriptions and schedules only through platform-owned contracts
namespaced app document/KV storage with quota and schema validation
assets and localization
health/testing metadata
```

It cannot add Payload collections/globals/hooks, native host routes, host process services, host React modules, unrestricted SQL, direct database credentials, Docker access, inherited environment variables, or arbitrary network access.

### Theme Skin

A live-installable subset containing only:

```text
bounded theme tokens
palettes and recipe selections
scoped validated CSS
content-addressed static assets
profile migration metadata expressible as data transforms
```

A full `theme.*` package with JavaScript token validators, React primitive overrides, or executable migrations remains a Platform Plugin release.

## Artifact format

Official catalog entries point to immutable GitHub Release assets or an equivalent protected artifact store. Runtime never clones a moving branch.

A Hot Application Bundle contains:

```text
k-nex.app-bundle.json
server/*.mjs              prebuilt self-contained logic bundles
ui/*.mjs                  prebuilt remote-UI worker bundles
assets/*                  bounded immutable assets
schemas/*                 JSON Schema only
sbom.cdx.json
provenance/attestation reference
```

The manifest binds:

```text
app ID and exact version
K-Nex runtime ABI range
artifact and file digests
server/UI entrypoints
permissions and requested host capabilities
network and secret-reference requirements
storage quota and schemas
routes/navigation/settings/templates
resource budgets
upgrade/uninstall hooks expressed through supported contracts
```

Dependencies are bundled at publication time. Production installation runs no lifecycle scripts and no package manager inside the web container.

## Official catalog trust

The official catalog is a signed, versioned index. A catalog entry is accepted only when it binds:

```text
publisher identity
source repository and commit
release asset digest
bundle manifest digest
SBOM digest
hosted-build provenance
review/support status
compatibility range
revocation/security status
```

The installer verifies the catalog signature, artifact digest, provenance, closed manifest schema, path safety, file count/size, entrypoint inventory, forbidden imports, capability requests, permissions, budgets, and current support state before staging.

## PluginManager architecture

`PluginManager` is the stable orchestration façade, not a god service:

```ts
interface PluginManager {
  plan(request: ExtensionChangeRequest): Promise<ExtensionPlan>
  stage(planId: string): Promise<StagedExtension>
  validate(stageId: string): Promise<ValidationReport>
  activate(stageId: string, expectedRevision: number): Promise<ActivationReceipt>
  rollback(activationId: string): Promise<ActivationReceipt>
  disable(extensionId: string, expectedRevision: number): Promise<void>
  uninstall(extensionId: string, expectedRevision: number): Promise<void>
}
```

It delegates to:

```text
CatalogClient
ArtifactFetcher
ArtifactVerifier
ContentAddressedArtifactStore
ExtensionPlanner
HotApplicationSupervisor
RemoteUiRegistry
RuntimeExtensionRegistry
MigrationCoordinator
DeploymentSupervisor
TrafficRouter
AuthorizationHook
Audit/Outbox/Observability
```

The main application never receives the Docker socket or registry publishing credentials.

## Live install flow

```text
operator requests app@version
→ catalog and authorization check
→ deterministic impact plan
→ background content-addressed download
→ signature/provenance/SBOM/manifest verification
→ static bundle inspection and quota checks
→ stage server/UI generation
→ start isolated runner generation with no traffic
→ run bounded install validation and health probes
→ prepare metadata/storage transaction
→ atomically commit active generation pointer + revision + audit + outbox
→ browser/process registries refetch
→ new navigation/screens become visible
```

Failure before activation deletes or quarantines the staged generation and does not affect the active one.

## Atomic update and rollback

An update stages a new generation beside the active generation:

```text
active generation N
staged generation N+1
→ validate/warm N+1
→ commit pointer N → N+1
→ new calls use N+1
→ drain in-flight N calls
→ retain N for rollback window
```

Rollback atomically restores the previous compatible pointer. Data changes must declare backward compatibility or a reviewed irreversible boundary; the manager cannot promise rollback when the extension's migration contract makes it impossible.

## Isolated server runner

The reference topology adds `k-nex-extension-runner` as a separate service or managed pool. Each execution receives only a capability-scoped invocation envelope and short-lived app token.

Reference restrictions:

```text
non-root process
read-only root filesystem
per-invocation/workload temp directory
no Docker socket
no customer database credential
no inherited host secrets or NODE_OPTIONS
explicit secret references resolved by host capability
network denied by default; reviewed destination policy
CPU, memory, wall-time, payload, result, log, and concurrency budgets
process/container termination on timeout or policy violation
structured IPC/RPC only
```

Node's permission model may be defense in depth, but it is not the security boundary. Process/container isolation, credentials, network policy, and the host API are the boundary.

## Host API and app storage

A Hot Application does not receive `req.payload` or a generic service locator. It calls versioned host capabilities such as:

```text
records.query/action through registered gateways
appStorage.get/put/query/delete
files.read/write through scoped handles
events.publish/subscribe through declared descriptors
secrets.resolveReference for declared keys
http.fetch through destination policy
jobs.schedule through a bounded scheduler contract
audit.emit structured application observation
```

The initial data store is a platform-owned namespaced document/KV store with strict JSON Schemas, optimistic revisions, quotas, indexes from a bounded declaration, backup/restore inclusion, and no cross-app reads. Dynamic custom relational objects are a later explicit gate.

## Remote UI

A Hot Application UI runs in a Web Worker or equivalent isolated realm and communicates through a K-Nex-owned remote component protocol.

```text
worker bundle
→ emits allowlisted component tree and typed events
→ host maps IDs to installed K-Nex components
→ host owns DOM, focus, accessibility, theme, navigation, data gateways
```

The worker receives no direct DOM, cookies, localStorage, host module imports, or arbitrary React component injection. Generic host routes such as `/apps/:appId/*` and fixed extension slots exist before installation, so a live app does not mutate Next.js routes.

Remote DOM/remote-component libraries may be evaluated behind a K-Nex adapter. Their wire types do not become persisted public contracts until the kill-spike passes.

## Theme skin activation

Theme skins use the same stage/verify/activate pointer model. CSS is parsed and scoped, remote imports/URLs are rejected except content-addressed approved assets, token values are bounded, and accessibility/visual checks run before publication.

A skin can activate live because it contains no host JavaScript. A full executable theme package follows the Platform Plugin release path.

## Zero-downtime Platform Plugin delivery

For a full plugin, the customer site remains available through blue/green or rolling replacement:

```text
stable gateway/reverse proxy
blue web/worker generation serving traffic
separate deploy supervisor builds/pulls green image
verify artifact/provenance/inventory
run expand-compatible migrations under advisory lock
start green web/worker with zero traffic
warm and run readiness/authenticated smoke
atomically promote gateway to green
reconnect/drain realtime and in-flight work
emit deployment receipt
retire blue after rollback window
```

Docker Compose alone is not treated as a zero-downtime orchestrator. The reference implementation uses a separate least-privileged deployment supervisor plus gateway, or a supported orchestrator such as Docker Swarm. The web/admin process never controls Docker directly.

Zero downtime is accepted only when:

```text
at least one healthy old generation remains during warm-up
migrations follow expand/contract compatibility
old and new versions can overlap for the promotion window
workers use lease/idempotency semantics
realtime has reconnect/resync convergence
readiness and inventory match the target artifact
```

A destructive or mutually incompatible migration produces `maintenance-required`; the UI cannot falsely label it zero downtime.

## Lifecycle states

```text
catalog-available
planning
downloading
verified
staged
waiting-configuration
waiting-approval
warming
active
disabled
update-available
rollback-available
quarantined
retirement-pending
removed
```

Every transition is revision-checked, idempotent, audited, and observable. Runtime state never changes the artifact digest or manifest.

## Security and failure principles

- Fail closed on signature, digest, compatibility, capability, migration, or health mismatch.
- Never execute install scripts.
- Never import downloaded code into the host process.
- Never expose Docker socket, raw database credentials, or ambient host secrets to an app.
- Activation is one atomic pointer/revision transaction.
- Lost invalidations converge through revision polling.
- Runner crash affects only that app invocation/generation.
- Catalog compromise is limited by artifact signature/provenance and revocation policy.
- Rollback retains exact prior artifacts, metadata revision, and receipts.
- Backup/restore includes active generation pointers, app storage, settings, permissions, and artifact references.

## Product experience

The operator sees one coherent Plugin Manager:

```text
Install live             Hot Application / Theme Skin
Install with live deploy Platform Plugin
Requires maintenance     incompatible migration only
```

The UI shows the execution class, requested permissions/capabilities, data and network access, migration/rollback limits, expected activation path, and continuous-availability eligibility before approval.

## Non-goals for the first gate

```text
arbitrary NPM package execution
host-process dependency injection
hot addition of Payload collections/hooks
third-party public marketplace governance
general dynamic relational ORM
native remote React component execution in host
automatic secret or network grants
claiming every migration is zero downtime
```

## Required proof

The dynamic-runtime gate must demonstrate:

```text
signed bundle download and tamper rejection
no package manager/install script in production activation
isolated server execution and denied host escape
remote UI without DOM/host-module access
atomic activate/update/rollback with concurrent requests
multi-web/worker revision convergence
runner crash and timeout containment
hot theme skin activation
blue/green full-plugin release with continuous HTTP probes
maintenance-required refusal for incompatible migration
backup/restore and exact runtime inventory
```
