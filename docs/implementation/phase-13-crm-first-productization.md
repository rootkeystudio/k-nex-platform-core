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

A pipeline is customer data, not executable policy. Stage IDs are host/server-generated lowercase RFC 4122 UUIDv5 values with one fixed namespace. Their executable name bytes are NFC-normalized UTF-8 `phase13/pipeline-stage/v1`, application ID, environment, durable positive-int32 pipeline stable ID, and semantic, joined by literal `0x00` separators; inputs reject NUL and contract golden vectors pin the result. An Opportunity derives state only from its locked referenced stage semantic, never from an ID spelling. P13.4 receipt-bound migration atomically rewrites only mutable Stage IDs and allowed-transition references, pipeline order, Opportunity, current Saved View, and current editable page-binding references. It byte-preserves historical audit/idempotency request/result/published revision evidence and treats old contracts as non-executable, appends translation evidence, makes exact replay a no-op, and fails closed on any preflight/fencing mismatch. Gate 13 has exactly one active pipeline per application/environment, so archiving that sole pipeline is rejected: there is no create/replacement path in this phase.

The only configuration mutation is a full atomic snapshot CAS over the expected pipeline revision and every affected stage revision. The snapshot contains exactly one each of `qualification`, `discovery`, `proposal`, `negotiation`, `won`, and `lost`; semantic is immutable and each stage ID is re-derived from its original semantic tuple; presentation names; configurable open ordering and probability; graph edges that are a subset of the trusted graph; and closed transition-required field IDs. Update returns one closed active pipeline with exactly six closed active-stage results. A stage move carries expected Opportunity, pipeline, source-stage, and destination-stage revisions. Pointer and keyboard Kanban movement call that same action. Opportunity close admits optional `lossReason` input, requires its trimmed 1–500 UTF-8 bytes only for locked `lost`, and forbids it for locked `won`.

A pipeline may define:

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

Saved views are personal to their owner or visible to one exact team; they are never public or application-wide. They support bounded, schema-owned:

```text
table
kanban
calendar/activity
```

configuration. Tables target Account, Contact, Lead, Opportunity, Task, or Activity; Kanban targets Opportunity and groups by stage; calendar targets Activity by `scheduledAt` or `occurredAt`. Three dedicated v1 saved-view DataSources use exact platform descriptors and existing structural-hash projection, leaving shipped record sources unchanged. Definitions use only declared platform field kinds/operators; every target field freezes independent select/filter/sort/group/calendar permission, with at most eight operators per field. They are capped at 8 fields, 8 filters, 2 sorts, one grouping, page size 100, name length 120, 16 KiB canonical JSON, and a 31-day calendar window. Presentation is table/Kanban `comfortable | compact` or calendar `agenda | month`. They cannot author SQL, Payload paths, policy code, arbitrary expressions, or unbounded queries.

Custom Phase 12 pages may embed these saved views through registered Sales blocks. Canonical route/page/block IDs are `calendar/calendar/calendar`, `pipeline-settings/pipeline-settings/pipeline-settings`, and `saved-views/saved-views/saved-views` under their `sales.route.*`, `sales.page.*`, and `sales.*` namespaces. Native and embedded execution both bind `savedViewId` plus `expectedRevision` and invoke the same server compiler/runtime; current visibility, target record, source, and field-operation authority may only narrow results. Query controls use standard `filters`, `sort`, and `{ number, size }` page shape; result is exact `TableRecords` only.

P13.4 registers only one globally unique block contribution for each canonical route/page/block triple. Full route/page/block descriptors close versions, permissions, source/action policies, required states, and dependencies. The compiler requires selected fields to equal persisted definition fields and include all descriptor-required/group/date/filter/sort fields; canonical filters/sorts enforce exact kind/nullability, 512-character strings, homogeneous arrays, and six user calendar filters plus two range predicates. Stable ordering fixes null placement and appends canonical ID ascending, while publication rechecks saved-view/source/authorization revisions.

Closed `sales.pipeline.snapshot`, `sales.saved-view.list`, and `sales.saved-view.detail` sources serve native administration; detail definitions use at most 33 ordered Unicode-safe platform text chunks and preserve the full 16 KiB canonical definition. The UUID migration retires `sales.opportunities@2` and `sales.opportunity.detail@1` for exact `@3`/`@2` schemas/hashes, advances the actual source-bound `sales.list.opportunities@2` to `@3`, and rewrites only current mutable dependent bindings. `sales.settings.workspace` schema v2 removes editable `pipelineStages`, migrates it once to the canonical pipeline, and thereafter renders pipeline stage order read-only.

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

### P13.6 reference-adapter contract

P13.6 uses the fixed host adapters `email.reference.v1` and `calendar.reference.v1`. Sales actions submit only an application/environment/actor-bound intent, a CRM relation, an idempotency key, and the closed message or activity fields. Email recipients are never caller-supplied: the worker resolves the current authorized Lead or Contact channel immediately before the effect. `sales.integration.configure` accepts only `providerId`, `expectedRevision`, and `activate | revoke`; the generated host maps each provider to one fixed opaque secret slot. Neither Sales nor browser state receives a secret reference or secret value.

Provider configuration status is projected only through source `sales.provider-configurations`, event `sales.event.provider-configuration-changed`, and realtime topic `sales.realtime.provider-configurations`. The source requires `sales.settings.read` and exposes exactly `provider-id`, `state`, `revision`, `updated-at`, and nullable `revoked-at`. Secret references and secret values are never source, event, realtime, UI, or browser fields.

Outbound intents are at most 32 KiB and reject secret-, credential-, address-, recipient-, or URL-shaped extension fields. The worker rechecks the PostgreSQL generation fence, authorization/lifecycle/scope revisions, provider configuration revision, CRM relation, and Activity CAS immediately before the effect. Every retry carries the same provider idempotency key. Only provider outages retry, at most three attempts with bounded backoff; revocation and host invariant failures dead-letter safely. A successful effect completes the same scheduled Activity and records one digest-only receipt; it never creates a parallel Activity.

Inbound endpoints are fixed per adapter. They accept at most 64 KiB of exact UTF-8 JSON, a millisecond timestamp within five minutes, and an HMAC-SHA256 signature over the raw timestamp/body bytes. The closed event binds an already accepted operation in the same application, environment, and provider. Its recipient must match the persisted operation actor, and notification delivery derives that persisted actor. Exact replay is inert; the same event ID with different bytes is rejected. Persisted webhook metadata is provider-specific and allowlisted.

The notification center registers `sales.notifications` and `sales.reminders` sources, `sales.page.notifications`, `sales.notification-center` and `sales.reminder-center` blocks, and the existing fixed `sales.route.notifications`. Both sources require exact recipient predicates. Reminder delivery uses `sales.job.reminder-delivery`, creates one recipient notification, and follows the lifecycle and terminal-state rules frozen in ADR-0028.

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

P13.3 pins one temporary, provenance-bound runtime dependency repair: `@payloadcms/db-postgres@3.88.0` receives only upstream `payloadcms/payload#17831` commit `134c89b7955d0dcde9137643ab86873ff542dbd4` (`#15674`, `#16256`), whose canonical patch SHA-256 is `0889c7c61e08478410dfcb1112415677fa9f50267901ee15c99e3deb1c9edf2f`. It releases the connectivity probe client after its reconnect listener is attached, so graceful `pool.end()` can drain. The root and every generated standalone application carry byte-identical patch bytes and exact `patchedDependencies` identity; factory-lock and plan digests bind them. Remove it only after an approved pinned Payload release contains this exact repair and the same shutdown/restart tests pass without it.

Acceptance:

- owner/manager/representative/viewer matrix;
- optimistic conflicts and replay;
- keyboard/accessibility;
- durable audit/outbox/realtime;
- hidden fields absent from query/cache/error/HTML.

### P13.4 — Productize configurable pipelines and saved views

Implement table, Kanban, and activity/calendar saved views plus pipeline/stage administration.

Acceptance:

- opaque-stage predecessor migration rewrites only mutable references atomically with receipt or fails closed; historical audit/idempotency/published evidence is byte-preserved;
- exactly-one active-pipeline snapshot CAS, trusted-graph subset, closed transition requirements, and sole-pipeline archive denial;
- Opportunity/pipeline/source-stage/destination-stage revision fences; pointer and keyboard Kanban movement share one action;
- personal/exact-team-only saved-view visibility with closed kind/date-field/presentation discriminators, dedicated source structural hashes, bounded declared platform field-kind operators, and presentation;
- page-embedded and native views share the same saved-view compiler/runtime and authority only narrows;
- stale, forged, unbounded, expression, and authority-expansion attempts fail closed.

P13.4 executable topology binds one source per node: calendar and Kanban use deterministic authorized defaults when the saved-view pair is omitted, explicit deep links/embedded nodes use the exact ID/revision pair, and saved-view management splits list/detail nodes. Kanban uses one composite TableRecords source for six ordered stage rows plus opportunities; bounded canonical-JSON stage metadata fails closed. Opportunity revision/presentation fields require existing Opportunity read authority without disclosing pipeline configuration. Pipeline snapshot and worst-case 33-row saved-view detail each freeze the real evaluator maximum at 14. Migration maps actual predecessor transition field names and newly populates required fields from the trusted semantic rule. Full successor page/contribution descriptors and mutable binding rewrites are exact.

Implementation freezes `SavedViewBindingInput` as exact empty-or-positive-safe-integer kebab pair; embedded camelCase maps to it. Host resolves/locks/authorizes definition before gateway, creates one request-local effective document for both load/render, compiles exact fields/filters/sorts/page, then rechecks view/source/auth revisions before publication. No default produces canonical empty `TableRecords`; no runtime path persists overrides. Saved View list selection updates exact query pair and refetches.

Kanban uses `stage:<uuid>` and `opportunity:<id>` keys. Six stage rows lead every page; opportunity-only filters/sorts use offset `(number-1)*(size-6)` and remaining-opportunity `hasNext`. Exact row nulls/token extraction, canonical JSON text arrays, chunk keys/order/digest, size-6 pipeline and size-33 detail loaders, source-aware detail assembly, five singular action nodes, and route `mode=table|kanban` are executable-route assertions. Only active mode loads; switch resets its page; pointer/keyboard reuse platform paginator. Update authorizes locked current Saved View scope and destination independently, keeps owner immutable, and atomically commits CAS/audit/outbox/idempotency or zero effects.

Raw embed props freeze Kanban `{title}` plus optional complete reserved ID/revision pair and calendar/table empty plus optional pair. Host strips/maps reserved props before exact contribution validation. Default-empty execution uses full node fields and numeric page size 25. Detail assembly requires every chunk key/cell to match one locked Saved View; trusted owner/digest remain resolver metadata. Kanban cross-row validation closes six unique stages, key/cell UUIDs, shared pipeline tokens, names/revisions/semantics, opportunity membership, and derivation of all eight `sales.opportunity.stage.update@3` inputs.

### P13.5 — Add import, export, dedupe, and merge

Implement dry-run CSV import, durable commit, authorized snapshot export, duplicate candidate review, and record merge lineage.

P13.5 is closed by `phase-13-crm-product-contract.v1.json:dataSemantics.dataMovement`. Imports target Lead, Account, or Contact only. They accept UTF-8 RFC4180 CSV with comma/double-quote/CRLF rules and an optional BOM, then reject any other encoding or dialect. The limits are exactly 16 MiB input bytes, 1–10,000 data rows, 64 columns, 16 KiB UTF-8 cell bytes, and 250-row worker chunks; header-only input is invalid. One header is required. It is NFC-normalized, unique, mapped only to registered writable fields, and cannot name ownership, scope, audit, lifecycle, authorization, revision, or merge fields. After leading Unicode whitespace and C0/C1 controls are removed, `=`, `+`, `-`, and `@` are formula-leading and reject the row/file before any execution.

The contract carries platform-valid route/page/block, Action, and DataSource descriptors plus canonical hashes and exact current-record policies. Idempotency stays in the existing action envelope, never an action input. Import and export use a nested discriminated `request` so target fields and target/source pairs cannot cross. Every identity/revision is bounded to a safe integer; header/field selections are runtime-unique and digests use exact lowercase SHA-256 syntax. Arbitrary unique NFC headers map one-to-one through exact `{header,fieldId}` items, each target field appears at most once, and every required field appears exactly once. Empty cells are null only for optional fields; only Contact `accountId` parses bounded ASCII decimal. Contact import locks an active in-scope Account immediately before effect and inherits its exact owner/team.

Fatal dry-run rolls back without a job; successful validation persists pending rows and reaches revision 2. Chunk `k` is zero-based rows `[250k,min(250k+250,rowCount))`, carries lease owner/expiry, allows at most three claims, and reauthorizes at claim, before each effect, and before completion. Claim/reclaim CAS-checks the persisted fence/lease, then installs the current global generation and new owner. Pending rows transition exactly once to accepted with the record effect or rejected with one safe diagnostic. Revoked authority or third lease expiry atomically rejects all pending rows, fails remaining chunks, closes the job once, and never requeues. Export has the same generation-fenced lease/CAS discipline; queued cancel and worker claim race by CAS, and publish/terminal evidence commit once.

After 30 days, raw/reconstructable uploads, mappings, row payloads, diagnostics, query values, snapshots, and artifact bytes are purged; only non-sensitive evidence, IDs, state, revisions, counts, and digests persist. Export is restricted to the exact current Lead/Account/Contact descriptor hashes and field allowlists. Those sources expose no filter or sort operators, so P13.5 accepts neither; the host scans by numeric record ID ascending in internal batches, capped at 10,000 rows and 16 MiB. It snapshots `{recordId,recordRevision,authorizedRedactedRowDigest}` and denies the whole artifact/no bytes if any final row/authority fence is revoked or stale.

Dedupe uses the Imports route's request-local Account/Contact selection; the host maps camel-case route keys to optional kebab-case source inputs, rejects partial variants, resolves `{}` to the contract's schema-valid empty `TableRecords` without lookup, and never persists the subject in the page document. It returns at most 1,000 unique candidate IDs, cursor-paged 100 at a time in candidate-ID order, and returns no rows/count when that bound is exceeded. Its exact match enum is `account-name | contact-email | contact-phone | contact-email-and-phone`; subject and candidate both require current record and matching-field authority. The request-local subject is always winner; the selected candidate is always loser, and both revisions are rechecked. Normalization is `node24.19-unicode17-v1`, bound to Node 24.19.0, Unicode 17.0, and ICU 78.3 with golden vectors. Contact merge additionally locks equal non-null active account IDs. Winner and loser revisions each advance once; both immutable audits use `sales.merge.commit` and distinguish survivor/merged resources through state, revisions, and lineage facts. Target-specific relation counts contain every exact relation ID once in contract order, and lineage binds pre/post identity, scope, revisions, match/normalizer, digests, counts, actor/authorization, and commit time. `mergedIntoId` is loser-only protected state and redirects reauthorize both rows. One closed public-error registry covers every fatal, row, worker, dedupe, authority, artifact, and replay failure.

Dry-run is `sales.import.dry-run@1`; commit is `sales.import.commit@1`; cancel is `sales.import.cancel@1`. Each takes its exact closed schema, authorization revision, canonical input digest, actor-bound idempotency key, and current target field authority from the contract. Dry-run persists mapping/upload/schema/authorization digests and row diagnostics. Commit rechecks all authority before queueing. Chunk claim/completion is generation-fenced and lease-CASed; durable `(job, oneBasedDataRow)` outcomes make crash/retry one logical write. A partial outcome has one public diagnostic per rejected data row; receipts/logs never contain raw sensitive cells.

Export creation is `sales.export.create@1`; cancellation is `sales.export.cancel@1`. It creates an immutable authorized/redacted materialized snapshot bound to its source, source/schema version, query, selected fields, and authorization revision. The worker emits only that snapshot. Artifact publishing and every download recheck current export/source/record/field/artifact authority. Output is UTF-8 RFC4180 with CRLF and no BOM; every authorized/redacted emitted value whose control/whitespace-trimmed prefix is formula-leading gains one apostrophe. The snapshot and artifact digests remain durable evidence; artifact bytes expire after exactly 30 days.

The `sales.dedupe.candidates@1` source has no hidden heuristic: Account candidates use normalized name only, Contact candidates use normalized email or normalized phone only. A candidate is omitted entirely when its match field is not currently authorized; neither hidden reason nor count is disclosed. `sales.merge.commit@1` admits only same-type active Account or Contact records, locks both winner/loser revisions and current authority, preserves all winner values, and rewrites only the contract's exact relation set. The transaction writes immutable loser-to-winner redirect/lineage, audit, outbox, and idempotency evidence. Rollback ends at transaction commit; automatic post-commit undo is forbidden.

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

Implement the exact static-only `module.sales` catalog in the product contract. It contains three compile-time rules: Opportunity `discovery → proposal` creates one owner follow-up Task; accepted Lead ownership assignment emits one fixed non-sensitive assignment notice to the new owner; accepted scheduled Activity schedules one Reminder exactly 15 minutes before, clamped to acceptance time when earlier. Each rule uses a dedicated `durable-workflow` event, declares one effect, and has fan-out 1/depth 1. Customer data cannot add or alter definitions, UI, permissions, triggers, conditions, effects, recipients, or jobs.

Persist executions through fixed job `sales.job.crm-workflow-execution` only. Allow states `queued`, `running`, `succeeded`, and `dead-letter`; claim at batch size 16 (hard maximum 32), retry at most three times with bounded backoff, and retain only safe failure codes and non-sensitive execution evidence. Canonical JSON idempotency binds application/environment, workflow, trigger event/digest, target, and effect. PostgreSQL fence/token, promotion revision, lease, expected revision, and CAS protect claim/effect/terminal transitions; stale workers have zero effects. Accepted-trigger → queued and every queued → running, running → queued retry, running → succeeded, and running → dead-letter transition atomically append immutable execution audit and internal `sales.event.workflow-execution-changed` v1 `durable-integration` outbox evidence. It has no source or realtime projection; transport rows retain 30 days while execution metadata, audit, receipt, digest, and safe failure evidence retain for the application lifetime.

Before the Task effect, recheck the original actor, current Opportunity authorization/scope, current Opportunity revision/state, and accepted owner; mismatch yields a safe terminal failure with zero effect. Preserve original Opportunity owner and relation. Keep Lead notice fixed and non-sensitive; reference navigation reauthorizes current Lead access. Before Reminder insertion, recheck target Activity remains scheduled at accepted revision/actor; cancel, complete, or stale yields safe terminal failure with zero effect. Owner notification and reminder are explicit system-after-acceptance duties from the accepted transition and cannot widen recipient or record scope. Closed schemas forbid arbitrary code, expressions, SQL, network/URL access, prompts, dynamic tools, and customer-authored UI or permissions.

Acceptance:

- exactly three dedicated durable-workflow triggers, one effect each, no generic changed-event reinterpretation;
- exact trigger/effect schema with closed keys, recipient/record bounds, 16/32 batch, depth/fan-out, three-attempt backoff, and four execution states;
- canonical idempotency plus application/environment isolation and fence/lease/CAS stale-worker denial;
- atomic audit/outbox and safe failure/retention evidence;
- actor/current-auth/scope plus current Opportunity revision/state/owner recheck for Task; scheduled Activity revision/actor recheck for Reminder; fixed non-sensitive Lead notice with navigation reauthorization;
- no arbitrary code/expression/SQL/network/URL/prompt/dynamic tools or customer-authored definitions/UI/permissions;
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
