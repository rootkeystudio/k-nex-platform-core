# Deployment and Operations

## Deployment model

K-Nex does not require a central multi-customer SaaS control plane. Every customer application is generated, built, released, deployed, backed up, upgraded, and monitored independently.

```text
customer repository
  → exact packages and committed lockfile
  → generated plugin/provider/UI/theme registries
  → customer-owned migrations
  → immutable application image/artifact
  → customer web/worker/realtime processes
  → customer Postgres/storage/optional Redis
  → customer domain/secrets/backups/monitoring
```

Shared code exists as released packages and versioned reusable CI/CD workflows. Runtime customer data is never pooled merely because deployments use the same hosting provider.

## Customer resource boundary

At minimum, production resources are logically isolated per customer:

```text
Postgres database and credentials
object storage bucket/namespace and credentials
application secrets and signing keys
integration/provider credentials
optional Redis/realtime namespace or instance
job/outbox/audit storage
public/admin domains and TLS
backups and retention policy
logs, metrics, traces, and alerts labeled by application
```

Physical managed clusters can be shared by the infrastructure provider, but the application treats each customer database/storage/security context as an independent ownership boundary.

## Generated operations inputs

`create-k-nex-app` and `k-nex` can generate or update:

```text
Dockerfile
docker-compose.yml
.env.example
environment validation schema
web/worker scripts
provider/infrastructure requirements
build/release inventory
reusable GitHub Actions workflow calls
```

Generated files are starting points and source-controlled artifacts. Production credentials, provider account creation, DNS, TLS, and backup configuration remain deliberate deployment work.

The CLI separates:

### Local development infrastructure

```text
Postgres container
optional Redis
optional MinIO
optional development mail service
```

### Production packaging

```text
application Dockerfile
web/worker process commands
migration command/job
health/readiness endpoints
```

A project can use Docker locally without deploying containers, or deploy a container while using externally managed local services.

## Baseline runtime topology

### Small CMS/workspace customer

```text
reverse proxy / platform ingress
            │
            ▼
Next.js + Payload application
            │
            ├── Postgres
            └── object storage

background worker process
```

The worker can run in the same image with a different command.

### Customer with local realtime provider

```text
ingress / reverse proxy
      ├── HTTP requests
      └── WebSocket upgrade
              │
              ▼
 single application instance
      └── in-process connection registry
```

Appropriate for small single-instance deployments and development. Process restart drops connections; clients reconnect and recover state through API.

### Customer with distributed realtime provider

```text
ingress
  ├── application instance A
  ├── application instance B
  └── optional gateway instances
              │
              ▼
       Redis/backplane provider
```

The `realtime.gateway` consumer modules do not change. The provider selection and deployment topology do.

### Customer with high-volume tracking

```text
web/application
worker/tracking ingestion
Postgres business data
current-position provider
position-history/PostGIS or specialized provider
Redis/realtime backplane when required
object storage
```

Complexity is added because a selected module/workload requires it, not preinstalled for every customer.

## Process types

Potential logical processes:

```text
web
worker-default
worker-notifications
worker-integrations
worker-imports
worker-outbox
worker-tracking-retention
optional-realtime-gateway
```

Small deployments can combine logical queues in one worker. Package and queue contracts preserve the ability to split them later.

Each process should expose/emit its release inventory and health status.

## Environment configuration

The resolved plugin graph generates the required environment schema.

Examples:

```text
DATABASE_URL
PAYLOAD_SECRET
S3_ENDPOINT
S3_BUCKET
S3_ACCESS_KEY_ID
S3_SECRET_ACCESS_KEY
REDIS_URL
DRIVER_TOKEN_SIGNING_KEY
EMAIL_PROVIDER_API_KEY
```

Rules:

- `k-nex.app.json` stores environment variable names, never secret values;
- `.env.example` contains safe placeholders/descriptions;
- `.env.local` is ignored and used only for local development;
- production secrets come from deployment secret stores;
- `k-nex doctor` validates presence/shape without printing values;
- unused legacy secrets should be removed after provider/plugin replacement;
- credentials are customer-scoped and independently rotatable.

## Build artifact

A customer release should be immutable and identifiable by:

```text
application ID
environment
Git commit SHA
container image digest or artifact checksum
Node/pnpm/framework versions
core package version
plugin package versions and enabled state
capability providers
builder and theme packages
application manifest schema version
generated registry API version
database migration revision
CMS/layout/theme storage schema versions where relevant
driver/mobile app version when deployed separately
build timestamp and provenance
```

Generated `.k-nex/generated/build-manifest.json` supplies source inventory. Runtime startup can augment it with environment and actual migration/readiness status without including secrets.

## Build and CI pipeline

Suggested customer repository validation:

```text
checkout exact commit
  → configure private package registry auth
  → install frozen lockfile
  → validate k-nex.app.json and package/lockfile agreement
  → k-nex generate --check
  → k-nex doctor --ci
  → generate/check Payload types
  → lint/typecheck
  → unit and plugin contract tests
  → access/action/data-source/realtime security tests
  → UI builder/theme fixtures
  → clean-database migration test
  → previous-release upgrade test
  → build application and workers
  → build immutable container/artifact
  → container/process smoke tests
  → publish artifact and release inventory
```

No CI build should resolve floating customer package versions or silently rewrite the lockfile.

## Deployment pipeline

Typical production sequence:

```text
1. Verify approved commit/artifact/inventory.
2. Validate environment and provider readiness.
3. Confirm backup/readiness policy for migration risk.
4. Stop or coordinate conflicting workers when required.
5. Run pre-deploy/migration readiness checks.
6. Run customer-owned migration job.
7. Deploy web/workers/providers in compatible order.
8. Drain/reconnect realtime connections as needed.
9. Verify liveness/readiness and migration revision.
10. Run authenticated/public smoke tests.
11. Verify CMS/layout/theme publication/render fixtures.
12. Record deployed artifact/inventory/time/operator.
13. Monitor error, queue, DB, realtime, and provider signals.
```

Expand/contract deployment can require old and new application processes to overlap. Migration notes must state compatibility and ordering.

## Migration execution

Migrations are source-controlled customer artifacts. Production execution should be a dedicated job/process with appropriate credentials.

Recommended separation where practical:

```text
application DB role
  ordinary runtime reads/writes

migration DB role
  schema changes and elevated operations
```

Migration commands never run incidentally during `k-nex add`, package installation, application startup, or ordinary web requests.

Before destructive migration:

1. verify a recent restorable backup;
2. record current artifact, package inventory, and migration revision;
3. verify dependents/stored UI/theme/content references;
4. state rollback/restore limitations;
5. run readiness checks against production-sized data where possible;
6. define worker/traffic coordination;
7. obtain explicit approval.

## Runtime data requiring backup

Database backup includes more than business tables:

```text
CMS pages, drafts, versions, navigation, media metadata
workspace customer/role/user layouts and revisions
theme profiles and revisions
plugin runtime settings
permissions/roles/users
jobs, workflows, outbox, idempotency records
audit logs according to policy
domain records
```

Object storage backup/versioning includes:

```text
public CMS media
private documents
proof of delivery assets
customer brand assets where stored there
exports/generated files according to policy
```

Specialized stores such as tracking history need their own backup/retention strategy or documented reproducibility/ephemeral classification.

## Backup and restore

Per customer, define:

```text
backup frequency
retention and immutable/offsite policy
encryption and access control
recovery point objective (RPO)
recovery time objective (RTO)
restore credentials/destination
object-storage consistency process
specialized provider backup
post-restore integrity checks
```

A backup is not considered valid until restore is tested.

Post-restore checks can include:

- migration revision matches expected application release;
- plugin/runtime inventory compatible with data;
- published CMS pages render;
- active theme profiles resolve installed themes;
- workspace layouts have no unexpected orphan blocks;
- protected media access works;
- jobs/outbox do not replay invalid external side effects;
- authentication/session/signing behavior is safe after restore;
- integrations are disabled or pointed at safe endpoints in test restore.

## Rollback

Different layers roll back independently:

```text
application artifact
Postgres schema/data
CMS page publication
theme publication
workspace layout publication
provider/infrastructure configuration
driver/mobile release
```

Safe patterns:

- retain previous immutable artifact and lockfile;
- use backward-compatible expand/contract schema;
- retain prior published CMS/layout/theme revision;
- disable a supported plugin/feature to halt behavior without deleting data;
- take verified backup before irreversible transformation;
- document when database restore is the only safe rollback;
- do not assume rolling back code automatically rolls back migrated data.

## Realtime deployment

Operations must verify:

```text
WebSocket upgrade support
proxy idle/read timeouts
origin/TLS configuration
sticky-session need for selected provider
graceful drain and termination period
client reconnect/backoff behavior
Redis/backplane connectivity and namespace
connection/message/subscription limits
provider health and metrics
```

Rolling deployment flow:

```text
mark instance not ready for new connections
  → stop accepting upgrades
  → provide reconnect hint/close code where supported
  → drain bounded existing connections
  → terminate instance
  → clients reconnect and refetch authoritative state
```

Realtime is never the only source of critical business truth.

## Object storage

Provider operations must define:

- customer bucket/namespace isolation;
- public versus private object policy;
- signed URL behavior;
- lifecycle/retention/versioning;
- encryption;
- upload size/content controls;
- CDN/cache invalidation for public CMS media;
- migration/export between storage providers;
- backup consistency with database references.

Storage provider replacement is a data migration, not only an environment-variable change.

## Theme and builder operations

### Theme package changes

Installing/removing/upgrading a theme package requires:

```text
source/manifest/package change
static registry regeneration
profile compatibility/migration check
build/deploy
preview of migrated draft profiles
explicit runtime publication
```

A package upgrade must not silently publish a changed visual profile.

### Theme profile changes

Palette/token/profile publication can occur at runtime among installed themes. It should create an audit/revision and invalidate relevant public/admin render caches.

### Builder/component changes

Before removing/upgrading a block provider:

```text
scan CMS drafts and published versions
scan customer/role/user workspace layouts
run component migrations
report orphan references
preview representative pages/dashboards
```

Runtime rendering should fail safely for unavailable components; deployment readiness should detect known unresolved references.

## Plugin lifecycle operations

### Add/upgrade

Source-control plan, exact packages, generated registries, migrations, tests, artifact, deploy.

### Disable

Use only declared semantics. Data normally remains. Depending on contribution shape, disablement can require rebuild/deploy.

### Uninstall

Remove code/registration while retaining data only after verifying framework/schema boot behavior, dependencies, jobs, integrations, and UI references.

### Purge

Explicit destructive migration and retention/backup/approval process.

The production admin panel does not install packages, run migrations, or purge data.

## Health endpoints

### Liveness

Process event loop/runtime responds. It should not depend on every external provider.

### Readiness

Required dependencies are usable:

```text
configuration valid
database connection/migration revision
required storage/provider connectivity
required plugin runtime settings
no blocking schema/registry incompatibility
worker/gateway-specific readiness
```

### Degraded health

Optional integrations can be degraded without removing readiness when product behavior allows. Diagnostics identify owning plugin/provider and impact.

Health endpoints exposed publicly should return minimal information; detailed inventory/diagnostics require authentication/operations access.

## Observability

Every signal should include useful dimensions:

```text
application_id
environment
release_sha/image_digest
core_version
plugin_id/provider_id when relevant
request/correlation/job/event IDs
process type
migration revision
```

Minimum signals:

### Web/application

```text
HTTP latency/error rate
route/action/data-source failures
authentication/authorization denials
Payload/database query health
public cache/render failures
```

### Jobs/events

```text
queue depth
retry/failure/dead-letter count
outbox age
workflow progress
idempotency conflict
```

### Builder/themes

```text
publication validation failures
orphan block count
component/theme migration status
active theme/profile revision
public render/cache failure
```

### Realtime

```text
connections/subscriptions
auth/authorization denials
publish latency/fan-out
rate limits/drops/reconnects
backplane health
```

### Data/infrastructure

```text
DB connections/locks/slow queries/storage growth
object storage failures/growth
backup freshness/restore test status
specialized tracking retention/backlog
certificate/domain expiry
```

Avoid logging secret or unnecessary customer/personal data.

## Reusable workflows

Common CI/deploy logic can live in a dedicated repository:

```yaml
jobs:
  validate:
    uses: rootkeystudio/k-nex-workflows/.github/workflows/validate.yml@v1

  deploy:
    needs: validate
    uses: rootkeystudio/k-nex-workflows/.github/workflows/deploy.yml@v1
    with:
      environment: production
    secrets: inherit
```

Rules:

- pin version/tag or commit, not a moving branch;
- customer repository retains environment approvals and deployment configuration;
- shared workflow updates are reviewed/tested before adoption;
- workflow inventory/version appears in release metadata where useful.

## Package registry operations

The private registry decision is open, with GitHub Packages currently recommended for the initial spike.

Operational requirements:

- developer authentication;
- CI read/publish permissions;
- deployment build-token permissions;
- package visibility across private customer repositories;
- protected release workflow;
- exact package/version/provenance;
- token rotation;
- dependency-confusion protection for the selected scope;
- package retention and incident response.

Customer runtime containers do not need package-registry credentials when dependencies are built into immutable artifacts.

## Fleet inventory without runtime tenancy

A private operations repository or tool can track:

```yaml
customers:
  - id: acme-cargo
    repository: rootkeystudio/client-acme-cargo
    environment: production
    releaseSha: abc123
    imageDigest: sha256:...
    core: 1.4.2
    payload: 3.x
    plugins:
      module.logistics-core: 1.8.0
      module.logistics-driver: 1.3.0
    providers:
      realtime.gateway: provider.realtime-websocket-local@1.2.1
      database.primary: provider.database-postgres@1.0.0
    builder: builder.puck@0.1.0
    themes:
      admin: theme.minimal@1.0.0
      public: theme.neobrutalism@1.0.0
    migrationRevision: 2026-08-25-01

  - id: mamma-restaurant
    repository: rootkeystudio/client-mamma-restaurant
    environment: production
    core: 1.3.5
    plugins:
      module.cms: 2.1.0
      module.restaurant-core: 1.2.0
      module.restaurant-qr-menu: 1.1.2
```

This is operational metadata, not a shared customer database or runtime entitlement service.

Fleet inventory enables:

- security-version impact analysis;
- deprecated provider/theme identification;
- automated upgrade pull requests;
- pending migration/infrastructure tracking;
- backup/restore freshness reporting;
- customer release/support visibility.

## Security update workflow

1. Identify affected package/capability/version ranges.
2. Query fleet inventory.
3. Publish fixed package and migration/config notes.
4. Generate/open customer-specific upgrade PRs.
5. Run each customer's tests and migration plan.
6. Prioritize/deploy independently.
7. Verify new runtime/release inventory and monitoring.
8. Rotate secrets/providers when compromise scope requires it.

Package-based reuse makes impact machine-readable without forcing simultaneous deployment.

## Customer creation workflow

```text
run create-k-nex-app
  → choose plugins/providers/builder/themes/database/Docker
  → create local repository and manifest
  → configure private registry and environment
  → implement customer theme/assets/extensions/layouts
  → generate/review migrations
  → provision production resources/secrets/domain
  → run CI and build artifact
  → migrate/deploy/smoke test
  → register fleet inventory and backup/monitoring
```

The generated scaffold is start-ready, not automatically production-secure.

## Customer offboarding

Runbook:

```text
final data/media/layout/theme export
customer acceptance/format documentation
credential/token revocation
domain/DNS transfer or shutdown
integration/webhook disablement
repository/archive/access policy
retention and deletion schedule
backup expiration/destruction
infrastructure teardown confirmation
audit record and fleet inventory update
```

Independent resources simplify offboarding because records do not need to be filtered from a shared tenant database.

## Disaster recovery

Document per customer:

- infrastructure recreation from repository/IaC/manual runbook;
- database and object-storage restore order;
- matching application artifact/package inventory;
- secret/key restoration or rotation;
- DNS/TLS recovery;
- specialized provider recovery;
- job/outbox replay safety;
- CMS/theme/layout validation;
- business/security smoke tests.

A restore against an incompatible package/schema/theme registry is not a valid recovery.

## Initial infrastructure recommendation

Keep the POC simple:

```text
one Postgres database per customer
one object-storage boundary per customer
one web and one worker process
local realtime provider for cargo POC
Redis only for provider replacement/scaling experiment
immutable container releases
version-pinned reusable workflows
runtime release inventory
```

Add complexity only when a selected plugin or measured workload requires it.

## Operational acceptance criteria

- CLI-generated local Postgres/Docker scaffold starts reproducibly.
- Customer applications build with frozen lockfiles and static registries.
- Cargo and restaurant deploy independently.
- Release inventory matches runtime/package/migration state.
- Clean and previous-release migration tests run in CI.
- Backup and restore are exercised for at least one POC.
- Theme/layout/CMS revisions survive restore and render correctly.
- Realtime clients reconnect safely during deployment.
- Provider replacement reports and applies infrastructure changes without consumer module changes.
- One customer upgrades while the other remains on its previous release.
- Fleet inventory identifies an intentionally affected test package version.
