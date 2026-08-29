# K-Nex Platform Core

K-Nex is a Payload/PostgreSQL application factory for independently deployed customer CMS, CRM, operations, analytics, and future vertical products.

```text
Payload + Postgres
+ deterministic K-Nex contracts/composition/runtime
+ trusted exact-version plugins, providers, themes, and builder adapters
+ authenticated sources, actions, tools, events, jobs, and UI
+ customer-owned roles, settings, content, layouts, migrations, and infrastructure
+ immutable container releases, restore evidence, and fleet inventory
= independently deployable customer application
```

K-Nex is not initially a shared multi-tenant SaaS. Each customer application has its own repository, database, storage boundary, secrets, deployment, migrations, content, authorization state, and release cadence.

## Current status

The executable platform foundation through **Gate 8 is accepted**. The active roadmap is:

```text
Phase 9 — RBAC, Authorization, and Plugin Bootstrap
```

Phase 9 completes the administration/security core before CRM or CMS product breadth:

```text
stable plugin permission descriptors
bounded application/record/field policy hooks
customer-owned roles and normalized grants
user/service role assignments
versioned plugin role templates
protected system roles and first-owner bootstrap
disabled-plugin dormant authority
live authorization revision and revocation
schema-less cleanup versus schema-owning purge
system access administration UI
```

`status.md` is the current execution source. The authoritative plan is [`docs/implementation/phase-9-rbac-and-authorization-control-plane.md`](./docs/implementation/phase-9-rbac-and-authorization-control-plane.md).

## Deployment decision

K-Nex V1 is **Docker/container-first**.

```text
package add / upgrade / removal
  → verified immutable release
  → Docker image build
  → migration/readiness plan
  → container deployment

preinstalled plugin enable / disable / re-enable
  → live PostgreSQL-backed lifecycle transaction when ready
```

Running containers never download or import executable packages. A future official GitHub package/theme catalog will produce release plans; it will not mutate a running process.

Typical customer topology:

```text
web
worker / outbox processor
PostgreSQL
object storage
optional Redis/backplane according to topology
backup, logs, metrics, traces, and deployment evidence
```

## Foundation evidence

Accepted executable gates provide:

```text
Gate 0
  typed contracts, generated JSON Schemas, fixtures,
  deterministic generation, governance, and CI

Gate 1
  exact package resolution/composition, static registries,
  Payload/Postgres migration, boot, and runtime inventory

Gate 2
  authenticated data-source gateway, record/field authorization,
  Metric/Table contracts, budgets, caching, and RFC 9457 errors

Gate 2A
  explicit source/action-backed agent tools,
  approval/idempotency/audit, bounded Payload MCP adapter

Gate 3
  transactional outbox, leased idempotent processing,
  supported Socket.IO topology and convergence

Gate 4
  canonical UiDocument, editor-independent runtime,
  Puck adapter, fixed-shell policy, accessibility/bundle boundaries

Gate 5
  semantic theme ABI, Minimal and Neobrutalism,
  atomic CMS page/document publication and deterministic layouts

Gate 6
  complete plugin contribution taxonomy, Sales reference plugin,
  package boundaries, settings/routes/pages, plugin conformance

Gate 7
  comprehensive headless component/data/form/page system,
  DataTable/DataGrid, Puck blocks, SSR/hydration, accessibility/performance

Gate 8
  upgrade/migration fencing, archive/purge/backup/restore,
  create-knex-app, two independent customers, SBOM/provenance,
  deployment receipts and full-closure fleet patch evidence
```

This is strong executable platform evidence, not a claim of a finished CRM/CMS product, a production-observed customer fleet, complete WCAG certification, or a SLSA level.

## Strategic boundaries

- **Payload is the strategic V1 application framework.** Replacing it would be a platform migration, not a provider switch.
- **Postgres is the V1 primary database.** K-Nex does not add a parallel ORM/database abstraction.
- **Plugins are trusted in-process code.** Package/type boundaries are not a malicious-code sandbox.
- **Exact packages and immutable releases.** Runtime data cannot install packages or create executable contributions.
- **Server authorization is authoritative.** UI hiding, role labels, cached catalogs, builder metadata, agent discovery, and realtime subscriptions do not grant authority.
- **Roles are customer data; permissions are stable contracts.** Plugins may provide role templates but never assign users or grant platform permissions.
- **Builder documents are declarative.** No arbitrary JavaScript, SQL, import path, secret, unrestricted server URL, or global CSS.
- **Realtime invalidates and refetches.** Durable facts use transactional outbox semantics.
- **One small theme ABI, broad platform components.** Themes style compound behavior; they do not reimplement it.
- **Pre-v1 obsolete paths are removed.** No compatibility shim is kept for unreleased APIs.

## Reference plugin

`module.sales` remains the sole first-party domain reference during Phase 9. It exercises:

```text
schema and customer migrations
permissions and settings
sources and actions
agent tools
events, jobs, outbox, and realtime
browser queries and mutations
components and Puck blocks
routes, navigation, and default pages
lifecycle, upgrade, restore, and conformance
Phase 9 role templates and policy hooks
```

Sales is a platform reference and test harness, not yet a complete commercial CRM.

## Package direction

```text
@k-nex/contracts
@k-nex/composition
@k-nex/runtime
@k-nex/payload-adapter
@k-nex/provider-realtime-socketio
@k-nex/ui-runtime
@k-nex/ui-design-system-contracts
@k-nex/ui-components
@k-nex/ui-data
@k-nex/ui-forms
@k-nex/ui-pages
@k-nex/ui-builder-blocks
@k-nex/ui-testing
@k-nex/builder-puck
@k-nex/payload-builder-storage
@k-nex/theme-minimal
@k-nex/theme-neobrutalism
@k-nex/module-sales
```

A package is added only when an active task has a real consumer. Third-party framework, editor, protocol, and behavior-engine types remain behind K-Nex contracts and adapters.

## Composition and sources of truth

```text
k-nex.app.json                 desired non-secret composition
package.json + pnpm-lock.yaml  installed exact bytes and integrity
released plugin manifests      static package claims
k-nex.config.ts                bounded source-controlled extensions
.k-nex/generated/              deterministic resolved graph and registries
customer database              roles, settings, content, layouts, publications
customer migrations            final schema/data evolution
signed release evidence        artifact provenance and closure
runtime inventory/receipt      observed deployed truth
```

A mismatch fails closed; layers do not silently override one another.

## Commands

The root `package.json` contains the authoritative commands. Current accepted foundation validation is:

```bash
pnpm install --frozen-lockfile
pnpm gate:8
pnpm audit --audit-level high
git diff --check
```

Phase 9 will add `pnpm gate:9` only when its complete executable acceptance path exists.

## Documentation

Start with [the documentation index](./docs/README.md).

Execution:

- [`AGENTS.md`](./AGENTS.md)
- [`status.md`](./status.md)
- [Master execution plan](./docs/implementation/codex-master-plan.md)
- [Phase 9 plan](./docs/implementation/phase-9-rbac-and-authorization-control-plane.md)

Architecture and decisions:

- [Product vision](./docs/01-product-vision.md)
- [System architecture](./docs/02-system-architecture.md)
- [Plugin lifecycle](./docs/19-plugin-lifecycle-and-package-management.md)
- [Runtime security and reliability](./docs/29-runtime-security-reliability-and-quality-gates.md)
- [Executable gates](./docs/30-executable-poc-gates.md)
- [Decision register](./docs/21-decision-register.md)
- [ADR index](./docs/adr/README.md)
- [ADR-0021 authorization decision](./docs/adr/0021-rbac-authorization-and-plugin-role-templates.md)

## Roadmap boundary

Before Gate 9 PASS, do not begin CRM/CMS breadth or another first-party domain module. The next planned productization layer after Gate 9 is system settings, plugin/theme administration, an official GitHub package/theme catalog, and a Docker release controller.

## License

No license has been selected. Until one is added, the repository and its contents should be treated as proprietary.
