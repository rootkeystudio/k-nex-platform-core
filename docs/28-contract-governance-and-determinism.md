# Contract Governance, Resolution, and Determinism

## Normative sources

K-Nex contracts are governed by machine-readable artifacts before prose examples:

```text
contracts/architecture-contracts.v1.json
schemas/plugin-manifest.v1.schema.json
schemas/application-manifest.v1.schema.json
fixtures/plugin-manifests/*.json
```

Prose explains intent. Schemas, fixtures, validators, and executable contract tests define accepted shapes.

## Identity grammar

Persisted IDs use hierarchical dot-separated namespaces. A hyphen is allowed inside one semantic segment only.

```text
module.logistics.core
module.logistics.driver
module.logistics.live-tracking
provider.realtime.socketio
sales.tasks
logistics.shipment.assign
metric.scalar@1
```

Package names remain kebab-case deployment locations:

```text
@k-nex/module-logistics-driver
@k-nex/provider-realtime-socketio
```

An ID rename after persistence requires an explicit migration across layouts, runtime settings, audits, events, inventories, and retained revisions. Permanent runtime aliases are rejected because they conceal drift.

## One manifest schema

Every installable K-Nex package publishes one side-effect-free `k-nex.plugin.json` validated by the canonical schema. Handwritten examples in documents must match a fixture or be validated in CI.

V1 uses one compatibility field:

```json
{
  "compatibility": {
    "payloadDatabaseAdapters": ["postgres"]
  }
}
```

This states tested framework compatibility. It does not introduce a K-Nex database provider.

## Registration lifecycle

The canonical sequence is:

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

Important separation:

- source/action/block schemas and browser-safe descriptors are declared during `contracts`;
- server source handlers bind during `data-handlers`;
- React renderers and browser clients bind during `ui`;
- declared and actual inventories are compared during `validate`;
- no mutation is accepted after `freeze`.

A plugin receives only the active phase API. Registration outside the phase fails.

## Source-of-truth precedence

| Concern | Authoritative source | Reconciliation rule |
|---|---|---|
| Desired composition | `k-nex.app.json` | Human/CLI edited; exact requests only. |
| Installed bytes | `pnpm-lock.yaml` plus package integrity | Must exactly satisfy desired package/version. |
| Package self-description | released `k-nex.plugin.json` | Must match package name/version/integrity. |
| Customer executable extensions | hermetic `k-nex.config.ts` exports | Fingerprinted; may not alter graph from time/network/random/environment values. |
| Executable composition | committed `.k-nex/generated/k-nex.resolved.json` and static registries | Deterministically derived; CI regenerates and compares. |
| Runtime condition | validated database settings and published revisions | Can configure installed code but cannot import packages or change schema composition. |
| Deployed truth | signed build attestation plus deployment receipt and runtime inventory | Must reference artifact digest and migration revision. |

A mismatch is an error with remediation. Silent precedence fallback is not allowed.

## Canonical resolved graph

`k-nex.resolved.json` is a deterministic lock graph containing:

```text
resolver/schema version
application identity
exact package names, versions, and integrity digests
plugin IDs and manifest digests
selected capability providers
registration order and contribution inventory
environment variable names, never values
Payload/Node/pnpm exact compatibility tuple
customer-config fingerprint
```

It contains no wall-clock timestamp, absolute path, hostname, random ID, or secret.

## Resolver rules

- A required direct plugin dependency must be explicitly installed or explicitly accepted by the plan.
- A single-cardinality capability with more than one compatible candidate requires an explicit provider selection; catalog order never chooses silently.
- Optional dependencies never cause package installation. Optional integration activates only when explicitly installed and compatible.
- Prerelease packages are excluded unless an exact prerelease was requested.
- Package version and capability contract version are independent.
- Required cycles fail with the shortest explainable cycle path.
- The resolver version is recorded; changing resolution semantics requires golden corpus review and resolved-graph migration.
- The same normalized inputs produce byte-identical graph output.

A CLI-independent golden corpus covers ambiguous providers, incompatible ranges, prereleases, optional integrations, conflicts, cycles, and diagnostics.

## Hermetic customer configuration

`k-nex.config.ts` remains a necessary code extension point, but generation treats it as a hermetic registration module.

Allowed:

```text
static imports from source-controlled customer packages
static calls to defineCustomerConfig/defineExtension
registered descriptors, handlers, blocks, policies, and overrides
environment variable names declared as requirements
```

Forbidden during composition:

```text
network access
current time
automatic random IDs
filesystem discovery outside declared source files
branching the plugin graph on secret/environment values
dynamic package names or imports
side effects outside the generation sandbox/staging directory
```

The generator fingerprints the transitive source inputs. CI generates in two clean directories and compares hashes. Runtime environment values may configure handlers after boot but cannot change the resolved graph.

## Declared versus actual registration

Static manifest declarations are not trusted blindly. During `validate` the runtime compares:

```text
declared dependencies and capability access
manifest contribution IDs and kinds
actual registered IDs, entrypoints, and owners
server/browser export boundaries
resolved service tokens requested by the plugin
```

Undeclared contribution or capability access fails generation/boot. The plugin context exposes only capability-scoped services resolved for that plugin; there is no ambient global service locator.

## Deterministic versus provenance artifacts

Committed deterministic artifacts:

```text
resolved graph
static registries
normalized manifests
schema/contract fixtures
```

Separate non-deterministic release evidence:

```text
build time
CI run and workflow identity
source commit
artifact/container digest
SBOM digest
lockfile digest
signed provenance
deployment time/operator/environment
```

CI provenance and deployment receipts are not rewritten into committed registries. `SOURCE_DATE_EPOCH` may be used when an archive format requires a timestamp, but logical graph identity remains timestamp-free.

## ADR decision status and evidence maturity

Decision status answers **what direction is chosen**:

```text
proposed
accepted
superseded
rejected
```

Evidence maturity answers **what has been proved**:

```text
design-only
executable-poc
production-observed
superseded
```

These dimensions are deliberately separate. An accepted design-only ADR directs the experiment; it is not a production-readiness claim. Public/persisted contracts cannot be marked executable or production-proven without linked fixtures, migrations, failure tests, and compatibility evidence.

## Docs-as-code gate

The repository validator checks:

- canonical fixture and JSON syntax;
- identity grammar and V1 lifecycle invariants;
- forbidden legacy symbols in active documentation;
- ADR evidence registry coverage;
- local documentation links;
- nondeterministic keys in committed generated artifacts.

Future implementation adds Zod-authored schemas, generated JSON Schema, Ajv parity tests, packed-package fixtures, and declared-versus-actual runtime inventory tests.
