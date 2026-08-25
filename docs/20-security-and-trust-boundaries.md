# Security and Trust Boundaries

## Purpose

K-Nex combines executable plugins, customer code, stored visual layouts, runtime theme profiles, public content, authenticated business applications, and independent customer infrastructure. Security depends on treating each of these as a different trust boundary.

The architecture does not rely on visual hiding, client-side permission metadata, or separate-customer deployment alone. Every sensitive data source, action, command, subscription, and public projection is authorized and validated on the server.

## Trust model

### Trusted executable code

The following execute inside the customer application process and are trusted application code:

- platform core packages;
- first-party K-Nex plugins;
- reviewed integration/provider/theme/builder packages;
- customer repository code and extensions;
- generated static registries.

A compromised executable package can compromise the customer deployment. V1 therefore does not provide an untrusted third-party plugin sandbox or runtime marketplace.

### Untrusted structured data

Treat as untrusted input even when created by authenticated users:

- builder documents;
- theme profile tokens;
- plugin runtime settings;
- public form submissions;
- route/query parameters;
- uploaded files and metadata;
- imported CRM/content data;
- WebSocket messages and subscription requests;
- mobile/driver offline mutations;
- external webhook payloads;
- manually edited manifest content before CLI validation.

### Customer isolation boundary

Each customer deployment owns separate:

```text
repository and release history
database
object storage
secrets
runtime processes
cache/Redis namespace or instance
backups
logs/alerts labels
domain and TLS configuration
```

This reduces cross-customer blast radius, but every application still requires normal authorization and secure infrastructure. Separate databases do not protect users from other users inside the same customer application.

## Primary threat categories

### Authorization bypass

Examples:

- user edits browser state to reveal a hidden block;
- direct API call bypasses sidebar/palette filtering;
- WebSocket client subscribes to another driver's channel;
- public CMS block calls an authenticated data source;
- job executes with broader access than the initiating actor;
- customer role is incorrectly treated as a permission by name.

Controls:

- capability-oriented permission registry;
- reusable record-level domain access services;
- server-side checks on every data source/action/command/endpoint;
- server-side WebSocket subscription authorization;
- explicit public projections;
- actor/correlation context propagated to jobs;
- deny-by-default route/action registration;
- access-policy tests across API, admin, jobs, and realtime.

### Stored and reflected XSS

Sources:

- rich text;
- URLs;
- builder text/HTML-like fields;
- imported content;
- theme/brand values;
- file names and metadata;
- error messages from providers.

Controls:

- no arbitrary React/JavaScript source in builder documents;
- rich-text schema and context-aware rendering;
- sanitize allowed HTML when HTML is deliberately supported;
- escape plain text by default;
- validate URL protocols and destinations;
- reject `javascript:` and unsafe data URLs;
- Content Security Policy appropriate to selected integrations;
- no arbitrary global CSS in runtime theme profiles;
- safe error serialization.

### SSRF and arbitrary network access

Builder/data/theme configuration must not accept unrestricted server-side URLs.

Controls:

- integrations/providers own allowlisted endpoint configuration;
- public image/link URLs validated by purpose;
- server-side fetches use provider contracts and destination policy;
- block documents reference registered data sources, not URLs;
- webhook destinations require explicit integration permissions and SSRF protections;
- cloud metadata/link-local/private network ranges blocked where applicable.

### Injection

Controls:

- Payload/database adapters and parameterized query APIs;
- no arbitrary SQL in builder or runtime settings;
- schema validation before domain services;
- safe command execution in CLI; avoid shell interpolation;
- no dynamic module imports from database strings;
- file paths normalized and constrained during generation/upload;
- logs structured rather than format-string concatenated.

### CSRF and session abuse

Controls depend on authentication strategy, but must include:

- secure, HTTP-only, appropriately scoped cookies;
- same-site policy suitable for intended domain setup;
- CSRF protection for state-changing cookie-authenticated requests;
- origin checks for WebSocket handshake and sensitive endpoints;
- session rotation/revocation;
- short-lived scoped public/driver tokens;
- explicit impersonation policy and audit.

### Broken public/private boundary

Public CMS pages can include module-provided blocks, but a public surface never inherits workspace authority.

Controls:

```text
separate public data-source/action registrations
explicit audience metadata
narrow projection DTOs
rate limiting and abuse controls
signed scoped tokens for public tracking
no internal document serialization
cache separation between public and authenticated responses
preview authorization independent from public publication
```

### Supply-chain compromise

Controls:

- trusted first-party/reviewed package catalog;
- exact package versions and committed lockfile;
- protected package publishing workflow;
- provenance/signature checks where available;
- dependency, license, and vulnerability scanning;
- review install scripts and avoid unnecessary lifecycle scripts;
- immutable release tags/artifacts;
- generated release inventory;
- no production runtime package installation;
- rapid fleet query for affected versions.

### Destructive lifecycle operations

Controls:

- disable/uninstall/purge are distinct;
- purge requires explicit confirmation, reviewed migration, dependency analysis, stored-layout analysis, and backup decision;
- no table/data drop from package removal alone;
- migration artifacts are customer-owned and code-reviewed;
- production migration permissions separated from normal app credentials where practical;
- restore procedure exercised.

## Security boundary: CLI

The CLI runs with developer filesystem and package-registry permissions.

### Risks

- malicious catalog/package metadata;
- path traversal in templates;
- shell command injection;
- writing secrets to committed files;
- destructive overwrite of existing source;
- unreviewed package lifecycle scripts;
- dependency confusion;
- logging external database credentials;
- applying a stale plan after repository state changes.

### Controls

- first-party catalog and expected package scope checks;
- validate package manifest before runtime import;
- use process argument arrays, not concatenated shell commands;
- normalize all generated paths inside repository root;
- refuse overwrite without known generated-file marker or explicit confirmation;
- masked prompts and redaction;
- verify `.env.local` is ignored before writing secrets;
- plan includes repository/lockfile hash and expires when state changes;
- filesystem staging/rollback;
- registry configuration pins intended scope/source;
- non-interactive mode requires complete explicit choices;
- no automatic production migration during add/remove/sync.

## Security boundary: plugin registration

Plugins are trusted but still constrained by platform contracts to reduce accidental collision and auditability problems.

Controls:

- static manifest loaded before executable registration;
- registration phases and deterministic order;
- duplicate collection slugs, routes, permissions, service tokens, event names, jobs, blocks, and navigation IDs rejected;
- plugin cannot add undeclared required dependency during registration;
- generated inventory records contribution ownership;
- module public exports separated from private implementation;
- optional integrations use public contracts or dedicated integration package;
- customer overrides are explicit and inventoried.

These controls do not sandbox malicious code. They make reviewed code composition predictable.

## Security boundary: builder documents

Builder documents are structured untrusted data.

Allowed:

```text
registered block IDs and versions
schema-validated serializable props
registered data-source IDs and bounded parameters
registered action IDs and bounded parameters
layout operations and region relationships
token references from installed theme schema
```

Forbidden:

```text
inline JavaScript or TypeScript
arbitrary HTML unless an explicitly sanitized block supports it
arbitrary SQL
server function/module import paths
secrets or environment variable values
raw access predicates
unrestricted URLs for server-side fetch
arbitrary CSS declarations/global selectors
serialized React elements
```

Controls:

- validate on every write and before render/publication;
- validate block availability against resolved plugin registry;
- validate profile/surface/audience;
- server revalidates action and data-source input;
- depth, node count, serialized size, and text/asset limits;
- migration only through trusted registered functions;
- safe missing-component fallback;
- audit publish/rollback;
- previews protected and drafts excluded from public responses.

## Security boundary: theme profiles

Theme values are untrusted runtime data.

Controls:

- selected theme ID must exist in generated static registry;
- token schema validation on write and read;
- bounded number/color/enum/string types;
- no arbitrary CSS, import, URL, or font source;
- CSS variable escaping;
- accessibility validation and safe fallbacks;
- versioned draft/publish workflow;
- permission-protected activation;
- cache key includes validated revision;
- editor chrome isolated from public theme.

## Security boundary: UI data sources and actions

### Data source requirements

Every data source declares:

```text
ID and owner plugin
allowed surfaces/audiences
input schema
output projection schema
required permission
domain record-level authorization
cache classification
PII/sensitivity classification
rate/size limits
```

No layout can widen these policies.

### Action requirements

Every action declares:

```text
ID and owner plugin
allowed surfaces/audiences
input/output schema
permission and record policy
transaction behavior
rate limit
idempotency expectation
audit risk level
```

Client-side action descriptors only call the registered server action. Business rules remain in authoritative domain services.

## Security boundary: WebSocket/realtime

Controls:

- authenticated handshake with origin validation;
- principal type and scoped claims;
- typed channel factories rather than arbitrary strings;
- domain-owned subscription policy;
- message input/output schemas and size limits;
- per-principal connection/subscription/rate limits;
- public tracking sessions narrow and expiring;
- after-commit/outbox publication;
- reconnect recovers authoritative state through API;
- no sensitive wildcard channels;
- logs/metrics for denials and anomalous behavior;
- distributed adapter isolates customer deployment namespaces.

Driver/mobile mutation commands should initially use authenticated HTTP/action endpoints rather than a general arbitrary WebSocket command protocol.

## Security boundary: files and media

Requirements:

- validate file type by content where practical, not extension alone;
- size and count limits;
- malware scanning policy for risky/customer-facing uploads;
- image processing in constrained worker context;
- private/public storage classification;
- signed URLs with bounded lifetime for protected assets;
- proof-of-delivery/media access uses domain policy;
- no executable serving under permissive content types;
- normalized filenames/keys;
- metadata stripped where privacy requires;
- storage credentials scoped per customer.

Public CMS media and internal documents should not share accidental access policy merely because they use one storage provider.

## Security boundary: jobs and events

Controls:

- input schemas and schema versions;
- idempotency for durable/external effects;
- actor/correlation/causation metadata;
- least-privileged service context;
- retry/backoff/dead-letter visibility;
- no secret values in event payloads/logs;
- after-commit/outbox for externally observed facts;
- event consumer ownership and supported version declarations;
- job cancellation/retention policy;
- high-risk action audit independent of event delivery.

## Authentication and actor types

Expected actor types:

```text
user
admin/operator
driver
service
public-session
system-job
impersonated-user
```

Actor context includes only required claims:

```ts
interface ActorContext {
  id: string
  type: ActorType
  permissions: ReadonlySet<string>
  teamIds?: readonly string[]
  branchIds?: readonly string[]
  sessionId?: string
  impersonatorId?: string
  correlationId: string
}
```

Do not assume all actor types are Payload admin users. Driver and public-session identity can use separate narrow strategies while adapting into the same authorization context.

## Permissions and roles

- Modules register permission keys.
- Customer applications compose roles.
- Role names are not public module contracts.
- Permission grant does not automatically grant all records.
- Record-level policy uses branch/team/ownership/state relationships.
- Critical permissions can require additional confirmation or approval workflow.
- Permission changes are audited.
- System/plugin/theme/builder publish privileges are separate from ordinary content editing.

Suggested high-risk permissions:

```text
system.plugins.configure
system.roles.manage
ui.layouts.publish
ui.themes.publish
cms.pages.publish
logistics.shipments.assign
inventory.stock.adjust
budget.approve
```

## Data classification

Modules can annotate data/projection fields:

```text
public
internal
confidential
personal
sensitive-personal
financial
credential/secret
```

Classification informs:

- logging/redaction;
- caching;
- export policy;
- public projection review;
- audit requirements;
- retention/deletion;
- analytics eligibility.

The classification system does not replace jurisdiction/customer-specific legal review.

## Logging and observability

Include:

```text
application_id
environment
release_sha
plugin_id/version when relevant
request_id
correlation_id
actor type/id where policy allows
resource type/id
outcome and denial reason category
```

Exclude/redact by default:

```text
passwords/tokens/session cookies
full database URLs
secret environment values
payment/financial secrets
unnecessary personal content
precise location where aggregate/ID is sufficient
uploaded file contents
```

Security events:

- repeated authentication failure;
- subscription authorization denial;
- public-form abuse/rate limit;
- theme/layout publication;
- role/permission change;
- plugin runtime configuration change;
- purge/migration execution;
- impersonation start/end;
- secret/provider readiness failure.

## Deployment security

Per customer:

- least-privileged database role;
- separate migration role where practical;
- secret manager/environment injection;
- TLS for external traffic and managed service connections;
- network exposure limited to required ports;
- WebSocket origin and proxy configuration;
- immutable container/release artifacts;
- read-only filesystem where feasible;
- non-root container user;
- dependency/runtime patch policy;
- protected backups and tested restore;
- staging separated from production credentials/data;
- security headers and CSP reviewed for installed integrations/themes.

## Package and license review

Before cataloging a dependency/plugin:

- verify license and commercial/redistribution constraints;
- record source repository and release provenance;
- review maintenance/security posture;
- minimize transitive dependencies;
- identify browser/server bundle impact;
- verify install scripts;
- define supported version range and update policy;
- document data egress or external service dependency.

Themes and builder packages receive the same review as backend modules because they execute code.

## Security tests

Mandatory POC and CI tests:

- direct API/action invocation fails without permission even when UI is manipulated;
- record-level branch/driver isolation;
- public blocks cannot call workspace data sources;
- draft pages/layouts are not public;
- builder rejects arbitrary script/CSS/import/SQL payloads;
- theme token injection attempts fail safely;
- second driver cannot subscribe to first driver's channel;
- transaction rollback emits no external event/realtime message;
- duplicate job/event delivery does not duplicate side effects;
- plugin conflict/collision fails before boot;
- uninstall/purge refuses with dependents or stored references;
- secret values are redacted from CLI and application logs;
- generated registry cannot load a database-supplied package path;
- file access respects public/private/domain policy;
- cached responses do not cross actor/public/private boundaries.

## Incident response support

Release inventory and customer isolation should make these questions answerable:

```text
Which customer deployments run the affected package/version?
Which capabilities and routes are exposed by it?
Can the plugin/feature be safely disabled while an upgrade is prepared?
Are data migrations required?
What secrets or external providers must be rotated?
Which release image and migration revision are currently deployed?
```

A central runtime SaaS control plane is not required, but a private fleet inventory and repeatable upgrade workflow are strongly recommended.

## Explicit non-claims

- Separate deployments do not eliminate application security requirements.
- K-Nex plugin contracts do not sandbox malicious trusted code.
- Visual editor restrictions do not replace server authorization.
- Theme validation cannot guarantee every custom customer override is accessible.
- Framework defaults do not replace deployment-specific threat modeling.
- This architecture documentation is not a substitute for customer-specific legal/compliance review.
