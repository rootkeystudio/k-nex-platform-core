# Security and Trust Boundaries

## Trust model

Trusted executable code:

```text
platform packages
first-party/reviewed plugins/themes/builders/providers
customer code
static generated registries
```

A compromised package can compromise one customer deployment. K-Nex V1 has no untrusted plugin sandbox.

Untrusted structured input includes builder documents, theme/settings records, source/action parameters, public forms, uploads/imports, WebSocket subscription messages, manifests before validation, and external webhooks.

## Customer isolation

Separate repository/database/storage/secrets/process/cache/backups/domain reduce cross-customer blast radius. They do not replace authorization among users in one customer.

## Server authorization

Every source/action/file/export/subscription enforces actor permission plus domain record/field policy. UI hiding and actor-filtered discovery are only user experience.

Public sources/actions have separate IDs, narrow projections, rate/abuse/privacy policy, and cache class. Authenticated preview does not make an internal source publishable.

## Data-source pipeline

```text
authenticate
lookup source/surface/audience
authorize source and requested fields
apply central query budget
execute only permitted projection
validate source-specific schema
validate output contract
defensively redact
apply safe cache policy
observe and serialize RFC 9457 problem details
```

Unauthorized values must not enter cache, trace, log, validation error, or response.

Bindings mark required versus optional fields. A missing required field produces explicit insufficient-permission state rather than a silently incomplete dashboard.

## Cache classifications

```text
no-store
actor
authorization-context
public
```

Authorization-context cache requires a revision/fingerprint covering permissions, membership, policy inputs, impersonation, locale/timezone, selected fields, surface, and publication/feature revision. Role name alone is insufficient.

## API budgets

Central ceilings cover CSRF/origin, content type, body bytes, nesting/filter depth, selected fields, page/series/result bytes, timeout/cancellation, concurrency, rate/burst, and cost class. Plugin handlers can choose lower limits, not silently higher ones.

## Builder and themes

Builder documents allow registered IDs, versions, validated props/bindings/layout tokens only. No executable code, package paths, secrets, arbitrary SQL/Payload query, unrestricted fetch URL, HTML/CSS except explicitly sanitized bounded blocks.

Theme IDs come from static registries. Tokens are typed/bounded and cannot inject CSS/functions/URLs/fonts. Customer code overrides are trusted code and rerun security/accessibility/bundle tests.

## Realtime

- authenticated origin-checked connection;
- every subscription validates typed params and domain policy;
- bounded connections/subscriptions/message/buffer/rate;
- revocation and reauthorization;
- reconstructible invalidation with revision/resync;
- no sensitive wildcard channels;
- memory adapter only in compatible topology;
- durable business truth outside sockets.

## Events/jobs

Durable integration/workflow classes require transactional outbox and idempotent processing. Jobs receive capability-scoped services and least-privileged actor/system context. Secrets do not enter events/logs.

## Files and network

- validate content type/size/count and scan policy;
- private/public storage classifications and bounded signed URLs;
- constrained image/media processing;
- no executable serving under unsafe types;
- destination allowlists and SSRF protection for provider-owned network calls;
- normalize generated/upload paths;
- process execution uses argument arrays, not shell concatenation.

## Supply chain

```text
protected source/publish workflows
exact immutable versions and integrity
reviewed/denied install scripts
license/vulnerability scanning
server/browser bundle leakage checks
SBOM
signed hosted-build provenance
artifact/container and lockfile digests
protected release identity
deployment receipt and fleet impact query
```

Contract boundaries are not a malicious-code sandbox.

## Control mapping

Implementation maintains K-Nex control IDs mapped to:

- NIST SSDF secure development/release practices;
- OWASP ASVS 5.0 verification requirements;
- OWASP API Security Top 10 2023, especially object/property authorization and resource consumption;
- K-Nex-specific plugin/source/realtime/builder/migration/provenance tests.

The mapping is evidence organization, not automatic certification.

## Accessibility and security

Supported web surfaces target WCAG 2.2 AA. Keyboard/focus/drag alternatives and semantic names also reduce security and operational error risk. Theme token checks alone are insufficient.

## Mandatory failure tests

- direct source/action/field request without authority;
- cross-branch/driver record access;
- public page bound to internal source/action;
- cache identity crossing actors/policies;
- forbidden realtime scope and revocation;
- rollback followed by no event/invalidation;
- commit/crash durable outbox recovery;
- script/CSS/query/import/URL injection;
- source output containing undeclared/unauthorized field;
- package manifest/runtime inventory drift;
- migration concurrency/stale artifact;
- secret redaction and supply-chain artifact verification.
