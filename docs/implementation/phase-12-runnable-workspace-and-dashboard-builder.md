# Detailed Implementation Plan — Phase 12 Runnable Customer Workspace and Dashboard Builder

- **Status:** selected next-phase plan
- **Entry:** Phase 11 / PR #30 merged as `main@9cb386e649aca5dfa90f04f3f1e3121b5debef93`
- **Purpose:** turn the existing application factory, runtime, RBAC, themes, plugin UI registry, and Puck adapter into a generated customer application that a user can actually start, sign in to, navigate, administer, and extend with customer-owned internal dashboard pages
- **Reference product behavior:** a familiar modern CRM workspace with a collapsible left navigation, plugin-owned sections, fixed K-Nex administration, and composable dashboards; external products are behavioral references only and do not become dependencies or copied contracts
- **Reference domain:** `module.sales`
- **Following phase:** [Phase 13 — CRM-First Productization](./phase-13-crm-first-productization.md)
- **Out of scope:** public CMS/site pages, arbitrary customer JavaScript/React/SQL/CSS, runtime Next route creation, public marketplace breadth, broad CRM data expansion, collaborative multi-user document editing, mobile-native applications, and production SaaS control-plane tenancy

## 0. Entry remediation

The first implementation commit must restore the inherited cumulative Gate 0–11 baseline before new Phase 12 behavior is accepted.

Current `main` has a deterministic Gate 6 evidence-name mismatch: the Sales settings conformance plan expects the named `node:test` case `Sales persisted settings enforce read/change permissions and drive workspace presentation`, while the current runner observes only the file-level subtest for `modules/sales/tests/settings.test.mjs`.

Required entry result:

```text
pnpm plugin:check modules/sales
pnpm gate:11
pnpm audit --audit-level high
git diff --check
```

all pass on the Phase 12 branch before P12.1 changes public or persisted contracts. This is an inherited evidence repair, not permission to weaken the conformance target.

## 1. Product outcome

After Gate 12, this command must create a real independently runnable customer application rather than only a generated artifact graph:

```bash
pnpm create-knex-app \
  --target ../customer-acme \
  --id customer-acme \
  --name "Acme Workspace" \
  --theme minimal \
  --database docker-postgres
```

The generated repository must provide documented commands equivalent to:

```bash
pnpm install --frozen-lockfile
pnpm knex:doctor
pnpm knex:db:up
pnpm knex:migrate
pnpm knex:bootstrap-owner
pnpm dev

pnpm build
pnpm start
```

The result is one real Next/Payload application with:

```text
authenticated K-Nex workspace
collapsible responsive left sidebar
plugin-defined navigation and pages
fixed K-Nex administration
customer-owned custom workspace pages
Puck-based dashboard authoring
selected Theme Package/Profile presentation
PostgreSQL drafts, publication, ACL, audit, and revisions
```

Payload Admin may remain available as a maintenance/developer surface, but it is not the K-Nex product shell.

## 2. Fixed shell and route authority

The shell is platform-owned and cannot be replaced by a plugin, database document, Theme Skin, or builder page.

It owns:

```text
authentication and session handling
application identity and environment banner
desktop collapsible sidebar and mobile drawer
current location and breadcrumbs
global shell actions
permission-filtered navigation
theme/profile application
workspace content boundary
fixed error, stale, denied, and missing-dependency states
fixed K-Nex administration entry
```

Accepted route classes:

```text
/system/*                         fixed platform administration
/apps/:appId/*                    existing fixed Hot Application host route
registered static plugin routes   compiled Platform Plugin contributions
/workspace/pages/:pageId          one fixed custom-page renderer
/workspace/pages/:pageId/edit     one fixed custom-page editor
```

A database row may select `pageId`, title, navigation placement, document revision, access policy, and Theme Profile reference. It may not create a Next route, import path, executable entrypoint, React component, server handler, policy function, CSS program, or arbitrary redirect.

The browser never selects application, environment, permission, role authority, plugin generation, component implementation, source handler, action handler, or theme artifact authority.

## 3. Generated customer application

`planCreateKnexApplication()` and `applyCreateKnexApplication()` must grow from artifact-only scaffolding into an exact runnable application factory.

The deterministic plan owns at least:

```text
package.json and exact package source
Next/Payload app directories and route handlers
Payload config and generated Platform Plugin registries
K-Nex shell composition entry
theme package/profile bootstrap
database adapter and migration commands
Docker Compose for the docker-postgres option
environment example containing names only, never secrets
health/readiness routes
worker/outbox command
first-owner bootstrap command
doctor command
test and build commands
```

Rules:

1. Generated source is deterministic for the same plan and package closure.
2. No generated file contains wall clock, host path, random ID, credential, or current machine state.
3. `--plan-only` remains side-effect free.
4. `--no-install` writes a complete runnable tree without resolving mutable versions.
5. Packed-mirror generation uses the exact verified release manifest and package bytes.
6. External PostgreSQL mode declares required environment names but never tests or stores credentials during generation.
7. Docker PostgreSQL mode is development/pilot convenience only; production deployment remains customer-specific.
8. The generated app boots without importing fixture-only code from `fixtures/customer-gate-1`.
9. Clean generation into two different directories produces byte-identical controlled files.
10. The generated app can be built and started from the packed release closure used by the proof.

## 4. Authentication and first owner

The first usable application requires a safe bootstrap sequence.

```text
database migration
→ out-of-band one-time owner bootstrap
→ authenticated login
→ current RBAC session
→ workspace shell
```

Constraints:

- no public self-signup is introduced;
- the bootstrap token/evidence is one-use, expiring, application/environment-bound, and never written to generated source;
- replay after the first owner exists fails closed;
- last-owner safety and protected role rules from Phase 10 remain authoritative;
- session cookies use production-safe attributes under HTTPS;
- logout and session revocation invalidate shell, page, source, action, builder, and realtime authority;
- generated development documentation may explain local bootstrap without printing a credential into logs or committed files.

Full SSO, SCIM, organization directories, and MFA policy remain Phase 13+ product decisions.

## 5. Workspace navigation

The server produces one closed `WorkspaceNavigationTree` from three sources:

```text
platform roots and fixed K-Nex administration
active registered Platform Plugin navigation descriptors
customer-owned custom page placements
```

Navigation descriptors are data, not authority. Every render re-enters current server authority.

Required behavior:

- desktop sidebar collapses to a compact rail and restores a user preference;
- mobile uses an accessible drawer rather than an off-screen desktop sidebar;
- plugin entries may define stable parent/child groups, icons from an allowlisted registry, order, and registered routes;
- customer pages may be placed below an allowed plugin or customer folder, for example below `Sales`;
- users may reorder allowed customer pages and folders without mutating plugin-owned descriptor identity;
- hidden or collapsed preference never grants or revokes route authority;
- unauthorized entries are omitted server-side;
- direct URL access performs the same current-authority and page ACL checks;
- duplicate IDs, cycles, foreign parents, missing routes, inactive plugin generations, and cross-application placements fail closed;
- when a plugin parent disappears, the custom page remains durable but becomes explicitly unplaced/unavailable until an authorized user moves it;
- favorites and recent pages may be user preferences, not shared application truth;
- the system section remains fixed and cannot be shadowed by plugin/customer IDs.

Phase 12 does not claim a cross-domain global record search. A command launcher may navigate only the currently authorized route/page catalog.

## 6. Custom workspace page contract

A custom page is customer data rendered at one fixed platform route.

Canonical identity:

```text
applicationId
environment
pageId                   immutable canonical ID
documentId               immutable UiDocument identity
title and optional description
state                    draft | published | archived
navigation placement     parent ID + order
working copy revision
published document revision
access revision
optional Theme Profile revision override
dependency inventory/digest
created/updated actor and audit identity
```

The page document is an existing canonical `UiDocument` with:

```text
surface: workspace
profileId: an accepted workspace builder profile
regions/nodes: registered K-Nex block/component definitions only
source/action bindings: existing immutable K-Nex identities
```

The contract contains no raw pathname, URL, import, JavaScript, JSX, React element, SQL, CSS, policy code, secret, provider credential, or arbitrary network target.

Page titles, descriptions, and user-provided block values are treated as untrusted data and must remain safe through schema validation, escaping, bounded rich text, URL policy, logs, audit, and rendered HTML.

## 7. Page permissions and ACL

Phase 12 must not create a new runtime permission ID for every page. Static platform permissions authorize the operation class; a normalized page ACL authorizes the exact page record.

Initial platform permissions:

```text
system.workspace-pages.read
system.workspace-pages.create
system.workspace-pages.edit
system.workspace-pages.publish
system.workspace-pages.access.manage
```

Normalized page access subjects:

```text
role assignment → view | edit
user assignment → view | edit
```

Rules:

1. Route admission requires current application/environment authority and exact page ACL.
2. `edit` implies viewing the editor but does not imply publishing or access administration.
3. Publish additionally requires `system.workspace-pages.publish`.
4. Access mutation additionally requires `system.workspace-pages.access.manage`.
5. Owner/system administration override, if retained, is explicit in policy and durable audit rather than inferred from a label.
6. Non-owner actors cannot grant a page capability they do not hold.
7. Self-assignment follows the same delegation/dominance policy as Phase 10 and cannot manufacture platform permissions.
8. Page access never grants the data/source/action permissions used by blocks.
9. Each block executes under the viewer's current principal, effective actor, delegation, authorization revision, and source/action policy.
10. A required source field or action denied to the viewer renders a canonical insufficient-permission state; it is never silently replaced with broader server data.
11. ACL mutation, access revision, audit, and transactional outbox invalidation commit atomically.
12. Revocation reaches open page sessions, editor sessions, cached navigation, realtime subscriptions, and pending publication.
13. Page enumeration returns 404 or a stable non-enumerating denial according to the existing external error policy.

## 8. Working copy, autosave, publication, and rollback

High-frequency autosave must not append an immutable publication revision for every keystroke.

Persistence is split:

```text
mutable working copy
  one current row per page
  expected-revision CAS
  bounded canonical UiDocument
  editor session and idempotency binding
  debounced autosave

immutable published revisions
  append-only UiDocument revision
  exact page metadata/access/theme/dependency snapshot
  atomic publication pointer and receipt
```

Required behavior:

- the editor shows `saving`, `saved`, `conflict`, and `error` states;
- autosave is debounced and bounded; it never sends secrets or authority fields;
- response-loss replay with the same idempotency identity returns the same accepted working revision;
- a stale tab receives `409` and cannot overwrite a newer working copy;
- Phase 12 does not silently merge concurrent structural edits;
- explicit publish revalidates page ACL, publish permission, document schema, component inventory, source/action bindings, plugin generations, theme override, dependency readiness, and current revisions;
- page metadata, immutable document revision, publication pointer, dependency digest, audit, receipt, and outbox commit atomically;
- production rendering never loads Puck;
- rollback creates a new publication receipt pointing to a previously valid immutable revision and revalidates current dependencies/authority;
- archived pages are removed from navigation and route admission but retain durable audit/revision history;
- restoration from backup preserves working copy, published pointer, ACL, theme reference, and dependency inventory.

## 9. Component library and Puck boundary

Puck remains an authoring adapter. K-Nex owns the document, catalog, validation, rendering, authorization, theme, and persistence.

The workspace builder library is the intersection of:

```text
built-in @k-nex/ui-builder-blocks
active Platform Plugin registered workspace blocks/components
current viewer/editor authority
selected workspace builder profile
current source/action catalogs
current Theme Profile compatibility
```

“Raw component” in product language means a registered K-Nex component/block definition. It never means code uploaded through the browser or stored in PostgreSQL.

Rules:

- Platform Plugin component implementations are static imports from the verified customer release.
- Hot Application UI remains behind the credentialless Remote UI protocol and cannot inject host React.
- A block may expose bounded editable fields, slots, source selection, action selection, and presentation options declared by its trusted definition.
- The browser cannot substitute component owner, package, generation, handler, schema, source, action, or route.
- Insertion and every save revalidate owner, generation, surface, schema, movement constraints, and exact definition identity.
- Published documents bind a dependency inventory/digest and structural compatibility hashes.
- Plugin disable, quarantine, uninstall, update, missing source, or incompatible component definition produces an impact report and a safe dependency-unavailable state.
- A stale implementation is never executed merely because a page still references its ID.
- Preview and production use the same `UiDocumentRuntime`, component host, source/action gateways, current viewer authority, and selected theme.
- The editor canvas cannot modify shell, authentication, sidebar, system navigation, or protected regions.

## 10. Theme behavior

The application has one default published workspace Theme Profile. A page may optionally reference one exact compatible published workspace profile revision.

Constraints:

- the override is a reference, not copied tokens or CSS;
- only installed, verified, published, accessibility-ready profiles for the `admin` surface are eligible;
- a draft may preview an eligible profile;
- publication fails if the referenced profile or Theme Skin generation is stale, disabled, missing, quarantined, wrong-surface, or accessibility-failing;
- rollback revalidates the old page/profile pair against current installed authority;
- changing the application default theme invalidates and re-renders pages without rewriting their canonical documents;
- a page with no override follows the application default;
- Theme Package/Skin/Profile boundaries from Phases 5, 9, and 11 remain unchanged.

## 11. Sales Kanban reference proof

Phase 12 adds one bounded `module.sales` workspace block as the vertical proof:

```text
sales.opportunity-kanban
```

It uses the existing authorized opportunity source and opportunity-stage action. It must not invent a parallel data API.

Phase 12 configuration may include:

```text
visible existing stage columns
column order
allowed card fields
page size / bounded loading behavior
empty and denied states
optional title/description
```

It does not create arbitrary CRM pipeline stages or redefine the Sales domain model. Configurable pipelines/stages belong to Phase 13.

Dragging or keyboard-moving a card:

```text
current page view/edit authority
+ current Sales record/action authority
+ exact record ID/current stage/revision
+ current authorization/catalog revision
→ conditional mutation
```

A stale card, unauthorized target stage, revoked actor, cross-page action substitution, or record that changed after render fails without moving the card.

The same action has a named keyboard alternative and an accessible status announcement.

## 12. Task order

### P12.0 — Restore inherited Gate 0–11 baseline

Repair the exact Sales settings conformance test ownership/name mismatch without weakening the named proof. Run the complete inherited gate.

Acceptance:

- named target test is visibly executed, not only the file;
- mutation of the expected settings permission behavior fails the conformance plan;
- `pnpm gate:11`, audit-high, diff, and clean-tree pass.

### P12.1 — Freeze shell, page, navigation, ACL, working-copy, and publication contracts

Add strict contracts, generated schemas, fixtures, permission registry changes, an accepted ADR, and attack mapping for the Phase 12 model.

Acceptance:

- Zod/AJV/generated-schema parity;
- exact fixed route classes;
- no database/browser-authored code or authority;
- page ACL is separate from data/source/action permission;
- one immutable page ID and one canonical document identity;
- all new IDs and contribution categories reconcile declared-versus-actual inventory.

### P12.2 — Generate a runnable customer application

Extend the application factory and CLI to emit the complete Next/Payload customer project, scripts, environment contract, and Docker PostgreSQL development topology.

Acceptance:

- plan-only, no-install, workspace, and packed-mirror modes;
- two clean target paths produce deterministic controlled source;
- generated app installs frozen, migrates, builds, and starts;
- no fixture imports or mutable package ranges;
- tampered package mirror or release manifest fails before writing an executable plan.

### P12.3 — Wire application boot, login, first owner, and current authority

Compose generated Payload, migrations, sessions, protected-role bootstrap, themes, outbox/worker, readiness, and application inventory.

Acceptance:

- one-time out-of-band first owner;
- login/logout/session revocation;
- owner and limited user journeys;
- restart and clean-database bootstrap;
- application/environment isolation;
- no public signup or credential in source/log/HTML.

### P12.4 — Deliver the workspace shell and navigation resolver

Implement the collapsible sidebar/mobile drawer, fixed K-Nex section, plugin sections, route catalog, customer placements, favorites/recent preferences, and current-authority filtering.

Acceptance:

- Sales and System sections from real registries;
- nested custom page under Sales;
- cycle/duplicate/foreign-parent/missing-route rejection;
- direct URL and sidebar parity;
- keyboard, focus, reduced motion, forced colors, RTL/long-label behavior;
- unauthorized links absent from server HTML and client state.

### P12.5 — Add PostgreSQL workspace page, ACL, and publication storage

Add migrations and adapter for page metadata, normalized role/user ACL, mutable working copies, immutable revisions, publication pointer/receipt, dependency snapshot, audit, and outbox.

Acceptance:

- transaction, CAS, replay, rollback, restore, and cross-customer tests;
- stale-tab overwrite denied;
- ACL/revision/audit/outbox atomicity;
- no document/ACL/theme value in unsafe logs or generic outbox metadata;
- page archive and dependency-unavailable states remain durable.

### P12.6 — Add current-authority page services and impact reconciliation

Implement list/detail/create/edit/autosave/publish/rollback/archive/access-management services and plugin/theme dependency impact.

Acceptance:

- every read/write enters current authority;
- route/page/source/action/theme identities are server-derived;
- permission or ACL revocation cancels pending work and invalidates open sessions;
- plugin disable/update/quarantine and theme changes converge after lost invalidation;
- no stale generation resurrection.

### P12.7 — Productize the Puck dashboard editor

Build the fixed editor shell, component library, canvas, fields, preview, debounced autosave, conflict recovery, publish/rollback actions, and production renderer separation.

Acceptance:

- built-in and Sales registered blocks appear only when authorized/compatible;
- Puck is absent from production page runtime dependency graph;
- same canonical document renders inside preview and normal route;
- multi-tab conflict is explicit;
- keyboard-only add/select/reorder/move/delete/edit/publish path;
- unsafe props, unknown blocks, source/action substitution, and oversize documents fail closed.

### P12.8 — Productize page navigation, access, and theme administration

Add page creation, placement/folder/reorder, role/user access assignment, Theme Profile override, archive, dependency diagnostics, and audit views.

Acceptance:

- access grant cannot expand platform or Sales authority;
- owner, page editor, viewer, revoked user, and unauthenticated journeys;
- theme override is exact-profile/revision/surface bound;
- removed plugin parent yields explicit unplaced state;
- no hidden authority in form fields or browser storage.

### P12.9 — Prove Sales Kanban and the generated-app journey

Add the bounded Sales Kanban block and run the complete user story in a generated packed customer app.

Required journey:

1. generate application;
2. start PostgreSQL and run migrations;
3. bootstrap/login first owner;
4. observe Sales and K-Nex navigation;
5. create a custom page below Sales;
6. add Kanban, revenue metric, and task components from the real library;
7. autosave and recover one simulated lost response;
8. assign a Sales manager role/user to the page;
9. select a compatible page Theme Profile override;
10. publish and open the normal page route;
11. prove unauthorized user/direct URL denial;
12. move a card through exact current Sales action authority using pointer and keyboard;
13. revoke access and observe live invalidation;
14. rollback the page;
15. restart app and PostgreSQL clients and recover the same published truth.

Acceptance uses real PostgreSQL, real Next/Payload HTTP, and real Chromium; no in-memory replacement of the page, ACL, source, action, theme, or publication store.

### P12.10 — Gate 12 closeout

Create `docs/implementation/phase-12-result.md`, `scripts/gate-12.mjs`, and `pnpm gate:12`.

Gate 12 first runs Gate 0–11 and then exact Phase 12 contract, generator, packed application, PostgreSQL, HTTP, Chromium, accessibility, restart, rollback, and attack evidence. A focused PR path may avoid repeating cumulative work, but one explicit exact-head Linux/AppArmor cumulative Gate 0–12 run is required before merge.

## 13. Required attacks

```text
database/browser-authored route, import, JavaScript, React, SQL, CSS, or policy
forged application/environment/page/document/navigation/theme identity
custom page shadowing a fixed system or plugin route
navigation cycle, foreign parent, missing plugin parent, or cross-customer placement
unauthorized direct URL and page enumeration
role/user ACL self-escalation or delegated authority expansion
page ACL used to bypass Sales source, field, record, or action permission
stale autosave tab overwriting a newer working revision
changed payload under one idempotency key
CSRF, replay, oversized/deep document, and malformed canonical JSON
title/description/prop rich-text XSS or unsafe URL
component owner/generation/schema/structural-hash substitution
source/action/record/target-stage substitution
disabled, quarantined, updated, or uninstalled plugin component resurrection
wrong-surface, stale, or missing Theme Profile override
rollback to an incompatible or missing dependency
editor/Puck code entering the production page runtime
authority, ACL, document, or secret leakage through HTML, logs, audit, outbox, or preferences
first-owner bootstrap replay or cross-application token
lost invalidation preserving stale sidebar, route, editor, or publication authority
generator path/time/random/environment nondeterminism
tampered packed release or mutable package resolution
```

Every attack ID maps to an exact executed proof and expected denial. A prose-only attack list does not satisfy Gate 12.

## 14. Kill criteria

Stop and redesign if any of these occur:

1. A generated application needs hand-written non-generated wiring to boot the accepted reference topology.
2. Custom pages require runtime creation of Next routes, host imports, arbitrary React, JavaScript, SQL, or CSS.
3. Puck becomes the persisted document format or production renderer.
4. Page ACL cannot remain separate from underlying source/action/record authority.
5. A stale editor can silently overwrite a newer working copy.
6. Plugin disable/update/quarantine can execute a stale component implementation.
7. Page theme override can select an unverified or wrong-surface profile.
8. The packed generated app cannot boot from one coherent immutable release closure.
9. Fixed shell/security/navigation regions become editable canvas content.
10. Phase 12 expands Sales into broad CRM data before the runnable product shell is accepted.

## 15. Gate decision

```text
GO PHASE 13 CRM-FIRST PRODUCTIZATION
REWORK RUNNABLE APPLICATION, WORKSPACE SHELL, PAGE AUTHORITY, OR BUILDER
REJECT DATABASE-AUTHORED EXECUTABLE UI
```

Gate 12 means a customer application can be generated, started, signed into, administered, navigated, and extended with safe custom internal pages. It does not mean the CRM domain is complete or the product is production SaaS-ready.
