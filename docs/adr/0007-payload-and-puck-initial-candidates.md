# ADR-0007: Payload and Puck as Provisional Initial Implementation Candidates

- Status: proposed
- Date: 2026-08-25
- Decision owners: K-Nex platform maintainers
- Related: [Research plan](../12-research-plan-and-poc.md), [Builder engine](../17-builder-engine-and-profiles.md), [External references](../references.md)

## Context

K-Nex needs a practical initial backend/application foundation and an embeddable visual editor. Building authentication, admin CRUD, API/schema integration, drafts/versions, jobs, migrations, and a complete visual editor from scratch would delay validation of the product-line architecture.

Payload appears compatible with the desired TypeScript/Next.js/plugin model. Puck appears compatible with React component-based, self-hosted, customer-owned visual composition. Existing Payload–Puck integration work may accelerate a spike.

These are implementation candidates, not the K-Nex architectural contracts themselves.

## Proposed decision

Use Payload as the initial backend/application host and Puck as the first builder engine adapter, subject to POC acceptance criteria.

Architectural insulation:

```text
K-Nex module/plugin contracts
  → Payload contribution adapter/merger

K-Nex UI/block/layout contracts
  → @k-nex/builder-puck
  → Puck
```

Domain modules must not expose Puck types. Core contracts must not reduce to unrestricted raw Payload configuration mutation.

The third-party Payload–Puck package can be wrapped, partially reused under its license, or used only as a reference. K-Nex storage/profile contracts remain authoritative.

## Expected benefits

### Payload

- TypeScript-first application environment;
- built-in admin and API/schema concepts;
- authentication/access integration;
- versions/drafts and migration tooling;
- jobs/workflows and plugin model;
- Next.js compatibility for customer applications.

### Puck

- embeddable React visual editor;
- customer-owned component configuration/data;
- lower initial editor UX implementation cost than a low-level framework;
- suitable candidate for fixed shell plus editable canvas;
- potential support for nested layout, fields, permissions, and preview.

## Risks

### Payload risks

- config fields/functions may not support a safe generic merger;
- framework upgrades can affect all plugins;
- migration behavior must remain customer-owned and deterministic;
- WebSocket/process hosting depends on deployment target;
- admin customization may create framework coupling.

### Puck risks

- canonical K-Nex document round-trip may be difficult;
- workspace/data/action/permission features are K-Nex responsibilities, not Puck features;
- editor customization may require unstable/deep overrides;
- nested dashboard behavior, accessibility, and performance may be insufficient;
- third-party Payload integration may not fit scoped layouts/profiles.

## Alternatives considered

### Twenty as core

Not selected because CRM is only one optional capability and K-Nex needs broader domain/UI ownership.

### Build backend framework from scratch

Not selected before validating whether Payload can host the architecture.

### Builder.io

Not selected as mandatory core because it introduces an external editor/content service dependency. Optional integration remains possible.

### Craft.js

Retained as fallback if Puck is fundamentally limiting. It offers control at significantly higher editor-development cost.

### GrapesJS

Not selected for application builder because its primary model is HTML/CSS template editing. It may suit future email/landing-template plugins.

## Acceptance criteria

Payload must prove:

- deterministic plugin/config composition;
- collision ownership diagnostics;
- two different customer applications from shared packages;
- clean and upgrade migration tests;
- domain services/access/events/jobs integration;
- no need for per-customer core forks.

Puck must prove the criteria in [Builder Engine and Profiles](../17-builder-engine-and-profiles.md), including fixed shell, CMS/workspace profiles, permission filtering, theme-aware rendering, component migration, safe stored documents, and engine-independent module contracts.

## Rejection and revisit

Reject or replace Payload if its composition/migration/upgrade model forces deep framework forks or unsafe plugin coupling.

Reject or replace Puck if canonical documents cannot round-trip, profile restrictions cannot be enforced, or realistic workspace composition requires maintaining a deep engine fork.

After the POC, change this ADR to accepted, rejected, or superseded with measured evidence.
