# ADR-0026: Source-Backed Restartless Extension Installation

- Status: accepted
- Date: 2026-09-04
- Decision owners: K-Nex platform maintainers
- Evidence: design-only
- Amends: [ADR-0003](./0003-plugin-taxonomy-and-capabilities.md), [ADR-0021](./0021-dynamic-application-runtime-and-zero-downtime-delivery.md), [ADR-0023](./0023-phase-9-production-isolation-and-static-delivery-hardening.md), [ADR-0025](./0025-runnable-workspace-shell-pages-and-builder.md)
- Related: [Extension lifecycle and package management](../19-plugin-lifecycle-and-package-management.md), [Dynamic applications and zero-downtime delivery](../35-dynamic-applications-and-zero-downtime-delivery.md)

## Context

K-Nex must support a developer/operator experience in which a valid extension can be selected from an approved GitHub repository or local directory, inspected, installed, bootstrapped, enabled, updated, disabled, and rolled back without a manual application reset.

The existing architecture already proves two important substrates:

```text
Hot Application / Theme Skin
  immutable generation
  isolated warm-up
  atomic active-pointer switch
  no host restart

Platform Plugin
  immutable customer application generation
  blue/green warm-up and traffic promotion
  no availability gap when compatibility permits
```

However, the existing production path begins with an official immutable catalog artifact. It does not yet define source admission from a GitHub repository or local directory, nor does it define a safe customer-install bootstrap hook. Treating this requirement as `pnpm add`, an arbitrary shell script, or `import()` inside the active host would violate deterministic composition, isolation, provenance, rollback, and multi-process consistency.

## Decision summary

K-Nex adds a **source-backed installation pipeline** in front of the existing artifact and lifecycle pipeline.

```text
source reference
→ resolve one exact source revision
→ inspect manifest without executing plugin code
→ classify delivery and impact
→ build in a separate trusted sandbox
→ issue immutable artifact/application evidence
→ stage
→ configure and bootstrap through closed capabilities
→ warm and verify
→ atomically activate a new generation
→ invalidate/refetch runtime catalogs
```

“Hot reload” is a product description for restartless availability. Technically, K-Nex creates and activates a new immutable generation; it does not mutate or unload arbitrary modules inside the active host process.

No new `PluginManifest.kind` or fourth delivery class is introduced. `plugin` remains the product umbrella, while restart behavior is determined by the existing delivery class and migration compatibility.

## Source references

The source admission boundary accepts exactly three source forms:

```text
catalog-release
  signed immutable catalog release already carrying artifact evidence

github-source
  exact GitHub repository + exact commit SHA + optional bounded subdirectory

local-directory
  operator-approved source alias + canonical content digest
```

### GitHub source

The product may let an authorized operator choose a repository and branch/tag for convenience, but the source resolver must convert that choice to one exact commit before planning. All durable plans, receipts, artifacts, updates, and rollbacks bind the commit SHA, not a moving branch or tag.

Rules:

- only configured GitHub hosts, owners, repositories, and GitHub App installations are eligible;
- private-repository credentials belong to the source/build authority, never the web application or extension runtime;
- repository URL, commit, and optional subdirectory are validated before network access;
- redirects, submodules, Git LFS, archives, file count, total bytes, symlinks, path escapes, and build time are bounded by policy;
- a later branch commit is a new explicit update request, never an implicit mutation of the active generation;
- production activation requires an admitted source receipt and trusted build/provenance evidence.

### Local directory

A local directory is intended for development and explicitly configured self-hosted operator workflows.

Rules:

- CLI/agent workflows may point to a path directly;
- browser administration may select only a preconfigured source alias, never an arbitrary host filesystem path;
- the source service resolves `realpath`, rejects symlink/path escape, and reads only below configured roots;
- the durable record stores the source alias, content digest, manifest digest, and issued artifact evidence; it does not treat the raw path as extension identity;
- development artifacts are signed by a distinct local-development authority and cannot be promoted into production by changing an environment flag;
- a watcher produces a new candidate generation after a bounded debounce; it never writes into active `node_modules` or imports changed source into the host process.

## Source inspection and build authority

Manifest inspection is side-effect free. Source code is not imported merely to discover its manifest.

The separate source builder may execute a bounded explicit build recipe inside an isolated build environment. It may resolve a frozen dependency graph and run the declared build entrypoint, but:

- package lifecycle scripts are disabled by default;
- no build executes in the active customer web/worker container;
- no build receives customer database credentials, application secrets, Docker socket, or host filesystem authority;
- network access is denied by default and enabled only for an approved dependency mirror;
- output must match the closed K-Nex artifact format and all declared file digests;
- source commit/content digest, lock graph, builder identity, build recipe, SBOM, manifest, and artifact digest are recorded in the admission receipt.

The runtime installer consumes only the resulting immutable artifact or customer application release. It never clones source or runs a package manager.

## Restartless behavior by delivery class

| Change | Technical activation | Product outcome |
|---|---|---|
| Hot Application install/update | isolated target generation + atomic active pointer | existing host processes remain running |
| Theme Skin install/update | parsed target generation + atomic profile/pointer update | existing host processes remain running |
| Enable/disable a lifecycle-safe Platform Plugin already present in the host image | revisioned runtime availability change | existing host processes remain running |
| Add/update/remove a Platform Plugin package | build and start a new customer application generation, then blue/green traffic promotion | no manual reset or outage when overlap-safe |
| Offline/incompatible schema or topology change | maintenance plan | restartless activation is not claimed |

The product may present all successful cases as “Install and enable without manual restart.” The receipt must still expose whether activation was an in-place runtime generation switch or a blue/green host generation promotion.

## Install and bootstrap contract

K-Nex supports install/bootstrap behavior, but not arbitrary `postinstall`, shell, package-manager, or host-process lifecycle scripts.

A source-backed Hot Application may declare a closed lifecycle contract containing bounded phases such as:

```text
validate-configuration
prepare-storage
migrate-app-storage
bootstrap
health
warm
```

Each phase:

- executes in the target generation sandbox before activation;
- receives an operation-scoped, generation-scoped, short-lived capability token;
- may use only explicitly approved host capabilities such as namespaced app storage, declared settings and secret references, bounded source/action calls, schedules, and structured audit;
- has canonical input/output schemas, timeout, memory/CPU/output limits, attempt limits, and checkpoint identity;
- is retryable and idempotent; K-Nex promises one logical effect through idempotency/checkpointing, not magical exactly-once process execution;
- records a durable receipt and cannot widen the extension’s approved capabilities;
- cannot access raw SQL, Payload internals, host imports, customer filesystem, ambient network, or another extension’s storage;
- cannot activate the target generation until every required phase and health check succeeds.

A bootstrap failure leaves the previous active generation unchanged and the candidate staged, failed, or quarantined according to policy. A crash after a committed checkpoint resumes from durable state. Re-enable normally revalidates configuration, storage compatibility, and health; it does not silently rerun destructive first-install work.

Platform Plugin schema/bootstrap work remains part of the trusted customer release and migration plan. It may be exposed as one product operation, but it is executed by migration/deployment authorities during green preparation rather than as downloaded code inside the active host.

## Dynamic contribution activation

After a Hot Application generation becomes active, the host refetches the exact active-generation contribution catalog. The generation may contribute only through existing or separately accepted closed contracts:

```text
navigation descriptors
fixed /apps/:appId/* screens
remote pages and remote dashboard blocks
allowlisted host-component trees and typed events
data source descriptors dispatched through fixed host gateways
action and tool descriptors dispatched through fixed host gateways
settings descriptors
role templates and permissions
schedules, subscriptions, localization, and assets
```

These contributions may appear in the workspace shell and Puck library without a host restart. A remote dashboard block is rendered through the K-Nex remote-component protocol; it is not a downloaded React module imported into the host.

Native Payload collections/hooks, native Next/Payload routes, host React components, provider implementations, builders, and executable Theme Packages remain Platform Plugin contributions. Installing those starts a new static customer application generation rather than injecting code into the running process.

Custom-object definitions may become live-installable only through a future closed metadata-driven object contract. A plugin cannot obtain restartless behavior by supplying arbitrary SQL or database-authored executable schema.

## Generation, compatibility, and page binding

Every active contribution is bound to:

```text
application + environment
extension ID + delivery class
source revision and artifact digest
authorization generation
runtime generation IDs
manifest and contribution digests
host ABI and capability versions
lifecycle revision and availability
```

Workspace pages bind the exact block/source/action dependency inventory. On update:

- an exact compatible generation may be rebound only after structural and behavioral compatibility checks;
- an incompatible replacement leaves affected pages in `dependency-unavailable` until authorized remediation or republish;
- unrelated extension lifecycle changes do not invalidate pages that do not depend on that extension;
- disable, quarantine, or uninstall removes runtime authority immediately while preserving durable page data and diagnostics;
- stale processes cannot relabel old compiled code as a newer Platform Plugin generation.

## Product experience

The K-Nex control plane should expose one guided operation:

```text
Add source
→ inspect manifest and delivery class
→ show requested capabilities, data/network/storage access, routes, blocks, settings, migrations, and availability impact
→ resolve exact source revision
→ build/verify
→ configure
→ approve
→ install/bootstrap/warm
→ enable
→ show receipt, health, rollback, and logs
```

Suggested source choices:

```text
Official catalog release
GitHub repository
Local development folder
```

The interface must not imply that every source is eligible for in-process live activation. Before approval it must state one of:

```text
Live activation — host processes stay running
Live deployment — green host generation will replace blue without outage
Maintenance required
Unsupported
```

## Security and failure rules

- The web application receives no general GitHub token, source-write credential, local filesystem traversal, builder credential, registry credential, or Docker socket.
- A pasted URL cannot become a generic SSRF primitive; source hosts and request shapes are allowlisted and fetched by a separate bounded service.
- Source admission, build, install, bootstrap, activation, disable, update, rollback, and uninstall are separately authorized and audited.
- Capability and permission escalation requires a new impact plan and approval even when source identity is unchanged.
- Existing active state remains authoritative until one atomic target-generation activation or traffic-promotion commit.
- Failed source resolution/build/verification/bootstrap/warm-up writes no active pointer and grants no execution authority.
- Response loss and process crashes replay by operation ID and idempotency key.
- Local-development authority is visibly marked and cannot cross environment/application trust boundaries.
- Runtime invalidation uses transactional outbox plus revision polling; message loss cannot preserve stale navigation, page, source, action, tool, or schedule authority.

## Required implementation proof

This ADR remains `design-only` until one bounded implementation proves at least:

```text
GitHub exact-commit Hot Application install while the generated app remains available
local-folder watcher builds a new immutable generation and atomically replaces the prior generation
failed local build or bootstrap leaves the prior generation active
bootstrap crash/retry produces one logical checkpointed effect
new navigation, remote page/block, source, action, permission, and settings contributions appear after activation
open browsers and workers converge after lost invalidation
branch movement does not mutate an installed generation
GitHub redirect/submodule/symlink/path/size/credential/SSRF attacks fail before execution
private repository credentials remain outside web/runtime receipts and logs
Hot Application update and rollback preserve generation identity and storage compatibility
real Platform Plugin source change uses blue/green promotion and never binds stale process code to a new runtime generation
incompatible Platform Plugin migration returns maintenance-required
backup/restore recovers source admission, artifact, bootstrap, active pointer, and rollback receipts
```

For a Hot Application proof, stable host boot/process identity must be observed across install and activation. For a Platform Plugin proof, stable user availability rather than stable process identity is the contract.

## Phase boundary

This ADR records the target product contract; it does not claim that the current Phase 12 implementation already accepts GitHub/local sources or runs lifecycle bootstrap hooks.

Phase 12 must leave generic extension, navigation, block, source, action, settings, authorization, and administration boundaries capable of consuming this model and must not hard-code the product around `module.sales`. Source admission and restartless install/bootstrap require a dedicated implementation slice before K-Nex claims self-service repository/folder installation.

Phase 13 CRM-first productization may proceed, but CRM delivery must use the same generic contribution and generation contracts so it does not block this source-backed installation path.

## Consequences

### Positive

- The desired “point to a repository/folder and use it without resetting the app” experience becomes explicit and testable.
- Development live sync and production installation share generation semantics rather than separate ad hoc loaders.
- Source flexibility does not weaken artifact immutability, rollback, authorization, or supply-chain evidence.
- Extension authors can choose live isolated capabilities or deeper static host integration without misleading users.

### Costs

- K-Nex needs source resolvers, a separate build authority, admission receipts, development signing, lifecycle checkpointing, and a dynamic contribution catalog.
- Remote blocks/pages require a richer but still closed host protocol.
- Platform Plugin delivery still needs deployment infrastructure even when the UI makes it feel one-click.
- Some requested plugins will correctly return `maintenance-required` rather than live activation.

## Alternatives considered

### Run `pnpm install` and `import()` in the active host

Rejected because it mutates deployed bytes, bypasses static registration and provenance, exposes host authority, and has no reliable unload or multi-process agreement.

### Trust any GitHub branch or local path directly

Rejected because moving refs, path traversal, unbounded source, credential exposure, and unaudited builds cannot define an active generation.

### Require every extension to rebuild the full application

Rejected because it unnecessarily prevents live installation of bounded application-like extensions, remote blocks, data tools, and Theme Skins.

### Make every extension a Hot Application

Rejected because native Payload schema, host hooks, provider/build infrastructure, and trusted host components require the static Platform Plugin path.
