## Summary

Describe the problem and the chosen change.

## Contract impact

- [ ] No persisted/public contract changes
- [ ] ID or schema change includes migration/compatibility notes
- [ ] Plugin manifest fixture/schema updated where relevant
- [ ] ADR status and evidence registry updated where relevant

## Determinism and security

- [ ] Generated artifacts remain deterministic
- [ ] No secret or environment-dependent composition was introduced
- [ ] Authorization/cache/realtime implications were reviewed
- [ ] Public and authenticated surfaces remain separate

## Validation

- [ ] `python3 scripts/validate_repository_contracts.py`
- [ ] Relevant POC gate/fixture updated
- [ ] Rollback or supersession path documented
