# Phase 9 Project-Manager Review Hardening

- **Status:** mandatory execution addendum
- **Review date:** 2026-08-29
- **Applies to:** Phase 9 — Dynamic Application Runtime and Zero-Downtime Delivery
- **Architecture authority:** [`ADR-0023`](../adr/0023-phase-9-production-isolation-and-static-delivery-hardening.md)
- **Precedence:** this addendum clarifies the Phase 9 plan and closes security/delivery ambiguities before P9.1; where wording differs, ADR-0023 and this addendum govern
- **Implementation state:** design-only; no Gate 9 evidence exists yet

## 1. Review verdict

The two-path roadmap is accepted:

```text
Hot Application / Theme Skin
  verify immutable bundle
  stage and warm isolated generation
  atomically activate without host restart

Platform Plugin
  create a new immutable static customer release
  start/warm a separate Docker generation
  atomically promote traffic when compatibility permits
```

Raw `pnpm add`, `npm install`, `node_modules` mutation, or downloaded-code `import()` inside the active Payload/Next process remains rejected.

The merged roadmap required five mandatory hardening corrections before implementation:

1. remote UI isolation must remove ambient host-origin credentials and network, not merely remove direct DOM access;
2. production server execution must use an OS/container sandbox per app generation, not a same-user child process presented as isolation;
3. a Platform Plugin change must originate from customer static desired state and produce a newly attested application bundle/image;
4. online migration phases and rollback boundaries must be explicit;
5. worker/job/outbox ownership must use an active-generation fencing lease so blue and green cannot perform duplicate effects.

## 2. Contract terminology

P9.1 uses:

```ts
type ExtensionDeliveryClass =
  | "platform-plugin"
  | "hot-application"
  | "theme-skin";
```

Do not introduce `ExtensionKind` for this purpose. `PluginManifest.kind` already identifies the Platform Plugin taxonomy (`module`, `provider`, `builder`, `theme`, `integration`, `preset`). Delivery class and plugin kind are independent concepts and must never share one ambiguous field.

P9.1 additionally freezes:

```text
RemoteUiIsolationProfile
RunnerIsolationProfile
StaticCompositionChangePlan
TrustedApplicationBuildEvidence
MigrationCompatibilityPlan
WorkerGenerationFence
ZeroDowntimeEligibility
```

## 3. Credentialless remote UI boundary

A Web Worker by itself is not a sufficient security boundary. A worker lacks direct DOM access but can normally possess network and browser-storage APIs, and a same-origin realm can attempt authenticated same-origin requests.

The accepted production boundary is:

```text
verified generation-pinned UI bytes
→ opaque-origin sandbox or dedicated credentialless extension origin
→ strict response CSP and content policy
→ one transferred MessagePort to the host
→ K-Nex remote component/event protocol only
```

Mandatory properties:

- the execution realm receives no customer application cookies, bearer tokens, local/session storage, IndexedDB/cache authority, or host-origin credentials;
- `connect-src` is denied for the extension realm; app network calls go only through the server-side bounded host capability gateway;
- Service Worker, SharedWorker, opener, top-navigation, popup, download, and nested executable-frame authority are denied;
- scripts/assets are exact generation-pinned verified bytes with strict MIME, CSP, CORS/CORP as applicable, cache, and integrity policy;
- host interaction is possible only through a transferred `MessagePort`/equivalent object controlled by the K-Nex host;
- every message is schema-validated, generation-bound, sequence/replay checked, size/rate/depth bounded, and actor/session reauthorized at the host boundary;
- unknown component, property, event, route, source, action, or asset identity fails closed;
- worker/realm termination clears ephemeral state and cannot leave background execution behind.

P9.5 must use real Chromium to attempt:

```text
credentialed same-origin fetch
cross-origin fetch
cookie and storage access
service/shared worker creation
host dynamic import
popup/top navigation/download
oversized or replayed MessagePort frames
old-generation UI calling new-generation server logic
```

Any path that exposes host credentials or authenticated APIs outside the host MessagePort is a Gate 9 blocker.

## 4. Production runner isolation

A plain child Node process under the host user is allowed only for explicitly labeled local development or bounded unit tests. It cannot satisfy the production Gate 9 isolation claim.

The production reference proof requires an OS/container sandbox for every active app generation or an independently reviewed equivalent. Minimum controls:

```text
separate PID/mount/user/network namespaces or equivalent isolation
unique non-root identity per workload/generation
read-only root; generation code read-only; bounded tmpfs only
no host filesystem, runtime socket, Docker socket, database credential, or host secret mount
all Linux capabilities dropped; no-new-privileges
reviewed seccomp plus AppArmor/SELinux profile where supported
cgroup CPU/memory/process/file/open-fd limits
egress denied by default; host-owned allowlisted proxy for approved requests
no arbitrary listener or inbound route
short-lived generation/actor capability token
structured schema-validated RPC only
forced termination/quarantine on timeout, OOM, protocol, or policy violation
```

A shared runner service must isolate app generations from one another. One compromised app cannot read another app's code, memory, temporary files, tokens, logs, or responses.

P9.4 acceptance must prove cross-app and cross-generation denial in addition to host escape denial. The runner must remain replaceable by a stronger sandbox later without changing Hot Application persisted contracts.

## 5. Static Platform Plugin change authority

A Platform Plugin installation is one-click from the product perspective, but it is not runtime-only state. The operation must preserve the customer repository as static desired-state authority.

Required flow:

```text
operator selects exact catalog plugin/version
→ PluginManager creates impact request
→ StaticCompositionChangeAuthority verifies expected base source commit
→ deterministically edits k-nex.app.json/package inputs
→ resolves exact lock, package closure, graph, registries, and migration plan
→ writes an auditable customer source commit/change record
→ trusted builder produces customer-specific application bundle and image
→ builder attests source commit, lock/graph, SBOM, image/application digest, workflow identity
→ DeploymentSupervisor accepts only the authority-issued candidate
→ migration/blue-green promotion
→ deployment receipt and observed inventory reconcile with the same source commit
```

Rules:

- live PostgreSQL state cannot synthesize or override the Platform Plugin graph;
- the deployment supervisor cannot accept an arbitrary image/tag or uncommitted manifest/lock mutation;
- exact expected base commit/graph prevents concurrent lost updates;
- rollback selects a retained previously verified source commit, application bundle, image digest, and compatible database revision;
- the web/admin process holds neither customer-repository write credentials nor builder/Docker authority;
- a self-hosted builder is permitted only as an explicit trusted build-authority adapter producing signed attestations; local self-asserted inventory is not provenance;
- existing Gate 8 hosted verification remains valid and is not silently weakened.

P9.8 must include the source/change/builder authority in its contracts and real proof. The UI may display one Install action, but receipts must expose the static source commit and immutable target application identity.

## 6. Migration phases and rollback truth

`MigrationCompatibilityPlan` is closed and classifies every database/data step:

```text
online-expand
  additive schema or compatibility state usable by old and new binaries

online-backfill
  resumable/checkpointed/idempotent work safe while overlap exists

post-retirement-contract
  removal/constraint tightening allowed only after old generation and rollback window retire

offline-required
  operation cannot preserve overlap and must use explicit maintenance
```

Zero-downtime promotion requires:

- old binaries pass against predecessor and expanded schema;
- new binaries pass against expanded schema while old writers may still run;
- event/job/source contracts are versioned for the overlap;
- no `post-retirement-contract` step executes before blue is retired and rollback is deliberately closed;
- every readiness response binds the exact compatible migration window;
- rollback is available only while the previous artifact and database/data state remain compatible.

The plan must distinguish:

```text
promotion completed
rollback window open
rollback window closed
contract cleanup eligible
maintenance required
```

Gate 9 requires a real PostgreSQL old/new overlap fixture and must reject an operation that relabels an offline or contract step as online.

## 7. Worker and side-effect generation fencing

Starting green workers for health must not create a second job/outbox/schedule owner.

Add a PostgreSQL-backed `WorkerGenerationFence`:

```text
application/environment
active execution generation
monotonic fencing token
lease owner and expiry
promotion revision
```

Rules:

- green workers boot in passive/readiness mode and cannot claim jobs, schedules, outbox effects, or integration delivery before activation;
- every claim/completion/checkpoint carries the current fencing token;
- stale blue owners cannot claim or complete after transfer;
- blue drains already-authorized work under bounded policy; irreconcilable work remains retryable/idempotent rather than silently duplicated;
- activation transfers execution authority through persisted revision/fence state, not process timing;
- crash/lost invalidation recovery reads the authoritative fence;
- realtime/socket ownership uses its separately accepted topology and reconnect/resync contract.

P9.8 must prove one effect under concurrent blue/green workers, stale completion rejection, crash during lease transfer, and recovery without traffic outage.

## 8. Task amendments

### P9.1

Use `ExtensionDeliveryClass`; add isolation, static-change/build-evidence, migration-phase, and worker-fence schemas and invalid fixtures.

### P9.3

`PluginManager` returns class-specific plan outcomes and delegates Platform Plugin source changes to `StaticCompositionChangeAuthority`. Database rows alone cannot mint verified/staged/active artifact authority.

### P9.4

Local child-process adapter is development/test-only. Production acceptance uses enforceable OS/container isolation and proves cross-app/generation separation.

### P9.5

The remote UI kill-spike includes credentialless/opaque-origin isolation, denied ambient network/storage/credentials, strict CSP, and MessagePort-only host interaction.

### P9.6

Generation activation receipts bind UI/server/storage generation together; mixed-generation messages/calls fail. Rollback state includes its compatible migration window.

### P9.8

Add exact customer source change and trusted application build evidence, closed migration phases, and worker-generation fencing to the blue/green proof.

### P9.9

Status/plan output exposes:

```text
execution class
source-change-required
zero-downtime-eligible
maintenance-required
rollback-window-open/closed
contract-cleanup-eligible
runner and remote-UI isolation profile
worker execution generation/fence
```

### P9.10

`pnpm gate:9` must fail unless all mandatory hardening evidence above ran in the named gate.

## 9. Review outcome

With these corrections, the Phase 9 direction is **PASS FOR IMPLEMENTATION AT P9.1**. This does not claim that dynamic installation, isolation, or zero-downtime delivery already works. It authorizes only the contract-freeze task and preserves every Gate 8 deterministic composition, provenance, migration, restore, and fleet invariant.
