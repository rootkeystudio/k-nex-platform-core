# Project Status

- **Updated:** 2026-10-01
- **Phase:** Phase 13 — CRM-First Productization and Pilot Readiness (merged in PR #35; decision REWORK, automated fixture readiness only)
- **Active task:** Generated-application first-run repair — PR #37, branch `fix/generated-application-first-run`
- **State:** In progress

## Last completed

Dogfooding `create-knex-app` found that a fresh generated application could not do its own work: the worker held no generation fence and processed nothing, System Settings was a permanent 404, and no first pipeline existed, so Opportunity work was unreachable. `knex:register-generation` records the image's Platform Plugin generation and seeds the runtime projection, bootstrap seeds the first pipeline and its six Stages, and the worker takes, renews, and may resume only the fence its own generation owns. Graphite & Paper ships as the default theme and the workspace layout ships with every theme, so the 1.1 release declares 18 packages.

CI on `fba6dd3` stopped in the Phase 13 attack corpus: the migrate-admission proof pinned the admitted package count to the pre-theme literal 17. It now derives the count from the release manifest the generated application carries, so a closure that proves fewer packages than its release declares still fails.

## Validation

Node 24.19/pnpm 11.9 with Docker PostgreSQL and Chromium, on this head: `pnpm build`; current 1.1 Sales release source, packed closure (18 archives), and factory locks (3) checks PASS; P13.9 generated migrate admission PASS; P13.10 fixture-only PostgreSQL PASS; P13.B ingress and credential recovery PASS. P13.10 generated browser readiness FAILS: the sign-in button's light accent (`#d1502a` under white text) is 4.29:1, below WCAG AA.

## Next

Fix the sign-in light accent contrast in the generated entry stylesheet, regenerate the 1.1 closure, re-run P13.10 browser readiness and `gate:13:focused`, then run the Phase 9 static-deployment proof, whose new `acquireWorkerFence` assertions have not run on any head.

## Out of Phase 13 acceptance

Phase 13 delivers the CRM product, its generated application, and attested `1.0.0 → 1.1.0` upgrade preparation, not a customer-executed upgrade. The five excluded capabilities are stated once, in the P13.9 section of `docs/implementation/phase-13-crm-first-productization.md`, which is the normative source.

## Blockers

Limited beta remains blocked by five consecutive business days, two active human users, closed Sev-1/Sev-2 evidence, observed RTO/RPO, and product/Sales/security/operations sign-offs. The five excluded capabilities must ship or stay excluded by explicit decision before any claim of a supervised customer upgrade. `pnpm gate:13` has not completed on any head.
