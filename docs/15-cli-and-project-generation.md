# CLI and Project Generation

## Product role

The K-Nex CLI is the primary application-composition interface. It creates customer repositories, edits the application manifest, resolves plugin dependencies, installs exact package versions, generates static registries, prepares local infrastructure, validates migrations, and reports the final product inventory.

It is not only a template copier. It is a **product-line compiler** that transforms a declarative application specification into a reviewable, deployable customer repository.

## Package and command names

Use names that do not collide with the existing `knex` SQL query-builder ecosystem.

```text
create-k-nex-app      project creation package
@k-nex/cli            ongoing project-management package
k-nex                 CLI executable
k-nex.app.json        declarative application manifest
k-nex.config.ts       programmatic customer extensions
```

Examples:

```bash
pnpm create k-nex-app acme-cargo
pnpm dlx create-k-nex-app acme-cargo
pnpm exec k-nex doctor
```

## CLI principles

1. **Plan before mutation.** Every material command can show its proposed package, manifest, generated-file, infrastructure, and migration changes.
2. **Deterministic output.** The same input manifest, catalog, lockfile, and CLI version produce the same generated files.
3. **No hidden runtime installation.** Packages are installed through repository changes and deployment, never from the production admin panel.
4. **No secret leakage.** Secret values are accepted only through protected prompts or environment input and are never written to committed manifests or logs.
5. **Safe interruption.** Filesystem changes are staged and applied only after validation succeeds.
6. **Human-reviewable diffs.** Generated registries, package changes, and migration warnings are visible in pull requests.
7. **Interactive and automated modes.** Every interactive choice has a non-interactive flag or manifest representation.
8. **Shared resolver.** CLI and runtime/core validation use the same contracts and resolution algorithm.

## Project creation flow

Example:

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

◇ Select a starting preset
  ● Custom
  ○ Logistics
  ○ Restaurant
  ○ Corporate CMS + CRM

◇ Select modules
  ◉ CMS
  ◉ CRM
  ◉ Visual builder
  ◉ Logistics core
  ◉ Dispatch
  ◉ Driver operations
  ◉ Live tracking

◇ Builder engine
  ● Puck

◇ Enable workspace customization?
  ● Yes
  ○ No

◇ Admin theme packages
  ◉ Minimal
  ◉ Neobrutalism
  ◯ Glassmorphism

◇ Default admin theme
  ● Minimal

◇ Public theme packages
  ◉ Neobrutalism
  ◉ Glassmorphism

◇ Default public theme
  ● Neobrutalism

◇ Database for development
  ● Local Postgres with Docker Compose
  ○ External Postgres URL
  ○ SQLite demo mode

◇ Object storage for development
  ● Local filesystem
  ○ MinIO with Docker Compose
  ○ External S3-compatible service

◇ Realtime provider
  ● Local WebSocket adapter
  ○ Redis-backed WebSocket adapter
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

Result summary:

```text
✔ Loaded first-party plugin catalog
✔ Expanded selected preset
✔ Resolved 14 requested plugins
✔ Added 3 required capability providers
✔ Validated core/Payload/Node compatibility
✔ Generated k-nex.app.json
✔ Generated static plugin, provider, UI, and theme registries
✔ Generated local Docker Compose services
✔ Generated .env.example and local .env.local
✔ Installed exact dependencies
✔ Generated Payload types
✔ Initialized Git repository

Next steps:
  cd acme-cargo
  pnpm dev:infra
  pnpm dev
```

## Default project decisions

Initial supported production profile:

```text
TypeScript
pnpm workspace
Next.js + Payload
Postgres
customer-specific repository
customer-specific database
customer-specific deployment
exact package versions
Dockerfile available by default
```

SQLite is a fast demo/POC mode, not the default path for a product expected to run on Postgres. MongoDB is not an officially supported K-Nex V1 production profile even if the underlying framework can support it; adding it requires module compatibility testing.

## Generated repository

Default customer scaffold:

```text
acme-cargo/
├── apps/
│   ├── platform/
│   │   ├── src/
│   │   │   ├── app/
│   │   │   ├── platform/
│   │   │   ├── payload.config.ts
│   │   │   └── extensions/
│   │   └── package.json
│   └── driver/
│       └── optional customer driver application
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
│       ├── theme-registry.ts
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

A website-only or backend-only profile may omit unnecessary applications while preserving the same manifest and plugin model.

## Architecture

Suggested CLI packages:

```text
packages/cli/
├── commands/
├── catalog/
├── resolver/
├── planner/
├── filesystem/
├── templates/
├── generators/
├── package-manager/
├── migrations/
├── prompts/
├── diagnostics/
└── schemas/
```

### Catalog loader

Reads the trusted first-party plugin catalog and selected package manifests. It does not execute plugin server code.

### Resolver

Validates requested plugins, capabilities, conflicts, compatibility, provider cardinality, environment requirements, and registration order.

### Planner

Computes an explicit change plan:

```text
manifest additions/removals/updates
package additions/removals/updates
generated registry changes
local infrastructure changes
environment variable changes
schema/migration risk
orphan UI blocks or stored data risk
```

### Filesystem transaction

Writes changes to a temporary staging directory or in-memory representation, validates the result, then atomically replaces target files where possible. If dependency installation or generation fails, the CLI restores the pre-command repository state and reports manual cleanup if any external process changed files.

### Package-manager adapter

V1 supports pnpm. The adapter is still explicit so package operations are testable and a future alternative does not infect resolver logic.

### Generator

Produces static TypeScript registries and machine-readable release inventory from the resolved graph.

### Diagnostics

Formats errors with plugin ownership, capability ranges, affected files, suggested commands, and migration impact.

## Command set

### `k-nex init`

Adopts an existing compatible project or initializes K-Nex metadata inside an empty repository.

```bash
k-nex init
```

It creates the manifest, config, generated directory, scripts, and baseline checks. Adoption of an existing Payload project must remain conservative and never overwrite application code without a diff and confirmation.

### `k-nex plan`

Shows what would change without writing files.

```bash
k-nex plan
k-nex plan --add module.crm
k-nex plan --remove module.inventory
k-nex plan --format json
```

The JSON form is suitable for CI, bots, or a future control utility.

### `k-nex apply`

Applies a previously described or currently computed plan.

```bash
k-nex apply
k-nex apply --non-interactive
```

Material dependency additions in interactive mode require confirmation. CI mode requires explicit flags and fails instead of asking questions.

### `k-nex add`

Adds a plugin request and resolves transitive capability requirements.

```bash
k-nex add module.logistics-driver
k-nex add @k-nex/module-driver@1.3.0
k-nex add theme.neobrutalism --surface public
```

Example plan:

```text
Requested:
  + module.logistics-driver@1.3.0

Required additions:
  + module.logistics-core@1.8.0
  + provider.realtime-websocket-local@1.2.1

Capabilities:
  logistics.domain@1.x → module.logistics-core
  realtime.gateway@1.x → provider.realtime-websocket-local

Infrastructure impact:
  WebSocket endpoint enabled
  no Redis required for selected local adapter

Database impact:
  new driver, device, task, and idempotency data
  migration generation required
```

### `k-nex remove`

Plans disable, uninstall, or purge semantics.

```bash
k-nex remove module.crm --mode disable
k-nex remove module.crm --mode uninstall
k-nex remove module.crm --mode purge
```

Purge requires:

- explicit `--confirm-purge <plugin-id>`;
- dependency and stored-layout analysis;
- backup acknowledgement;
- generated destructive migration review.

### `k-nex enable` and `k-nex disable`

Changes enabled state for plugins that declare safe disable semantics.

```bash
k-nex disable module.crm
k-nex enable module.crm
```

A schema-owning plugin can remain registered for data compatibility while its UI, writes, schedules, subscribers, and public routes are gated.

### `k-nex sync`

Reconciles manually edited `k-nex.app.json`, `package.json`, the lockfile, and generated registries.

```bash
k-nex sync
k-nex sync --check
```

`--check` performs no writes and is intended for CI.

### `k-nex generate`

Generates registries and diagnostics without changing requested plugin composition.

```bash
k-nex generate
k-nex generate --check
```

Generation includes:

- plugin imports;
- provider bindings;
- Payload contribution composition;
- UI/navigation/block registry;
- theme registry;
- environment schema;
- release/build inventory.

### `k-nex doctor`

Validates the full repository and local environment.

Checks include:

```text
manifest schema and canonical form
package.json and lockfile agreement
plugin/capability compatibility
duplicate IDs, routes, permissions, jobs, events, blocks, and Payload slugs
missing environment variables
provider infrastructure requirements
stale generated files
pending migration/schema differences
orphan builder components
invalid runtime theme profiles
untrusted or deprecated packages
known incompatible versions
```

Output levels:

```text
PASS     no action required
INFO     diagnostic information
WARN     supported but risky or migration-sensitive
ERROR    build/deploy must stop
```

### `k-nex inspect`

Displays the resolved application graph and inventory.

```bash
k-nex inspect
k-nex inspect capabilities
k-nex inspect ui
k-nex inspect module.logistics-driver
```

### `k-nex upgrade`

Plans package upgrades without applying them blindly.

```bash
k-nex upgrade
k-nex upgrade module.crm
k-nex upgrade --security-only
```

The plan shows:

- current and target versions;
- core/Payload compatibility;
- required related upgrades;
- migration notes;
- configuration changes;
- infrastructure changes;
- known rollback limitations.

### `k-nex db`

Coordinates framework migration commands and K-Nex checks.

```bash
k-nex db diff
k-nex db generate
k-nex db migrate
k-nex db status
k-nex db validate-upgrade --from <fixture-or-backup>
```

The CLI wraps rather than hides underlying migration artifacts. Generated customer migrations remain visible source files.

### `k-nex theme`

Manages installed theme packages and runtime defaults.

```bash
k-nex theme add theme.neobrutalism
k-nex theme remove theme.glassmorphism
k-nex theme set theme.neobrutalism --surface public
k-nex theme validate
```

Installing/removing a theme package changes code and requires deployment. Changing the active profile among installed themes can also occur in the application panel at runtime.

### `k-nex manifest migrate`

Updates the source manifest format without changing application database state.

```bash
k-nex manifest migrate
```

## Non-interactive creation

Every interactive choice can be supplied explicitly:

```bash
pnpm create k-nex-app acme-cargo \
  --preset logistics \
  --modules module.cms,module.crm,module.logistics-driver \
  --builder builder.puck \
  --admin-theme theme.minimal \
  --public-theme theme.neobrutalism \
  --database docker-postgres \
  --storage minio \
  --realtime websocket-local \
  --dockerfile \
  --git \
  --install \
  --non-interactive
```

For repeatability, creation can also read a specification file:

```bash
pnpm create k-nex-app --from ./customer-spec.json
```

The resulting repository always contains the normalized `k-nex.app.json`; the creation spec is not required at runtime.

## Secret handling

### External database URL

When the user selects an external database, the prompt is masked. The URL is written only to `.env.local` after verifying that the file is ignored by Git.

The manifest receives:

```json
{
  "connectionEnvironmentVariable": "DATABASE_URL"
}
```

### Generated secrets

The CLI can generate local-only random values such as `PAYLOAD_SECRET`. It must:

- use a cryptographically secure random source;
- write only to ignored local environment files;
- avoid printing the full value after creation;
- place safe placeholders in `.env.example`;
- never commit or transmit the value.

### Logs

Diagnostics redact values matching registered secret variables and common credential URL patterns.

## Docker generation

The CLI asks two separate questions.

### Development infrastructure

Generate `docker-compose.yml` for selected local services:

```text
Postgres
Redis when required
MinIO when selected
mail-catcher when selected
optional observability services for advanced profiles
```

### Production packaging

Generate a production `Dockerfile` and process commands for:

```text
web
worker
optional realtime gateway when separated
```

These decisions are independent. A project can use local Docker services while deploying the application without Docker, or use a production container with externally managed development infrastructure.

## Git behavior

V1 can initialize a local Git repository and make an optional initial commit.

```bash
k-nex init --git
```

Creating a remote GitHub repository is not required for V1. It can be added later as an authenticated optional command so local project generation remains independent of one source-control provider.

## Migration behavior during plugin changes

After a composition change, the CLI classifies database impact:

```text
none        no schema/data change
additive    new tables/fields/indexes, normally safe after review
transform   explicit data migration/helper required
destructive drop or irreversible conversion; backup and confirmation required
unknown     plugin did not provide sufficient metadata; block automation
```

The CLI may generate a schema migration draft but never claims it is safe without customer-application tests.

## Stored UI and theme impact

Before uninstalling a module or theme, the CLI or application readiness check identifies:

- stored layouts referencing module blocks;
- pages requiring a renderer supplied by the plugin;
- active theme profiles using the theme package;
- role/user layouts inheriting affected components;
- unpublished drafts as well as published content.

The default behavior is to preserve data and produce orphan diagnostics, not silently delete content.

## Failure and rollback behavior

Command execution stages:

```text
1. load current state
2. calculate plan
3. stage manifest/package/generated changes
4. validate staged composition
5. install/update packages in staged repository state
6. generate registries
7. run configured validation hooks
8. atomically apply files where possible
9. report required migration/testing steps
```

On failure before apply, the original repository is unchanged. On failure after an external package-manager operation, the CLI restores tracked files and reports any untracked cache/state requiring cleanup.

The CLI should never run a production database migration as an incidental side effect of `add`, `remove`, `sync`, or `generate`.

## CLI version compatibility

The CLI publishes:

- supported manifest schema versions;
- supported core ranges;
- supported Node and pnpm ranges;
- generated-code API version.

A generated header records the CLI version. `k-nex doctor` warns when the repository was generated by an incompatible version and provides a migration command.

## Telemetry

V1 should not send customer composition, repository paths, plugin choices, or command usage to an external service by default.

Any future telemetry must be:

- opt-in;
- documented;
- free of secrets and customer data;
- disableable through environment and configuration;
- unnecessary for core functionality.

## Test strategy

The CLI requires fixture-driven tests for:

- every interactive answer path;
- non-interactive equivalent output;
- dependency additions and provider selection;
- conflict and cycle failures;
- exact manifest normalization;
- generated-file determinism;
- interruption/rollback behavior;
- secret redaction;
- add/disable/uninstall/purge plans;
- stale generated-file detection;
- upgrade compatibility warnings;
- Windows, macOS, and Linux path/process behavior where supported.

Golden repositories can verify that a given creation specification produces an expected scaffold and resolved inventory.

## V1 boundaries

V1 does not:

- install packages from the runtime admin panel;
- discover arbitrary third-party marketplace packages;
- create a production database automatically without explicit deployment configuration;
- apply destructive migrations automatically;
- generate complete business applications from natural language;
- guarantee support for every Payload database adapter;
- create a shared multi-customer control plane.

The CLI creates and maintains independently deployable customer repositories from trusted, versioned K-Nex packages.
