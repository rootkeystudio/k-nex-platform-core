# Phase 4 Result — Builder Engine Kill-Spike

- **Date:** 2026-08-26
- **Gate:** Gate 4
- **Baseline:** `6706911`
- **Delivery:** one Phase 4 branch and pull request; no merge or auto-merge
- **Decision:** **ACCEPT PUCK**

## Scope proved

Phase 4 proves that Puck can edit a minimal canonical K-Nex UI document through a narrow adapter without owning persistence, publication, runtime rendering, profile policy, or the fixed application shell. The same editor engine supports CMS and workspace profiles with distinct block, source, surface, audience, and publication authority.

The production UI runtime remains editor-independent. It validates canonical documents, migrations, blocks, bindings, selected fields, structural hashes, source results, permissions, and surfaces before producing safe render or fallback results. Puck and React are absent from the production runtime package boundary.

## Completed tasks

| Task | Primary commit |
|---|---|
| P4.1 — minimal canonical UI document | `f515263` |
| P4.2 — editor-independent UI runtime | `8053309` |
| P4.3 — isolated Puck adapter and round-trip | `3dac61b` |
| P4.4 — fixed shell and profile policy | `0e28808` |
| P4.5 — static and authenticated blocks | `598dd6e` |
| P4.6 — migration and safe fallback | `d74d97b` |
| P4.7 — bundle and runtime boundaries | `8cdfcb8` |
| P4.8 — accessible keyboard operation | `f774e12` |
| P4.9 — executable Gate 4 | `8f84fed` |

Review corrections were delivered in `6c130e3`, `cd59941`, `1b9a5ba`, `be6faa3`, `33a6bc7`, and `b0c45f1`.

## Canonical document and adapter proof

The versioned `UiDocument` contract persists profiles, regions, nodes, block identity, validated JSON props, source bindings, layout tokens and constraints, and namespaced engine metadata. Unsupported state, context, and action authority is deliberately absent from v1. It rejects duplicate identities, arbitrary executable values, unrestricted or obfuscated URLs, unsafe or Unicode-obscured keys, secret-bearing structures, arbitrary style objects, and non-namespaced engine metadata. Migration dispatch is deterministic and refuses unknown or failed versions.

The Puck adapter maps one configured canonical region to Puck content and retains only minimal namespaced bridge metadata. Round-trip tests preserve document semantics and untouched canonical fields. Profile validation treats all editor data as untrusted: document identity, bindings, layouts, engine metadata, protected props, inserted defaults, movement/deletion rules, child constraints, and every non-canvas region remain server-authoritative. The raw publish-capable host is not exported from the public editor entry; publication is reachable only through the fixed-shell host and revalidates the canonical change and runtime readiness.

## Runtime and authority proof

CMS accepts only public-audience blocks and sources that explicitly support the public surface. Workspace uses its separate allowlists and authenticated surface. Authenticated preview cannot promote a workspace source into public authority. A shared field-selection and table-projection authority preserves the Phase 2 gateway rules for required fields, permission-filtered optional fields, selected-field coverage, result ordering, nullable omissions, and semantic cell kinds.

The same browser presenter and UI runtime execute inside preview and outside the editor. Renderers receive a private non-mutable permission view, recursively immutable descriptor snapshots, and only strict, state/status-consistent, normalized source-result envelopes. Caller-owned actor/results remain detached, and one renderer cannot expand authority or mutate policy for another. One canonical Puck bridge snapshot captures fields, defaults, constraints, profiles, surfaces, permissions, source policy, schema validation, and rendering callbacks before both profile policy and adapter/runtime generation consume it; later mutations of the registered bridge cannot split editor and publication authority. Missing plugins, block versions, sources, selected fields, structural hashes, permissions, migrations, and loose result envelopes produce bounded fallback/readiness results while retaining canonical content for remediation rather than silently deleting it.

## Bundle and accessibility proof

Executable boundary checks prove that the production UI runtime has no Puck dependency, browser exports contain no server/Payload imports, module contracts expose no Puck types, persisted fixtures contain no Puck implementation data, and runtime rendering works without editor initialization.

Native labelled controls provide keyboard selection, field editing, same-container reorder, and cross-container movement without drag. They expose visible focus, at least 44-by-44 targets, semantic roles/names, bounded actions, and a polite position status. The real Chromium journey runs through the resolved workspace profile and fixed shell, edits a nested block, preserves controlled destination state across a Puck rerender with unequal container sizes, moves the block between sibling containers, and verifies both editor preview and production presentation.

## Commands executed

On exact Node.js `24.19.0` and pnpm `11.9.0`:

```bash
pnpm install --frozen-lockfile
pnpm exec playwright install chromium
pnpm gate:through-4
pnpm audit --audit-level high
git diff --check
git status --porcelain --untracked-files=all
```

`pnpm gate:through-4` is the single required CI orchestration path. It runs Phase 0 shared build/tests once, the real customer PostgreSQL fixture once, every focused Gate 1–4 proof once, and the real Chromium accessibility journey, while preserving the historical gate commands for independent use. Contract-generation and Gate 1 static-artifact digests are recorded separately after exact-head and synthetic-merge verification so the two evidence domains cannot be conflated.

The first clean correction CI run additionally proved that TypeScript's incremental `dist/tsconfig.tsbuildinfo` cache is machine-specific and must not be distributed. The provider package allowlist now explicitly excludes that cache, the committed archive contains only runtime declarations, JavaScript, source maps, manifest, and package metadata, and the synchronized provider integrity is `sha512-1AcAhPuIPKRi2JCft6dJPiLcN9as1r69/FXvYcKHDy6l3yFslwALsb2uvPxa6+e5UTYazv0Nr2SyDVJYwaCugw==`.

## Explicitly not proved

- This is the deliberately minimal kill-spike, not a broad CMS or workspace component catalog.
- Keyboard controls prove canonical root/nested reorder and sibling-container transfer, not every advanced editor interaction.
- Themes, localization, broad CMS features, and atomic publication storage are deferred to Phase 5.
- Production load/capacity and complete WCAG conformance are not claimed.

## Kill/rework assessment

No Gate 4 kill criterion fired. Lossless round-trip, fixed-shell policy, public/workspace separation, editor-independent runtime rendering, and accessible non-drag operation work through public Puck extension points. K-Nex does not maintain a Puck fork or depend on private Puck APIs. Puck is accepted behind the canonical adapter and may be replaced without changing stored documents or production runtime contracts.

## Whole-phase review

Independent reviews were run over the complete Phase 4 diff after each correction cycle. The designated project-manager reviews anchored to `54ad518` and `1ee5786` identified cross-phase CI, event, outbox, realtime, immutable-authority, result-envelope, unsupported-contract, bridge-snapshot, and evidence-labeling blockers. This correction series addresses every listed blocker, regenerates the provider archive and schemas, updates the lock integrity, removes clean-machine package variance, and leaves PR #17 open for the required green check and review confirmation.
