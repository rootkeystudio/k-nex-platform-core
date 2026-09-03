# Phase 12 Result — Runnable Customer Workspace and Dashboard Builder

- **Date:** 2026-09-03
- **Gate:** Gate 12
- **Accepted base:** Phase 11
- **Decision:** **READY FOR PHASE REVIEW**
- **Review state:** Focused Gate 12, cumulative Gate 0–12, and independent phase review are required at the exact PR head.

## Scope proved

Phase 12 turns the platform into a runnable generated customer application. A first owner can bootstrap securely, sign in, use the fixed workspace shell, administer durable custom pages, build a bounded Sales dashboard with Puck, publish through immutable dependency-bound revisions, grant exact page access, use Sales source/action authority, revoke access live, rollback, and recover the same truth after restart. Sales remains the only first-party domain module.

## Completed task matrix

| Task | Result |
|---|---|
| P12.1 | Closed workspace, route, navigation, page, ACL, working-copy, publication, receipt, and attack contracts |
| P12.2 | Generated deterministic runnable Next/Payload/PostgreSQL customer applications from one exact v1 packed closure |
| P12.3 | Added secure one-time first-owner bootstrap, session-only browser authentication, readiness, and replay denial |
| P12.4 | Delivered fixed authenticated shell, current-authority navigation, breadcrumbs, responsive drawer, and durable preferences |
| P12.5 | Added PostgreSQL page, folder, ACL, working-copy, immutable publication, audit, outbox, rollback, and restore storage |
| P12.6 | Added non-enumerating current-authority page services, exact ACL intersection, dependency impact, and invalidation |
| P12.7 | Productized one guarded Puck editor with CAS autosave, idempotency, publication, rollback, and protected regions |
| P12.8 | Added fixed page/folder administration, placement, access, Theme Profile, archive, audit, and diagnostics views |
| P12.9 | Proved the generated packed-app owner/editor/viewer journey with real PostgreSQL, Next/Payload HTTP, and Chromium |
| P12.10 | Added focused Gate 12/result artifacts and the cumulative Gate 0–12 command |

## Executable evidence

`pnpm gate:12:focused` builds the affected Phase 12 graph, verifies the exact v1 packed closure, runs selected contract/navigation/shell/administration/builder/service/generator/Sales proofs, then runs real PostgreSQL storage/restore and the generated Next/Payload/PostgreSQL/Chromium journey. It machine-maps all 22 contracted attack IDs to evidence that actually passed.

`pnpm gate:12` first runs cumulative Gate 0–11, then the exact focused Gate 12 evidence. Pull requests may run the focused command, but one exact-head cumulative run is required before merge.

## Boundaries retained

- Runtime/database content cannot create routes, imports, React, JavaScript, SQL, CSS, policy, or host primitives.
- Page ACL intersects platform and Sales authority; it never grants source, field, record, or action permission.
- Puck is editor-only. Production pages render the canonical UI document through the platform runtime.
- Published revisions are immutable and bind exact document, ACL revision, Theme Profile revision, and dependency digest.
- Generated v1 applications include the current transactional outbox schema; no compatibility migration or shim exists.
- Fixed shell, security, navigation, accessibility, and theme semantics remain host-owned.

## Known limits

Broad CRM data, CMS/public-site productization, arbitrary customer code, role inheritance, marketplace breadth, and production SaaS operations remain outside Phase 12.

**Decision:** **READY FOR PHASE REVIEW**

Gate decision on acceptance: **GO PHASE 13 CRM-FIRST PRODUCTIZATION**.
