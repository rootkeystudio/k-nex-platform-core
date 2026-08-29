# Dynamic Applications and Zero-Downtime Extension Delivery

## Decision summary

K-Nex supports a product experience in which an authorized operator selects an official extension, the platform downloads and validates it in the background, and the extension becomes available without making the customer site unavailable when its delivery class and migration compatibility permit.

That outcome uses two execution paths, never live host-process package mutation:

```text
Hot Application / Theme Skin
  signed immutable artifact
  isolated generation warm-up
  atomic live pointer activation
  no host restart

Platform Plugin
  exact customer source/lock/graph change
  signed customer-specific application/image build
  blue/green generation warm-up
  compatibility-gated traffic promotion
```

A raw `pnpm add` followed by `import()` in the active web/worker process is rejected. It would bypass the resolved graph, static registration, Payload config, SBOM/provenance, migration fence, rollback, multi-process consistency, and reliable unload boundaries.

## Why a full current plugin cannot be hot-injected

The accepted Platform Plugin contract can contribute:

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

These contributions are composed before Payload boot, generated as static imports, reconciled, and frozen. Full `module.sales`-class code is therefore a **Platform Plugin**, not a Hot Application.

## Reference from Twenty

Twenty demonstrates a useful product pattern: resolve/download an immutable package, apply declarative metadata, store prebuilt files, and execute extension logic/UI behind separate boundaries. K-Nex adopts that product pattern behind K-Nex contracts; it does not copy Twenty internals or treat arbitrary application code as trusted host modules.

## Extension delivery classes

| Delivery class | Identity | Availability path | Execution | May alter host Payload config? |
|---|---|---|---|---:|
| Platform Plugin | existing `module.*`, `provider.*`, `builder.*`, `theme.*`, `integration.*`, `preset.*` | customer release + compatible blue/green promotion | trusted host/container code | yes, through reviewed source/migration/release |
| Hot Application | `app.*` | live immutable generation | per-generation server sandbox + credentialless remote UI | no |
| Theme Skin | `skin.*` | live immutable generation | declarative parsed data | no |

The contract discriminator is `ExtensionDeliveryClass`; it does not overload existing `PluginManifest.kind`.

### Platform Plugin

The existing exact-version K-Nex package. It may own schema and deep framework integration. Add, upgrade, or removal creates a new customer source commit, application bundle/image, migration plan, and deployment receipt.

### Hot Application

A signed, immutable, prebuilt bundle using fixed host capabilities. Initial surfaces are bounded to:

```text
declarative app metadata and settings
permission and role-template descriptors
navigation and generic /apps/:appId/* routes
remote UI screens/blocks using allowlisted K-Nex components
isolated logic functions
source/action/tool descriptors dispatched through fixed host gateways
event subscriptions and schedules through platform-owned contracts
namespaced schema-validated quota-bound document/KV storage
assets, localization, health, testing metadata
```

It cannot add Payload collections/globals/hooks, native host routes, host process services, host React modules, unrestricted SQL, direct database credentials, Docker access, inherited environment values, or raw network.

### Theme Skin

A live-installable data-only visual artifact containing bounded tokens, palettes, recipes, scoped CSS, approved content-addressed assets, and data-only profile transformations. Full executable `theme.*` code remains a Platform Plugin.

## Artifact format

Official catalog entries point to immutable GitHub Release assets or an equivalent protected artifact store. Runtime never clones a moving branch.

A Hot Application bundle contains:

```text
k-nex.app-bundle.json
server/*.mjs              prebuilt self-contained logic bundles
ui/*.mjs                  prebuilt remote-UI bundles
assets/*                  bounded immutable assets
schemas/*                 JSON Schema only
sbom.cdx.json
provenance/attestation reference
```

The manifest binds exact identity/version, runtime ABI, artifact/file digests, entrypoints, permissions/capabilities, isolation profiles, network/secret references, storage quotas/schemas, routes/navigation/settings/templates, resource budgets, and lifecycle compatibility.

Dependencies are bundled at publication. Customer activation runs no package manager or lifecycle script.

## Official catalog trust

The official catalog is a signed, versioned index. An entry binds publisher, source repository/commit, immutable release asset, manifest/artifact/SBOM digests, hosted-build provenance, compatibility, support, revocation, permissions/capabilities, and resource/security impact.

Verification covers catalog trust, digest/provenance, closed manifests, secure archive extraction, entrypoint inventory, forbidden imports, capability requests, budgets, downgrade, and support/revocation before staging.

## PluginManager architecture

`PluginManager` is a stable orchestration façade, not a god service or generic package executor:

```ts
interface PluginManager {
  plan(request: ExtensionChangeRequest): Promise<ExtensionPlan>
  stage(planId: string): Promise<StagedExtension>
  validate(stageId: string): Promise<ValidationReport>
  activate(stageId: string, expectedRevision: number): Promise<ActivationReceipt>
  rollback(activationId: string, expectedRevision: number): Promise<ActivationReceipt>
  disable(extensionId: string, expectedRevision: number): Promise<void>
  uninstall(extensionId: string, expectedRevision: number): Promise<void>
}
```

It delegates to:

```text
CatalogClient
ArtifactFetcher / ArtifactVerifier / ContentAddressedArtifactStore
ExtensionPlanner / RuntimeExtensionStore
HotApplicationSandboxSupervisor
RemoteUiIsolationHost / RuntimeExtensionRegistry
MigrationCoordinator / WorkerGenerationCoordinator
StaticCompositionChangeAuthority / TrustedApplicationBuilder
DeploymentSupervisor / TrafficRouter
AuthorizationHook / Audit / Outbox / Observability / Inventory
```

The main application never receives customer source-repository write credentials, builder/image-publish authority, Docker socket, or registry credentials.

## Hot Application live install

```text
operator requests app@version
→ catalog and authorization check
→ deterministic impact plan
→ background content-addressed download
→ signature/provenance/SBOM/manifest verification
→ static bundle inspection and quota checks
→ stage server/UI/storage generation
→ start isolated server sandbox with no traffic
→ create credentialless remote-UI generation
→ run bounded install validation/health
→ prepare metadata/storage transaction
→ atomically commit active generation pointer + revision + receipt + audit + outbox
→ browser/process registries refetch
→ new navigation/screens become visible
```

Failure before activation quarantines/deletes the staged generation and does not affect the active one.

## Atomic update and rollback

```text
active generation N
staged generation N+1
→ validate/warm N+1
→ atomically commit pointer N → N+1
→ new calls/sessions use N+1
→ drain in-flight N work
→ retain N and its compatible data window for rollback
```

UI, server logic, storage metadata, and assets are generation-pinned. Cross-generation calls/messages fail. Rollback restores only a declared compatible generation; irreversible data state closes rollback explicitly.

## Production server sandbox

Production Hot Application logic runs in an OS/container sandbox per app generation or an independently reviewed equivalent. A same-user child process is development/test-only.

Minimum boundary:

```text
separate process/mount/user/network authority
unique non-root workload identity
read-only root and code; bounded tmpfs/temp
no host mounts, runtime/Docker socket, DB credential, or host secret
all capabilities dropped; no-new-privileges
reviewed syscall/MAC policy
cgroup CPU/memory/process/file limits
raw egress denied; reviewed calls use host-owned policy adapter
short-lived generation/actor/delegation token
structured schema-validated RPC only
termination/quarantine on timeout, OOM, protocol, or policy violation
```

App generations cannot read another app/generation's memory, files, tokens, temporary state, logs, or responses.

## Host API and app storage

A Hot Application receives neither `req.payload` nor a generic service locator. It calls versioned capabilities such as registered source/action gateways, namespaced app storage, scoped file handles, declared events/schedules, secret-reference resolution, policy-owned HTTP fetch, and structured audit.

Every host call binds active app generation, principal/effective actor/delegation, permission/record/field policy, surface/audience, budget, storage/network/secret scope, correlation, and audit identity.

Initial storage is platform-owned namespaced document/KV with closed schemas, optimistic revisions, quotas, bounded indexes/query controls, backup/restore, and cross-app denial. Dynamic custom relational schema is deferred.

## Credentialless remote UI

A Web Worker alone is not sufficient because lack of DOM does not automatically remove network, storage, or host-origin credential authority.

The accepted production shape is:

```text
verified generation-pinned UI bytes
→ opaque-origin sandbox or dedicated credentialless extension origin
→ strict CSP/content/integrity policy
→ Web Worker/equivalent isolated execution realm
→ transferred MessagePort to K-Nex host
→ allowlisted remote component/event protocol
```

The realm has no customer cookies/tokens, local/session storage, IndexedDB/cache authority, ambient network, Service Worker/SharedWorker, popup, top navigation, downloads, host imports, or arbitrary nested execution. `connect-src` is denied. Network/data operations are requested through the bounded host channel and server capability gateway.

The host validates generation, sequence, replay, schema, size, depth, rate, actor/session, component, prop, event, route, source, action, and asset identity. The host owns actual React/K-Nex components, DOM, focus, accessibility, routing, theme, transport, authorization, and sensitive-state clearing.

Fixed routes such as `/apps/:appId/*` exist before installation; no runtime Next/Payload route injection occurs.

## Theme Skin activation

Theme Skins use stage/verify/activate pointer semantics. CSS is AST-parsed/scoped; remote imports and unrestricted URLs are rejected; assets are rewritten to approved content-addressed handles; token/property/rule/byte/complexity and accessibility checks run before activation.

A full executable Theme Package follows Platform Plugin delivery.

## Static Platform Plugin source and build authority

A Platform Plugin can feel one-click in the panel, but the authoritative operation remains a static customer application change:

```text
select exact plugin release
→ verify expected customer base source commit/graph
→ deterministically update k-nex.app.json/package inputs
→ resolve exact lock, package closure, graph, registries, migrations
→ write auditable target source commit/change record
→ run full gates
→ trusted builder emits customer-specific application bundle/image
→ sign source commit, builder/workflow, lock/graph, SBOM, package closure, bundle/image digest
→ DeploymentSupervisor accepts only that issued candidate
```

Live database state cannot invent the Platform Plugin graph. Arbitrary tags, images, uncommitted manifests, and self-asserted inventory are rejected. A configured self-hosted builder is allowed only when its trusted identity and full materials are bound in signed evidence; Gate 8 hosted evidence remains valid rather than weakened.

## Migration compatibility and rollback

Every step is one of:

```text
online-expand
  additive state usable by old and new binaries

online-backfill
  resumable/checkpointed/idempotent work safe during overlap

post-retirement-contract
  removal/tightening only after old generation and rollback window retire

offline-required
  explicit maintenance; no zero-downtime claim
```

Old and new binaries must pass concurrently against expanded state. Readiness and receipts bind the exact migration compatibility window. Contract cleanup cannot execute while rollback remains open.

## Worker generation fencing

Green workers may start for health in passive mode but cannot claim jobs, outbox effects, schedules, or integrations before persisted activation.

A PostgreSQL-backed `WorkerGenerationFence` binds application/environment, active execution generation, monotonic fencing token, lease owner/expiry, and promotion revision. Every claim/completion/checkpoint carries the current token; stale blue owners cannot claim or complete after transfer. Idempotency remains required but does not replace fencing.

## Zero-downtime Platform Plugin delivery

```text
stable gateway/reverse proxy
blue web/active-worker generation serves
separate source/build/deployment authority prepares green
verify source/application/image provenance and inventory
run online-expand under advisory lock
start green web and passive green worker with no traffic/effects
warm and run readiness/authenticated/public smoke
transfer persisted worker fencing token
atomically promote gateway to green
reconnect/resync realtime and drain old work
emit deployment receipt
retain compatible rollback generation/window
later permit contract cleanup only after rollback closes
```

Docker Compose alone is not a zero-downtime orchestrator. The reference uses a separate least-privileged supervisor plus gateway or an accepted orchestrator. Web/admin receives no source-write, build, image-publish, or Docker authority.

Zero downtime is accepted only when old/new binaries can overlap, migrations are compatible, target source/build/inventory is exact, worker ownership is fenced, realtime converges, and continuous external probes record no unavailable interval. Otherwise the operation is `maintenance-required` or unsupported.

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

Platform Plugin plans also expose source-change/build-attestation, migration phase, rollback-window, contract-cleanup, traffic-generation, and worker-fence state. Every transition is revision-checked, idempotent, audited, and observable.

## Security and failure principles

- Fail closed on signature, digest, compatibility, isolation, capability, source/build, migration, fence, or health mismatch.
- Never execute production install scripts or import downloaded code into host.
- Never expose source-repository, builder, Docker, raw database, host-secret, or ambient browser-origin authority to app/web code.
- Activation is one generation pointer/revision transaction; platform promotion uses exact source/build/traffic/fence receipts.
- Lost invalidations converge through revision polling.
- Runner/remote UI failure remains app-local.
- Rollback retains exact prior artifacts, source/image identity, migration window, metadata, and receipts.
- Backup/restore includes active pointers, app storage, settings, permissions, artifacts, source/build references, worker fence, and deployment/activation receipts.

## Product experience

```text
Install live             Hot Application / Theme Skin
Install with live deploy Platform Plugin when overlap-safe
Requires maintenance     offline/incompatible migration/topology
```

The UI shows delivery class, requested permissions/capabilities, data/network access, isolation profiles, static source/build impact, migration phases, rollback limits, worker fence, and availability eligibility before approval.

## Non-goals for Gate 9

```text
arbitrary NPM package execution
host-process dependency injection
hot addition of Payload collections/hooks
same-origin credential-bearing remote UI
same-user child process as production sandbox
runtime DB-authored Platform Plugin graph
arbitrary target image/tag or self-asserted build evidence
public third-party marketplace governance
general dynamic relational ORM
native remote React component execution in host
claiming every migration is zero downtime
```

## Required proof

```text
signed bundle download and tamper/revocation rejection
no package manager/install script in production activation
per-generation server sandbox and host/cross-app escape denial
credentialless remote UI and authenticated-fetch/storage/network denial
MessagePort protocol/generation/replay bounds
atomic app/skin activate/update/rollback with concurrent requests
multi-web/worker/runner/browser revision convergence
hot Theme Skin activation
exact customer source commit → lock/graph → signed app/image evidence
real old/new Postgres overlap across migration classes
worker fencing and one logical side effect
continuous-traffic Docker blue/green Platform Plugin promotion
maintenance-required refusal for incompatible/offline migration
rollback-window and post-retirement contract enforcement
backup/restore and exact combined runtime inventory
```