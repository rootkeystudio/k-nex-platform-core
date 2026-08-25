# Plugin Taxonomy and Capability Resolution

## Plugin kinds

```text
module       business or horizontal application behavior
provider     genuinely replaceable infrastructure capability
builder      visual editor engine adapter
theme        executable presentation package and token/profile schema
integration  reusable collaboration between modules/external systems
preset       CLI composition recipe expanded before runtime
```

Examples:

```text
module.sales
module.logistics.core
module.logistics.driver
provider.realtime.socketio
provider.storage.s3
builder.puck
theme.neobrutalism
integration.sales-logistics
preset.logistics
```

The Payload database adapter is framework/scaffold configuration, not a K-Nex plugin.

## Identity

Every plugin has independent identities:

```text
plugin ID       stable persisted product identity
package name    registry location
package version exact installed artifact
manifest digest exact package self-description
```

Canonical grammar is defined in `contracts/architecture-contracts.v1.json`. Dots express hierarchy; package names may remain kebab-case.

## Static manifest

All packages use the single schema and fixtures:

```text
schemas/plugin-manifest.v1.schema.json
fixtures/plugin-manifests/
```

The manifest includes:

```text
ID/kind/package/exact package version
core/Payload/Node/Postgres compatibility
provided capabilities
required/optional/conflicting dependencies
surfaces and environment names
V1 lifecycle semantics
expected contribution IDs by kind
```

Resolution loads static metadata without executing server code.

## Capabilities

A capability versions an interchangeable public contract, not a package implementation.

```text
realtime.gateway
storage.objects
notifications.sender
builder.engine
```

Direct domain dependencies remain direct plugin dependencies.

Rules:

- single-cardinality capability with multiple candidates requires explicit provider selection;
- optional dependency never auto-installs;
- prerelease version requires exact explicit request;
- required cycles fail;
- capability and package versions are independent;
- resolver output is canonical and deterministic.

## Resolver

Input:

```text
normalized application manifest
exact installed package manifests and integrity
explicit provider choices
hermetic customer registration fingerprint
resolver/schema version
```

Output:

```text
.k-nex/generated/k-nex.resolved.json
static import registries
registration order
environment names
contribution inventory
migration/readiness diagnostics
```

The resolver does not choose from catalog ordering. A golden corpus proves provider ambiguity, optional activation, prerelease, version conflict, cycle, and diagnostic semantics.

## Registration phases

```text
manifest
contracts
providers
schema
behavior
jobs
data-handlers
ui
admin
validate
freeze
```

Descriptors are declared before executable handlers. During `validate`, actual contribution IDs and capability token access must match the manifest. Undeclared registration fails.

## Trust

Plugins execute as trusted in-process application code. Type/package boundaries are not a malicious-code sandbox.

Production catalog requirements:

```text
first-party or explicitly reviewed packages
protected publishing workflow
exact versions and integrity
reviewed install-script policy
license/vulnerability checks
SBOM and signed provenance
server/browser bundle checks
release and fleet inventory
```

## Package entrypoints

```text
./manifest
./contracts
./server
./browser
./ui
./migrations
./testing
```

Contracts are serializable/neutral. Server handlers and React renderers are physically separate. Domain public APIs do not expose Puck, Socket.IO, ECharts, TanStack, Zustand, or Payload-internal implementation types unless the entrypoint is explicitly the Payload adapter.

## Canonical driver example

The normative example is `fixtures/plugin-manifests/module.logistics.driver.json`:

```text
module.logistics.driver
  requires module.logistics.core
  requires realtime.gateway
  optionally integrates with module.logistics.dispatch
  owns Payload schema and data
  supports disable/re-enable
  does not promise retained-schema uninstall in V1
```

## Diagnostics

`k-nex inspect` reports stable IDs, package versions/digests, capabilities, expected/actual contributions, source/action/block inventories, lifecycle policy, and stored references. Errors identify both owners and a concrete remediation.
