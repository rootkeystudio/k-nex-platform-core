# Research Plan and Proof of Concept

## Objective

The research phase must prove that K-Nex can transform a declarative customer specification into an independently deployed product that combines reusable backend logic, infrastructure providers, style-agnostic module UI, a shared CMS/workspace builder architecture, and runtime-configurable installed themes—without creating dependency, migration, security, or upgrade chaos.

The goal is not to build complete CRM, logistics, restaurant, inventory, budgeting, or production tracking products. The goal is to validate the architecture's riskiest assumptions with thin, measurable vertical slices.

## Required POC products

Build at least:

```text
k-nex platform/packages POC
client-acme-cargo-poc
client-mamma-restaurant-poc
```

Both customer repositories must be generated through the CLI from explicit specifications, not hand-copied from the platform source.

## Core hypotheses

### H-001 — Manifest-driven generation is deterministic

Given the same:

```text
k-nex.app.json
catalog/static manifests
CLI version
package registry state
lockfile constraints
customer TypeScript config
```

the CLI produces the same package graph, generated registries, and build inventory.

### H-002 — Plugin/capability graph is safe and understandable

Missing dependencies, incompatible versions, duplicate single providers, conflicts, cycles, and contribution collisions fail before Payload boot with actionable ownership/remediation messages.

### H-003 — Payload can host the platform without deep forks

K-Nex can compose collections, endpoints, jobs, permissions, admin/system contributions, and migrations from plugins while keeping domain logic testable outside hooks.

### H-004 — One canonical UI contract can support CMS and workspace profiles

The same block/layout/runtime architecture can power public page creation and authenticated dashboard/overview composition while enforcing different policies.

### H-005 — Puck can be an adapter rather than a leaked dependency

Puck can edit/round-trip canonical K-Nex documents without domain modules importing Puck types or requiring a deep engine fork.

### H-006 — Style-agnostic module UI can render across different themes

The same reusable module block/screen can render correctly and accessibly under at least Minimal, Neobrutalism, and one materially different theme/profile.

### H-007 — Theme package/profile split works

New theme code requires build/deploy; palette/token/profile changes among installed themes can preview/publish/rollback from database revisions without document mutation.

### H-008 — Customer-owned migrations remain manageable

Plugins can publish schema/data/UI/theme helpers while customer repositories own final clean/upgrade migrations and independent release history.

### H-009 — Realtime provider substitution works

Driver consumes `realtime.gateway`; local and distributed-provider experiments can satisfy the contract without changing driver domain code.

### H-010 — Security boundaries survive client manipulation

UI visibility, builder palette, or client metadata changes cannot bypass server action/data-source/record/realtime policy.

## Key research questions

## Platform and packaging

- Should first-party core/UI/CLI/early modules live in one monorepo? Current recommendation: yes during contract stabilization.
- Does GitHub Packages provide acceptable local/CI/deployment authentication?
- Which final package scope is available and appropriate?
- Can static plugin manifests be read without executing package code?
- Can exact package versions and capability contract versions coexist clearly?
- Can generated registries be committed without harmful churn?

## CLI

- Can interactive and non-interactive creation produce byte-equivalent normalized output?
- Can plan/apply stage/rollback filesystem and package changes safely?
- Can manual JSON edits reconcile through `k-nex sync`?
- Can secret prompts avoid committed/logged exposure?
- Can add/disable/uninstall/purge plans correctly report data/layout/theme impact?
- Can `doctor` detect stale generated output and real framework collisions?

## Payload composition

- Which contribution types can be merged safely?
- Which function/config fields require explicit adapters rather than generic merge?
- Can ownership diagnostics identify both plugins in a slug/route collision?
- Can disabled/uninstalled schema-owning modules preserve data safely?
- Can two customer compositions generate correct distinct Payload types/migrations?

## UI runtime

- Which semantic primitive foundation best supports style neutrality and accessibility?
- Can navigation, screens, blocks, data sources, actions, and slots resolve from enabled plugins deterministically?
- Can server/client bundles avoid server-only dependency leakage?
- Can missing blocks fail safely without crashing a page?
- Can one module block render under multiple themes without custom conditionals?

## Builder

- Can Puck round-trip a K-Nex-owned canonical document?
- Can fixed shell and editable canvas coexist cleanly?
- Can CMS/workspace profiles expose different palettes and policies?
- Can arbitrary JS/CSS/SQL/imports be impossible through the stored schema?
- Can customer/role/user layout scopes work with patch, snapshot, or hybrid inheritance?
- Can component migrations cover drafts, published pages, role/user layouts, and revisions?
- Does the existing Payload–Puck integration fit storage/publication needs, or should K-Nex implement its own adapter?

## Themes

- Can semantic primitive adapters be swapped without changing module block data?
- Can token schemas generate safe CSS variables consistently on server/client?
- Can accessibility validation prevent obviously invalid profiles?
- Can profile migration create draft rather than silently publishing visual change?
- Can editor chrome remain stable while previewing extreme public themes?

## Realtime

- Can driver require `realtime.gateway` capability and fail clearly when absent?
- Can domain modules register typed channel policy without transport imports?
- Can local adapter run in the selected application process/deployment?
- What changes for Redis-backed/multi-instance mode?
- Are after-commit invalidation messages enough for POC, and where is outbox required?

## Migrations and lifecycle

- Can plugin install generate customer-owned migration safely?
- What does disabled schema-owning module mean in Payload?
- How can uninstall retain data without framework boot issues?
- Can purge detect module dependents and stored UI references?
- Can UI/theme migrations preview and roll back independently from code deployment?

## Security

- Can public CMS blocks be guaranteed to use public projections/actions only?
- Can direct UI action/data-source calls enforce permission and record scope?
- Can builder/theme data resist script/style/import injection?
- Can CLI redact secrets and prevent path/shell injection?
- Can release inventory identify vulnerable package versions across customers?

## POC package scope

Minimum reusable packages/plugins:

```text
@k-nex/contracts
@k-nex/core
@k-nex/cli
@k-nex/ui-contracts
@k-nex/ui-runtime
@k-nex/ui-shell
@k-nex/ui-design-system-contracts
@k-nex/builder-puck
@k-nex/theme-minimal
@k-nex/theme-neobrutalism
@k-nex/module-cms
@k-nex/module-logistics-core
@k-nex/module-driver
@k-nex/module-restaurant-core
@k-nex/module-qr-menu
@k-nex/provider-websocket
@k-nex/provider-database-postgres
```

CRM can be a thin stub/block provider or added after the foundation. Full dispatch, inventory, budgeting, and production GPS history remain architecture stubs until the platform works.

## Customer POC A — Acme Cargo

### Requested composition

```text
module.cms
module.logistics-core
module.logistics-driver
provider.database-postgres
provider.realtime-websocket-local
builder.puck
CMS and workspace builder profiles
theme.minimal (admin)
theme.neobrutalism (public)
```

### Customer-specific work

- brand assets and approved fonts;
- public cargo layout and theme token profile;
- one customer block/renderer override;
- one local domain extension such as shipment number policy;
- minimal driver frontend;
- dispatcher/admin role definitions.

### CMS journey

1. Editor creates a cargo landing page.
2. Adds shared content blocks and module-provided public tracking form.
3. Previews using Neobrutalism public theme draft.
4. Publishes page and theme profile.
5. Public page exposes only public tracking projection/action.
6. Switches palette/token values without redeploying.

### Workspace journey

1. Admin opens module-generated navigation in fixed shell.
2. Customer admin composes operations dashboard using allowed logistics blocks.
3. Locks a required task/assignment block.
4. Dispatcher role receives a published role layout.
5. Individual dispatcher reorders/hides only allowed personal blocks.
6. Same blocks render under Minimal admin theme.

### Realtime journey

1. Admin creates and assigns a minimal shipment/task.
2. Transaction commits and records event.
3. Driver projection updates.
4. Realtime gateway sends task invalidation/update to authorized driver.
5. Driver fetches authoritative task data.
6. Another driver cannot subscribe/fetch it.
7. Reconnect recovers current state even if message was missed.

## Customer POC B — Mamma Restaurant

### Requested composition

```text
module.cms
module.restaurant-core
module.restaurant-qr-menu
provider.database-postgres
builder.puck
CMS builder profile
theme.minimal (admin)
theme.glassmorphism or another materially different public theme
```

### Customer-specific work

- restaurant brand assets/fonts;
- public theme profile;
- customer-specific hero/story block;
- local menu availability extension.

### Journey

1. Admin creates dishes/categories/branches.
2. Editor composes public page with shared content and restaurant module blocks.
3. Cargo-only components do not appear.
4. Draft preview is authorization-protected.
5. QR menu/public page publishes with restaurant theme.
6. Internal cost/stock data is absent from public projection.
7. Same builder/CMS packages remain unchanged from cargo application.

## Cross-customer proof

- Core/platform package fix upgrades Cargo only.
- Restaurant remains on previous package versions and keeps running.
- Both repositories have separate lockfiles/migrations/build inventories.
- Same foundational block renders under two visual systems.
- Customer extension in one repository does not appear in the other.
- No copied platform source exists in either customer repository.

## CLI POC scenarios

### Interactive creation

```bash
pnpm create k-nex-app client-acme-cargo-poc
```

Verify prompt selections generate expected manifest/packages/infrastructure.

### Non-interactive creation

Generate same app from flags/spec file and compare normalized output.

### Add plugin

```bash
k-nex add module.logistics-driver
```

Expected: resolver proposes logistics core and realtime provider, environment requirements, schema/UI impact.

### Provider replacement

```text
provider.realtime-websocket-local
  → provider.realtime-websocket-redis
```

Expected: driver code unchanged; CLI reports Redis/infrastructure/deployment impact.

### Disable/uninstall/purge

Verify each has different package/data/UI behavior and purge refuses without explicit confirmation/readiness.

### Stale generated files

Manually edit manifest without generation. CI `k-nex generate --check` must fail.

### Secret safety

External database URL/local secret prompt must write only ignored local environment file and remain redacted from output.

## Builder POC scenarios

### Fixed shell

Editor appears inside stable sidebar/topbar; only content canvas is editable.

### Profile separation

Workspace-only block cannot appear on public CMS page. Public block cannot bind authenticated data source.

### Engine independence

Domain module exports no Puck types. Canonical fixture round-trips edit/save/render.

### Missing component

Remove/disable module that provides a stored block. Whole page must not crash; readiness/publication reports orphan.

### Component migration

Upgrade a block property schema and migrate CMS drafts/published content and workspace layout fixtures.

### Layout scope

Prove at least customer → role → user resolution. Compare patch/snapshot/hybrid complexity and select V1 storage strategy.

### Security mutation

Modify browser document/action/data-source metadata manually. Server must reject forbidden access.

## Theme POC scenarios

- Same CMS document under Neobrutalism and Glassmorphism/Minimal.
- Same workspace block under two admin theme packages.
- Adjust allowed palette/radius/shadow/typography tokens in DB and preview.
- Reject malicious/invalid token values.
- Publish/rollback theme revision.
- Upgrade theme schema and create migrated draft without auto-publishing.
- Prevent uninstall of active theme.

## Deliberate failure tests

### Missing capability

Driver installed without realtime provider.

Expected: plan/generate/startup fails with capability range and suggested providers.

### Duplicate provider

Two active single providers for `realtime.gateway`.

Expected: resolution fails before registration.

### Duplicate framework/UI contribution

Two plugins register same collection slug, route, permission, action, or block ID.

Expected: error names both owners and contribution type.

### Incompatible versions

Driver requires capability/core range not provided.

Expected: clear installed/required versions and remediation.

### Unauthorized realtime subscription

Driver B subscribes to Driver A channel.

Expected: denial/security metric, no data.

### Transaction rollback

Prepare event then fail assignment transaction.

Expected: no externally processed event or realtime message.

### Public/private boundary

CMS block attempts workspace data source.

Expected: builder validation/publication failure and server denial.

### Arbitrary code/style input

Inject JS/import/SQL/global CSS/unsafe URL into builder/theme payload.

Expected: schema validation failure and safe audit/error behavior.

### Orphan block

Uninstall/disable module used in stored CMS/workspace documents.

Expected: orphan report; no automatic document deletion; safe fallback.

### Theme removal

Attempt to uninstall active public theme.

Expected: operation refused until replacement published.

### Destructive purge

Purge module with dependent plugin/stored blocks and no backup acknowledgment.

Expected: operation refused.

## Acceptance criteria

### Architecture and packaging

- Separate customer repositories consume packages; no core source copy.
- Static plugin manifests and capabilities resolve deterministically.
- Exact versions and generated inventory match lockfile.
- Core never imports business modules.
- First-party registry authentication works locally and in CI.

### CLI

- Interactive/non-interactive generation succeeds.
- Plan/apply and rollback behavior is test-covered.
- Manual manifest edits reconcile deterministically.
- Generated registries are current and reviewable.
- Secrets are redacted and never committed.

### Payload/backend

- Final config boots from plugin contributions.
- Collision checks work.
- Types/migrations differ correctly by customer composition.
- Business commands/events/jobs/access remain testable outside UI/hooks.

### UI and builder

- Fixed shell and module navigation work.
- CMS/workspace profiles share canonical contracts but enforce different policies.
- Module blocks are style-agnostic and engine-independent.
- Customer/role/user layout scope is demonstrated.
- Component migration/orphan behavior works.
- Builder data contains no arbitrary executable content.

### Themes

- Installed packages and DB profiles are separate.
- Admin/public themes are independent.
- Same document/block renders across themes.
- Draft/publish/rollback/schema migration works.
- Invalid/unsafe values cannot publish.

### Security

- Server actions/data sources/record policy cannot be bypassed through UI manipulation.
- Public projections remain narrow.
- WebSocket authorization works.
- Transaction rollback emits no external fact.
- Package/runtime install boundary is enforced.

### Migrations and operations

- Fresh and previous-release upgrade tests pass per customer.
- One customer upgrades independently.
- Disable/uninstall/purge behaviors are distinguishable.
- Release inventory and backup/restore proof exist.

## Rejection criteria

### Reject Payload as long-term base if

- deterministic safe contribution composition requires deep framework fork;
- migration/type generation cannot be made reliable per customer;
- framework upgrades force unacceptable module/customer source coupling;
- required runtime processes cannot be deployed reasonably.

### Reject Puck as first builder if

- canonical document cannot round-trip without loss;
- fixed shell/profile restrictions cannot be enforced;
- realistic workspace layout requires deep/unstable engine fork;
- domain modules must leak Puck types;
- accessibility/performance cannot reach acceptable POC level;
- preview cannot use production runtime/theme renderer.

Fallback: evaluate Craft.js through the same K-Nex contracts.

## Research phases

## Phase 0 — Decisions and package/tooling spike

Deliverables:

- repository topology decision;
- GitHub Packages/private registry proof;
- final working package scope;
- pnpm/Changesets/build/test conventions;
- ADR/decision register maintained;
- minimal CI;
- publish/install hello-world core and plugin.

Exit: two empty customer fixtures install one shared released package.

## Phase 1 — Manifest, CLI, and graph

Deliverables:

- application/plugin JSON schemas;
- trusted catalog;
- resolver for plugin IDs, capabilities, conflicts, cycles, compatibility;
- `create-k-nex-app` minimal scaffold;
- `k-nex plan/sync/generate/doctor`;
- static generated registry/inventory;
- failure fixtures.

Exit: two different manifests generate deterministic repositories and invalid graphs fail clearly.

## Phase 2 — Payload composition and migrations

Deliverables:

- explicit Payload contribution contracts;
- phased registration/collision ownership;
- actor/permission/service foundations;
- Postgres local scaffold;
- type generation;
- clean/upgrade migration fixture.

Exit: two distinct customer configs boot and migrate.

## Phase 3 — UI contracts, shell, and themes

Deliverables:

- semantic primitive contract and selected foundation;
- UI contribution registry;
- fixed shell/navigation;
- Minimal and Neobrutalism theme packages;
- versioned theme profiles/preview/publication;
- one style-agnostic module block.

Exit: same block renders in two themes and permission-filtered navigation works.

## Phase 4 — Builder adapter and profiles

Deliverables:

- canonical K-Nex UI document;
- Puck adapter spike;
- CMS and workspace profiles;
- draft/preview/publish;
- layout scope experiment;
- component migration/orphan validation;
- third-party Payload–Puck integration decision.

Exit: cargo CMS page and workspace dashboard plus restaurant CMS page work from shared builder contracts.

## Phase 5 — Events, jobs, realtime, driver slice

Deliverables:

- event/job wrappers;
- after-commit/outbox experiment;
- local realtime provider;
- typed channel authorization;
- driver dependency proof and minimal driver client.

Exit: secure cargo assignment/driver journey works.

## Phase 6 — Lifecycle and operations proof

Deliverables:

- add/disable/uninstall/purge plans;
- provider replacement experiment;
- theme/block/profile upgrade migration;
- reusable deployment workflow;
- release/fleet inventory;
- backup/restore exercise.

Exit: upgrade Cargo only, preserve Restaurant, and document go/no-go decisions.

## Implementation order

```text
contracts and schemas
  → static plugin manifest/catalog
  → capability resolver
  → CLI plan/generate/doctor
  → customer scaffold
  → Payload contribution adapter
  → permission/service/event/job foundations
  → UI contracts and fixed shell
  → semantic primitives and two themes
  → canonical document and Puck adapter
  → CMS profile
  → workspace profile
  → logistics/driver/realtime thin slice
  → restaurant/QR thin slice
  → lifecycle/migration/operations proof
```

Do not begin with full CRM, dispatch optimization, inventory accounting, budgeting, production GPS history, or a broad plugin marketplace.

## Research output

At the end of the POC, produce:

- working platform and two customer repositories;
- accepted/rejected/superseded ADR updates;
- measured Puck/Payload results;
- module/plugin authoring guide;
- theme authoring guide;
- builder block/profile guide;
- customer application and CLI guide;
- compatibility/migration report;
- deployment/security runbooks;
- known limitations and rejected approaches;
- explicit go/no-go decisions for Payload, Puck, committed registries, layout inheritance model, and package topology.
