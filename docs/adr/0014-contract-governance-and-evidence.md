# ADR-0014: Machine-Readable Contract Governance and Separate Evidence Maturity

- Status: accepted
- Date: 2026-08-25
- Decision owners: K-Nex platform maintainers
- Evidence: design-only; machine-readable schemas and fixture introduced in this branch
- Related: [Contract governance](../28-contract-governance-and-determinism.md), [POC gates](../30-executable-poc-gates.md)

## Context

K-Nex persists plugin, capability, source, action, block, state, and output-contract identities across independently deployed customer applications. Hand-copied examples had already diverged before executable packages existed. ADR status also conflated “we chose this direction” with “the design has executable or production evidence.”

## Decision

1. Machine-readable schemas, registries, fixtures, and validators are normative before prose snippets.
2. Persisted IDs use the canonical hierarchical grammar in `contracts/architecture-contracts.v1.json`.
3. Plugin manifests use one versioned JSON Schema and canonical fixtures.
4. Registration uses one phase enum with descriptor/handler/UI separation.
5. The resolver emits a deterministic committed `k-nex.resolved.json` without timestamps or host data.
6. `k-nex.config.ts` is a hermetic static registration module and is fingerprinted.
7. Runtime registration is compared with static declarations; undeclared contributions or capability access fail.
8. ADR decision status and evidence maturity are independent. Evidence is recorded in `docs/adr/evidence-registry.json`.
9. Public/persisted contracts remain design-only until executable fixtures and migrations prove them.

## Consequences

- Documentation examples cannot invent alternate manifest fields or IDs.
- Generator changes require golden corpus and deterministic-output review.
- Customer extensions retain TypeScript flexibility but cannot make the composition graph depend on time, network, random, secrets, or ambient filesystem state.
- Existing draft IDs are normalized before production persistence; later renames require migrations.
- CI can reject decision drift before package code is released.

## Alternatives considered

### Continue treating prose as the specification

Rejected because independently authored packages would implement different contracts.

### Add many ADR statuses for evidence

Rejected. Decision disposition and evidence maturity answer different questions and remain separate dimensions.

### Accept permanent runtime aliases for legacy IDs

Rejected as the default because aliases hide drift and expand compatibility obligations. Explicit migration is clearer.

## Validation

Gate 0 validates schemas, fixtures, links, evidence coverage, and forbidden legacy symbols. Gate 1 validates hermetic generation, declared-versus-actual registration, and byte-identical resolved output.
