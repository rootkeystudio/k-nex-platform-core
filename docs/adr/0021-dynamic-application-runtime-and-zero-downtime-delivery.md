# ADR-0021: Dynamic Application Runtime and Zero-Downtime Extension Delivery

- Status: accepted
- Date: 2026-08-29
- Decision owners: K-Nex platform maintainers
- Evidence: executable-poc
- Related: [Dynamic applications and zero-downtime delivery](../35-dynamic-applications-and-zero-downtime-delivery.md), [Phase 9 plan](../implementation/phase-9-dynamic-application-runtime.md), [Plugin lifecycle](../19-plugin-lifecycle-and-package-management.md), [Deployment and operations](../11-deployment-and-operations.md)

## Context

Gate 8 proved deterministic static plugin composition, exact packages, generated registration, Payload/Postgres migrations, lifecycle safety, application generation, provenance, deployment inventory, restore, and fleet operations.

The next product requirement is different: an authorized administrator should be able to select an official extension, let K-Nex download and validate it in the background, and make it available without taking the site offline.

The existing full plugin model cannot truthfully meet that requirement through host-process injection:

```text
Payload collections and migrations are boot-time config
server entrypoints are generated as static imports
registration is reconciled and frozen
web and worker processes require the same inventory
SBOM/provenance describe immutable deployed bytes
arbitrary ESM modules do not provide a reliable general unload contract
```

Twenty demonstrates a viable application pattern: resolve/download a package, apply a declarative manifest and metadata changes, store prebuilt artifacts, and run extension logic/UI behind isolated execution boundaries. K-Nex can adopt the pattern while preserving its own contracts and customer-isolation model.

## Decision

1. K-Nex exposes one Plugin Manager experience but distinguishes three technical extension classes:

```text
Platform Plugin  existing full trusted K-Nex package
Hot Application  signed prebuilt isolated runtime bundle
Theme Skin       signed declarative live-installable visual bundle
```

2. A Platform Plugin keeps the current identities and manifest. It may contribute Payload schema, migrations, host services, jobs, routes, native UI, providers, builders, and executable themes.
3. Platform Plugin add, upgrade, and removal remain immutable application release operations. User-visible availability is preserved through blue/green or rolling Docker delivery when migration compatibility permits.
4. A Hot Application uses a separate closed manifest and `app.*` identity. It cannot mutate host Payload config, host imports, or the frozen Platform Plugin registry.
5. Hot Application server code executes only in an isolated runner process/service with capability-scoped RPC, short-lived identity, strict budgets, no raw database/Docker/host-secret authority, and network denied by default.
6. Hot Application UI executes in a Web Worker or equivalent isolated realm and communicates through a K-Nex-owned allowlisted remote-component protocol. The host owns DOM, routing, semantic components, accessibility, theme, and authorization.
7. Hot Application routes use fixed preinstalled host surfaces such as `/apps/:appId/*`; runtime install does not add Next.js/Payload routes.
8. Production Hot Application artifacts are prebuilt and self-contained. Activation runs no package manager and no install/lifecycle scripts.
9. Official catalog entries bind publisher, source commit, immutable release asset, manifest/artifact/SBOM digests, hosted-build provenance, compatibility, support, and revocation state.
10. Downloads are staged in content-addressed storage and remain non-executable/non-servable until full verification.
11. `PluginManager` is a thin orchestrator delegating artifact, runner, UI, registry, migration, deployment, traffic, authorization, audit, and observability concerns.
12. Hot install/update uses immutable generations: stage, verify, warm, atomically switch the active generation pointer, drain old calls, and retain a compatible prior generation for rollback.
13. Multi-process activation state is PostgreSQL-backed, revisioned, audited, published through transactional outbox, and converges through revision polling after message loss.
14. Initial Hot Application persistence is a platform-owned namespaced document/KV store with closed schemas, quotas, optimistic revisions, indexes from bounded declarations, and backup/restore coverage. Arbitrary dynamic relational schema is deferred.
15. A Theme Skin uses `skin.*` identity and contains only bounded tokens, palettes, recipes, scoped CSS, approved content-addressed assets, and data-only profile migration metadata.
16. A full executable `theme.*` package with JavaScript validators, native primitive overrides, or executable migrations remains a Platform Plugin release.
17. The zero-downtime Platform Plugin reference topology uses a stable gateway plus separate deployment supervisor. The web/admin process never receives Docker socket or build/publish credentials.
18. Full-plugin promotion is allowed only when old/new releases can overlap and migrations are expand-compatible. Incompatible/destructive changes return `maintenance-required`; the system does not make a false zero-downtime claim.
19. Docker Compose alone is not treated as a zero-downtime orchestrator. The reference proof uses an external supervisor/gateway or a supported Docker orchestrator.
20. Phase 9 exposes a narrow operation-authorizer interface and trusted automation adapter for proof. End-user authorization and role templates are implemented in Phase 10; no temporary role-name bypass is introduced.
21. The main host process never performs `pnpm add`, `npm install`, dynamic import of downloaded code, runtime `node_modules` mutation, or direct in-process injection.
22. Local development may use an explicitly development-only live-sync watcher. Production accepts only immutable verified artifacts.
23. Each accepted signed catalog payload is a complete authoritative snapshot for active-generation security reconciliation, not a delta. Absence of an exact active release is `release-missing`; divergence in its immutable source or digest evidence is `release-evidence-mismatch`; and divergence from the trusted publisher key is `publisher-key-mismatch`. Every outcome fails closed through the same durable quarantine receipt, audit, and outbox path.

## Consequences

- The requested no-outage installation experience is achievable without weakening Payload composition or release evidence.
- Extension authors must choose the correct class. Deep framework/schema integration costs a release; live installation accepts a narrower host ABI.
- Hot Application code can fail, time out, or be quarantined without taking down the host.
- Remote UI cannot use arbitrary host React modules; it composes allowlisted K-Nex components and typed events.
- The platform gains an additional runner, artifact store, catalog/verifier, generic route host, and deployment supervisor.
- Some “plugins” in product language are technically apps or skins. Receipts and impact plans expose this truth.
- Platform Plugin updates can preserve availability but not for every migration. Maintenance remains an explicit safe outcome.
- RBAC follows the execution substrate so it can authorize both live activation and rolling deployment through one model.
- Catalog publication must carry every currently admitted release in each complete signed snapshot; removal is authoritative and quarantines an active generation without requiring an unsigned inference or compatibility shim.

## Alternatives considered

### Run `pnpm add` and `import()` in the main container

Rejected. It mutates deployed bytes, breaks deterministic inventory and multi-process agreement, bypasses static Payload config and registration freeze, creates supply-chain and rollback ambiguity, and provides no reliable generic unload boundary.

### Rebuild/restart one Docker container in place

Rejected as the sole production path because it causes an outage and removes the last healthy generation during validation.

### Make every existing plugin a Hot Application

Rejected. Payload schema, native hooks, providers, builders, and trusted host UI need a static release path.

### Make every extension a Platform Plugin

Rejected. It prevents the desired live install/update experience for bounded app-like extensions and skins.

### Execute downloaded server code with Node permission flags in the host

Rejected. Permission flags are defense in depth, not the isolation boundary, and the host would still share process memory and credentials.

### Load remote React modules directly in the browser host

Rejected. It gives downloaded code host-realm DOM/session authority and couples the public contract to a bundler/runtime implementation.

### Give the web application the Docker socket

Rejected. A compromised web/plugin path would gain host-level container control. Deployment authority belongs to a separate supervisor.

## Validation

Gate 9 promoted ADR-0021 to `executable-poc` by proving:

```text
closed extension/bundle schemas and deterministic build
signed catalog and artifact/provenance verification
secure extraction and forbidden-import failure corpus
isolated runner and capability escape denial
remote UI worker and allowlisted host components
atomic activation/update/rollback and lost-message convergence
hot theme skin install/update/rollback
continuous-traffic blue/green Platform Plugin delivery
maintenance-required refusal for incompatible migrations
backup/restore and exact active-generation inventory
```

The linked Phase 9 result, gate, fixtures, and runtime implementations record that atomic promotion.
