# ADR-0028: CRM-First Product Contract and Limited-Beta Measures

- Status: accepted
- Date: 2026-09-05
- Decision owners: K-Nex product and Sales module maintainers
- Evidence: design-only
- Entry: Gate 12 runnable customer workspace and dashboard builder PASS
- Related: [Phase 13 plan](../implementation/phase-13-crm-first-productization.md), [ADR-0020](./0020-reference-sales-and-headless-component-system.md), [ADR-0022](./0022-rbac-authorization-and-extension-role-templates.md), [ADR-0025](./0025-runnable-workspace-shell-pages-and-builder.md)

## Context

`module.sales` has proved platform surfaces with small task and opportunity fixtures. Phase 13 must turn that reference into one daily-use CRM without adding disconnected collections, inventing a second authorization model, or silently preserving the reference data as a competing source of truth.

## Target customer and product boundary

The limited-beta customer is one independently deployed application for a small business-to-business sales team with 3–25 active sellers, one primary reporting currency, one configurable pipeline, and a manager-owned weekly forecast. The team captures or imports leads, qualifies them, maintains account/contact context, works opportunities, records activities and follow-up tasks, then reviews conversion and forecast.

This is not a multi-vertical suite or enterprise CRM. Public CMS, marketing automation, telephony, accounting/ERP, payments, arbitrary workflow/query languages, unrestricted mailbox/network access, shared-database SaaS tenancy, multiple concurrent pipelines, territory/quota management, product catalogs, quotes/orders, and autonomous AI actions are non-goals for Gate 13.

## Canonical sales process

One process owns all Phase 13 journeys:

```text
Lead new → working → qualified ─┬→ Account + Contact linked or created
                               └→ Opportunity open in configured pipeline
Lead new | working → disqualified

Opportunity open: qualification → discovery → proposal → negotiation
Opportunity terminal: won | lost
```

Rules:

1. A lead is a pre-qualification person/company assertion. `qualified` and `disqualified` are terminal lead states. Either decision records canonical `decidedAt`; qualification also records `qualifiedAt`, while disqualification records `disqualifiedAt`. Qualification is one expected-revision, idempotent v2 action that supports only create/create, link/create, or link/link Account/Contact modes. A linked Contact must belong to the chosen active Account; create/link is invalid. The action records converter actor, exact lineage, and resulting account/contact/opportunity IDs. New derivatives inherit the locked active Lead owner/team, existing records are never reassigned, and replay returns the same result without duplicates.
2. An account is a customer or prospect organization. A contact is a person associated with one account for this beta. Neither has a sales-stage lifecycle; both are `active → archived | merged`, with `merged` preserving redirect lineage.
3. An opportunity is a revenue pursuit for exactly one account, one owner, one pipeline, and one non-terminal `stageId` until its stage becomes `won | lost`; its primary contact is optional. Opportunity state is derived only from the referenced stage semantic and is never stored as a second status field. Terminal transitions require `closedAt`; `lost` requires a closed loss reason; reopening is outside Gate 13.
4. Pipeline stages use stable opaque IDs. Names are presentation. Exactly one active pipeline exists for Gate 13, with four ordered open semantic stages shown above plus terminal `won` and `lost`. Pipeline data may narrow its transition graph but cannot bypass the trusted transition service.
5. An Activity is an interaction (`call | meeting | email`) with `scheduled → completed | cancelled`; `completed` and `cancelled` are terminal. Corrections to a completed activity append a superseding Activity and audit event; they do not erase history. A superseding Activity optionally references one prior Activity in the same application/environment; direct self-reference, missing targets, and cross-scope targets are rejected. Append-only chains are accepted; full multi-hop cycle prevention belongs to the mutation service in P13.3. A Note is a separate immutable `recorded` content record. Record timelines project Activity and Note into one ordered view without merging their persistence truth.
6. A task is planned work with `open | completed | cancelled`; completion/cancellation is terminal. A reminder belongs to one open task or scheduled activity and transitions `scheduled → delivered → dismissed`, `scheduled → cancelled`, or `scheduled → failed` after bounded delivery retries are exhausted. `dismissed`, `cancelled`, and `failed` are terminal. Failure stores a closed safe reason and audit/dead-letter reference, never provider secrets; retry requires a new idempotently created Reminder rather than relabeling failed delivery as successful.
7. A Notification has `unread → read → archived` and may move directly `unread → archived`; `archived` is terminal. Saved View, Import Job, Export Job, attachment reference, notification, merge lineage, and audit records support the sales process. None creates executable policy.
8. Pipeline, Pipeline Stage, and Saved View use `active → archived`. Attachment reference uses `active → removed`; removal revokes access but preserves audit-safe metadata. Import Job uses `draft → validated → queued → running → succeeded | partially-failed | failed`, with cancellation allowed before running. Export Job uses `queued → running → succeeded | failed`, with cancellation before running. Job outcomes are terminal; artifact expiry is retention metadata, not a lifecycle rewrite.

The normative IDs, ownership assignments, lifecycle transitions, journey coverage, metric semantics, and legacy mappings are frozen in [`phase-13-crm-product-contract.v1.json`](../../contracts/phase-13-crm-product-contract.v1.json). Its validator rejects duplicate ownership identities, unknown references, illegal transitions, ambiguous metrics, and objects/routes/actions without a daily journey.

## Object contract and daily consumer

All records have stable opaque ID, application/environment binding, created/updated actor and timestamp, monotonic integer CAS revision where mutable, durable audit, and owner/team fields where stated. Archive preserves identity and relationships.

| Object | Required customer fields | Owner and retention | Daily workflow consumer |
|---|---|---|---|
| Account | name, owner, status | owner required; archive, never hard-delete during beta | rep/manager account detail and related opportunity work |
| Contact | account, given or display name, owner, status | inherits readable account scope; archive | rep contact detail, communication, lead conversion |
| Lead | display name, owner, status, source; decision time plus qualified/disqualified time on terminal decision | owner required; terminal records retained | capture/import and qualification queue |
| Opportunity | name, account, owner, pipeline, stage; optional primary contact, amount, and expected close date; currency required when amount exists | owner required; state derives from stage semantic; terminal records retained | pipeline list/Kanban, detail, forecast |
| Pipeline / Stage | name; ordered active stages; stage semantic, probability, transitions, transition requirements | Sales administrator; revisions retained with referenced records | manager/rep Kanban and forecast |
| Activity | type, scheduled/occurred time, exact actor and team, subject, one related CRM record | scheduled activity mutable by CAS; completed activity immutable/superseding; retained | record timeline, calendar, activity report |
| Note | body, author, occurred time, one related CRM record | immutable; correction creates replacement lineage; retained | record timeline and customer context |
| Task | title, owner, status; optional due date and related CRM record | owner required; terminal record retained | daily task queue and follow-up |
| Attachment reference | storage reference, filename, media type, byte size, uploader, related record | no bytes or credentials in CRM row; follows related record | timeline/detail download through storage authority |
| Saved View | name, owner or team visibility, target object, bounded fields/filter/sort/group/view kind | creator or authorized administrator; archive | list/Kanban/calendar work queues |
| Import / Export Job | actor, source/selection digest, schema revision, state, counts, artifact reference | initiating actor; immutable receipt/error artifact | controlled onboarding and portability |
| Notification / Reminder | recipient, trigger/reference, state, scheduled/delivered time | exact recipient; terminal record retained | notification center and due-work prompts |

Hard deletion, if later required by law or customer policy, is a separately authorized operation with relationship and audit handling. Gate 13 defaults to soft archive for mutable domain rows; terminal Leads, Opportunities, Activities, Tasks, Notes, attachment references, provider message/event metadata, notification/reminder delivery records, merge lineage, and immutable import/export receipts/errors remain for the application lifetime. Attachment bytes follow configured customer storage retention. Import source, export, and partial-error artifacts expire after 30 days by default while their redacted receipts remain. Audit and outbox evidence follows platform retention and cannot be purged through a Sales record action. Operational logs follow deployment policy and omit sensitive field values.

Related-record persistence vocabulary is closed: `sales.account`, `sales.contact`, `sales.lead`, `sales.opportunity`, and `sales.task`. Activities, Notes, Attachment references, and optional Task links share this vocabulary only, and each target resolves in the same application/environment. Activity authority targeting a Task locks that Task's persisted link and derives current authority and ownership from its immediate, same-scope parent; resolution is deliberately one level, including a parent Task. Unlinked, missing, foreign, or teamless parents fail closed. Notes and Attachment references authorize their Task target directly. Intent remains object-specific: Activity is an interaction target, Note is a timeline target, Attachment reference is a storage-reference target, and Task's follow-up target is optional. The product contract, Payload select options, and PostgreSQL trigger remain byte-for-byte equivalent in persisted vocabulary.

## Money, date, and timezone semantics

- Money uses the existing K-Nex canonical value `{ kind: "money", value: canonical decimal string, currency: ISO-4217 uppercase code, scale: integer, rounding?: declared mode }`; no binary floating point. Opportunity amount is optional, currency is required when amount exists, and scale must preserve the accepted value exactly. One application reporting currency is configured. Gate 13 rejects mixed-currency aggregation; it does not perform FX conversion.
- A calendar date such as `expectedCloseDate` is `YYYY-MM-DD` without timezone conversion.
- Instants such as activity occurrence, audit, delivery, and import completion are UTC instants. The application has one IANA reporting timezone used for day/week grouping and display; reports record that timezone and their `asOf` instant.

## Ownership and permission contract

Stable permission IDs and current record/field policies authorize; persona labels are templates only. Exact permission IDs, record scope, field scope, and persona-template grants are normative in `phase-13-crm-product-contract.v1.json`; this table states product responsibility, not alternate authority. UI, custom-page ACL, saved views, reports, exports, jobs, and adapters never widen authority.

| Persona template | Record scope | Allowed product work |
|---|---|---|
| Sales representative | records owned by actor or assigned team; related records only when policy permits | own daily queue, lead follow-up, customer context, opportunity progress, activities/tasks; no pipeline/admin/export-all authority |
| Sales manager | assigned teams plus own records | team assignment and coaching, won/lost decisions, controlled team imports/exports, forecast and conversion review |
| Sales administrator | application Sales scope | configure pipeline/stages, mappings, retention-visible settings, provider references, and Sales templates; operate CRM; cannot grant itself platform authority |
| Sales viewer/auditor | explicitly authorized application/team scope | inspect records, timelines, audit-safe history, and reports; no mutation, export, or provider send/sync |

Each mutable record has exactly one owner; optional team assignment broadens scope only through current policy. `sales.ownership.assign` v2 is closed to Account, Contact, Lead, and Opportunity: exact input is `recordType`, `id`, `expectedRevision`, `ownerId`, optional non-null `teamId`; its result returns record type, ID, revision, owner, and omits team when cleared. Reassignment requires explicit permission, expected revision, audit, and invalidation. Account/contact relationship never implies access without current record and field authorization. Protected ownership, application, audit, lifecycle, revision, and merge-lineage fields cannot be set by generic create/update/import actions.

Creation ownership is host-derived and never client-selectable. A top-level Account or Lead receives the effective actor and that actor's current-scope canonical personal team. A related Contact, Opportunity, or Activity inherits the locked related record owner/team. Lead qualification preserves the locked Lead owner/team on all derived records while recording the converter as `createdBy` and audit actor. A teamless legacy target requires explicit reassignment before child creation.

Contribution identities remain globally unique: the reassignment action is `sales.ownership.assign`, while its authorizing permission is the distinct `sales.ownership.write`.

### Sales authority-scope administration

P13.2 has one fixed generated-host endpoint, `/api/k-nex/sales/authority-scopes`; no extension, browser, or database row can register an alternate authority control plane. Admission requires current `sales.settings.write`, an active caller `application-sales-scope`, `applicationWide=true`, and `mutationAllowed=true`. The target remains bound to this application/environment and upsert/reactivation requires its current `module.sales` Platform Plugin grant.

Every request has an expected global authorization revision and target scope revision. Its replay key binds application, environment, caller, target, operation, and canonical request digest. The same transaction changes the scope/state and authorization revision, writes immutable authorization audit and canonical authorization outbox evidence, and records the replay result. Revoke is a CAS transition to a retained `revoked` tombstone, never delete. An active scope can be dormant while its current RBAC grant is absent and become effective again when that grant returns; a revoked tombstone never auto-reactivates and requires an explicit, current-grant reactivation mutation.

## Registered route and action journey map

These IDs are the Phase 13 Sales contract. P13.2–P13.8 must register them statically before use; Gate 13 fails if any required journey points to an absent registration. Existing `sales.route.overview`, `sales.route.tasks`, `sales.route.opportunities`, `sales.task.create`, `sales.task.update`, and `sales.opportunity.stage.update` are replaced or evolved atomically, never kept as parallel truth.

| Journey | Registered routes | Registered actions |
|---|---|---|
| Start day and follow up | `sales.route.overview`, `sales.route.tasks`, `sales.route.notifications` | task create/update/archive, reminder dismiss, notification read/archive |
| Capture and qualify lead | `sales.route.leads`, `sales.route.lead-detail` | lead create/update/qualify/disqualify/archive |
| Maintain customer context | `sales.route.accounts`, `sales.route.account-detail`, `sales.route.contacts`, `sales.route.contact-detail` | account/contact create, update, object-specific archive, merge, ownership assign |
| Work opportunity | `sales.route.opportunities`, `sales.route.opportunity-detail` | opportunity create/update/stage/close/archive |
| Record interaction | record detail routes | activity create/complete/cancel, note create, attachment link/remove |
| Configure pipeline/views | `sales.route.pipeline-settings`, `sales.route.saved-views` | pipeline update/archive, saved-view create/update/archive, settings update |
| Move controlled data | `sales.route.imports`, `sales.route.exports`, record list/detail routes | import dry-run/commit/cancel, export create/cancel, merge commit |
| Communicate and review | `sales.route.calendar`, `sales.route.notifications`, `sales.route.reports` | `sales.email.send`, `sales.calendar.sync`, `sales.reminder.schedule`, `sales.integration.configure`, `sales.report.run`, `sales.report.schedule` |

Fixed record detail pages contain summary, owner/team, relations, activity/note/attachment timeline, tasks/reminders, state history, and authorized actions. The Gate 13 timeline is a deterministic newest-first window of at most 100 entries; pagination reports `hasNext: false` at that window boundary even when older retained entries exist. Custom Phase 12 pages embed registered saved views and reports only; they do not replace these daily routes.

P13.3 invalidation IDs are fixed one-to-one: `sales.event.account-changed` → `sales.realtime.accounts` → `sales.accounts`; `sales.event.contact-changed` → `sales.realtime.contacts` → `sales.contacts`; `sales.event.lead-changed` → `sales.realtime.leads` → `sales.leads`; and `sales.event.timeline-changed` → `sales.realtime.timeline` → `sales.timeline`. Activity, Note, and Attachment-reference mutations emit the one aggregate timeline event with their immutable subtype facts; lead qualification also emits the lead and each created Account, Contact, and Opportunity invalidation. Fixed detail routes load the authorized timeline internally; no Timeline block or component is authorable on custom pages.

## Metric contract and ownership

Sales product maintainers own metric definitions and schema. Sales administrators own application pipeline configuration and reporting timezone. Sales managers own saved report filters and operational review. Platform maintainers own authorization, exact decimal/time primitives, bounded execution, page embedding, and export delivery. No collection or field may define its own conflicting metric.

Every result binds application, source/schema revision, current authorization revision, filters, grouping, reporting timezone, reporting currency, `asOf`, and record count.

| Metric | Definition |
|---|---|
| Pipeline value by stage | exact-decimal sum of amounts for authorized open opportunities in reporting currency, grouped by current stage |
| Weighted forecast | exact-decimal sum of unrounded `amount × stage probability basis points / 10,000` terms for authorized open opportunities; round aggregate once at reporting-currency scale using existing K-Nex `half-up` mode |
| Won/lost conversion | count opportunities first terminally won / count opportunities first terminally won or lost in selected close-date window |
| Lead conversion | count leads first qualified / count leads first qualified or disqualified in selected decision-time window |
| Activity by owner/team | count immutable, non-superseded activities by activity actor and authorized team in selected occurred-time window |
| Task aging | open task count grouped by `not-due`, `due-today`, `1–7-days-overdue`, `8–30`, `31+` in reporting timezone |
| Sales cycle duration | for each opportunity, floor non-negative UTC elapsed seconds from creation to first terminal close divided by 86,400; sort whole-day values, use middle value for odd count, exact arithmetic mean of two middle values for even count |

Empty denominators yield `null`, not zero. Archived records remain in historical closed-window metrics; open pipeline excludes archived opportunities.

## Existing Sales data migration truth

P13.2 must upgrade in place from the accepted Phase 12 Sales schema:

- each existing `sales_opportunities` table row (`sales-opportunities` public collection ID) becomes exactly one canonical Opportunity with the same stable ID and audit lineage;
- legacy `lead` maps to the new `qualification` open stage, `qualified` maps to `discovery`, and `won`/`lost` remain terminal;
- required missing account or owner values are never silently invented: migration uses one configured migration owner and, where needed, one explicit legacy-import account, both bound in the migration plan and receipt; absent authority or binding returns `maintenance-required`. Optional primary contact, amount, due date, task relation, and expected close date remain null;
- existing opportunity values and task potential-revenue strings are parsed losslessly as canonical decimals. Existing USD rendering becomes explicit configured/backfilled currency evidence; an invalid or conflicting value stops migration;
- each existing `sales_tasks` table row (`sales-tasks` public collection ID) becomes exactly one canonical Task with the same stable ID and created/updated timestamps. Legacy `open`/`done` map to `open`/`completed`; absent due date and relation remain null; potential-revenue becomes migration evidence only and never opportunity revenue; private note becomes one authorized immutable Note related to the task. P13.2 replaces the current timestamp revision with an integer CAS revision for task and opportunity mutation;
- old collections cease to be writable/readable product truth after cutover. Compatibility aliases, dual writes, shadow copies, and silent duplicate sources are forbidden.

P13.9 must prove clean install, exact predecessor upgrade, backup/restore, and the declared rollback or maintenance boundary.

## Exact predecessor identity decision

P13.2 changes the accepted Phase 12 Sales contract atomically. The normative registry inventories every predecessor identity exactly once and assigns it to a versioned `v1→v2` or `v2→v3` replacement, a static in-place replacement, or fail-closed retirement; this ADR fixes handling rules rather than duplicating that list:

- Preserve public IDs when meaning and authority remain compatible, including `sales.route.settings`. When input/output/schema semantics change, bump the registered version and update every static registry, caller, fixture, saved reference, and document binding atomically.
- Retire an ID when its meaning would become ambiguous or unsafe. A retired source, action, route, event, realtime topic, page, block, or document binding fails closed; no compatibility alias or dual registration remains.
- Migrate existing Sales permissions, normalized grants, customer-edited roles, assignments, and Sales role-template adoption baselines to exact target permission IDs without widening or silently losing authority. When a predecessor effective permission depends on a cross-role composition that cannot be represented exactly by target role grants, preflight returns `maintenance-required` before mutation. Disabled/retired identities remain diagnostically truthful and non-executable under ADR-0022 generation fencing.
- Migrate Sales workspace settings—including default route, task page size, revenue visibility, and legacy ordered stage names—into target settings and the single configured pipeline. Unknown or conflicting settings return `maintenance-required`; they are not silently discarded.
- Reconcile existing task/opportunity/total-revenue sources, create/update/stage actions, task/opportunity events and realtime topics, registered routes, pages, UI components/blocks, page templates, and their source/action/document bindings by the registry's preserve-and-bump or explicit-retire decision.
- Persisted RBAC rows, settings, custom-page documents, published snapshots, saved views, source/action bindings, and block props migrate in the same release/migration boundary. Validation occurs before cutover; any unresolved reference or authority delta aborts. No page becomes broader, no actor loses accepted authority silently, and no stale binding executes against a new meaning.

### P13.3 corrective mutation contracts

- Contact and Lead update v2 require `emailMode` and `phoneMode` with exact `retain | set | clear` semantics. A value is present iff its mode is `set`; `clear` writes null; `retain` neither reads nor writes the protected field. Create supply and update set/clear require an exact current channels-read admission. Note body is not part of this admission family.
- Opportunity create/update v2 keep closed inputs. Create requires name, Account, pipeline, and qualification stage; primary Contact, money, and expected close date are optional. Update requires CAS identity, name, and retain/set/clear modes for primary Contact, money, and expected close date; each value is present iff its mode is `set`. Money is an exact canonical decimal with uppercase ISO currency and scale 0–18, zero-padded without rounding before persistence and capped at 128 padded characters. Amount create/set/clear requires current amount-read admission. A supplied primary Contact is locked, active, current-authorized, and belongs to the locked Account.
- Note create v2 may name one `replacesNoteId`. The predecessor must be a current-authorized recorded Note in the same application, environment, related-record type, and related-record ID. The predecessor stays immutable; the replacement link, audit, outbox, and idempotency result commit together.
- These admissions are host-derived within the action transaction, exact-bound to supplied fields and related identities, and reject missing, extra, duplicate, stale, revoked, or cross-scope facts before business effects.

## Limited-beta acceptance

Gate 13 may say `GO LIMITED CRM BETA` only when one exact-head independently deployed application proves:

1. All required journeys above complete against real PostgreSQL, real Next/Payload HTTP, and real Chromium for representative Sales representative and Sales manager accounts, with zero critical or serious accessibility violations.
2. The complete four-persona role matrix and authorization attacks prove cross-application, cross-team, field, dashboard, report, export, ownership, stage, replay, and stale-revision denials. Zero unauthorized records or sensitive values appear in response, HTML, cache, artifact, notification, or log evidence. Every stale write returns HTTP 409 and produces zero business effects.
3. A representative dataset contains at least 100 leads, 50 accounts, 100 contacts, 50 opportunities across every stage, 200 activities, and 100 tasks. One 10,000-row bounded CSV import and exact replay produce one logical outcome, zero duplicate records, and a diagnostic for every rejected row.
4. Metrics above reconcile exactly to an independently calculated fixture ledger; money delta is zero at the declared decimal scale and UTC/date/timezone boundary fixtures match expected buckets.
5. A signed Phase 12 predecessor dataset upgrades with stable IDs and zero silent row/value loss. Backup/clean restore preserves counts, relationships, audit, permissions, saved views, and report results.
6. Worker/realtime loss and restart converge without lost accepted activity, task, reminder, notification, import, or report effects; idempotent replay changes no logical counts. Healthy and recovery-path reminders reach the authorized recipient within 60 seconds of their scheduled time.
7. On the declared CI/pilot profile, p95 server-observed list, detail, and action latency is at most 1 second and p95 browser interaction readiness is at most 2.5 seconds for the representative dataset. The evidence records sample count, concurrency, hardware, and cache state; these budgets are beta evidence, not a production-capacity claim.
8. Pilot/dogfood record names its evidence class, application release, operators, dates, support owner, incidents, and observed results. A fixture is labeled fixture. Limited beta requires five consecutive business days of dogfood or external-pilot operation, at least two active human users, all Sev-1/Sev-2 incidents closed, successful restore drill within RTO 4 hours, and observed recoverable-point age within RPO 15 minutes.
9. Product owner signs journey/metric scope; Sales engineering owner signs migration and data correctness; security owner signs auth/adapter attack evidence; operations owner signs deploy/backup/restore/runbook evidence.

Any Phase 13 kill criterion stops beta promotion. Specifically: no object ships without a mapped daily consumer; no second vertical starts; no general language enters views/workflows; raw provider credentials never enter Sales/browser/domain rows; dashboard ACL never broadens CRM authority; upgrade/import cannot silently lose or duplicate truth; support, restore, or upgrade failure yields `REWORK`, not a beta claim.

## Attack delivery ownership

The Phase 13 attack list is mandatory. Delivery ownership is closed so no class can drift to an unnamed future task:

| Task | Required attack classes |
|---|---|
| P13.2 | cross-application core-record access; forged application/owner/team; predecessor migration mismatch; duplicate opportunity/task truth; money/currency/date/timezone coercion |
| P13.3 | field/record bypass across list/detail; forged revision; lead-conversion replay; duplicate conversion outputs; hidden-field leakage; lost invalidation |
| P13.4 | stale pipeline/stage/Kanban transition; forged pipeline revision; unbounded saved-view query or expression; page embed authority expansion |
| P13.5 | formula/oversize/encoding/protected-field import; crash/retry duplication; unauthorized export; dedupe hidden-field leak; merge substitution/stale winner |
| P13.6 | provider credential or webhook-secret exfiltration; forged/replayed webhook; unrestricted provider URL/network; cross-user notification/reminder |
| P13.7 | arbitrary code/expression/network; workflow loop/fan-out; privilege escalation; replayed business effect |
| P13.8 | report/dashboard/export field or record bypass; unauthorized scheduled recipient; rounding, currency, and timezone ambiguity |
| P13.9 | prior-release upgrade, backup, restore, rollback, application restart, worker recovery, inventory, or attestation mismatch |
| P13.10 | verify every prior denial proof, required journey, operational threshold, and pilot/dogfood statement at exact head |

## Consequences

- P13.2 has one vocabulary and migration target before schema code begins.
- Persona templates remain convenient defaults while stable permissions and policy hooks retain authority.
- Gate 13 can measure product coherence and operations, not collection count.
- Multiple pipelines, advanced revenue operations, and enterprise CRM breadth require later accepted decisions.

## Validation

ADR-0028 remains `design-only` until Gate 13 proves its full normative scope through the Phase 13 result, exact-head gate, executed route/action inventory, real database/browser journeys, attack evidence, predecessor upgrade, restore drill, and declared pilot or dogfood record.
