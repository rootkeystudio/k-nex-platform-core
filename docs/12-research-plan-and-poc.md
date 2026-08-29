# Research Plan and Proof Strategy

## Principle

K-Nex validates consequential architecture through independent falsifiable gates. The normative definitions live in [Executable Gates](./30-executable-poc-gates.md), while `status.md` selects the active task.

The accepted executable platform foundation uses one first-party domain reference, `module.sales`, so missing platform contracts are solved once instead of independently across premature verticals.

## Gate sequence

```text
Gate 0   contract freeze and repository governance                 complete
Gate 1   deterministic Payload/Postgres composition                complete
Gate 2   source authorization and output contracts                 complete
Gate 2A  agent-tool contracts and safe execution                   complete
Gate 3   transactional outbox and realtime convergence             complete
Gate 4   builder engine kill-spike                                 complete
Gate 5   themes, accessibility, atomic publication                 complete
Gate 6   plugin platform hardening and complete Sales reference    complete
Gate 7   comprehensive component/data/form/page system             complete
Gate 8   lifecycle, application factory, release, fleet safety     complete
Gate 9   RBAC, plugin policy hooks, and role-template bootstrap     active
```

Each gate carries explicit exclusions and kill/rework criteria so failure identifies the wrong assumption.

## Reference slice growth

```text
Gate 1
  Payload + Postgres
  module.sales
  deterministic composition, migration, boot

Gate 2
  sales.total-potential-revenue
  sales.tasks
  source/record/field authorization

Gate 2A
  sales.tools.search-tasks
  sales.tools.create-task
  catalog/gateway/MCP proof

Gate 3
  Sales durable events/outbox
  realtime invalidation and convergence

Gate 4
  canonical Sales-compatible blocks through Puck adapter

Gate 5
  Minimal/Neobrutalism runtime
  atomic CMS publication and workspace layout

Gate 6
  complete Sales contribution inventory
  settings/routes/navigation/default pages
  one plugin conformance command

Gate 7
  comprehensive component library
  DataTable/forms/pages/Puck blocks
  Sales overview/tasks/opportunities/settings UI

Gate 8
  upgrade/lifecycle/restore
  create-knex-app
  two independent Sales customer applications
  signed release/deployment/fleet evidence

Gate 9
  central roles, normalized grants, user/service assignments
  plugin permission policy bindings and role templates
  first-owner and last-owner safety
  dormant disabled-plugin authority
  live revocation across HTTP/cache/worker/browser/realtime
```

## Current freeze

Until Gate 9 project-manager PASS:

```text
module.sales remains the sole first-party domain reference
no CRM/CMS breadth
no logistics/restaurant/inventory/budgeting product module
no runtime package loading
no marketplace or Docker deploy controller implementation
```

A bounded test-only fixture may prove schema-less authorization cleanup or another generic property only when the active Phase 9 plan explicitly requires it. Such a fixture is not a second domain module.

## Docker and plugin-lifecycle research boundary

K-Nex V1 is container-first:

```text
package add/upgrade/removal
  immutable release + Docker deployment

ready preinstalled plugin enable/disable/re-enable
  PostgreSQL-backed live lifecycle transaction
```

Gate 9 determines whether live enable can remain honest without weakening package identity, migration readiness, policy binding, role-template bootstrap, revocation, or restore semantics. Runtime package download is not an experimental option.

## Authorization questions under test

Gate 9 must independently answer:

```text
Can every enabled plugin expose permissions without role-label coupling?
Can record/field policy hooks remain plugin-owned and capability-scoped?
Can customer roles survive disable/re-enable without retaining authority?
Can role templates evolve without overwriting customer edits?
Can disabled/orphaned permissions remain diagnosable but non-executable?
Can first-owner/last-owner lockout be prevented transactionally?
Can HTTP, worker, cache, browser, and realtime authority converge after revocation?
Can schema-less cleanup be safe without pretending schema-owning uninstall is generic?
```

## Evidence discipline

A gate result links real evidence:

```text
implementation PR/commit
contract and failure fixtures
required CI run
benchmark where performance matters
real PostgreSQL/browser/multi-process proof
migration/upgrade/restore fixture
deployment receipt when production-observed
```

Update `docs/adr/evidence-registry.json` only with actual evidence. A plan, mock, or interface is `design-only`.

## Immediate work

Execute P9.1 only:

```text
role/grant/assignment contracts
role-template adoption with stored baseline snapshot
permission display snapshot
policy-binding and authorization decision
protected roles and first-owner bootstrap
authorization revision and bootstrap receipt
schema-less authorization cleanup plan
```

Then continue Phase 9 in documented task order. Do not begin system settings, plugin/theme catalog, Docker controller, CRM, or CMS work before the corresponding gate and roadmap handoff.
