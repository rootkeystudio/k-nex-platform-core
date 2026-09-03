# Detailed Implementation Plan — Phase 13 CRM-First Productization and Pilot Readiness

- **Status:** selected following-phase plan; implementation is frozen until Gate 12 is accepted
- **Entry:** Phase 12 runnable customer application, workspace shell, custom-page builder, page ACL, and Sales Kanban proof accepted
- **Purpose:** turn `module.sales` from a platform reference into a coherent daily-use CRM product without opening multiple verticals
- **Product strategy:** CRM first; prove one usable product on the accepted platform before public CMS breadth, logistics, restaurant, inventory, budgeting, commerce, or marketplace expansion
- **Persisted identity:** keep `module.sales`; do not rename the installed domain merely to signal productization
- **Out of scope:** public website/CMS authoring, marketing automation suite, telephony platform, accounting/ERP, payments, public marketplace, shared-database SaaS tenancy, and broad AI assistant autonomy

## 1. Product outcome

Gate 13 targets a limited CRM beta candidate for a small sales team.

A user must be able to:

```text
sign in to the generated K-Nex application
see an authorized Sales workspace
manage accounts, contacts, leads, opportunities, activities, and tasks
work a configurable pipeline in list and Kanban views
view a record timeline and ownership
create customer dashboards with the Phase 12 page builder
import/export controlled data
receive reminders/notifications
connect bounded email/calendar adapters
run reports and forecasts
survive application upgrade, backup, restore, and operator restart
```

The phase is successful only if the daily workflow is coherent. Adding many disconnected collections is not productization.

## 2. Target user and initial workflow

Initial roles:

```text
Sales administrator
Sales manager
Sales representative
Sales viewer/auditor
```

Initial flow:

```text
lead captured/imported
→ qualified or disqualified
→ account/contact linked or created
→ opportunity opened
→ activities/tasks recorded
→ opportunity moves through one configured pipeline
→ won/lost reason recorded
→ manager reviews forecast, conversion, and activity
```

P13.1 must freeze the exact vocabulary, lifecycle, required fields, ownership rules, metrics, and success criteria before migrations are written.

## 3. Domain model

Initial first-party CRM objects:

```text
Account
Contact
Lead
Opportunity
Pipeline
Pipeline Stage
Activity
Task
Note
Attachment reference
Saved View
Import Job
Export Job
Notification/Reminder
```

Requirements:

- stable opaque IDs;
- application/environment isolation;
- owner/team assignment;
- created/updated actor and durable audit;
- bounded status/state transitions;
- soft archive where retention is required;
- explicit merge lineage for duplicate records;
- exact money/currency representation;
- locale/timezone-safe dates;
- no raw provider credentials in domain rows;
- plugin-owned migrations and upgrade/rollback evidence;
- field/record permissions integrated with current RBAC rather than separate role labels.

The existing Sales task/opportunity records are migrated or adapted deliberately. No silent duplicate source of truth is introduced.

## 4. Configurable pipelines and saved views

Phase 12's bounded Kanban becomes a real CRM view.

A pipeline is customer data, not executable policy. It may define:

```text
name
ordered active stages
terminal won/lost semantics
allowed transition graph
probability/default forecast metadata
required fields per transition
archive state
```

The transition service remains trusted code and enforces current record/action authority, expected record revision, current pipeline revision, and server-owned transition rules.

Saved views support bounded, schema-owned:

```text
table
kanban
calendar/activity
```

configuration. They may select declared fields, filters, sorts, groupings, pagination, and presentation options. They cannot author SQL, Payload paths, policy code, arbitrary expressions, or unbounded queries.

Custom Phase 12 pages may embed these saved views through registered Sales blocks.

## 5. Daily record experience

Each core record gets a fixed authorized page with:

```text
summary and key fields
owner/team
related account/contact/opportunity
activity timeline
tasks and reminders
notes
attachment references
audit-safe state history
authorized actions
```

Required product behaviors:

- optimistic edit conflicts;
- inline and full-form editing through registered actions;
- keyboard-first list/detail/Kanban workflow;
- clear loading/empty/error/denied/stale states;
- deep links through registered routes;
- no hidden-UI authorization;
- record-level and field-level redaction before caching/rendering;
- realtime invalidation plus bounded revalidation;
- bulk actions with explicit limits and partial-failure reporting.

## 6. Import, export, dedupe, and merge

CSV import is a server-side durable operation:

```text
upload to bounded object/storage authority
→ parse and validate
→ dry-run mapping/diagnostics
→ explicit commit
→ chunked idempotent writes
→ immutable receipt and error artifact
```

Constraints:

- file bytes/rows/columns/depth/time are bounded;
- formulas/macros and active content are not executed;
- customer-selected mapping references only registered fields;
- actor authority is rechecked before commit;
- duplicate retry does not duplicate records;
- partial failure is explicit;
- import cannot set protected ownership/audit/authorization fields;
- sensitive fields are absent from generic logs/receipts.

Export uses the same source/field/record authorization as the UI and is snapshot/revision bound.

Dedupe and merge:

- produce explainable candidates;
- never auto-merge by hidden heuristic;
- require explicit authority and expected revisions;
- preserve redirect/lineage and related records;
- support bounded rollback where still reversible;
- audit the winning and losing identities without leaking hidden fields.

## 7. Communication adapter boundary

Email and calendar are optional customer-configured integrations behind K-Nex interfaces.

Initial capabilities:

```text
send an authorized CRM email through a configured provider
record message metadata and delivery receipt
sync bounded calendar events/meetings
associate communication with CRM records
schedule reminders
```

Provider OAuth tokens, API keys, webhook secrets, and refresh credentials remain host secret references. They never appear in browser state, CRM records, builder documents, audit payloads, generic errors, or plugin settings values.

Inbound webhooks require exact provider signature verification, replay protection, tenant/application binding, idempotency, and bounded payloads.

No Phase 13 feature grants the Sales plugin raw unrestricted network or mailbox authority.

## 8. Workflow and notification boundary

Phase 13 may add a bounded rules model for common CRM automation:

```text
record event
+ closed condition set
→ declared registered action/job
```

Allowed examples:

```text
create follow-up task when opportunity enters a stage
notify owner when a lead is assigned
schedule reminder before an activity
```

Rules cannot contain arbitrary JavaScript, SQL, shell, network URLs, prompts with hidden authority, or dynamic tool creation. Conditions and actions are selected from registered schema-owned catalogs.

Durable business effects use transactional outbox, idempotent workers, retry/dead-letter policy, current authority where user authority remains relevant, and explicit system-after-acceptance authority where the accepted duty is intentionally irrevocable.

## 9. Reporting and dashboards

Initial reports:

```text
pipeline value by stage
weighted forecast
won/lost conversion
lead conversion
activity by owner/team
task aging
sales cycle duration
```

Rules:

- money uses canonical exact decimal representation;
- definitions name the source revision, filters, grouping, timezone, currency, and as-of time;
- data remains current-authority projected;
- expensive reports are bounded/durable jobs rather than unbounded request handlers;
- Phase 12 custom pages embed registered report/metric/chart/table blocks;
- dashboard access never broadens report data authority;
- export and scheduled report delivery reauthorize recipients and fields.

## 10. Pilot and operational readiness

Gate 13 includes a pilot-like independently deployed customer application, not only package unit tests.

Required operational evidence:

```text
clean install
seed/import representative CRM data
daily user journeys
authorization matrix
backup and clean restore drill
upgrade from accepted Phase 12 Sales state
rollback/maintenance classification
lost invalidation and worker restart
catalog/package attestation
health and alert signals
data export
support/runbook exercise
```

The result must state whether evidence came from a controlled fixture, internal dogfood, or a real external pilot. A fixture is not labeled as a customer.

Production claims require explicit SLO/RTO/RPO targets and observed evidence; deterministic test budgets alone are not production capacity.

## 11. Task order

### P13.1 — Freeze CRM product contract and acceptance metrics

Define target customer, personas, lifecycle vocabulary, required daily journeys, data retention, ownership, permissions, and measurable beta criteria.

Acceptance:

- one coherent sales process;
- explicit non-goals;
- UX journey maps tied to registered routes/actions;
- domain/permission/metric definitions have one owner;
- no collection is added without a daily workflow consumer.

### P13.2 — Add CRM core contracts and migrations

Add Account, Contact, Lead, Pipeline/Stage, Activity, Task, Note, attachment reference, and relationships; migrate the current Sales reference safely.

Acceptance:

- strict schemas and exact migrations;
- clean install plus prior-state upgrade;
- rollback/maintenance classification;
- customer isolation and revision fences;
- exact field/record permission matrix;
- no duplicate opportunity/task truth.

### P13.3 — Productize account, contact, lead, and opportunity workflows

Implement authorized list/detail/create/edit/archive/convert/qualify/win/loss journeys with ownership and timeline.

Acceptance:

- owner/manager/representative/viewer matrix;
- optimistic conflicts and replay;
- keyboard/accessibility;
- durable audit/outbox/realtime;
- hidden fields absent from query/cache/error/HTML.

### P13.4 — Productize configurable pipelines and saved views

Implement table, Kanban, and activity/calendar saved views plus pipeline/stage administration.

Acceptance:

- transition graph and revision fencing;
- pointer and keyboard Kanban movement;
- saved filter/sort/field configuration stays bounded;
- page-embedded and native views share the same definition/runtime;
- stale stage or pipeline changes fail closed.

### P13.5 — Add import, export, dedupe, and merge

Implement dry-run CSV import, durable commit, authorized snapshot export, duplicate candidate review, and record merge lineage.

Acceptance:

- malformed/oversized/CSV formula and replay attacks;
- chunk crash/restart and exact-once logical outcome;
- protected-field denial;
- partial-failure artifact;
- merge revision conflict and related-record preservation.

### P13.6 — Add communication, reminder, and notification adapters

Implement one bounded email provider and one calendar provider reference adapter, CRM activity association, reminders, and notification center.

Acceptance:

- provider secrets remain references;
- signed/replay-safe webhooks;
- actor/application isolation;
- send/sync idempotency;
- revocation and provider outage behavior;
- no raw mailbox/network authority in Sales code.

### P13.7 — Add bounded CRM workflows

Implement registered triggers, closed conditions, and declared actions/jobs for a small accepted automation set.

Acceptance:

- no arbitrary code/expression/network;
- exact trigger/action schema;
- loop and fan-out budgets;
- outbox/retry/dead-letter;
- authority transition documented and audited;
- unrelated customer/workflow remains healthy.

### P13.8 — Add CRM reports and dashboard blocks

Implement forecast, conversion, activity, aging, and cycle metrics plus Phase 12 dashboard blocks.

Acceptance:

- exact decimal/timezone semantics;
- source and authorization parity;
- bounded synchronous/async execution;
- custom-page ACL does not widen report data;
- report export/scheduling recipient authorization.

### P13.9 — Prove upgrade, backup, restore, and realistic data migration

Build a representative prior Sales dataset, upgrade it to the Phase 13 model, and prove clean backup/restore plus application restart.

Acceptance:

- exact predecessor migrations;
- no data loss or silent coercion;
- current-v1 package closure and attestation;
- rollback/maintenance decision;
- post-restore login, dashboard, pipeline, activities, permissions, and audit.

### P13.10 — Gate 13 limited-beta closeout

Create the Phase 13 result and cumulative gate.

Required journey includes:

```text
generated application
real PostgreSQL
real Next/Payload HTTP
real Chromium
at least two roles
account/contact/lead/opportunity workflow
configured pipeline and Kanban
activity/task/reminder
custom dashboard
import/export
communication adapter
report
backup/restore
version upgrade
worker/realtime recovery
```

One exact-head cumulative Gate 0–13 run and one declared pilot/dogfood evidence record are required before a limited beta claim.

## 12. Required attacks

```text
cross-application account/contact/lead/opportunity access
field/record permission bypass through list, detail, report, export, or dashboard
forged owner/team/pipeline/stage/revision
stale Kanban transition
lead conversion replay or duplicate account/contact creation
import formula, oversized file, malformed encoding, protected-field injection
import crash/retry duplication
unauthorized export or report recipient
dedupe hidden-field leakage
merge winner/loser substitution and stale revision
email/calendar token or webhook-secret exfiltration
forged/replayed inbound webhook
unrestricted provider URL/network
workflow arbitrary code/expression, loop, fan-out, or privilege escalation
notification/reminder cross-user delivery
money rounding/currency/timezone ambiguity
lost outbox/realtime invalidation preserving stale authority
prior-release migration or restore mismatch
custom dashboard used to expand CRM data authority
```

## 13. Kill criteria

1. The team cannot identify one daily-use CRM workflow that spans the new objects.
2. Domain breadth grows faster than accepted user journeys.
3. Saved views or workflows require a general query/programming language.
4. Communication requires raw provider credentials in Sales/browser/database content.
5. Dashboard/page access can widen CRM data authority.
6. Current Sales data cannot be upgraded without silent loss or a declared maintenance procedure.
7. Import/retry can create duplicate logical records.
8. A limited beta cannot be operated, restored, and upgraded through the accepted customer-application boundary.
9. The phase starts a second vertical or public CMS before CRM evidence closes.

## 14. Gate decision

```text
GO LIMITED CRM BETA
REWORK CRM DAILY WORKFLOW, DATA MODEL, OR PILOT OPERATIONS
REJECT BROAD MULTI-VERTICAL EXPANSION
```

Gate 13 does not claim a complete enterprise CRM. It establishes one coherent, supportable, independently deployable CRM product slice on the K-Nex platform.
