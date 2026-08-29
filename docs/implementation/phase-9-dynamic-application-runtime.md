# Detailed Implementation Plan — Phase 9 Dynamic Application Runtime and Zero-Downtime Delivery

- **Status:** accepted, review-hardened execution plan
- **Entry:** Gate 8 accepted on `main`
- **Architecture decisions:** [`ADR-0021`](../adr/0021-dynamic-application-runtime-and-zero-downtime-delivery.md), [`ADR-0023`](../adr/0023-phase-9-production-isolation-and-static-delivery-hardening.md)
- **Architecture detail:** [`../35-dynamic-applications-and-zero-downtime-delivery.md`](../35-dynamic-applications-and-zero-downtime-delivery.md)
- **Mandatory review record:** [`phase-9-plan-review-hardening.md`](./phase-9-plan-review-hardening.md)
- **Purpose:** support background download, validation, live app/skin activation, and no-outage full-plugin delivery without weakening static Payload composition
- **Deployment assumption:** Docker/container-first customer application with PostgreSQL, a stable gateway, isolated extension runner, and separate deployment/build authority
- **Reference:** `module.sales` remains the full Platform Plugin; one bounded Sales-based test Hot Application and one Theme Skin prove infrastructure without becoming new domain products
- **Next phase:** Phase 10 RBAC, authorization, and role-template bootstrap

## 1. Phase decision

Phase 9 introduces three explicit extension delivery classes:

```text
Platform Plugin
  existing full K-Nex package
  static Payload/host composition
  customer source/lock/graph change
  compatible blue/green release

Hot Application Bundle
  signed prebuilt bundle
  per-generation isolated server sandbox
  credentialless remote UI realm
  live install/update/rollback

Theme Skin Bundle
  declarative tokens/recipes/scoped CSS/assets
  live install/update/rollback
```

The user-facing term may remain “plugin,” but plan, API, receipt, audit, and inventory expose the exact `ExtensionDeliveryClass`.

### Accepted interpretation of hot reload

```text
accepted
  stage a new immutable generation
  warm and validate beside the active generation
  atomically switch an active pointer or traffic target
  drain and retain the previous compatible generation for rollback

rejected
  mutate host node_modules
  run pnpm/npm install scripts in the web/worker container
  import downloaded code into the main Payload/Next process
  patch a frozen registry in place
  treat a same-user child process as a production sandbox
  expose host-origin credentials/network to remote UI
  synthesize the Platform Plugin graph from runtime database state
  promise unload of arbitrary host modules
```

## 2. Gate-wide invariants

1. Existing `PluginManifest.kind` and Platform Plugin behavior remain static/release-composed.
2. `ExtensionDeliveryClass` is a separate discriminator: `platform-plugin | hot-application | theme-skin`; it never overloads `PluginManifest.kind`.
3. Hot Application and Theme Skin use separate closed manifests and identity grammars.
4. Downloaded server code never executes in the host web/worker process.
5. Production app code runs in an enforceable OS/container sandbox per generation; child-process-only isolation is development/test scope.
6. Remote UI receives no customer cookies/tokens, browser storage, ambient network, DOM, or host module authority and communicates only through a bounded transferred host channel.
7. Production bundles are prebuilt and self-contained; no install script or package manager runs during activation.
8. Activation/update/rollback is immutable-generation based and expected-revision checked.
9. Multi-process state converges through PostgreSQL, transactional outbox, and revision polling.
10. A Platform Plugin change starts from an expected customer source commit and produces exact target manifest/lock/graph/migrations plus signed customer-specific application/image evidence.
11. Full-plugin no-outage delivery uses a separate source/build/deployment authority and gateway; the admin application owns none of those credentials or sockets.
12. Migration compatibility is closed: `online-expand`, `online-backfill`, `post-retirement-contract`, or `offline-required`.
13. Contract/destructive work never runs while an old generation or rollback window remains; incompatible work returns `maintenance-required`.
14. Green workers start passive; PostgreSQL-backed monotonic fencing transfers correctness-relevant job/outbox/schedule ownership.
15. Phase 9 exposes a narrow operator/automation API with an injected authorization hook. It does not invent temporary role labels before Phase 10.
16. The official GitHub catalog is signed immutable release metadata, not arbitrary branch cloning.
17. Every accepted artifact, source commit, migration window, worker generation, active pointer, traffic target, and receipt appears in protected inventory and backup/restore evidence.

## 3. Target topology

```text
stable edge/gateway
  ├─ blue/green K-Nex web generations
  ├─ fixed /apps/:appId/* host routes
  └─ verified credentialless remote-UI asset/isolation host

K-Nex web
  ├─ PluginManager API
  ├─ RuntimeExtensionRegistry
  ├─ remote-component host
  └─ host capability gateway

K-Nex worker generations
  ├─ passive warm-up mode
  ├─ PostgreSQL WorkerGenerationFence
  └─ outbox/jobs/schedules under active fencing token

per-generation extension sandbox
  ├─ isolated app code/process/container
  ├─ no host/database/Docker credentials
  └─ structured capability RPC only

PostgreSQL
  ├─ extension install/activation records
  ├─ app metadata/settings/storage
  ├─ revisions, receipts, outbox
  └─ active worker generation/fencing token

content-addressed artifact store
  └─ verified catalog bundles and retained prior generations

StaticCompositionChangeAuthority / trusted builder
  ├─ expected customer source commit
  ├─ exact target manifest/lock/graph/migrations
  └─ signed application bundle/image evidence

separate DeploymentSupervisor
  ├─ restricted source/build/pull/deploy authority
  ├─ migration orchestration
  └─ gateway blue/green promotion
```

## 4. Task order

### P9.1 — Freeze delivery classes, manifests, isolation, build, migration, and fencing contracts

Deliver machine-readable authoring sources and generated schemas for:

```text
ExtensionDeliveryClass = platform-plugin | hot-application | theme-skin
HotApplicationIdSchema (`app.*`)
ThemeSkinIdSchema (`skin.*`)
HotApplicationManifestSchema
ThemeSkinManifestSchema
ExtensionBundleManifestSchema
ExtensionCapabilityRequestSchema
ExtensionResourceBudgetSchema
RemoteUiIsolationProfile
RunnerIsolationProfile
StaticCompositionChangePlan
TrustedApplicationBuildEvidence
MigrationCompatibilityPlan
WorkerGenerationFence
ExtensionInstallPlan/Receipt schemas
ExtensionGeneration and lifecycle-state schemas
ZeroDowntimeEligibility result
```

The Hot Application manifest may declare only bounded runtime surfaces accepted by the architecture. Platform Plugins continue using the existing plugin manifest and plugin-kind taxonomy.

Acceptance:

- Zod/AJV parity and deterministic schema generation;
- closed objects, canonical IDs, exact versions, bounded arrays/bytes/paths;
- delivery class cannot collide with or replace `PluginManifest.kind`;
- host schema/routes/services are impossible to declare in a hot manifest;
- no arbitrary package/import specifier inside runtime entrypoints;
- Theme Skin cannot contain JavaScript entrypoints or primitive overrides;
- isolation profiles cannot select same-origin credential-bearing UI or same-user child-process production execution;
- static Platform Plugin change requires expected base/target source and build subjects;
- migration plan accepts only the four closed classes and records rollback-window state;
- worker fence requires monotonic token, owner/generation, lease, and promotion revision;
- fixtures distinguish Hot Application, Skin, and Platform Plugin;
- obsolete “all plugins install the same way” APIs are removed pre-v1.

Kill/rework:

- classes cannot be distinguished without ambiguous runtime behavior;
- useful hot functionality requires host Payload config mutation;
- bundle contracts require third-party runtime types as K-Nex persisted contracts;
- secure browser/server isolation cannot be expressed as enforceable data/host requirements.

### P9.2 — Signed bundle builder, official catalog, and verifier

Deliver:

```text
@k-nex/extension-bundler or a real existing-package boundary
prebuilt server/UI bundle generation
forbidden-import/static inventory inspection
content/file digest manifest
CycloneDX SBOM
hosted-build provenance input/output contract
signed official catalog index fixture
CatalogClient and ArtifactVerifier
secure archive extraction
content-addressed staging store
```

Publication, not customer activation, resolves and bundles dependencies. Catalog fixtures model immutable GitHub Release assets, publisher/root trust, compatibility, support, and revocation.

Acceptance:

- same source inputs produce byte-identical normalized bundle payloads;
- path traversal, absolute paths, symlink/hardlink escape, case collision, duplicate file, special device, decompression bomb, file-count/size/depth overflow fail;
- mismatched catalog signature, artifact/file/manifest/SBOM/provenance digest, publisher, source, version, ABI, support, downgrade, or revocation fails;
- package lifecycle scripts are neither represented nor executed;
- forbidden built-in/module imports fail static inspection and runtime isolation remains authoritative;
- content-addressed duplicate download is idempotent;
- staged artifacts are never served or executed before verification.

Kill/rework:

- trustworthy bundle verification depends on running package code;
- dependencies cannot be made self-contained within accepted limits;
- immutable catalog/release identity cannot be bound to artifact and provenance.

### P9.3 — Persistent PluginManager state machine, operation authority, and static-change delegation

Deliver:

```text
PluginManager façade
CatalogClient
ArtifactFetcher / ArtifactStore
ExtensionPlanner
RuntimeExtensionStore
transition/lease/idempotency coordinator
operation authorizer interface
StaticCompositionChangeAuthority client
trusted build/deployment request client
audit/outbox integration
protected runtime inventory
```

Canonical runtime states:

```text
catalog-available → planning → downloading → verified → staged
→ waiting-configuration/approval → warming → active
disabled | update-available | rollback-available | quarantined
→ retirement-pending → removed
```

Platform Plugin plans additionally track:

```text
source-change-required
source-change-ready
build-attested
zero-downtime-eligible | maintenance-required | unsupported
rollback-window-open | rollback-window-closed
contract-cleanup-eligible
```

The Phase 9 operator adapter is an explicit trusted automation identity or fixture-owned authorizer. No role-name, header, localhost, or environment-string bypass may become production authority. Phase 10 wires this boundary to RBAC.

Acceptance:

- every transition has expected revision, operation ID, actor/automation identity, source/artifact/generation identity, receipt, and audit;
- duplicate/replayed requests are idempotent;
- concurrent install/update/uninstall of the same extension is serialized;
- different extensions can stage concurrently within global budgets;
- process crash at every transition resumes or rolls back deterministically;
- web and worker observe one active runtime generation;
- direct database state forgery cannot mint verified/staged/active authority;
- Platform Plugin database state cannot replace the expected source commit/change/build chain;
- manager is a thin orchestrator and specialized services remain independently tested.

### P9.4 — Production per-generation server sandbox and capability-scoped host API

Deliver:

```text
k-nex-extension-runner reference service
per-app/per-generation sandbox supervisor
structured invocation protocol
short-lived app/generation/actor identity
host capability gateway
appStorage document/KV service
secret-reference resolver
bounded network policy adapter
CPU/memory/process/file/time/input/output/log/concurrency limits
runner health and quarantine
```

Development may include a clearly labeled local child-process adapter. Gate 9 production evidence requires a separate OS/container sandbox per app generation or an independently reviewed equivalent.

Minimum production profile:

```text
separate process/mount/user/network authority
unique non-root workload identity
read-only root and generation code
bounded tmpfs/temp only
no host mounts, runtime socket, Docker socket, DB URL, or host secret
all capabilities dropped and no-new-privileges
reviewed syscall/MAC policy
cgroup resource limits
raw egress denied; approved network through host policy adapter
structured schema-validated RPC only
```

Acceptance:

- app code has no host `process.env`, Docker socket, DB URL, filesystem outside sandbox roots, host module graph, raw listener, or raw network;
- only declared capabilities are callable;
- app storage is namespaced, schema-validated, quota-limited, revisioned, backed up, and cross-app isolated;
- secret values never enter manifest, logs, receipts, events, storage, or browser;
- timeout/OOM/crash/malformed IPC affects only the invocation/generation;
- compromised app fixture cannot invoke undeclared capability or read another app/generation's memory/files/tokens/responses;
- old generation drains and terminates without killing host traffic.

Kill/rework:

- runner requires ambient host/database authority;
- crashed/compromised app can affect host or another app generation;
- production isolation is only TypeScript, Node permission flags, or same-user process convention.

### P9.5 — Credentialless remote UI realm and fixed host surfaces

Deliver:

```text
K-Nex remote-component wire contract
opaque-origin sandbox or dedicated credentialless extension origin
Web Worker/equivalent isolated UI loader
strict CSP/content/CORS/CORP/integrity policy
transferred MessagePort host channel
allowlisted component/event/property registry
fixed /apps/:appId/* route host
navigation and extension-slot resolution
remote data/action bridge through standard gateways
content-addressed generation-pinned asset serving
accessibility/focus/error boundaries
```

Evaluate Remote DOM or an equivalent library behind a K-Nex adapter. A same-origin worker alone is rejected.

Acceptance:

- realm has no customer cookies/tokens, local/session storage, IndexedDB/cache authority, ambient network, direct DOM, popup, top navigation, download, Service Worker/SharedWorker, or host dynamic import;
- host interaction is only the bounded transferred channel;
- every frame is schema-, generation-, sequence-, replay-, size-, depth-, rate-, and authorization-checked;
- unknown component/event/prop/source/action/route/asset is rejected;
- host owns semantic components, keyboard/focus, theme, routing, source/action transport, and authorization;
- fixed route handles install without Next rebuild;
- UI/server/storage generation identities cannot mix;
- update swaps new sessions to the new generation and bounded old work drains;
- realm crash/malformed tree displays safe app-local fallback and leaves no background authority;
- real Chromium credentialed-fetch/storage/network/import/navigation and accessibility attacks fail.

Kill/rework:

- useful UI requires executing app React code in the host realm;
- remote realm retains ambient host credentials/network/storage;
- protocol cannot preserve accessibility or bounded events;
- selected library demands an unstable third-party persisted contract.

### P9.6 — Atomic activation, update, rollback, and convergence

Deliver:

```text
ExtensionGenerationStore
active generation pointer
staged metadata/storage transaction
warm-up/readiness coordinator
in-flight drain leases
rollback window and compatible migration record
outbox invalidation
web/worker/runner/browser revision convergence
backup/restore support
```

Activation transaction:

```text
compare expected install revision
verify staged server/UI/storage generation and health lease
apply bounded metadata/settings/storage changes
switch active generation pointer
advance runtime-extension revision
write receipt, audit, and outbox
commit
```

Acceptance:

- no request sees a half-activated or mixed UI/server/storage generation;
- concurrent traffic observes old or new generation only;
- crash before commit leaves old active; crash after commit converges to new;
- rollback atomically restores a compatible prior generation;
- rollback receipt binds its migration/data compatibility window;
- irreversible state blocks rollback with an explicit decision;
- lost invalidation converges by revision polling;
- restored database/artifact store reproduces exact active/rollback generation inventory.

### P9.7 — Live Theme Skin bundles

Deliver:

```text
ThemeSkin resolver and registry
strict token/palette/recipe schemas
scoped CSS parser/rewriter
content-addressed asset policy
skin generation activation/rollback
profile compatibility and preview
browser accessibility/visual checks
```

Acceptance:

- install/update/rollback requires no host restart;
- no JavaScript/WASM, remote import, unrestricted URL/font, global selector, primitive implementation, secret, or network reference enters a skin;
- same UI document renders under old/new skin without mutation;
- active profile update is atomic and draft-safe;
- bad contrast/focus/motion/forced-colors fixtures fail according to accepted target;
- full executable `theme.*` package is routed to Platform Plugin delivery.

### P9.8 — Static source/build authority and zero-downtime Platform Plugin delivery

Deliver contracts and a real Docker reference proof for:

```text
StaticCompositionChangeAuthority
expected base/target customer source commit
exact target manifest, lock, package closure, graph, registries, migrations
TrustedApplicationBuildEvidence
DeploymentSupervisor interface
Build/Artifact provider
MigrationCompatibilityPlan
blue/green host generation identity
WorkerGenerationFence and passive worker mode
GatewayTrafficRouter
readiness and warm-up
worker transfer/drain order
realtime reconnect/resync
promotion/rollback receipt
maintenance-required result
```

Required flow:

```text
select exact official Platform Plugin release
→ verify expected customer base commit/graph
→ create deterministic source change and auditable commit
→ resolve exact lock/graph/registries/migrations
→ run gates and build customer-specific application bundle/image
→ sign source/build/package/SBOM/application/image evidence
→ run online-expand under advisory lock when eligible
→ start green web and passive green worker with zero traffic/effects
→ warm/readiness/authenticated/public smoke
→ transfer persisted worker fencing token
→ atomically promote gateway target
→ drain blue requests/work/sockets
→ retain compatible rollback generation/window
→ emit deployment receipt
→ permit post-retirement-contract only after rollback deliberately closes
```

The source/build/deployment implementation is a separate least-privileged service/agent. It may use GitHub-hosted builds, an explicitly configured self-hosted trusted builder, Docker Engine behind a restricted adapter, or an accepted orchestrator. The web/admin process receives only a change-request API.

Acceptance:

- target starts from the exact expected customer source commit; concurrent source changes fail rather than overwrite;
- package/image is built from exact lock/resolved graph and verified application provenance;
- self-hosted build evidence binds trusted builder identity and is not self-asserted runtime state;
- blue keeps serving throughout source/build/start/warm;
- old/new binaries run concurrently against `online-expand` schema;
- `online-backfill` is bounded, resumable, checkpointed, and overlap-safe;
- traffic changes only after target readiness and source/build/migration/inventory reconciliation;
- continuous external HTTP probes record no unavailable interval during compatible install/update/rollback;
- green worker cannot claim effects before fence transfer;
- stale blue claim/completion fails after transfer, while idempotency prevents replay duplication;
- crash during fence transfer recovers from PostgreSQL authority;
- in-flight requests/jobs drain safely and one logical external effect occurs;
- socket clients reconnect and resync;
- `post-retirement-contract` cannot execute while rollback is open;
- incompatible/offline migration returns `maintenance-required` and does not attempt promotion;
- application process cannot write customer source, build images, or access Docker;
- failed green never changes blue traffic.

Kill/rework:

- continuous availability requires source/build/Docker authority in the web process;
- target can deploy without source commit and trusted customer-application evidence;
- static plugin promotion can serve an artifact/schema mismatch;
- workers cannot overlap/fence safely;
- migration classes cannot state rollback truth.

### P9.9 — Unified manager API, status experience, and attack corpus

Deliver a headless/operator API and minimal system status surface sufficient to exercise the manager before full RBAC/admin productization:

```text
catalog list/detail
plan and impact report
install/stage/validate/activate
update/rollback/disable/uninstall
operation progress and receipts
execution class and availability guarantee
source-change/build evidence state
migration class and rollback-window state
runner/remote-UI isolation profiles
worker execution generation/fence
health/quarantine/runtime inventory
```

Every mutation uses injected operation authorization and current revision. Rich user/role administration remains Phase 10.

Acceptance journeys:

```text
Hot Application install while continuous host traffic runs
Hot Application update and rollback
runner crash/timeout/quarantine and cross-app denial
credential/network/storage remote UI attacks and recovery
Skin install/update/rollback
full plugin source change/build/blue-green install/update/rollback
worker fence transfer and stale completion denial
post-retirement contract after rollback closure
maintenance-required refusal
catalog revocation
backup/restore active generations
multi-process convergence
```

Required attacks:

```text
arbitrary repository/branch URL
unsigned/tampered/downgraded/revoked bundle
archive traversal/symlink/hardlink/collision/bomb
install script or runtime package-manager invocation
host dynamic import of downloaded code
same-origin credentialed remote UI fetch/storage/network
forbidden builtin/import/capability
host/cross-app DB/Docker/secret/network/filesystem escape
cross-app storage/token/revision reuse
staged artifact served before verification
mixed UI/server/storage generation
activation pointer race
stale operation replay
runtime DB-authored static graph
arbitrary image/tag or unsigned/self-asserted build
rollback across irreversible migration
contract cleanup while rollback open
blue/green worker duplicate claim/completion
worker/process crash during each state
false zero-downtime claim
web process source/build/Docker authority
operator authorization bypass
```

### P9.10 — Gate 9 closeout

Create:

```text
docs/implementation/phase-9-result.md
pnpm gate:9
```

Gate 9 runs all earlier gates plus:

```text
delivery/manifest/isolation/build/migration/fence schemas
bundle generation reproducibility
signed catalog and tamper corpus
real per-generation production runner sandbox and cross-app denial
real Chromium credentialless remote UI and Skin proof
real PostgreSQL activation/update/rollback/restore
real old/new migration-overlap and rollback-window proof
multi-process revision convergence
exact customer source commit → app/image attestation proof
continuous-traffic Docker blue/green proof
worker fencing and single-effect proof
maintenance-required refusal
packed-package/bundle boundary checks
```

The named gate fails if any mandatory review-hardening evidence is absent or replaced by a mock that cannot falsify the claim.

## 5. Gate decision

```text
GO PHASE 10 RBAC AND AUTHORIZATION
REWORK HOT APPLICATION OR ZERO-DOWNTIME DELIVERY
REJECT HOST-PROCESS HOT INJECTION
```

PASS means K-Nex can truthfully offer live app/skin installation and compatibility-gated no-outage full-plugin delivery while preserving customer source, provenance, migration, worker, and isolation authority. It does not yet authorize end users; Phase 10 provides RBAC and role-template administration.
