# Project Status

- **Updated:** 2026-08-26
- **Phase:** Phase 4 — Builder Engine Kill-Spike
- **Active task:** P4.2 — minimal UiDocumentRuntime
- **State:** Active

## Last completed

P4.1 froze the editor-independent canonical UI document contract: bounded regions and recursive nodes, versioned blocks and bindings, stable selected fields, constrained layout tokens, namespaced engine metadata, deterministic current-version migration, canonical valid/invalid fixtures, and generated JSON Schema parity through the repository's strict Ajv validation path. Puck types, executable/script/SQL/package-path fields, secrets, unrestricted URL fields, and arbitrary style fields are excluded.

## Validation

On Node.js 24.19.0 and pnpm 11.9.0: `pnpm --filter @k-nex/contracts build` and all 103 contract tests pass; `pnpm contracts:generate`, `pnpm contracts:validate`, and `pnpm contracts:reproducibility` pass with generated-schema/Zod parity and reproducible SHA-256 `d28e15b82a6ad3a7bd63ba6c22c3a77905a9f9a421a9bedf643b755d64381ee6`. Pre-commit `pnpm phase:0` reached the expected generated-clean guard because the new generated UI schema was not yet committed; rerun it from the committed clean state.

## Next

Execute P4.2 — minimal `UiDocumentRuntime` — in documented Phase 4 order.

## Blockers

None.
