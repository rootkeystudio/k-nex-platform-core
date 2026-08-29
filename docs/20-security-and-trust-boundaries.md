# Security and Trust Boundaries

## Trust model

### Trusted host code

```text
platform packages
verified Platform Plugins in the customer image
static generated registries
customer source-controlled code
separate deployment-supervisor implementation
```

A compromised Platform Plugin can compromise one customer host generation. Exact packages, review, provenance, and customer isolation reduce but do not eliminate this blast radius.

### Isolated executable extension code

Hot Application bundles are treated as capability clients even when official. Signing proves provenance/identity; it does not grant host trust.

### Untrusted structured data

```text
Hot Application/Theme Skin manifests before verification
remote UI trees/events
app settings/storage values
builder documents
public forms/uploads/webhooks
source/action inputs
realtime messages
catalog/network responses
```

## Absolute boundaries

Downloaded extension code must not execute in the main web/worker process. The application process must not expose:

```text
Docker socket
customer database credential
host filesystem/module graph
raw req.payload
ambient process.env or host secrets
unrestricted child process
unrestricted outbound network
arbitrary React/DOM execution
```

TypeScript types, package exports, ESM cache behavior, and Node permission flags are not sufficient sandbox boundaries.

## Catalog and artifact supply chain

Production installation begins from a signed versioned official catalog entry bound to:

```text
publisher and source repository/commit
immutable release asset
artifact/manifest/file/SBOM digests
hosted-build provenance
runtime ABI/framework compatibility
capability/permission/secret/network/storage requests
support and revocation state
```

Verification occurs before serving or execution. Secure extraction rejects path traversal, absolute paths, symlinks/hardlinks, duplicate/case-colliding paths, special devices, decompression bombs, excessive files/bytes/depth, and unsupported content types.

Production activation never runs NPM/PNPM lifecycle scripts or resolves dependencies from the network. Dependencies are bundled in a protected publication workflow.

## Isolated runner

Reference controls:

```text
separate process/service/container boundary
non-root and read-only root filesystem
generation-specific code root and bounded temp
no Docker/DB credentials
minimal explicit environment
short-lived app/actor/delegation token
network deny by default and destination allowlist
CPU/memory/wall-time/concurrency/input/output/log quotas
structured schema-validated IPC/RPC
termination/quarantine on violation
```

The host capability gateway reauthenticates each call; possession of an app token does not authorize arbitrary operations.

## Host capabilities

A Hot Application can only use declared versioned capabilities. Each call is bounded by:

```text
app ID and active generation
principal/effective actor/delegation
permission and record/field policy
surface/audience
resource/rate/concurrency budget
storage/file/network/secret scope
correlation and audit identity
```

No generic service locator or raw SQL API exists.

## App storage

Initial app storage is platform-owned and namespaced. It enforces closed schemas, canonical keys, optimistic revisions, quotas, bounded indexes/query controls, actor/app authorization, encryption/backup policy, and cross-app denial.

Storage content cannot create executable entrypoints, routes, permissions, policies, or capabilities.

## Remote UI

Remote UI worker code cannot access DOM, cookie, localStorage, host module imports, or arbitrary network. It emits only allowlisted component IDs, strict props, and typed events.

The host owns:

```text
React/K-Nex components
DOM and portals
focus/keyboard/accessibility
theme and CSS boundary
routing and external navigation policy
source/action transport
authorization and sensitive state clearing
CSP/SRI/content-type/cache headers
```

Unknown components/events/props fail closed. Worker failure is app-local.

## Platform Plugin delivery security

A separate deployment supervisor owns Docker/build/pull/gateway authority. The web application submits a narrow authorized change request and observes receipts.

Promotion requires:

```text
verified artifact/provenance/SBOM/static inventory
migration advisory lock and expected revision
expand/overlap compatibility
new generation readiness and authenticated smoke
continuous old-generation availability
atomic gateway target update
safe worker/socket drain
post-promotion receipt/inventory
```

A compromised web process must not be able to create arbitrary containers, mount host paths, read other secrets, or route traffic to an unverified image.

## Authorization

Server/host capability authorization is authoritative. UI hiding, catalog filtering, role labels, remote component visibility, and client-provided scopes do not grant authority.

Phase 9 uses an injected operation-authorizer boundary with explicit trusted automation identity. Phase 10 implements stable platform/extension permissions, roles, normalized grants, role templates, protected owner, lifecycle generations, and live revocation.

Long-lived tokens do not carry authoritative permission arrays.

## Data-source and action safety

```text
authenticate
lookup exact active owner/generation/surface
authorize source/action and fields
apply budgets
execute only permitted projection/effect
validate exact output
redact defensively
cache only under safe identity
observe and serialize bounded errors
```

Unauthorized values must not enter app runner input/output, cache, trace, log, validation error, event, or browser.

## Network and secrets

- Secrets are declared references and resolved only for authorized server capability calls.
- Secret values never enter bundles, app storage, remote UI, events, logs, receipts, inventory, or errors.
- Outbound destinations are normalized and allowlisted; DNS/IP redirect/rebinding and private-network SSRF are denied according to policy.
- Fetch size, redirects, methods, headers, duration, and concurrency are bounded.
- Apps cannot open arbitrary listeners.

## Realtime and events

- every app subscription binds actor, app generation, typed params, and current policy;
- disable/update/role revocation triggers reauthorization/termination;
- durable facts use transactional outbox;
- realtime is reconstructible invalidation plus refetch/revision resync;
- cross-app wildcard channels are forbidden;
- slow consumers and message buffers are bounded.

## Availability and resource isolation

A Hot Application cannot consume unbounded host resources. Per-app and global circuit breakers, queues, concurrency, quotas, timeout, and quarantine protect the host.

A failed target host generation receives no traffic. At least one old healthy generation remains during zero-downtime warm-up. Maintenance-required operations are explicit rather than attempted unsafely.

## Backup and incident response

Backups/restore cover host release, app/skin generations, artifact references, app storage, settings, authorization, outbox/idempotency/audit, and migration/deployment revision.

Catalog/artifact revocation supports:

```text
block new installs/updates
warn or quarantine affected active generations according to severity
fleet query by artifact/package/version/digest
safe rollback or patched replacement
incident audit and customer-specific plan
```

## Mandatory failure corpus

```text
unsigned/tampered/downgraded/revoked artifact
catalog publisher/source mismatch
archive traversal/symlink/bomb/duplicate
install script or host package-manager execution
host dynamic import of downloaded code
runner DB/Docker/env/filesystem/network escape
forged/expired app token or generation
undeclared host capability
cross-app storage/secret/cache access
remote UI DOM/cookie/host-import/arbitrary URL attempt
unknown component/event/prop and malformed tree
activation race/mixed generation/staged asset exposure
runner crash/OOM/timeout and log/output flood
lost revision invalidation
web Docker control attempt
unverified green traffic promotion
incompatible migration labeled zero downtime
rollback across incompatible data
backup/restore generation mismatch
```
