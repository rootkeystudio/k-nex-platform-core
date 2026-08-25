## Summary

Describe the problem and the chosen change.

## Contract impact

- [ ] No persisted/public contract changes
- [ ] Pre-v1 obsolete paths were removed instead of preserved through shims or fallbacks
- [ ] ID or schema changes update all callers, fixtures, tests, and documentation
- [ ] Plugin manifest fixture/schema updated where relevant
- [ ] ADR status and evidence registry updated only when supported by real evidence

## Migration notes

Describe the migration, rollback, removal, or supersession path. Write `None` when no persisted/public contract changes exist.

## Determinism and security

- [ ] Generated artifacts remain deterministic
- [ ] No secret or environment-dependent composition was introduced
- [ ] Authorization/cache/realtime implications were reviewed
- [ ] Public and authenticated surfaces remain separate

## Project status

- [ ] `status.md` reflects this PR's final state, completed work, validation, next task, and blockers
- [ ] The change remains inside the active phase and bounded task

## Validation

- [ ] `pnpm phase:0`
- [ ] Active phase acceptance commands were run
- [ ] Relevant POC gate/fixture updated

List CI run, test output, or other executable evidence references here.
