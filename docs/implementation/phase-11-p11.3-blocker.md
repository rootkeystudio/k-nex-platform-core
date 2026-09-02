# P11.3 blockers — settings lifecycle coordination and consumption

- **Status:** confirmed architecture blocker
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

## Decision required

The architecture must choose and specify one persisted legal sequence, for example:

- reserve a non-authorizing pending authorization generation before configuration, then atomically promote it during activation; or
- persist a target-runtime-generation candidate under a distinct provisional identity, then atomically bind it to the newly minted authorization generation during activation.

Either choice changes public/persisted state, transaction ordering, recovery, and lifecycle proofs. It requires an accepted plan/ADR amendment before implementation.

## Missing generation-validation coordinator

The administration service can create a generation-validated pending operation, but no production coordinator currently claims it, invokes the validator, transitions it, and terminally promotes or fails it. The owning runtime operation also has no implemented transition to `waiting-configuration`. Consequently every generation-validated change remains pending even for an already-active owner.

The amendment must define one lifecycle/settings coordinator, its ownership and claim protocol, exact operation and generation fencing, crash/replay behavior, and the `unresolved required settings -> waiting-configuration -> configured -> activate` sequence.

## Missing unresolved-required administration state

A valid descriptor may declare a required field without a default. Current projection rejects that state, and the administration view contract cannot represent a required-but-unset target field. Even after solving pending generation identity, an incompatible target could not present the configuration form promised by `waiting-configuration`.

The amendment must define a safe non-effective administration projection/state for required-but-unset target fields. It must remain configurable while being impossible to consume before terminal validation and promotion.

## Missing effective-value consumption

The current convergence fixture proves invalidation and polling delivery only. It does not re-read an exact active settings document or apply changed values to web, worker, or runner consumers. Production code likewise has no generation-scoped effective-settings provider/cache.

P11.3 still needs a provider that re-resolves the current descriptor and owner, reads only the exact active document after each revision, never serves pending/disabled/retired values, and proves both delivered and lost invalidation by observing changed values in all three consumer classes. Cross-process transport remains P11.9 scope.

## Missing explicit reinstall adoption

The descriptor source correctly selects the current owner, but no current-authority operation can adopt retained values from an exact retired generation into the new generation. Manual browser re-entry is insufficient because secret-reference identifiers are deliberately redacted.

The amendment must define server-derived old/new identities, exact revision and generation locks, deterministic server-side projection, authorization, atomic audit/receipt/outbox behavior, and reinstall/cross-owner/stale/race proofs.

## Completed safe work

The P11.3 descriptor parsing, static/verified descriptor sources, RBAC-projected reads and immediate changes, generation-fenced store writes, deterministic replay, redaction/projection, application-scoped outbox delivery, and polling signal delivery remain independently valid. They do not claim generation-validation completion, unresolved-required rendering, effective-value consumption, or incompatible-update/reinstall adoption.
