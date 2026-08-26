# Phase 5 Result — UI Runtime, Themes, and Atomic CMS Publication

- **Date:** 2026-08-27
- **Gate:** Gate 5
- **Baseline:** `0674add`
- **Delivery:** Phase 5 branch and PR #19; no merge or auto-merge
- **Decision:** **GO Phase 6**

## Scope proved

One canonical UI document renders through one semantic primitive ABI under materially different Minimal and Neobrutalism themes without document mutation or forked interaction behavior. Published theme profiles are strict, revisioned data and cannot introduce arbitrary CSS, code, URLs, secrets, class names, or uninstalled packages.

Payload stores UI drafts and immutable published revisions with validation, lineage, indexes, lookup, and rollback. A real PostgreSQL fixture publishes localized CMS page metadata, canonical SEO fields, theme authority, and its UI document as one revision pair in one Payload transaction. A validation failure after the page write rolls the transaction back; lookup returns only published pairs; rollback creates new page, document, and pair revisions; invalidation runs only after the pair is independently visible as committed.

Workspace layouts resolve explicit user, group, and permission assignments by priority, selector specificity, then stable assignment ID. The result explains selected and superseded policies. Published layouts remain immutable, user patches are allowlisted by operation/node/property, and a conflict, denied patch, missing revision, or migration failure retains the last valid resolved snapshot.

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

Real Chromium journeys cover keyboard activation and focus, unobscured visible focus, named non-drag alternatives, 44-by-44 targets, semantic names/roles/states, reduced motion, forced colors, and ARIA-tree screen-reader smoke. The same journey passes under both themes and a customer override. Screenshot SHA-256 digests are distinct for all three variants. The supplemental manual CLI/snapshot/visual evidence is recorded in [`phase-5-accessibility-smoke.md`](./phase-5-accessibility-smoke.md).

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

## Kill/rework assessment

No Gate 5 kill criterion fired. Theme differences do not mutate canonical documents or behavior, atomic page/document publication and rollback are proven on PostgreSQL, layout resolution is deterministic and explained, and the accessibility fixes remain ordinary semantic/CSS policy rather than replacement of the primitive or builder foundations.

## Explicit limits

- This is a two-theme proof, not a theme marketplace or arbitrary CSS/JavaScript editor.
- The primitive ABI intentionally defers advanced grids, dates, charts, maps, rich text, and resizable workspaces to separate adapters.
- The accessibility result targets the supported proof surfaces and does not claim complete-product WCAG certification.
- CMS hierarchy, redirects, form building, and search remain outside Gate 5 as recorded above.
