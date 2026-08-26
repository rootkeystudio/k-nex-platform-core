# Phase 5 Accessibility Smoke Evidence

- **Date:** 2026-08-27
- **Environment:** Chromium via Playwright 1.61.0, 1024 × 768 viewport
- **Surface:** shared workspace-card journey under Minimal, Neobrutalism, and a customer override
- **Result:** PASS

## Automated browser acceptance

The real-browser proof exercises keyboard focus and activation, a non-drag move alternative, a 44 × 44 CSS-pixel minimum target, unobscured visible focus, semantic heading/button/article/status names and roles through an ARIA snapshot, reduced-motion emulation, forced-colors emulation, and distinct screenshot digests for both themes plus the customer override.

Command: `pnpm test:p5-accessibility`

## Manual smoke

A separate Playwright CLI session was opened for the Neobrutalism surface. The accessibility snapshot exposed one `main`, level-one and level-two headings, the named **Move Beta earlier** button, an article, and a live `status`. Keyboard `Tab` moved active focus to the named button. Visual inspection confirmed a clearly visible blue focus ring, no focus clipping/obscuration, readable hierarchy, and preserved high-contrast borders/shadow. The control provides the required non-drag alternative and its visible target exceeds 44 × 44 CSS pixels.

This manual observation supplements the repeatable browser assertions; it is not used as a substitute for them.
