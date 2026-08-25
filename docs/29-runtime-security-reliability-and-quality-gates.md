# Runtime Security, Reliability, and Quality Gates

## Data-source gateway pipeline

The HTTP route is an orchestration boundary, not one god service. Its stages are independently testable:

```text
1. RequestAuthenticator
2. SourceCatalog lookup and surface/audience check
3. AuthorizationEvaluator for source and requested fields
4. QueryBudgetEvaluator
5. HandlerDispatcher with capability-scoped services
6. source-specific schema validation
7. canonical/plugin-owned output-contract validation
8. ProjectionRedactor as a defensive final guard
9. CachePolicyEvaluator
10. ObservabilityDecorator and RFC 9457 serialization
```

The secure projection order is:

```text
authorize requested fields
→ query only the permitted projection
→ validate the permitted result
→ defensively redact
→ cache/trace/serialize
```

Fetching broad private objects and stripping them after cache/log/validation is not an accepted generic implementation.

## Required and optional component fields

A binding declares dynamic fields as:

```text
required   absence or insufficient permission makes the component explicitly unavailable
optional   may be omitted without changing the component's stated meaning
```

A financial or operational dashboard must not silently render an incomplete authoritative view when a required field is withheld. Builder preview validates the target audience, not only the editor's own permissions.

## Cache policy

Allowed classifications:

```text
no-store
actor
authorization-context
public
```

Rules:

- internal sources default to `actor` or `no-store`;
- `authorization-context` requires a stable fingerprint/revision covering permissions, branch/team membership, record-policy inputs, impersonation, locale/timezone, selected fields, surface, and publication/feature revision;
- role name alone is never a safe cache boundary;
- public cache is opt-in and uses an explicitly public source/projection;
- unauthorized fields never enter a broader cached result;
- permission/policy revisions invalidate affected entries;
- cache keys and traces must not expose secrets or sensitive filters.

## Descriptor identity

Separate:

```text
structuralCompatibilityHash
  field IDs/types/requiredness, input/output contracts,
  pagination/filter/sort capabilities, source/contract major versions

presentationMetadataRevision
  localized labels, descriptions, grouping, editor hints
```

Persisted layouts depend on structural compatibility, not localized label text. Actor-filtered descriptors may vary, but field authorization changes use authorization context rather than pretending every label change is a migration.

## Gateway abuse budgets

Every deployment defines conservative maxima; plugins can request a lower budget but not raise the platform ceiling without reviewed configuration.

Minimum controls:

```text
cookie-authenticated POST CSRF/origin policy
content type and body-size limit
maximum nesting/filter depth
maximum selected fields
maximum page size and total response bytes
maximum series points
query timeout and cancellation
per-actor and per-source concurrency
rate limit and burst
cost class / database work budget
batching disabled by default
explicit cache-control
```

Rejected inputs return a safe RFC 9457 problem response before handler execution where possible.

## RFC 9457 problem details

External HTTP errors use `application/problem+json`:

```json
{
  "type": "https://errors.k-nex.dev/data-source/forbidden-field",
  "title": "Requested field is unavailable",
  "status": 403,
  "detail": "One or more required fields cannot be read by the current actor.",
  "instance": "/api/k-nex/data-sources/sales.tasks/query",
  "code": "SOURCE_FIELD_FORBIDDEN",
  "correlationId": "01...",
  "issues": []
}
```

`detail`, `issues`, and extension members never reveal stack traces, SQL, internal policy predicates, secret values, or the existence of an unauthorized record.

## Event durability classes

```text
ephemeral-hint
  presence, typing, optional position hint;
  loss is acceptable

reconstructible-invalidation
  tells a client a source may be stale;
  after-commit delivery may be used only with convergence mechanisms

durable-integration
  external synchronization, notification requiring durable intent;
  transactional outbox is mandatory

durable-workflow
  business workflow continuation/projection required for correctness;
  transactional outbox or equivalent atomic durable queue is mandatory
```

A package manifest/event definition states its class. Provider choice cannot weaken required durability.

## Realtime topology and convergence

### In-memory mode

Supported only when one process owns all socket connections **and** all mutation/invalidation publication paths. A separate worker cannot publish directly into another process's memory.

If web and worker are separate, select one:

```text
Socket.IO Redis/backplane adapter
Postgres outbox relay consumed by the web/gateway process
another provider that satisfies distributed publication
```

`k-nex doctor` rejects an in-memory provider with incompatible process topology.

### Convergence

Invalidation is a hint, not a state log. Every query-capable client implements:

- authoritative initial fetch;
- source or snapshot revision/watermark;
- reconnect/resume handshake followed by refetch when uncertain;
- window-focus revalidation for workspace clients;
- bounded periodic revalidation according to source freshness class;
- permission/subscription reauthorization;
- cache invalidation when observed server revision is newer.

A lost Pub/Sub message cannot leave an active client indefinitely stale.

## Supply-chain controls

Plugins are trusted in-process code; contract boundaries are not a sandbox. Production package distribution requires:

```text
protected source and publish workflow
exact immutable package versions and integrity digests
install-script deny-by-default or reviewed allowlist
license and vulnerability scanning
server/browser bundle leakage tests
SBOM for packages and application/container
signed provenance binding source, workflow, lockfile, and artifact digest
signed release tags or equivalent protected release identity
fleet impact query and emergency upgrade workflow
```

Target before production distribution: verifiable hosted-build provenance equivalent to SLSA Build L2. Documentation must not claim a SLSA level until the provenance is independently verified.

## Migration concurrency and stale release fence

A production migration job:

1. derives a deterministic lock key from application ID plus database identity;
2. obtains a PostgreSQL advisory lock using a dedicated migration session;
3. verifies the expected predecessor migration revision;
4. runs reviewed customer-owned migrations;
5. records the new migration/release revision;
6. releases the lock;
7. causes an older artifact to fail readiness rather than boot against a newer incompatible revision.

Migration credentials are separate from ordinary runtime credentials where practical. Advisory locking complements—not replaces—database backups, expand/contract planning, and deployment serialization.

## Accessibility target

Supported K-Nex web surfaces target **WCAG 2.2 AA**.

Mandatory gates include:

```text
keyboard-only operation
visible and unobscured focus
non-drag alternatives for drag-and-drop operations
minimum target size policy
semantic names/roles/states
screen-reader smoke journeys
reduced-motion behavior
high-contrast/forced-colors behavior
theme contrast and state distinguishability
browser accessibility automation plus manual checks
```

A theme token validator alone cannot establish conformance. Customer renderer/primitive overrides rerun the same contract tests.

## Small semantic primitive ABI

V1 base primitives:

```text
Box / Stack / Inline / Grid / Container
Text / Heading / Link
Button / IconButton
Card / Badge / Status
Input / Textarea / Select / Checkbox / FormField
Dialog / Popover / Tooltip
Toast / Skeleton / EmptyState / ErrorState
simple Table / Pagination
```

Complex behavior is not mandatory for every theme package. Versioned adapters/capabilities own:

```text
DataGrid
DatePicker and calendar
drag/resizable dashboard grid
CommandMenu and advanced Menu
Map
Chart
rich text editor
```

Themes provide tokens/recipes for these adapters where installed; they do not reimplement every interaction engine.

## Builder boundaries

```text
BuilderEngineAdapter
  engine ↔ canonical document conversion,
  editor host, field/palette bridge, engine metadata

UiDocumentRuntime
  validation, rendering, permissions, migrations,
  missing-component behavior, contract/source binding

UiDocumentRepository
  Payload storage, revisions, atomic publication,
  rollback, query/index strategy
```

The engine adapter does not own CMS lifecycle or Payload publication transactions.

Public and workspace authority-bearing IDs are separate:

```text
sales.public-lead-form
sales.workspace-lead-quick-create
logistics.public-tracking
logistics.workspace-shipment-tracking
```

A purely static renderer may be shared, but one action/source ID is not reconfigured from anonymous to privileged authority.

## Layout resolution

V1 uses explicit layout assignments rather than implicit merging by role name:

```text
assignment ID
subject selector (user/group/permission predicate)
layout revision
priority
active interval
reason/source
```

Resolution is deterministic and explainable. Published customer/role layouts are immutable snapshots with lineage; users receive constrained patches for move/hide/allowed props. A last-valid resolved snapshot remains available after conflict or migration failure.

## CMS atomic publication gate

Before broad CMS implementation, prove in one transaction/integration fixture:

```text
page metadata draft
canonical builder document draft
validation of public sources/actions/blocks/theme
atomic publication of one page+document revision pair
failure rollback
lookup of published pair
rollback to the previous pair
cache/invalidation after commit only
```

## Security control mapping

K-Nex control IDs map architecture requirements to:

- NIST SSDF practices for secure development and release;
- OWASP ASVS 5.0 verification requirements;
- OWASP API Security Top 10 2023 risks, especially object/property authorization and resource consumption;
- K-Nex-specific plugin, source, builder, realtime, migration, and provenance tests.

The implementation repository will maintain a machine-readable control matrix with test IDs and release-gate evidence. References guide the control design; passing a self-authored checklist is not a certification.
