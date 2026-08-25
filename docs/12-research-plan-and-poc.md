# Research Plan and Proof of Concept

## Objective

The research phase must prove that K-Nex can transform a declarative customer specification into an independently deployed product that combines reusable backend logic, replaceable infrastructure providers, style-agnostic module UI, typed data/state bindings, a shared CMS/workspace builder architecture, and runtime-configurable installed themes—without creating dependency, migration, security, or upgrade chaos.

The goal is not to build complete CRM, logistics, restaurant, inventory, budgeting, analytics, or production tracking products. The goal is to validate the architecture's riskiest assumptions with thin, measurable vertical slices.

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

the CLI produces the same package graph, generated registries, build inventory, database/provider composition, UI/data/state registry, and environment schema.

### H-002 — Plugin/capability graph is safe and understandable

Missing dependencies, incompatible versions, duplicate singleton providers, conflicts, cycles, and contribution collisions fail before Payload boot with actionable ownership/remediation messages.

### H-003 — Payload can host the platform without deep forks

K-Nex can compose collections, endpoints, jobs, permissions, admin/system contributions, database provider wiring, and migrations from plugins while keeping domain logic testable outside hooks.

### H-004 — Database adapters and targets fit the provider model

The selected `database.primary` adapter and local/hosted target can be resolved from the manifest, generated statically, validated by capabilities, and used by modules without direct provider imports.

The first proof uses:

```text
provider.database-postgres
local Docker Postgres target
external Postgres URL target
```

A module requiring transactions must resolve successfully with Postgres, while a deliberately incomplete experimental adapter must fail before boot.

### H-005 — One canonical UI contract can support CMS and workspace profiles

The same block/layout/runtime architecture can power public page creation and authenticated dashboard/overview composition while enforcing different policies.

### H-006 — Puck can be an adapter rather than a leaked dependency

Puck can edit/round-trip canonical K-Nex documents without domain modules importing Puck types or requiring a deep engine fork.

### H-007 — Style-agnostic module UI can render across different themes

The same reusable module block/screen can render correctly and accessibly under at least Minimal, Neobrutalism, and one materially different theme/profile.

### H-008 — Theme package/profile split works

New theme code requires build/deploy; palette/token/profile changes among installed themes can preview/publish/rollback from database revisions without document mutation.

### H-009 — Plugin-exposed data sources and state can drive generic components

CRM/logistics/restaurant plugins can expose typed data sources, the visualization plugin can expose generic chart/table blocks, and the builder can connect them through typed parameters and page state without domain imports or arbitrary code.

Required proof:

```text
DateRangeFilter writes page state
  → Pie/Bar chart source input reads state
  → chart selection writes another state
  → table source reads both states
```

### H-010 — Customer-owned migrations remain manageable

Plugins can publish schema/data/UI/theme/source/state helpers while customer repositories own final clean/upgrade migrations and independent release history.

### H-011 — Realtime provider substitution works

Driver consumes `realtime.gateway`; local and distributed-provider experiments can satisfy the contract without changing driver domain code. Data sources can use the same capability for invalidation or selected stream projections.

### H-012 — Security boundaries survive client manipulation

UI visibility, builder palette, source picker, state/binding metadata, or client request changes cannot bypass server action/data-source/record/realtime policy.

## Key research questions

## Platform and packaging

- Should first-party core/UI/CLI/early modules live in one monorepo? Current recommendation: yes during contract stabilization.
- Does GitHub Packages provide acceptable local/CI/deployment authentication?
- Which final package scope is available and appropriate?
- Can static plugin manifests be read without executing package code?
- Can exact package versions and capability contract versions coexist clearly?
- Can generated registries be committed without harmful churn?
- Should database target packages contain runtime code, CLI recipes, catalog metadata, or a combination?

## CLI

- Can interactive and non-interactive creation produce byte-equivalent normalized output?
- Can plan/apply stage/rollback filesystem and package changes safely?
- Can manual JSON edits reconcile through `k-nex sync`?
- Can secret prompts avoid committed/logged exposure?
- Can add/disable/uninstall/purge plans correctly report data/layout/theme/source/state impact?
- Can `doctor` detect stale generated output and real framework collisions?
- Can database adapter and target changes show honest migration/deployment impact?

## Database providers

- Can the Postgres framework adapter be registered only through generated provider composition?
- Which capabilities should Postgres claim in V1?
- Can modules declare transaction/index/constraint requirements without importing the provider?
- Can local Docker and external Postgres targets share one adapter and module code?
- What environment/pooling/health metadata belongs to the target versus adapter?
- How should migration locks and required Postgres extensions be represented?
- Can an experimental SQLite/fake adapter be rejected when required capabilities are absent?
- Can provider diagnostics remain useful while redacting every secret?

## Payload composition

- Which contribution types can be merged safely?
- Which function/config fields require explicit adapters rather than generic merge?
- Can ownership diagnostics identify both plugins in a slug/route/capability collision?
- Can disabled/uninstalled schema-owning modules preserve data safely?
- Can two customer compositions generate correct distinct Payload types/migrations?
- Can transaction context flow through domain services, outbox writes, jobs, and UI actions consistently?

## UI runtime

- Which semantic primitive foundation best supports style neutrality and accessibility?
- Can navigation, screens, blocks, data sources, state, context, actions, and slots resolve from enabled plugins deterministically?
- Can server/client bundles avoid server-only dependency leakage?
- Can missing blocks or sources fail safely without crashing a page?
- Can one module block render under multiple themes without custom conditionals?
- Can generic visualization blocks consume multiple domain source contracts?

## Data sources, state, and bindings

- What initial shared output contracts are sufficient: scalar, tabular, category series, time series, geo, record list?
- Can builder source discovery filter by installed plugin, surface, audience, permission, contract, and deprecation state?
- Can source input forms be generated safely from schemas?
- Can field mapping remain useful without introducing arbitrary expressions?
- Which state scopes/persistence policies are needed in V1?
- Can graph validation reject schema mismatches, public/private edges, and cycles deterministically?
- Can source caching include every authorization-relevant dimension?
- Can preview use live, redacted, or fixture data without privilege escalation?
- Should realtime use invalidation by default and streams only for genuine live projections?
- How should source/state/block version migrations interact?

## Builder

- Can Puck round-trip a K-Nex-owned canonical document?
- Can fixed shell and editable canvas coexist cleanly?
- Can CMS/workspace profiles expose different palettes, sources, actions, state, and policies?
- Can arbitrary JS/CSS/SQL/imports/URLs be impossible through the stored schema?
- Can customer/role/user layout scopes work with patch, snapshot, or hybrid inheritance?
- Can component/source/state migrations cover drafts, published pages, role/user layouts, and revisions?
- Does the existing Payload–Puck integration fit storage/publication needs, or should K-Nex implement its own adapter?

## Themes

- Can semantic primitive adapters be swapped without changing module block data?
- Can token schemas generate safe CSS variables consistently on server/client?
- Can accessibility validation prevent obviously invalid profiles?
- Can profile migration create draft rather than silently publishing visual change?
- Can editor chrome remain stable while previewing extreme public themes?
- Can charts/maps/tables use semantic theme roles without domain-specific CSS?

## Realtime

- Can driver require `realtime.gateway` capability and fail clearly when absent?
- Can domain modules register typed channel policy without transport imports?
- Can local adapter run in the selected application process/deployment?
- What changes for Redis-backed/multi-instance mode?
- Are after-commit invalidation messages enough for POC, and where is outbox required?
- Can source invalidation and live stream reducers remain provider-independent?

## Migrations and lifecycle

- Can plugin install generate customer-owned migration safely?
- What does disabled schema-owning module mean in Payload?
- How can uninstall retain data without framework boot issues?
- Can purge detect module dependents and stored block/source/state references?
- Can UI/theme/source/state migrations preview and roll back independently from code deployment?
- Can database target changes avoid false schema migrations while dialect changes demand explicit data migration planning?

## Security

- Can public CMS blocks be guaranteed to use public projections/actions only?
- Can direct UI action/data-source calls enforce permission and record scope?
- Can source parameters, field mappings, state values, and event bindings resist injection?
- Can binding graphs prevent arbitrary imports, handlers, URLs, SQL, and code?
- Can builder/theme data resist script/style/import injection?
- Can CLI redact secrets and prevent path/shell injection?
- Can release inventory identify vulnerable package versions across customers?

## POC package scope

Minimum reusable packages/plugins:

```text
@k-nex/contracts
@k-nex/core
@k-nex/cli

@k-nex/database-postgres

@k-nex/ui-contracts
@k-nex/ui-runtime
@k-nex/ui-shell
@k-nex/ui-design-system-contracts
@k-nex/ui-data-sources
@k-nex/ui-state
@k-nex/ui-bindings
@k-nex/builder-puck

@k-nex/theme-minimal
@k-nex/theme-neobrutalism
@k-nex/theme-glassmorphism-or-contrast-theme

@k-nex/module-visualization
@k-nex/module-cms
@k-nex/module-crm-thin
@k-nex/module-logistics-core
@k-nex/module-driver
@k-nex/module-restaurant-core
@k-nex/module-qr-menu

@k-nex/provider-websocket
```

CRM remains a thin source/block provider for the POC. Full dispatch, inventory accounting, budgeting, and production GPS history remain architecture stubs until the platform works.

## Customer POC A — Acme Cargo

### Requested composition

```text
module.cms
module.crm-thin
module.visualization
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
3. Tracking block uses an explicitly public projection/action.
4. Previews using Neobrutalism public theme draft.
5. Publishes page and theme profile.
6. Public page exposes no authenticated logistics/CRM source.
7. Switches palette/token values without redeploying.

### Workspace data-binding journey

1. Admin opens module-generated navigation in fixed shell.
2. Customer admin adds a date-range filter, shipment-status bar chart, CRM pipeline pie chart, delayed-shipment table, and live-fleet map.
3. Date-range filter writes `page.filters.date-range`.
4. Chart sources bind their period inputs to that state and branch input to `context.current-branch`.
5. Selecting a shipment-status bar writes `page.filters.shipment-status`.
6. Shipment table source consumes both state values.
7. Live map uses initial snapshot plus realtime stream/invalidation.
8. Customer admin locks one required operations block.
9. Dispatcher role receives a published role layout.
10. Individual dispatcher reorders/hides only allowed personal blocks.
11. Same blocks render under Minimal admin theme.

### Realtime journey

1. Admin creates and assigns a minimal shipment/task.
2. Transaction commits and records event.
3. Driver projection updates.
4. Realtime gateway sends task invalidation/update to authorized driver.
5. Driver fetches authoritative task data.
6. Another driver cannot subscribe/fetch it.
7. Reconnect recovers current state even if a message was missed.
8. Dashboard source invalidates/refetches without embedding transport logic in chart/table blocks.

## Customer POC B — Mamma Restaurant

### Requested composition

```text
module.cms
module.visualization
module.restaurant-core
module.restaurant-qr-menu
provider.database-postgres
builder.puck
CMS and workspace builder profiles
theme.minimal (admin)
theme.glassmorphism or another materially different public theme
```

### Customer-specific work

- restaurant brand assets/fonts;
- public theme profile;
- customer-specific hero/story block;
- local menu availability extension.

### CMS journey

1. Admin creates dishes/categories/branches.
2. Editor composes public page with shared content and restaurant module blocks.
3. Cargo-only components and internal sources do not appear.
4. Branch selector writes approved public page state.
5. Public menu source binds branch and locale context.
6. Draft preview is authorization-protected.
7. QR menu/public page publishes with restaurant theme.
8. Internal cost/stock data is absent from public projection.

### Workspace data-binding journey

1. Admin composes restaurant overview using the same visualization package as Cargo.
2. Date-range and branch filters drive `restaurant.sales.by-category`.
3. Generic pie chart renders restaurant data with Minimal admin theme.
4. A thin inventory/low-stock stub source drives a generic table.
5. Source mappings and state are stored as IDs/configuration, not records or code.
6. Same builder/runtime packages remain unchanged from Cargo.

## Cross-customer proof

- Core/platform package fix upgrades Cargo only.
- Restaurant remains on previous package versions and keeps running.
- Both repositories have separate lockfiles/migrations/build inventories/databases.
- Same visualization block renders different plugin data under different visual systems.
- Customer extension in one repository does not appear in the other.
- No copied platform source exists in either customer repository.
- Both use Postgres through generated provider composition.
- Their layouts expose only sources from their enabled plugins.

## CLI POC scenarios

### Interactive creation

```bash
pnpm create k-nex-app client-acme-cargo-poc
```

Verify prompt selections generate expected manifest, packages, database target, Docker services, environment schema, registries, and infrastructure.

### Non-interactive creation

Generate the same application from flags/spec file and compare normalized output.

### Add plugin

```bash
k-nex add module.logistics-driver
```

Expected: resolver proposes logistics core and realtime provider, environment requirements, schema/UI/source/state impact.

### Database selection

```bash
k-nex database set provider.database-postgres
k-nex database target local-docker-postgres
```

Expected: generated adapter registry, Docker Compose service, `.env.example`, health/readiness, and migration scripts.

### Database target replacement

```text
local Docker Postgres
  → external Postgres URL
```

Expected: module code and schema unchanged; CLI reports environment/deployment/backup impact and redacts URL.

### Realtime provider replacement

```text
provider.realtime-websocket-local
  → provider.realtime-websocket-redis
```

Expected: driver/source code unchanged; CLI reports Redis/infrastructure/deployment impact.

### Disable/uninstall/purge

Verify each has different package/data/UI/source/state behavior and purge refuses without explicit confirmation/readiness.

### Stale generated files

Manually edit manifest without generation. CI `k-nex generate --check` must fail.

### Secret safety

External database URL/local secret prompt must write only ignored local environment file and remain redacted from output.

## Database POC scenarios

### Generated adapter boot

Remove hard-coded database adapter import. Application must boot only through `.k-nex/generated/provider-registry.ts`.

### Capability requirement

Inventory/transaction fixture requires `database.transactions`. Postgres resolves it.

### Incompatible adapter

Install a fake/experimental adapter that provides `database.primary` but not transactions.

Expected: resolver rejects dependent module before install/generation/boot.

### Target portability

Run same customer application against local Docker Postgres and external Postgres fixture without module changes.

### Health and migration state

`k-nex doctor` distinguishes missing URL, unreachable DB, pending migration, and ready state without exposing credentials.

### Customer-owned migration

Generate distinct final migrations for Cargo and Restaurant. Upgrade one while leaving the other on the previous version.

## Builder and binding POC scenarios

### Fixed shell

Editor appears inside stable sidebar/topbar; only content canvas is editable.

### Profile separation

Workspace-only block/source cannot appear on public CMS page. Public block cannot bind authenticated source.

### Engine independence

Domain module exports no Puck types. Canonical fixture round-trips edit/save/render.

### Source discovery

Select a generic pie/bar chart. Source picker lists compatible enabled-plugin sources only.

### Shared page state

Date-range block writes typed page state. Chart and table source inputs bind to it and re-execute deterministically.

### Component event binding

Chart selection writes selected-stage/status state. Table source consumes the state.

### Mapping

Map a tabular source's key/label/value fields to a generic chart. Invalid fields fail validation/publication.

### Missing component/source

Remove/disable plugin that provides a stored block or source. Whole page must not crash; readiness/publication reports orphan.

### Component/source/state migration

Upgrade property, source input/output, and state schemas; migrate CMS drafts/published content and workspace layout fixtures.

### Layout scope

Prove at least customer → role → user resolution. Compare patch/snapshot/hybrid complexity and select V1 storage strategy.

### Security mutation

Modify browser document/action/source/state/binding metadata manually. Server/runtime must reject forbidden access or invalid graph.

### Cycle detection

Create direct and indirect state/source cycles. Publication/generation must fail deterministically.

## Theme POC scenarios

- Same CMS document under Neobrutalism and Glassmorphism/Minimal.
- Same workspace/chart block under two admin theme packages.
- Adjust allowed palette/radius/shadow/typography/chart semantic tokens in DB and preview.
- Reject malicious/invalid token values.
- Publish/rollback theme revision.
- Upgrade theme schema and create migrated draft without auto-publishing.
- Prevent uninstall of active theme.

## Deliberate failure tests

### Missing capability

Driver installed without realtime provider or transaction module installed without compatible database provider.

Expected: plan/generate/startup fails with capability range and suggested providers.

### Duplicate provider

Two active singleton providers for `realtime.gateway` or `database.primary`.

Expected: resolution fails before registration.

### Database target mismatch

Postgres target selected with a non-Postgres adapter.

Expected: plan/generation failure with both plugin owners and dialect mismatch.

### Duplicate framework/UI contribution

Two plugins register same collection slug, route, permission, action, block, data-source, state, context, or contract ID.

Expected: error names both owners and contribution type.

### Incompatible versions

Driver/source/block requires capability/core/contract range not provided.

Expected: clear installed/required versions and remediation.

### Unauthorized realtime subscription

Driver B subscribes to Driver A channel.

Expected: denial/security metric, no data.

### Unauthorized data source

User manually calls an internal source hidden from their UI.

Expected: server denial; no cached or partial data.

### Transaction rollback

Prepare event then fail assignment transaction.

Expected: no externally processed event, source invalidation, or realtime message.

### Public/private boundary

CMS block attempts workspace data source/action/state/context.

Expected: builder validation/publication failure and server denial.

### Binding schema mismatch

Connect time-series source to incompatible input or invalid field mapping.

Expected: publication/runtime-plan rejection with source/block versions.

### Binding cycle

Create state → source → automatic state write loop.

Expected: deterministic graph rejection.

### Arbitrary code/style input

Inject JS/import/SQL/global CSS/unsafe URL into builder/theme/source/binding payload.

Expected: schema validation failure and safe audit/error behavior.

### Orphan block/source/state

Uninstall/disable plugin used in stored CMS/workspace documents.

Expected: orphan report; no automatic document deletion; safe fallback.

### Theme removal

Attempt to uninstall active public theme.

Expected: operation refused until replacement published.

### Destructive purge

Purge module with dependent plugin/stored blocks/sources/states and no backup acknowledgment.

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
- Generated plugin/provider/UI/data/state/theme registries are current and reviewable.
- Secrets are redacted and never committed.

### Database provider

- Postgres adapter and target are selected through manifest/resolver.
- Application contains no unrelated hard-coded database composition path.
- Local Docker and external Postgres targets work with same module code.
- Capability mismatch and duplicate primary provider fail early.
- Health/readiness and migration diagnostics do not leak credentials.
- Customer repositories own distinct final migrations.

### Payload/backend

- Final config boots from plugin contributions.
- Collision checks work.
- Types/migrations differ correctly by customer composition.
- Business commands/events/jobs/access remain testable outside UI/hooks.

### UI, data, and builder

- Fixed shell and module navigation work.
- CMS/workspace profiles share canonical contracts but enforce different policies.
- Module blocks are style-agnostic and engine-independent.
- Generic chart/table select compatible domain data sources.
- Page state coordinates at least three components.
- Source execution remains server-authorized and bounded.
- Public/private bindings are rejected.
- Binding cycles and schema mismatches are detected.
- Customer/role/user layout scope is demonstrated.
- Component/source/state migration and orphan behavior work.
- Builder data contains no arbitrary executable content or live result snapshots.

### Themes

- Installed packages and DB profiles are separate.
- Admin/public themes are independent.
- Same document/block/chart renders across themes.
- Draft/publish/rollback/schema migration works.
- Invalid/unsafe values cannot publish.

### Security

- Server actions/data sources/record policy cannot be bypassed through UI manipulation.
- Public projections remain narrow.
- WebSocket authorization works.
- Cache/realtime behavior cannot cross actor/public boundaries.
- Transaction rollback emits no external fact.
- Package/runtime install boundary is enforced.

### Migrations and operations

- Fresh and previous-release upgrade tests pass per customer.
- One customer upgrades independently.
- Disable/uninstall/purge behaviors are distinguishable.
- Stored block/source/state references are inventoried before removal.
- Release inventory and backup/restore proof exist.

## Rejection criteria

### Reject Payload as long-term base if

- deterministic safe contribution/provider composition requires deep framework fork;
- migration/type generation cannot be made reliable per customer;
- framework upgrades force unacceptable module/customer source coupling;
- required runtime processes cannot be deployed reasonably.

### Reject Puck as first builder if

- canonical document cannot round-trip without loss;
- fixed shell/profile/source/state restrictions cannot be enforced;
- realistic workspace layout requires deep/unstable engine fork;
- domain modules must leak Puck types;
- accessibility/performance cannot reach acceptable POC level;
- preview cannot use production runtime/theme/data-source renderer.

Fallback: evaluate Craft.js through the same K-Nex contracts.

### Reject the generic binding layer for broad V1 use if

- realistic dashboards require pervasive unsafe escape hatches;
- graph validation/migration is less reliable than module-owned screens;
- source authorization/caching cannot remain understandable;
- editor UX cannot explain data/state provenance;
- performance becomes unpredictable despite limits.

Fallback: retain typed sources/actions/state for module-owned screens and restrict visual composition to simpler dashboards. Arbitrary code in documents is not the fallback.

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
- resolver for plugin IDs, capabilities, conflicts, cycles, compatibility, and singleton providers;
- `create-k-nex-app` minimal scaffold;
- `k-nex plan/sync/generate/doctor`;
- static generated registry/inventory;
- failure fixtures.

Exit: two different manifests generate deterministic repositories and invalid graphs fail clearly.

## Phase 2 — Database provider, Payload composition, and migrations

Deliverables:

- Postgres provider contribution contract;
- local Docker and external Postgres targets;
- explicit Payload contribution contracts;
- phased registration/collision ownership;
- actor/permission/service foundations;
- generated environment/health/readiness;
- type generation;
- clean/upgrade migration fixture.

Exit: two distinct customer configs boot and migrate through generated Postgres provider composition.

## Phase 3 — UI contracts, shell, themes, data/state foundations

Deliverables:

- semantic primitive contract and selected foundation;
- UI contribution registry;
- data-contract/data-source/state/context/action contracts;
- binding graph validator/runtime skeleton;
- fixed shell/navigation;
- Minimal and Neobrutalism theme packages;
- versioned theme profiles/preview/publication;
- one style-agnostic module block and one generic visualization block.

Exit: same block renders in two themes, permission-filtered navigation works, and a static compatible source renders through a generic chart.

## Phase 4 — Builder adapter, profiles, and dynamic bindings

Deliverables:

- canonical K-Nex UI document;
- Puck adapter spike;
- CMS and workspace profiles;
- source picker and parameter editor;
- page state and event-to-state binding;
- chart/table shared filter scenario;
- public/private publication validation;
- draft/preview/publish;
- layout scope experiment;
- component/source/state migration/orphan validation;
- third-party Payload–Puck integration decision.

Exit: Cargo CMS page/workspace dashboard and Restaurant CMS/workspace overview work from shared builder/data/state contracts.

## Phase 5 — Events, jobs, realtime, driver slice

Deliverables:

- event/job wrappers;
- after-commit/outbox experiment;
- local realtime provider;
- typed channel authorization;
- source invalidation/stream experiment;
- driver dependency proof and minimal driver client.

Exit: secure cargo assignment/driver journey and live dashboard update work.

## Phase 6 — Lifecycle and operations proof

Deliverables:

- add/disable/uninstall/purge plans;
- database/realtime target/provider replacement experiments;
- theme/block/source/state/profile upgrade migration;
- reusable deployment workflow;
- release/fleet inventory;
- backup/restore exercise.

Exit: upgrade Cargo only, preserve Restaurant, and document go/no-go decisions.

## Implementation order

```text
contracts and schemas
  → static plugin manifest/catalog
  → capability/singleton resolver
  → CLI plan/generate/doctor
  → customer scaffold
  → Postgres provider + local target
  → Payload contribution adapter
  → permission/service/event/job foundations
  → UI/data/state/action contracts
  → binding graph validation/runtime
  → fixed shell and semantic primitives
  → two themes
  → visualization blocks
  → canonical document and Puck adapter
  → CMS profile and public sources
  → workspace profile and shared filter/chart/table graph
  → logistics/driver/realtime thin slice
  → restaurant/QR thin slice
  → lifecycle/migration/operations proof
```

Do not begin with full CRM, dispatch optimization, inventory accounting, budgeting, production GPS history, arbitrary query builder, or a broad plugin marketplace.

## Research output

At the end of the POC, produce:

- working platform and two customer repositories;
- accepted/rejected/superseded ADR updates;
- measured Payload/Puck/database-provider/binding-runtime results;
- module/plugin authoring guide;
- database adapter/target authoring guide;
- data-source/state/action/binding authoring guide;
- theme authoring guide;
- builder block/profile guide;
- customer application and CLI guide;
- compatibility/migration report;
- deployment/security runbooks;
- known limitations and rejected approaches;
- explicit go/no-go decisions for Payload, Puck, committed registries, layout inheritance model, database provider contract, binding graph scope, and package topology.