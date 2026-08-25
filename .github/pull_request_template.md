## Summary

Describe the problem and the chosen change.

## Contract impact

- [ ] No persisted/public contract changes
- [ ] Pre-v1 obsolete paths were removed instead of preserved through shims or fallbacks
- [ ] ID or schema changes update all callers, fixtures, tests, and documentation
- [ ] Plugin manifest fixture/schema updated where relevant
- [ ] ADR status and evidence registry updated only when supported by real evidence

## Determinism and security

- [ ] Generated artifacts remain deterministic
- [ ] No secret or environment-dependent composition was introduced
- [ ] Authorization/cache/realtime implications were reviewed
- [ ] Public and authenticated surfaces remain separate

## Project status

- [ ] `status.md` reflects this PR's final state, completed work, validation, next task, and blockers
- [ ] The change remains inside the active phase and bounded task

## Validation

- [ ] `python3 scripts/validate_repository_contracts.py`
- [ ] Active phase acceptance commands were run
- [ ] Relevant POC gate/fixture updated
- [ ] Rollback, removal, or supersession path documented where relevant
