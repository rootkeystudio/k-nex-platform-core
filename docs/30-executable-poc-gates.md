# Executable Proof-of-Concept Gates

## Principle

A POC must be independently falsifiable. K-Nex will not build the entire platform and then try to infer which architectural assumption failed.

A gate starts only after its predecessor's contract/evidence is stable enough. Failure causes a documented redesign or rejection of that assumption; it does not get hidden by adding more features.

## Gate 0 — Contract freeze and repository governance

Deliver:

```text
canonical ID grammar
plugin/application JSON Schemas
one plugin fixture
canonical registration phases
output-contract registry
ADR evidence registry
docs/schema/legacy-symbol CI
CODEOWNERS and PR checklist
```

Exit:

- validator passes in a clean checkout;
- intentional legacy fixture fails;
- two clean runs produce identical normalized schema/fixture outputs.

Kill/rework criterion: prose examples cannot be made consistent with the machine-readable contracts without changing accepted product semantics.

## Gate 1 — Minimal deterministic composition

Scope only:

```text
one customer repository
Payload + Postgres
contracts + resolver + composition + Payload adapter
one module
one collection
one authenticated query
one generated registry and resolved graph
one clean migration
boot inventory
```

Explicitly excluded: Puck, themes, WebSocket, retained-schema uninstall, second customer.

Exit:

- two clean directories generate byte-identical deterministic artifacts;
- resolved graph matches package integrity and runtime actual registration;
- undeclared contribution/capability access fails;
- clean Postgres boot and migration pass.

Kill/rework criterion: identical normalized inputs cannot produce identical graph/registries or Payload composition needs a deep framework fork.

## Gate 2 — Data source, authorization, and output contracts

Scope:

```text
metric.scalar@1
table.records@1
one Sales metric source
one Sales paginated table source
source/field/record authorization
required/optional fields
bounded sort/filter/page/query cost
source-specific + canonical contract validation
safe cache classes
RFC 9457 errors
```

Exit:

- manual source/field manipulation is denied;
- no unauthorized field enters query result, cache, trace, or error;
- actor and authorization-context cache fixtures do not cross boundaries;
- realistic validation benchmark meets an explicitly recorded budget;
- lost required field creates explicit insufficient-permission UI state.

Kill/rework criterion: safe cache identity is not expressible or runtime validation/projection cost is unacceptable at representative sizes.

## Gate 3 — Transactions, durable events, and realtime convergence

Scope:

```text
transactional outbox for one durable event
reconstructible source invalidation
single-process Socket.IO mode
Redis/backplane or outbox relay for split process mode
revision/watermark and reconnect resync
failure injection
```

Failure cases:

```text
commit then process crash
duplicate event
worker → web invalidation
lost Pub/Sub message
role revocation during subscription
slow consumer
rolling deployment
```

Exit:

- durable intent survives crash and is idempotently processed;
- no event/invalidation escapes a rolled-back transaction;
- split topology cannot select in-memory mode;
- clients converge after message loss/reconnect;
- authorization is re-evaluated.

Kill/rework criterion: provider abstraction cannot state topology/durability honestly or clients can remain indefinitely stale.

## Gate 4 — Builder engine kill-spike

Scope only:

```text
BuilderEngineAdapter
canonical document round-trip
fixed shell outside canvas
one static block
one authenticated data block
public/workspace policy separation
missing-block fallback
browser/server bundle boundary
keyboard operation
```

Excluded: broad CMS catalog, localization, extensive theme editor, full operational screen composition.

Exit:

- canonical fixture round-trips without semantic loss;
- no Puck type/config enters module contract or persisted document;
- forbidden public/internal binding cannot be authored or published;
- same runtime renderer renders outside the editor;
- accessibility blockers can be fixed without a deep engine fork.

Kill/rework criterion: lossless canonical mapping, fixed-shell policy, or accessible operation requires maintaining a deep Puck fork. Fallback: evaluate Craft.js through the same contracts.

## Gate 5 — UI runtime, themes, and CMS atomic publication

Scope:

```text
small semantic primitive ABI
Minimal + Neobrutalism themes
WCAG 2.2 AA acceptance journeys
UiDocumentRuntime and UiDocumentRepository split
atomic page+document publish/rollback
published layout snapshot + constrained user patch
```

Exit:

- same document renders under both themes without mutation;
- keyboard, focus, drag alternative, target size, reduced motion, and screen-reader smoke gates pass;
- failed document validation rolls back page publication;
- multi-assignment layout resolution is deterministic and explainable.

## Gate 6 — Lifecycle, migrations, and upgrade safety

Scope:

```text
install
upgrade
disable
re-enable
explicit archive/export
purge
migration advisory lock and predecessor fence
source/block/theme migrations
```

Schema-owning retained-data uninstall is a separate experiment, not a V1 exit requirement.

Exit:

- disable/re-enable preserves data and declared behavior;
- concurrent migration attempt fails safely;
- stale artifact fails readiness after newer incompatible migration;
- purge refuses without dependency/reference/backup/migration evidence.

## Gate 7 — Second customer and fleet operations

Add the second repository only now.

Prove:

```text
same released packages, different composition and themes
independent lockfile/migrations/release cadence
automated upgrade PR generation
SBOM and signed build provenance
deployment receipt and runtime inventory
fleet query for vulnerable package/version
security patch propagation
previous-release upgrade fixture
```

Exit:

- Cargo upgrades while Restaurant remains on its previous supported release;
- fleet inventory is derived from verifiable deployed evidence, not manually asserted YAML;
- one security package range identifies every affected deployed customer artifact.

## Evidence promotion

After a gate passes, update `docs/adr/evidence-registry.json` with links to:

```text
implementation commit/PR
test fixture and CI run
benchmark or failure-injection result
migration fixture
deployment receipt when production-observed
```

An accepted design remains `design-only` until this evidence exists.
