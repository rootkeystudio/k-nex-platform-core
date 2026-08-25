# ADR-0014: Machine-Readable Contract Governance and Separate Evidence Maturity

- Status: accepted
- Date: 2026-08-25
- Decision owners: K-Nex platform maintainers
- Evidence: executable-poc; see [Phase 0 result](../implementation/phase-0-result.md)
- Related: [Contract governance](../28-contract-governance-and-determinism.md), [POC gates](../30-executable-poc-gates.md), [ADR-0017](./0017-deterministic-composition-and-registration-reconciliation.md)

## Context

K-Nex persists plugin, capability, source, action, block, state, and output-contract identities across independently deployed customer applications. Hand-copied examples had already diverged before executable packages existed. ADR status also conflated “we chose this direction” with “the design has executable or production evidence.”

## Decision

1. Machine-readable schemas, registries, fixtures, and validators are normative before prose snippets.
2. K-Nex identifiers intended for persistence use the canonical hierarchical grammar in `contracts/architecture-contracts.v1.json`. Gate 0 proves the current pre-v1 grammar and rejection of drift; it does not claim migration compatibility from an earlier released grammar.
3. Plugin and application manifests have one typed Zod authoring source, versioned generated JSON Schemas, and canonical fixtures.
4. Registration uses one canonical phase enum with descriptor/handler/UI separation. Gate 0 freezes and validates the phase contract; runtime phase enforcement belongs to ADR-0017 and Gate 1.
5. ADR decision status and evidence maturity are independent. Evidence is recorded in `docs/adr/evidence-registry.json`.
6. Evidence maturity is atomic per ADR: a level applies only when every normative decision in that ADR has evidence at that level. Independently meaningful decisions assigned to different gates are split before promotion; otherwise the ADR remains at the lowest common evidence level.

## Consequences

- Documentation examples cannot invent alternate manifest fields or IDs.
- Contract generator changes require fixture-corpus and deterministic-output review.
- Draft IDs are normalized before production persistence. Once an earlier released or persisted grammar exists, a later rename requires an explicit migration and separate compatibility evidence; this ADR does not claim that path has been proved.
- CI can reject decision drift before package code is released.
- Deterministic composition, hermetic customer registration, and runtime reconciliation remain separate Gate 1 claims under ADR-0017.

## Alternatives considered

### Continue treating prose as the specification

Rejected because independently authored packages would implement different contracts.

### Add many ADR statuses for evidence

Rejected. Decision disposition and evidence maturity answer different questions and remain separate dimensions.

### Accept permanent runtime aliases for legacy IDs

Rejected as the default because aliases hide drift and expand compatibility obligations. Explicit migration is clearer.

## Validation

Gate 0 validates generated schemas and registries, valid and invalid fixtures, the current pre-v1 identity grammar, canonical registration phases, links, evidence coverage, forbidden legacy symbols, deterministic generation, and repository governance. It does not claim migration compatibility from a prior persisted identity grammar or runtime enforcement of the registration phases.
