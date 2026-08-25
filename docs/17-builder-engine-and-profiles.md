# Builder Engine and Profiles

## Decision

K-Nex uses one canonical visual document architecture for CMS and workspace composition, with separate policies and authority-bearing IDs. Puck is the first engine candidate, not the owner of K-Nex storage/runtime contracts.

## Three boundaries

```text
BuilderEngineAdapter
  editor engine ↔ canonical document
  palette/field bridge, editor host, engine metadata

UiDocumentRuntime
  document/source/action/block validation
  permission/audience/profile rules
  rendering, migrations, missing-component behavior

UiDocumentRepository
  Payload storage, revisions, atomic publication,
  rollback, indexes and query lifecycle
```

`@k-nex/builder-puck` implements only the first boundary. Payload storage lives in a separate package; CMS owns page metadata/publication policy.

## Profiles

### CMS

```text
public/content page kinds
explicit public-safe blocks/sources/actions
SEO/localization and public theme
draft, protected preview, atomic publish/rollback
no authenticated workspace source inheritance
```

### Workspace

```text
authenticated dashboards/overviews/reports
source filters and registered actions
layout assignments and constrained personalization
realtime invalidation and admin theme
no anonymous authority
```

The engine can be shared; the palette, policy, data, action, publication, and storage behavior are not.

## Authority-specific identities

Do not configure one authority-bearing ID for both public and privileged behavior.

```text
sales.public-lead-form
sales.workspace-lead-quick-create
logistics.public-tracking
logistics.workspace-shipment-tracking
```

A purely static Hero/Card renderer may be shared across profiles because it has no authority-bearing source/action.

## Canonical document

Persisted data contains:

```text
document/profile/schema version
regions and block ID/version
validated static props
source/action/state/context bindings
selected stable fields
constraints and layout token references
assignment/publication lineage
namespaced optional engine metadata
```

It contains no Puck types, arbitrary style object, JavaScript, SQL, package path, secret, or raw server URL.

## Puck adapter responsibilities

- translate K-Nex block/field/slot definitions to Puck configuration;
- host editor inside the fixed shell;
- convert edits to/from canonical documents without semantic loss;
- apply profile palette/edit constraints;
- render preview through `UiDocumentRuntime` and selected theme;
- isolate/migrate minimal Puck-specific metadata;
- report engine diagnostics.

It does not own Payload revisions, page publication, source authorization, runtime rendering policy, or customer theme definitions.

## Layout and assignment

Published customer/group layouts are immutable snapshots with lineage. Assignment rules select a layout by explicit subject selector and priority. User personalization is a constrained patch for move/hide/allowed props. Last-valid resolved snapshot remains after conflict/migration failure.

A user with several roles is not resolved by merging role names in unspecified order.

## CMS atomic publication

Gate 5 proves page metadata and canonical document publication in one transaction. Failed block/source/action/theme validation rolls back both. Published pair lookup and rollback are fixture-tested.

## Puck acceptance

Gate 4 requires:

- lossless canonical round-trip;
- fixed shell outside canvas;
- distinct CMS/workspace policy;
- one static and one authenticated data block;
- safe missing-block fallback;
- no server bundle leakage;
- keyboard operation and drag alternative without deep fork;
- runtime rendering without editor package.

Reject/rework Puck if these require a maintained deep engine fork. Craft.js is evaluated through the same canonical/runtime/repository boundaries.
