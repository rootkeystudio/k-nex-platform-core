# ADR-0017: Deterministic Composition and Registration Reconciliation

- Status: accepted
- Date: 2026-08-25
- Decision owners: K-Nex platform maintainers
- Evidence: design-only
- Related: [ADR-0014](./0014-contract-governance-and-evidence.md), [Contract governance](../28-contract-governance-and-determinism.md), [POC gates](../30-executable-poc-gates.md)

## Context

Static package manifests and customer registrations must produce one explainable composition graph before application boot. Executable registration can otherwise drift from declared contributions, and ambient inputs can make committed artifacts irreproducible.

These claims are independently falsifiable in Gate 1 and are separate from Gate 0's contract-governance evidence.

## Decision

1. The resolver emits a deterministic committed `.k-nex/generated/k-nex.resolved.json` and static registries without timestamps, host data, random values, secrets, or environment values.
2. `k-nex.config.ts` is a hermetic static registration module. Its transitive source is fingerprinted, and graph composition cannot depend on network access, current time, randomness, secrets, or ambient filesystem discovery.
3. Runtime registration is compared with static declarations. Undeclared contributions, undeclared capability access, wrong-phase registration, and registration after freeze fail.
4. Deterministic inputs include the normalized application manifest, exact installed package manifests and integrity, resolver version, and customer-config fingerprint.
5. Runtime data may configure installed code but cannot select imports, packages, or graph membership.

## Consequences

- Customer extensions retain TypeScript flexibility inside a composition-hermetic boundary.
- Generator and resolver changes require golden failure cases and byte-identical output review.
- The application fails before readiness when executable registration disagrees with the declared inventory.
- Capability-scoped services replace ambient or universal plugin access.

## Alternatives considered

### Runtime package discovery

Rejected because filesystem or import-time discovery makes graph membership environment-dependent and executes code before validation.

### Trust static declarations without reconciliation

Rejected because stale or dishonest manifests could expose undeclared behavior at runtime.

### Keep these decisions in ADR-0014

Rejected because their executable validation belongs to Gate 1, while ADR-0014 has complete and independently meaningful Gate 0 evidence.

## Validation

Gate 1 must prove byte-identical resolved graphs and registries in two clean roots, hermetic config fingerprinting, canonical resolver output, restricted phase execution, and declared-versus-actual inventory and capability-access rejection. Evidence remains `design-only` until the complete Gate 1 scope passes.
