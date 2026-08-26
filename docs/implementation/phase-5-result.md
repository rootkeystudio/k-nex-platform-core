# Phase 5 Result — UI Runtime, Themes, and Atomic CMS Publication

- **Date:** 2026-08-27
- **Gate:** Gate 5
- **Baseline:** `0674add`
- **Delivery:** Phase 5 branch and PR #19; no merge or auto-merge
- **Decision:** **GO Phase 6**

## Scope proved

One canonical UI document renders through one semantic primitive ABI under materially different Minimal and Neobrutalism themes without document mutation or forked interaction behavior. Published theme profiles are strict, revisioned data and cannot introduce arbitrary CSS, code, URLs, secrets, class names, or uninstalled packages.

Payload stores server-only UI drafts and immutable published revisions with validation, unique ordering keys, lineage, lookup, and rollback. One strict persisted schema bounds canonical locale, IDs, paths, title, description, canonical path, robots, document, and theme references at draft/publish/rollback boundaries. A real PostgreSQL fixture resolves an installed published `ThemeProfile`, publishes page and document as one pair, serializes parallel publish/rollback attempts through unique sequence constraints and bounded transaction retries, and preserves one ordered lineage. Failed writes roll back. Post-commit invalidation retries use a unique operation ID, recover the already committed pair, and never republish.

Workspace layouts resolve explicit user, group, and permission assignments by priority, selector specificity, then stable assignment ID. The result explains selected and superseded policies. Published layouts remain immutable, user patches are allowlisted by operation/node/property, and a conflict, denied patch, missing revision, or migration failure retains the last valid resolved snapshot. Move-before behavior is exact for forward, backward, end, self/no-op, and nested sibling operations.

## Completed tasks

| Task | Primary commit |
|---|---|
| P5.1 — semantic primitive ABI | `a5c2c54` |
| P5.2 — theme contracts | `646df1e` |
| P5.3 — Minimal theme | `3013a0c` |
| P5.4 — Neobrutalism theme | `e6225e3` |
| P5.5 — UI document repository | `4e5a420` |
| P5.6 — atomic CMS publication | `2ba2a92` |
| P5.7 — deterministic layout resolution | `fb646dd` |
| P5.8 — accessibility acceptance | `6c5b4a0` |
| P5.9 — Gate 5 closeout | this closeout commit |

## Accessibility and visual proof

The real Chromium journey bundles React and renders the canonical CMS document through `createUiDocumentRuntime`, `KNeXDesignSystemProvider`, and the React Aria-backed K-Nex primitives. It covers keyboard activation, focus visibility, dialog containment/restoration, named non-drag alternatives, 44-by-44 targets, ARIA-tree smoke, reduced motion, and forced colors. Minimal, Neobrutalism, and the customer override coexist in one page with distinct digests; exact profile scoping prevents bleed before and after live theme switching. Supplemental visual inspection is recorded in [`phase-5-accessibility-smoke.md`](./phase-5-accessibility-smoke.md).

## Payload plugin decisions

Gate 5 uses the smallest public contract required for the proof; no plugin-private type enters the page/document authority.

- SEO — **deferred**. Gate 5 needs a bounded canonical title, description, canonical path, and robots policy, not editor preview/generation hooks. These fields participate directly in the atomic pair.
- Nested Docs — **deferred**. Hierarchical CMS navigation is outside the one-page atomic publication proof.
- Redirects — **deferred**. Redirect lifecycle and routing are not a Gate 5 exit condition.
- Form Builder — **conditional**. Adopt only when a later accepted product surface requires persisted forms; it is not part of the base semantic ABI proof.
- Search — **conditional**. Adopt only with an accepted indexing/query authority and freshness model; adding it now would expand the publication boundary.

## Commands executed

On exact Node.js `24.19.0` and pnpm `11.9.0`:

```bash
pnpm install --frozen-lockfile
pnpm exec playwright install chromium
pnpm gate:5
pnpm audit --audit-level high
git diff --check
git status --porcelain --untracked-files=all
```

`pnpm gate:5` is the required CI path. It preserves Gate 0–4 evidence, executes all Phase 5 unit/contract checks through the shared phase build, then runs the semantic primitive browser journey, Minimal hydration proof, real PostgreSQL atomic-publication fixture, theme/customer-override accessibility journey, and focused Gate 5 boundary assertions.

## Project-manager correction evidence

The blocking review anchored to `e991534` produced seven corrections: exact layout movement, exact profile CSS scoping, server-only UI revision access, serialized and idempotent publication completion, rollback revalidation with authoritative published-theme lookup, actual primitive/theme/runtime browser integration, and one strict bounded CMS metadata schema. Each correction has a focused regression and is included in the single Gate 5 path.

## Kill/rework assessment

No Gate 5 kill criterion fired. Theme differences do not mutate canonical documents or behavior, atomic page/document publication and rollback are proven on PostgreSQL, layout resolution is deterministic and explained, and the accessibility fixes remain ordinary semantic/CSS policy rather than replacement of the primitive or builder foundations.

## Explicit limits

- This is a two-theme proof, not a theme marketplace or arbitrary CSS/JavaScript editor.
- The primitive ABI intentionally defers advanced grids, dates, charts, maps, rich text, and resizable workspaces to separate adapters.
- The accessibility result targets the supported proof surfaces and does not claim complete-product WCAG certification.
- CMS hierarchy, redirects, form building, and search remain outside Gate 5 as recorded above.
