# ADR-0003: Unified Plugin Taxonomy and Capability-Based Dependencies

- Status: accepted
- Date: 2026-08-25
- Decision owners: K-Nex platform maintainers
- Related: [Plugin taxonomy](../13-plugin-taxonomy-and-capabilities.md), [Module system](../04-module-system.md)

## Context

K-Nex needs to compose more than business modules. Applications may select database, storage, realtime, builder, theme, and integration implementations. Treating each category as an unrelated mechanism would duplicate manifest, CLI, versioning, compatibility, lifecycle, and inventory behavior.

At the same time, consumers such as the driver module should not depend on a concrete WebSocket package when several providers can implement the same contract.

## Decision

Use **plugin** as the umbrella installable concept with explicit kinds:

```text
module
provider
builder
theme
integration
preset
```

Every plugin publishes a side-effect-free static manifest describing:

- stable plugin ID and kind;
- package/version;
- core/framework/runtime compatibility;
- provided capabilities;
- required, optional, and conflicting dependencies;
- surfaces and environment requirements;
- data/lifecycle metadata.

Use versioned **capabilities** for replaceable contracts:

```text
module.logistics-driver
  requires realtime.gateway@^1

provider.realtime-websocket-local
  provides realtime.gateway@1
```

Use direct plugin/domain dependencies when a module genuinely depends on another domain model, such as driver requiring logistics core.

Dependency resolution occurs before executable plugin registration. Registration is deterministic and phased.

## Consequences

### Positive

- One CLI/manifest/inventory model covers all installable capabilities.
- Infrastructure providers can be replaced without rewriting consumer modules.
- Missing providers/conflicts fail before framework boot.
- Plugin lifecycle and supply-chain policy become consistent.
- Builder/theme packages remain first-class versioned dependencies rather than hidden app code.

### Costs

- Capability contracts require separate semantic versioning and testing.
- Static manifest tooling and catalog validation must be built.
- Incorrect capability granularity can create abstraction overhead.
- Some dependencies still need direct plugin IDs; not everything should be converted into a generic provider.

### Rules

- Capability version describes the public contract, not package version.
- Single-provider capabilities reject ambiguous multiple providers.
- Required dependency cycles are errors; extract a lower contract or integration package.
- Optional integrations use public contracts, not private imports/tables.
- Static dependency resolution does not execute arbitrary package code.

## Alternatives considered

### Package-name dependencies only

Rejected because consumer modules would bind to specific provider implementations and replacement would require code changes.

### Everything as a capability

Rejected because real domain dependencies would become vague service-locator abstractions. Direct domain-module dependencies remain valid.

### Separate systems for modules, themes, builders, and providers

Rejected because composition, versioning, CLI, and lifecycle semantics would diverge and duplicate logic.

## Validation or revisit trigger

Validate with at least:

- driver using local and Redis-backed realtime providers without code change;
- storage provider substitution;
- Puck builder satisfying `builder.engine`;
- theme packages participating in the same catalog/lifecycle while retaining theme-specific runtime profiles.

Revisit capability granularity when real integrations show repeated awkward adapters or excessive provider-specific options leaking into consumers.
