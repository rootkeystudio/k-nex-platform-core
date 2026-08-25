# Deployment and Operations

## Deployment model

K-Nex does not require a central SaaS control plane. Every customer application is built and operated independently.

Default isolation:

```text
customer repository
  → customer container image
  → customer application/worker deployment
  → customer database
  → customer object storage
  → customer secrets
  → customer domain
  → customer backups and monitoring
```

Shared code exists only as released package dependencies and reusable CI/CD workflows.

## Baseline runtime topology

For a small customer:

```text
reverse proxy / platform ingress
          │
          ▼
Next.js + Payload application
          │
          ├── Postgres
          └── object storage

separate Payload job worker process
```

When WebSocket/realtime is installed:

```text
reverse proxy / ingress
     ├── HTTP application
     └── WebSocket endpoint

single instance
     └── local realtime adapter

multiple instances
     └── Redis/distributed realtime adapter
```

When high-volume live tracking is installed, additional current-position and history storage may be introduced behind module provider contracts.

## Environment isolation

At minimum, production resources must be separate per customer:

- database and database credentials;
- object storage bucket or isolated namespace;
- application secrets;
- email/integration credentials;
- WebSocket/realtime secrets;
- domain and TLS configuration;
- backups;
- logs and alerts with customer/application labels.

Staging should not reuse production credentials or silently read production data.

## Build artifact

A customer release should identify:

- Git commit SHA;
- container image digest;
- core version;
- module versions;
- Payload version;
- schema/migration revision;
- frontend/driver app version where applicable;
- deployment timestamp and environment.

The application can expose non-sensitive inventory through an authenticated operations endpoint or startup log.

## CI pipeline

Suggested customer repository pipeline:

```text
install exact dependencies
  → validate environment schema
  → validate module graph
  → generate Payload types
  → lint and typecheck
  → unit/module integration tests
  → clean-database migration test
  → previous-version upgrade test
  → build application
  → build container
  → container smoke test
  → publish immutable image
```

Production deployment adds:

```text
verify backup/readiness
  → run pre-deploy checks
  → run migration job
  → deploy application/workers
  → health/readiness verification
  → run smoke tests
  → record release inventory
```

Migration and application deployment ordering depends on backward compatibility. Expand/contract migrations should be used when old and new processes may overlap.

## Reusable workflows

Keep common CI logic in a dedicated workflow repository or shared workflow directory.

Customer workflow example:

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

Pin shared workflow versions. Do not reference an unversioned moving branch for production deployment.

## Application and worker separation

Background jobs should be runnable in a separate process/container so expensive work does not block or destabilize the HTTP application.

Potential process types:

```text
web
worker-default
worker-integrations
worker-imports
worker-tracking-retention
```

Small deployments may combine logical queues into one worker while preserving the ability to split later.

## WebSocket deployment

Operations must define:

- sticky sessions, if required by the chosen adapter;
- load-balancer WebSocket upgrade support;
- connection drain behavior during deploy;
- reconnect policy;
- maximum connection and message limits;
- distributed adapter health;
- origin and authentication configuration;
- metrics for active connections and failed handshakes.

A rolling deployment should stop accepting new connections, provide reconnect hints where possible, drain existing connections for a bounded period, and then terminate.

## Backups and restore

Per customer, define:

- database backup frequency and retention;
- object storage versioning/backup policy;
- encryption and access control;
- recovery point objective;
- recovery time objective;
- restore destination and credential procedure;
- post-restore integrity checks.

Backups are not considered valid until a restore has been tested.

Before a destructive migration:

1. create/verify a recent backup;
2. record currently deployed image and package inventory;
3. confirm rollback limitations;
4. run migration readiness checks;
5. prevent conflicting background workers during the critical step if necessary.

## Secrets

- Never publish customer credentials inside shared module packages.
- Validate required secrets from the resolved module graph.
- A module declares secret requirements by logical name and purpose.
- Customer deployment maps logical secrets to environment or secret-manager values.
- Rotate secrets per customer without releasing shared code.
- Separate application, database, storage, signing, and integration credentials.

Example requirement:

```ts
websocketModule({
  auth: {
    tokenSigningKey: secret('WEBSOCKET_TOKEN_SIGNING_KEY'),
  },
})
```

## Observability

Every log/trace/metric should carry useful dimensions:

```text
application_id
customer_environment
release_sha
core_version
module_versions or module_id
request_id
correlation_id
job_id
```

Minimum operational signals:

- HTTP latency/error rate;
- database connection and query health;
- queue depth, retry, and failure count;
- WebSocket connections and publish failures;
- storage upload failures;
- migration status;
- health/readiness failures;
- integration/provider failures;
- disk/data growth and backup freshness.

Avoid putting sensitive customer data into logs by default.

## Fleet inventory without a control plane

A lightweight private operations repository can track customer deployments:

```yaml
customers:
  - id: acme-cargo
    repository: rootkeystudio/client-acme-cargo
    productionUrl: internal-reference
    core: 1.4.2
    modules:
      logistics.core: 1.8.0
      logistics.dispatch: 1.5.1
      transport.websocket: 1.4.2
      driver: 1.3.0

  - id: mamma-restaurant
    repository: rootkeystudio/client-mamma-restaurant
    core: 1.3.5
    modules:
      cms: 2.1.0
      restaurant.core: 1.2.0
      restaurant.qr-menu: 1.1.2
      restaurant.inventory: 1.0.8
```

This is operational inventory, not runtime tenancy. It can later be generated automatically from release metadata.

## Security update workflow

When a shared package has a security issue:

1. identify affected version ranges;
2. query fleet inventory for affected customers;
3. publish fixed package version and migration notes;
4. open automated customer upgrade pull requests;
5. prioritize and deploy customers independently;
6. verify fixed inventory in each environment.

This is the main benefit of package-based reuse over copied core source.

## Customer offboarding

An offboarding runbook should cover:

- final data export format;
- credential revocation;
- domain/DNS transfer where applicable;
- retention and deletion obligations;
- backup expiration;
- repository/archive policy;
- infrastructure teardown confirmation;
- audit record of deletion.

Because resources are isolated, one customer's offboarding does not require filtering data from a shared database.

## Initial infrastructure recommendation

Keep the first POC operationally simple:

- one Postgres database per customer;
- one object-storage boundary per customer;
- one web process and one worker process;
- local WebSocket adapter for a single instance;
- Redis only when multi-instance or queue/realtime requirements justify it;
- immutable container releases;
- reusable but version-pinned GitHub Actions workflows.

Add complexity only when a selected module or measured workload requires it.