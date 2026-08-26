# Phase 5 Accessibility Smoke Evidence

- **Date:** 2026-08-27
- **Environment:** Chromium via Playwright 1.61.0, 1440 × 900 viewport
- **Surface:** canonical CMS runtime output through the actual K-Nex provider and primitives under simultaneous Minimal, Neobrutalism, and customer roots
- **Result:** PASS

## Automated browser acceptance

The bundled React proof evaluates `fixtures/ui-documents/valid/cms.v1.json` with `createUiDocumentRuntime`, then renders its result through `KNeXDesignSystemProvider` and the React Aria-backed K-Nex primitives. It exercises keyboard focus/activation, a non-drag move alternative, 44 × 44 targets, dialog containment and trigger-focus restoration, semantic headings/buttons/status through an ARIA snapshot, reduced motion, forced colors, simultaneous-root isolation, live switching, and distinct screenshots.

Command: `pnpm test:p5-accessibility`

## Manual smoke

The actual-integration full-page screenshot was inspected at 1440 × 900 after keyboard activation and dialog close. It showed three simultaneously mounted roots with isolated 1 px Minimal, 3 px Neobrutalism, and 5 px customer card borders; materially different recipes; readable headings/body/status; and an unobscured blue focus ring restored to **Open Minimal dialog**. The named increment, move, switch, and dialog controls remain visible without overlap.

This manual observation supplements the repeatable browser assertions; it is not used as a substitute for them.
