# Post-Gate-11 Product Roadmap Addendum

- **Status:** selected execution addendum
- **Base:** Phase 11 merged on `main@9cb386e649aca5dfa90f04f3f1e3121b5debef93`
- **Authority:** `status.md` selects the active task; the existing master plan remains authoritative for Gates 0–11 and cross-phase invariants
- **Purpose:** define the explicit product decision required by the Phase 11 gate without rewriting accepted historical plans

## Selected order

```text
Phase 12  Runnable Customer Workspace and Dashboard Builder
Phase 13  CRM-First Productization and Pilot Readiness
```

Phase 12 closes the gap between generated composition artifacts and a usable customer application. It must deliver a real generated Next/Payload app, login/first-owner flow, fixed themed shell, collapsible plugin-aware navigation, K-Nex administration, and safe customer-owned internal pages composed with Puck from registered components.

Phase 13 then expands `module.sales` into one coherent CRM product. No broad CMS, logistics, restaurant, inventory, budgeting, commerce, marketplace, or second first-party domain starts before Gate 13.

## Active plans

- [Phase 12 — Runnable Customer Workspace and Dashboard Builder](./phase-12-runnable-workspace-and-dashboard-builder.md)
- [Phase 13 — CRM-First Productization and Pilot Readiness](./phase-13-crm-first-productization.md)

## Preserved invariants

All accepted Gates 0–11 invariants remain in force, especially:

```text
deterministic generated customer applications
static Platform Plugin composition
fixed host routes and no runtime Next route injection
database/browser content cannot author executable code or policy
server authorization is authoritative
page access cannot widen source/action/record authority
Puck is an authoring adapter, not persisted format or production renderer
themes are verified Package/Skin/Profile authority
durable state uses PostgreSQL revisions, audit, outbox, replay, and restore
real generated-app/PostgreSQL/HTTP/Chromium evidence is required
```

## Entry condition

Before Phase 12 public/persisted contracts change, repair the inherited Sales settings conformance named-test mismatch and restore the complete Gate 0–11 baseline on the Phase 12 branch.

## Phase boundaries

```text
Gate 12 PASS
  → generated app is runnable and usable
  → custom internal dashboards are safely composable
  → GO Phase 13

Gate 13 PASS
  → one daily-use CRM slice is supportable
  → limited beta decision
```
