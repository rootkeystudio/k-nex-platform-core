# CLI and Project Generation

## Product role

The K-Nex CLI creates and maintains independently deployable customer repositories.

It is not only a template copier. It is a **product-line compiler** that transforms a declarative application specification into:

```text
Payload application scaffold
+ selected Payload database adapter
+ exact K-Nex plugin packages
+ generated static registries
+ customer composition root
+ local infrastructure files
+ environment schema
+ migration/test/deployment workflow
```

## Package and command names

```text
create-k-nex-app      project creation package
@k-nex/cli            ongoing project-management package
k-nex                 executable
k-nex.app.json        declarative application manifest
k-nex.config.ts       programmatic customer extensions
```

Avoid `knex` command/config names because they collide with the existing SQL query-builder ecosystem.

Examples:

```bash
pnpm create k-nex-app acme-cargo
pnpm dlx create-k-nex-app acme-cargo
pnpm exec k-nex doctor
```

# CLI principles

1. **Plan before mutation.** Material changes show package, framework, source, UI, environment, infrastructure, and migration impact.
2. **Deterministic output.** Same manifest, catalog, lockfile, CLI version, and customer config produce the same generated artifacts.
3. **Payload is explicit.** The CLI generates Payload configuration instead of hiding it behind a K-Nex database/runtime abstraction.
4. **No hidden runtime installation.** Executable packages change through repository/deployment workflows, never the production panel.
5. **No secret leakage.** Secret values never enter committed manifests, generated registries, or logs.
6. **Safe interruption.** File changes are staged/validated before apply; failures restore tracked state where possible.
7. **Reviewable diffs.** Composition, imports, source registries, adapter package, and migration requirements appear in source control.
8. **Interactive and automated parity.** Every prompt has a flag/spec representation.
9. **Shared contracts.** CLI and runtime use the same plugin/source/compatibility schemas.
10. **No false database portability.** V1 selects Payload Postgres; changing database family is not presented as a plugin swap.

# Project creation flow

```text
$ pnpm create k-nex-app acme-cargo

◇ Application name
  Acme Cargo

◇ Application ID
  acme-cargo

◇ Project type
  ● Customer platform
  ○ Website only
  ○ Backend only

◇ Starting preset
  ● Custom
  ○ Logistics
  ○ Restaurant
  ○ Corporate CMS + Sales

◇ Modules
  ◉ CMS
  ◉ Sales/CRM
  ◉ Visualization blocks
  ◉ Logistics core
  ◉ Dispatch
  ◉ Driver operations
  ◉ Live tracking

◇ Builder engine
  ● Puck

◇ Builder profiles
  ◉ CMS/public pages
  ◉ Workspace dashboards/reports

◇ Admin themes
  ◉ Minimal
  ◉ Neobrutalism
  ◯ Glassmorphism

◇ Default admin theme
  ● Minimal

◇ Public themes
  ◉ Neobrutalism
  ◉ Glassmorphism

◇ Default public theme
  ● Neobrutalism

◇ Payload database adapter
  ● Postgres

◇ Local database setup
  ● Generate Docker Postgres
  ○ Use existing DATABASE_URL

◇ Object storage
  ● Local filesystem
  ○ MinIO with Docker Compose
  ○ External S3-compatible service

◇ Realtime provider
  ● Local WebSocket
  ○ Redis-backed WebSocket
  ○ None

◇ Generate production Dockerfile?
  ● Yes
  ○ No

◇ Initialize Git repository?
  ● Yes
  ○ No

◇ Install dependencies now?
  ● Yes
  ○ No
```

V1 exposes only Postgres as a supported Payload adapter. Future experimental choices appear only after complete K-Nex compatibility work.

## Result summary

```text
✔ Loaded trusted plugin catalog
✔ Expanded selected preset
✔ Resolved requested plugins and replaceable capabilities
✔ Selected Payload database adapter: postgres
✔ Added @payloadcms/db-postgres
✔ Validated core/Payload/Node compatibility
✔ Generated k-nex.app.json and k-nex.config.ts
✔ Generated Payload database/config composition
✔ Generated plugin/provider/UI/source/action/state/theme registries
✔ Generated Docker Postgres and selected local services
✔ Generated .env.example and ignored .env.local
✔ Installed exact dependencies
✔ Generated Payload types
✔ Initialized Git repository

Next:
  cd acme-cargo
  pnpm dev:infra
  pnpm dev
```

# Default project decisions

```text
TypeScript
pnpm workspace
Next.js + Payload
Payload Postgres adapter
local Docker Postgres by default
separate customer repository/database/deployment
exact package versions
production Dockerfile available
```

SQLite and other Payload adapters are not supported K-Nex V1 profiles.

# Generated repository

```text
acme-cargo/
├── apps/
│   ├── platform/
│   │   ├── src/
│   │   │   ├── app/
│   │   │   ├── platform/
│   │   │   ├── extensions/
│   │   │   └── payload.config.ts
│   │   └── package.json
│   └── driver/
│       └── optional customer driver app
├── packages/
│   ├── customer-components/
│   ├── customer-extensions/
│   └── customer-theme/
├── migrations/
├── tests/
├── infra/
├── .k-nex/
│   └── generated/
│       ├── plugin-registry.ts
│       ├── provider-registry.ts
│       ├── ui-registry.ts
│       ├── data-source-registry.ts
│       ├── action-registry.ts
│       ├── state-registry.ts
│       ├── theme-registry.ts
│       ├── payload-database.ts
│       ├── payload-contributions.ts
│       ├── environment-schema.ts
│       └── build-manifest.json
├── k-nex.app.json
├── k-nex.config.ts
├── pnpm-workspace.yaml
├── package.json
├── pnpm-lock.yaml
├── Dockerfile
├── docker-compose.yml
├── .env.example
├── .gitignore
└── README.md
```

# CLI architecture

Suggested packages:

```text
packages/cli/
├── commands/
├── catalog/
├── resolver/
├── planner/
├── filesystem/
├── templates/
├── generators/
├── payload/
├── package-manager/
├── migrations/
├── prompts/
├── diagnostics/
└── schemas/
```

## Catalog loader

Reads trusted first-party plugin metadata without executing plugin server code.

## Resolver

Validates:

```text
plugin dependencies
replaceable capabilities
conflicts and cycles
core/Payload/Node compatibility
provider cardinality
surface/audience metadata
environment requirements
registration order
```

The resolver does not resolve a K-Nex `database.primary` provider. It validates the supported Payload adapter selected under `framework.payload.database`.

## Planner

Computes:

```text
manifest changes
package/lockfile changes
Payload adapter/config changes
generated registry changes
environment and Docker changes
schema/migration impact
source/action/UI inventory impact
orphan layout/theme risk
```

## Filesystem transaction

Stages changes, validates generated composition, and applies files atomically where possible. Package-manager side effects are restored/reported if a later step fails.

## Package-manager adapter

V1 supports pnpm explicitly.

## Payload generator

Generates:

- selected database adapter import/config;
- final Payload plugin/contribution composition;
- type-generation scripts;
- migration scripts;
- framework-specific environment validation;
- collision diagnostics.

## Registry generator

Generates static imports for:

```text
plugins/providers
navigation/screens/blocks
data-source descriptors and handlers
actions/state/context definitions
themes/builder adapters
Payload contributions
```

## Diagnostics

Errors identify stable ID, package owner, conflicting contribution, affected files/layouts, and suggested remediation.

# Command set

## `k-nex init`

Initializes K-Nex metadata in an empty or conservatively adopted compatible Payload project.

```bash
k-nex init
```

Existing code is never overwritten without a plan/diff.

## `k-nex plan`

```bash
k-nex plan
k-nex plan --add module.sales
k-nex plan --remove module.inventory
k-nex plan --format json
```

No writes.

## `k-nex apply`

```bash
k-nex apply
k-nex apply --non-interactive
```

Applies a validated plan.

## `k-nex add`

```bash
k-nex add module.logistics-driver
k-nex add @k-nex/module-driver@1.3.0
k-nex add theme.neobrutalism --surface public
```

Example:

```text
Requested:
  + module.logistics-driver@1.3.0

Required:
  + module.logistics-core@1.8.0
  + provider.realtime-websocket-local@1.2.1

Capabilities:
  logistics.domain@1.x → module.logistics-core
  realtime.gateway@1.x → provider.realtime-websocket-local

Payload/schema impact:
  driver/device/task collections contributed
  customer migration required

UI/source impact:
  driver routes/screens/sources registered
  authenticated driver subscriptions enabled
```

## `k-nex remove`

```bash
k-nex remove module.sales --mode disable
k-nex remove module.sales --mode uninstall
k-nex remove module.sales --mode purge
```

Purge requires dependency/layout/source/data scans, backup acknowledgement, explicit confirmation, and reviewed destructive migration.

## `k-nex enable` / `k-nex disable`

```bash
k-nex disable module.sales
k-nex enable module.sales
```

Disablement can gate navigation, sources, actions, jobs, subscribers, and writes while retaining schema/data where supported.

## `k-nex sync`

```bash
k-nex sync
k-nex sync --check
```

Reconciles manifest, package files, adapter dependency, and generated registries.

## `k-nex generate`

```bash
k-nex generate
k-nex generate --check
```

Generation includes:

```text
Payload database/config composition
plugin/provider registries
UI/navigation/block registry
data-source/action/state/context registry
theme/builder registry
environment schema
build inventory
```

## `k-nex doctor`

Checks:

```text
manifest schema/canonical form
package and lockfile agreement
selected Payload adapter package/config
plugin/capability compatibility
duplicate Payload slugs/routes/permissions/events/jobs/blocks/sources/actions/states
source descriptor/handler and output contract validity
source field permissions and table metadata
missing environment variables
stale generated files
pending migration/schema differences
orphan page/layout/source bindings
invalid theme profiles
realtime provider requirements
known incompatible versions
```

Levels:

```text
PASS
INFO
WARN
ERROR
```

## `k-nex inspect`

```bash
k-nex inspect
k-nex inspect capabilities
k-nex inspect ui
k-nex inspect sources
k-nex inspect source sales.tasks
k-nex inspect module.sales
```

Source inspection can show:

```text
owner/version
surface/audience
permission
input/output contract
selectable fields
pagination/sort/filter policy
realtime topics
stored layout references
```

## `k-nex upgrade`

```bash
k-nex upgrade
k-nex upgrade module.sales
k-nex upgrade --security-only
```

Shows related upgrades, Payload compatibility, source/block contract changes, migrations, and rollback limitations.

## `k-nex db`

Wraps visible Payload/customer migration workflow:

```bash
k-nex db diff
k-nex db generate
k-nex db migrate
k-nex db status
k-nex db validate-upgrade --from <fixture-or-backup>
```

The CLI does not hide or replace Payload migration artifacts.

## `k-nex theme`

```bash
k-nex theme add theme.neobrutalism
k-nex theme remove theme.glassmorphism
k-nex theme set theme.neobrutalism --surface public
k-nex theme validate
```

Package install/removal requires deploy; runtime profile activation can occur in the panel.

## `k-nex manifest migrate`

Migrates manifest source format only, not application data.

# Non-interactive creation

```bash
pnpm create k-nex-app acme-cargo \
  --preset logistics \
  --modules module.cms,module.sales,module.visualization,module.logistics-driver \
  --builder builder.puck \
  --admin-theme theme.minimal \
  --public-theme theme.neobrutalism \
  --payload-db postgres \
  --database-mode docker-postgres \
  --storage minio \
  --realtime websocket-local \
  --dockerfile \
  --git \
  --install \
  --non-interactive
```

Or:

```bash
pnpm create k-nex-app --from ./customer-spec.json
```

The normalized `k-nex.app.json` remains the repository source of truth.

# Secret handling

## External database URL

A masked prompt writes only to ignored `.env.local` after confirming Git ignore coverage.

Manifest:

```json
{
  "connectionEnvironmentVariable": "DATABASE_URL"
}
```

## Generated local secrets

The CLI may generate local-only `PAYLOAD_SECRET` values using a secure random source. It never prints full values after creation or places them in committed files.

## Logs

Diagnostics redact registered secret variables and credential-like URLs.

# Docker generation

## Development infrastructure

Generated according to selected modules/providers:

```text
Postgres
Redis when required
MinIO when selected
mail catcher when selected
```

## Production packaging

Optional Dockerfile/process definitions:

```text
web
worker
separate realtime process where selected
migration command/job
```

Development Docker and production containers are independent choices.

# Git behavior

V1 initializes local Git and can create an initial commit. Remote GitHub creation is a later authenticated optional command.

# Migration impact

After composition changes:

```text
none
additive
transform
destructive
unknown
```

The CLI never runs production migrations as a side effect of add/remove/sync/generate.

# Stored UI and source impact

Before disabling/removing/upgrading a plugin, readiness identifies:

```text
stored pages/layouts using plugin blocks
bindings using plugin data sources/actions/state
selected fields removed or permission-changed
active theme profiles
role/user layout inheritance
published and draft references
```

Data and documents are preserved by default with actionable orphan diagnostics.

# Failure and rollback

```text
1. load current state
2. calculate plan
3. stage manifest/package/framework/generated changes
4. validate staged composition
5. install exact dependencies
6. generate registries/Payload config
7. run checks/tests configured for the command
8. apply files atomically where possible
9. report migration/deploy steps
```

# CLI compatibility

The CLI publishes supported manifest, core, Payload, Node, pnpm, and generated-code API ranges. `doctor` identifies incompatible generator versions and required manifest migrations.

# Telemetry

No external K-Nex CLI telemetry by default. Future telemetry must be explicit opt-in and contain no customer composition, paths, secrets, or business data.

# Test strategy

Fixture/golden tests cover:

- every interactive branch and non-interactive equivalent;
- Payload Postgres adapter installation/config generation;
- plugin/capability resolution and failure cases;
- source/action/UI registry determinism;
- duplicate source/field/contribution errors;
- secret redaction;
- filesystem rollback;
- add/disable/uninstall/purge plans;
- stale generated files;
- migration warnings;
- supported platform path/process behavior.

# V1 boundaries

V1 does not:

- install packages from runtime admin UI;
- discover arbitrary marketplace packages;
- abstract Payload database APIs behind K-Nex providers;
- support every Payload database adapter;
- create production databases automatically without explicit deployment setup;
- apply destructive migrations automatically;
- expose arbitrary user-created data queries;
- create a shared multi-customer control plane.
