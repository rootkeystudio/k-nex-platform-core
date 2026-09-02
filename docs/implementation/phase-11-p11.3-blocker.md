# P11.3 blockers — settings lifecycle coordination and consumption

- **Status:** architecture decision accepted; implementation in progress
- **Observed:** 2026-09-02
- **Scope:** incompatible Hot Application update or reinstall with required settings

## Pre-activation identity conflict

The accepted sequence requires a target Hot Application to enter `waiting-configuration` before activation when deterministic data-only projection cannot satisfy its settings descriptor. The current persisted model cannot represent that sequence:

1. `PluginManager` stages the verified target runtime generation before activation.
2. The target authorization generation is created only when the terminal active lifecycle event is projected.
3. P11.2 settings operations and documents require an existing exact authorization generation through PostgreSQL foreign keys.
4. Therefore a settings candidate for the incompatible target generation cannot exist while the extension is waiting for configuration.
5. Activating first to obtain the generation would expose a target that has not satisfied its required configuration and would violate ADR-0024.

This is not solvable with a compatibility alias, guessed generation number, activation JSON, or an unfenced settings row. Those paths weaken generation isolation or use a state store that ADR-0024 explicitly rejects.

## Accepted decision

Reserve the final numeric authorization generation before configuration in a new `pending-configuration` state. It binds exactly one verified staged runtime generation, exists only as a settings foreign-key fence, and is excluded from all effective authority. The coordinator promotes settings after exact-generation validation; activation promotes that reserved generation to `current`. A second provisional settings identity is rejected.

## Missing generation-validation coordinator

The administration service can create a generation-validated pending operation, but no production coordinator currently claims it, invokes the validator, transitions it, and terminally promotes or fails it. The owning runtime operation also has no implemented transition to `waiting-configuration`. Consequently every generation-validated change remains pending even for an already-active owner.

The amendment must define one lifecycle/settings coordinator, its ownership and claim protocol, exact operation and generation fencing, crash/replay behavior, and the `unresolved required settings -> waiting-configuration -> configured -> activate` sequence.

## Missing unresolved-required administration state

A valid descriptor may declare a required field without a default. Current projection rejects that state, and the administration view contract cannot represent a required-but-unset target field. Even after solving pending generation identity, an incompatible target could not present the configuration form promised by `waiting-configuration`.

The amendment must define a safe non-effective administration projection/state for required-but-unset target fields. It must remain configurable while being impossible to consume before terminal validation and promotion.

## Resolved: effective-value consumption

`EffectiveSettingsProvider` now re-resolves the exact active descriptor owner around every authoritative document read, rejects pending/disabled/retired/stale-owner/invalid values, and is driven by the existing revision consumer. The real PostgreSQL convergence proof observes changed effective values—not only revision counters—at web, worker, and runner boundaries after both delivered and lost invalidations. P11.9's focused attack corpus requires this proof.

## Missing explicit reinstall adoption

The descriptor source correctly selects the current owner, but no current-authority operation can adopt retained values from an exact retired generation into the new generation. Manual browser re-entry is insufficient because secret-reference identifiers are deliberately redacted.

The amendment must define server-derived old/new identities, exact revision and generation locks, deterministic server-side projection, authorization, atomic audit/receipt/outbox behavior, and reinstall/cross-owner/stale/race proofs.

## Completed safe work

The P11.3 descriptor parsing, static/verified descriptor sources, RBAC-projected reads and immediate changes, generation-fenced store writes, deterministic replay, redaction/projection, effective-value consumption, application-scoped outbox delivery, and polling recovery remain independently valid. They do not claim generation-validation coordination, unresolved-required rendering, or incompatible-update/reinstall adoption.
