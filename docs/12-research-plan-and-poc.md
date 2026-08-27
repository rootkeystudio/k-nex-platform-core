# Research Plan and Proof Strategy

## Principle

The architecture is validated through independent kill gates, not one small-platform implementation. The normative gate definitions are in [Executable Gates](./30-executable-poc-gates.md).

The foundation program uses one domain reference module, `module.sales`, so every missing plugin/UI/lifecycle contract is solved once in the platform rather than independently inside multiple verticals.

## Sequence

```text
Gate 0   contract freeze and repository governance
Gate 1   minimal deterministic Payload composition
Gate 2   source authorization and output contracts
Gate 2A  agent tool contracts and safe execution
Gate 3   outbox and realtime convergence
Gate 4   builder engine kill-spike
Gate 5   UI themes, accessibility, atomic publication
Gate 6   plugin platform hardening and complete Sales reference
Gate 7   comprehensive headless component/data/form/page system
Gate 8   lifecycle, application factory, release, and fleet safety
```

Each gate has explicit exclusions so failure identifies the wrong assumption.

## Reference customer slice

The same Sales-based vertical slice grows through the gates:

```text
Gate 1
  Payload + Postgres
  module.sales
  deterministic composition and migration

Gate 2
  sales.total-potential-revenue
  sales.tasks
  source/record/field authorization

Gate 2A
  sales.tools.search-tasks
  sales.tools.create-task
  safe catalog/gateway/MCP proof

Gate 3
  Sales durable events/outbox
  realtime invalidation and convergence

Gate 4
  Sales static/authenticated blocks through canonical Puck adapter

Gate 5
  Sales-compatible runtime under Minimal/Neobrutalism
  atomic CMS publication and workspace layout

Gate 6
  complete Sales plugin contribution matrix
  settings/routes/navigation/default pages
  plugin conformance command

Gate 7
  comprehensive component library
  DataTable/forms/page templates/Puck blocks
  complete Sales overview/tasks/opportunities/settings UI

Gate 8
  upgrade/lifecycle/restore
  create-knex-app
  two independent Sales-only customer compositions
  release/fleet evidence
```

## Domain expansion freeze

Before Gate 8 PASS, do not implement:

```text
module.logistics.*
module.restaurant.*
module.inventory
module.budgeting
other first-party domain modules
```

Domain blueprints remain research/backlog context only. They do not select implementation work.

This freeze prevents Cargo and Restaurant fixtures from inventing separate settings, query, component, page-template, lifecycle, and deployment patterns before the Sales reference contract is complete.

## Component research

The Component Gallery list is the minimum coverage inventory for Gate 7. React Aria, WAI-ARIA APG, TanStack Table/Virtual, form-engine candidates, and Lexical are evaluated as implementation engines behind K-Nex contracts.

The theme ABI remains small. Component breadth is achieved through platform-owned compound components and adapters, not by requiring each theme to implement a separate component framework.

See:

- [Plugin platform hardening and Sales reference](./33-plugin-platform-hardening-and-reference-sales.md)
- [Headless component system](./34-headless-component-system.md)

## Two-customer proof

Gate 8 creates two independent customer applications using the same platform and Sales packages but different:

```text
themes/profiles
Sales settings
default-page selection
permissions and layouts
lockfiles and release cadence
```

This proves application-factory and fleet reuse without adding another domain module.

## Evidence discipline

A gate result links:

```text
implementation PR/commit
contract and failure fixtures
CI run
benchmark where performance matters
migration/restore fixture
deployment receipt for production-observed evidence
```

Update `docs/adr/evidence-registry.json` only with real evidence. A document or mock interface is not executable proof.

## Immediate work

- complete and merge Gate 5 without expanding its scope;
- begin Gate 6 with the contribution taxonomy, not another module;
- use Sales for every plugin-authoring proof;
- keep the comprehensive component catalog in Gate 7 behind the small theme ABI;
- defer customer generator/lifecycle/fleet proof to Gate 8;
- do not select a new vertical or AI product until the foundation program passes.