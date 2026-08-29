# Detailed Implementation Plan — Phase 9 Dynamic Application Runtime and Zero-Downtime Delivery

- **Status:** accepted execution plan
- **Entry:** Gate 8 accepted on `main`
- **Architecture decision:** [`ADR-0021`](../adr/0021-dynamic-application-runtime-and-zero-downtime-delivery.md)
- **Architecture detail:** [`../35-dynamic-applications-and-zero-downtime-delivery.md`](../35-dynamic-applications-and-zero-downtime-delivery.md)
- **Purpose:** support background download, validation, and no-outage activation without weakening static Payload composition
- **Deployment assumption:** Docker/container-first customer application
- **Reference:** `module.sales` remains the full Platform Plugin; one bounded `app.sales-assistant`-style test application proves the hot runtime without becoming a second domain product
- **Next phase:** Phase 10 RBAC, authorization, and role-template bootstrap

## 1. Phase decision

Phase 9 introduces three explicit extension delivery classes:

```text
Platform Plugin
  existing full K-Nex package
  static Payload/host composition
  zero-downtime blue/green release

Hot Application Bundle
  signed prebuilt bundle
  isolated server runner + remote UI
  live install/update/rollback

Theme Skin Bundle
  declarative tokens/recipes/scoped CSS/assets
  live install/update/rollback
```

The user-visible term may remain “plugin,” but plan, API, receipt, and UI must expose the true execution class.

### Accepted interpretation of hot reload

```text
accepted
  stage a new immutable generation
  warm and validate beside the active generation
  atomically switch an active pointer or traffic target
  drain and retain the previous generation for rollback

rejected
  mutate host node_modules
  run pnpm/npm install scripts in the web container
  import downloaded code into the main Payload/Next process
  patch a frozen registry in place
  promise unload of arbitrary host modules
```

## 2. Gate-wide invariants

1. The existing `PluginManifest` and Platform Plugin behavior remain static/release-composed.
2. Hot Application and Theme Skin use separate closed manifests and identity grammars.
3. Downloaded server code never executes in the host web/worker process.
4. The hot runtime receives no raw Payload request, database credential, Docker socket, ambient environment, or unrestricted network.
5. Production bundles are prebuilt and self-contained; no install script or package manager runs during activation.
6. Activation/update/rollback is generation-based and revision-checked.
7. Multi-process state converges through transactional outbox plus revision polling.
8. Full-plugin no-outage delivery uses an external deployment supervisor and gateway; the admin application never owns Docker authority.
9. Database compatibility is honest: incompatible destructive migrations produce `maintenance-required`.
10. Phase 9 exposes a narrow operator/automation API with an injected authorization hook. It does not invent temporary role labels before Phase 10.
11. The official GitHub catalog is source-controlled/signed release metadata, not arbitrary branch cloning.
12. Every accepted artifact appears in protected runtime inventory and backup/restore evidence.

## 3. Target topology

```text
edge/gateway
  ├─ blue/green K-Nex web generations
  └─ remote UI asset route

K-Nex web
  ├─ fixed /apps/:appId/* host routes
  ├─ PluginManager API
  ├─ RuntimeExtensionRegistry
  └─ host capability gateway

K-Nex worker
  ├─ outbox and revision convergence
  └─ extension schedules/events through fixed dispatcher

k-nex-extension-runner
  ├─ isolated app process/container generations
  └─ no host/database/Docker credentials

PostgreSQL
  ├─ extension install/activation records
  ├─ app metadata/settings/storage
  └─ revisions, receipts, outbox

content-addressed artifact store
  └─ verified catalog bundles and prior generations

separate deployment supervisor
  ├─ Docker/build/pull authority
  ├─ migration orchestration
  └─ gateway blue/green promotion
```

## 4. Task order

### P9.1 — Freeze extension classes, manifests, and kill criteria

Deliver machine-readable authoring sources and generated schemas for:

```text
ExtensionKind = platform-plugin | hot-application | theme-skin
HotApplicationIdSchema (`app.*`)
ThemeSkinIdSchema (`skin.*`)
HotApplicationManifestSchema
ThemeSkinManifestSchema
ExtensionBundleManifestSchema
ExtensionCapabilityRequestSchema
ExtensionResourceBudgetSchema
ExtensionInstallPlan/Receipt schemas
ExtensionGeneration and lifecycle-state schemas
ZeroDowntimeEligibility result
```

The Hot Application manifest may declare only the bounded runtime surfaces accepted by the architecture document. Platform Plugin continues using the existing plugin manifest.

Acceptance:

- Zod/AJV parity and deterministic schema generation;
- closed objects, canonical IDs, exact versions, bounded arrays/bytes/paths;
- host schema/routes/services are impossible to declare in a hot manifest;
- no arbitrary package name/import specifier inside runtime entrypoints;
- theme skin cannot contain JavaScript entrypoints or primitive overrides;
- fixtures distinguish hot application, skin, and Platform Plugin;
- obsolete “all plugins install the same way” APIs are removed pre-v1.

Kill/rework:

- the classes cannot be distinguished without ambiguous runtime behavior;
- useful hot functionality requires host Payload config mutation;
- bundle contracts require third-party runtime types as K-Nex persisted contracts.

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

Publication, not customer activation, resolves and bundles dependencies. The catalog fixture models immutable GitHub Release assets and publisher/revocation metadata.

Acceptance:

- same source inputs produce byte-identical normalized bundle payloads;
- tar path traversal, symlink escape, duplicate file, decompression bomb, file-count/size overflow fail;
- mismatched catalog signature, artifact digest, manifest digest, SBOM, provenance, publisher, version, ABI, or support state fail;
- package lifecycle scripts are neither represented nor executed;
- forbidden built-in/module imports fail static inspection;
- content-addressed duplicate download is idempotent;
- staged artifacts are never served or executed before verification.

Kill/rework:

- trustworthy bundle verification depends on running package code;
- dependencies cannot be made self-contained within accepted limits;
- GitHub release/catalog identity cannot be bound to immutable artifacts.

### P9.3 — Persistent PluginManager state machine and operator boundary

Deliver:

```text
PluginManager façade
CatalogClient
ArtifactFetcher
ArtifactStore
ExtensionPlanner
RuntimeExtensionStore
transition/lease/idempotency coordinator
operation authorizer interface
audit/outbox integration
protected runtime inventory
```

Canonical states:

```text
catalog-available → planning → downloading → verified → staged
→ waiting-configuration/approval → warming → active
disabled | update-available | rollback-available | quarantined
→ retirement-pending → removed
```

The Phase 9 operator adapter is an explicit trusted automation identity or fixture-owned authorizer. No role-name, header, localhost, or environment-string bypass may become production authority. Phase 10 replaces/wires this boundary to RBAC.

Acceptance:

- every transition has expected revision, operation ID, actor, artifact/generation identity, receipt, and audit;
- duplicate/replayed requests are idempotent;
- concurrent install/update/uninstall of the same extension is serialized;
- different extensions can stage concurrently within global budgets;
- process crash at every transition resumes or rolls back deterministically;
- web and worker observe one active generation;
- direct database state forgery cannot create verified/active authority.

### P9.4 — Isolated server runner and capability-scoped host API

Deliver:

```text
k-nex-extension-runner reference service
runner generation supervisor
structured invocation protocol
short-lived app-service identity
host capability gateway
appStorage document/KV service
secret-reference resolver
bounded network adapter
CPU/memory/time/input/output/log/concurrency limits
runner health and quarantine
```

A process runner may be the first local adapter, but the security contract is designed for a separate container/service. Node permission flags are defense in depth only.

Acceptance:

- app code has no host `process.env`, Docker socket, DB URL, filesystem outside its generation/temp root, host module graph, or raw network;
- only declared capabilities are callable;
- app storage is namespaced, schema-validated, quota-limited, revisioned, backed up, and cross-app isolated;
- secret values never enter manifest, logs, receipts, events, or browser;
- timeout/OOM/crash/malformed IPC affects only the invocation/generation;
- runner compromise fixture cannot invoke undeclared host capability;
- old generation drains and terminates without killing host traffic.

Kill/rework:

- the runner requires ambient host/database authority;
- a crashed app can crash or permanently stall K-Nex;
- capability isolation is only TypeScript-level rather than runtime enforced.

### P9.5 — Remote UI worker and fixed host surfaces

Deliver:

```text
K-Nex remote-component wire contract
Web Worker loader
allowlisted component/event/property registry
fixed /apps/:appId/* route host
navigation and extension-slot resolution
remote data/action bridge through standard gateways
content-addressed/SRI asset serving
CSP and generation pinning
accessibility/focus/error boundaries
```

Evaluate Remote DOM or an equivalent library behind a K-Nex adapter. The kill-spike decides whether it reduces complexity without leaking its protocol into persisted K-Nex contracts.

Acceptance:

- worker has no direct DOM, cookie, localStorage, host dynamic import, or arbitrary URL authority;
- unknown component/event/prop is rejected;
- host owns semantic components, keyboard/focus, theme, routing, and authorization;
- fixed route handles install without Next rebuild;
- multiple app generations do not mix UI/server assets;
- update swaps new sessions to the new generation and lets existing bounded work drain;
- worker crash/malformed tree displays safe app-local fallback;
- real Chromium keyboard, focus, CSP, hydration/host, and accessibility journeys pass.

Kill/rework:

- useful UI requires executing app React code in the host realm;
- remote protocol cannot preserve accessibility or bounded events;
- the library demands an unstable third-party persisted contract.

### P9.6 — Atomic activation, update, rollback, and convergence

Deliver:

```text
ExtensionGenerationStore
active-generation pointer
staged metadata transaction
warm-up/readiness coordinator
in-flight drain leases
rollback window and compatibility record
outbox invalidation
web/worker/runner/browser revision convergence
backup/restore support
```

Activation transaction:

```text
compare expected install revision
verify staged generation and health lease
apply bounded metadata/settings/storage changes
switch active generation pointer
advance runtime-extension revision
write receipt, audit, and outbox
commit
```

Acceptance:

- no request sees a half-activated generation;
- concurrent traffic observes old or new, never mixed artifacts/metadata;
- crash before commit leaves old active; crash after commit converges to new;
- rollback atomically restores a compatible prior generation;
- irreversible migration blocks rollback with an explicit decision;
- lost invalidation converges by revision polling;
- restored database/artifact store reproduces exact active generation inventory.

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
- no JavaScript, remote import, unrestricted URL/font, global selector, or primitive implementation enters a skin;
- same UI document renders under old/new skin without mutation;
- active profile update is atomic and draft-safe;
- bad contrast/focus/motion/forced-colors fixtures fail according to accepted target;
- full executable `theme.*` package is routed to Platform Plugin delivery.

### P9.8 — Zero-downtime Platform Plugin deployment strategy

Deliver contracts and a real Docker reference proof for:

```text
DeploymentSupervisor interface
Build/Artifact provider
MigrationCompatibilityPlan
blue/green generation identity
GatewayTrafficRouter
readiness and warm-up
worker lease/drain order
realtime reconnect/resync
promotion/rollback receipt
maintenance-required result
```

The reference supervisor is a separate least-privileged service/agent. It may use Docker Engine behind an adapter or a supported Docker orchestrator. The web application receives only a change-request API.

Acceptance:

- target image is built/pulled from exact lock/resolved graph and verified provenance;
- blue keeps serving throughout green build/start/warm;
- expand migration runs under existing advisory lock/revision fence;
- traffic changes only after target readiness and inventory reconciliation;
- continuous external HTTP probes record no unavailable interval during compatible install/update/rollback;
- in-flight requests/jobs drain safely and duplicate effects do not occur;
- socket clients reconnect and resync;
- incompatible/destructive migration returns `maintenance-required` and does not attempt false zero-downtime promotion;
- application process cannot access Docker socket;
- failed green never changes blue traffic.

Kill/rework:

- continuous availability requires Docker authority in the web process;
- static plugin promotion can serve an artifact/schema mismatch;
- workers cannot overlap safely during supported updates.

### P9.9 — Unified manager API, status experience, and attack corpus

Deliver a headless/operator API and minimal system status surface sufficient to exercise the manager before full RBAC/admin productization:

```text
catalog list/detail
plan and impact report
install/stage/validate/activate
update/rollback/disable/uninstall
operation progress and receipts
execution class and availability guarantee
health/quarantine/runtime inventory
```

Every mutating endpoint uses the injected operation authorizer and current revision. The rich user/role-facing administration UI remains Phase 10/11 work.

Acceptance journeys:

```text
hot app install while continuous traffic runs
hot app update and rollback
runner crash/timeout/quarantine
remote UI crash and recovery
skin install/update/rollback
full plugin blue/green install/update/rollback
maintenance-required refusal
catalog revocation
backup/restore active generations
multi-process convergence
```

Required attacks:

```text
arbitrary repository/branch URL
unsigned/tampered/downgraded/revoked bundle
archive traversal/symlink/decompression bomb
install script or runtime package-manager invocation
host dynamic import of downloaded code
forbidden builtin/import/capability
DB/Docker/secret/network escape
cross-app storage/token/revision reuse
staged artifact served before verification
mixed UI/server generation
activation pointer race
stale operation replay
rollback across irreversible migration
worker/process crash during each state
false zero-downtime claim
web process Docker socket access
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
bundle contract/generation reproducibility
signed catalog and tamper corpus
real isolated runner proof
real Chromium remote UI and skin proof
real PostgreSQL activation/update/rollback/restore
multi-process revision convergence
continuous-traffic Docker blue/green proof
maintenance-required refusal
packed-package/bundle boundary checks
```

## 5. Gate decision

```text
GO PHASE 10 RBAC AND AUTHORIZATION
REWORK HOT APPLICATION OR ZERO-DOWNTIME DELIVERY
REJECT HOST-PROCESS HOT INJECTION
```

PASS means K-Nex can truthfully offer both live app installation and no-outage full-plugin delivery. It does not yet authorize end users to perform those operations; Phase 10 provides RBAC and plugin role-template integration.
