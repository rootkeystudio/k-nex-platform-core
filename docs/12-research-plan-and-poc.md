# Research Plan and Proof Strategy

## Principle

K-Nex validates consequential assumptions through independent falsifiable gates. Gate definitions are normative in [Executable Gates](./30-executable-poc-gates.md); `status.md` selects the active task.

## Accepted foundation

```text
Gate 0   contracts and repository governance                complete
Gate 1   deterministic Payload/Postgres composition         complete
Gate 2   source authorization/output contracts              complete
Gate 2A  agent tools and safe execution                     complete
Gate 3   outbox/realtime convergence                        complete
Gate 4   builder kill-spike                                 complete
Gate 5   themes/accessibility/atomic publication            complete
Gate 6   plugin platform and Sales reference                complete
Gate 7   comprehensive component system                     complete
Gate 8   lifecycle/application factory/release/fleet safety complete
```

## Active hypotheses

### Gate 9 — Dynamic application runtime

Questions:

```text
Can an official app bundle download/verify without executing package code?
Can server logic run outside the host with real capability isolation?
Can remote UI remain useful and accessible without host-realm React/DOM authority?
Can app/skin generations activate/update/rollback atomically without host restart?
Can full Platform Plugins deploy blue/green with continuous successful traffic?
Can incompatible migrations be detected and refused before a false promotion?
Can all processes converge after lost activation/deployment invalidation?
Can backup/restore reproduce exact host and dynamic extension inventory?
```

Kill criteria are in the Phase 9 plan. Raw host-process package injection is not an experimental fallback.

### Gate 10 — RBAC and extension bootstrap

Questions:

```text
Can platform and extension permissions share one stable owner model?
Can users edit mixed roles without role-label authorization?
Can extensions offer role templates without assigning users or overwriting edits?
Can disable hide noise and revoke authority while preserving data?
Can uninstall/reinstall prevent retired grants from reactivating?
Can revocation reach web, worker, runner, remote UI, and realtime?
Can PluginManager/deployment operations be safely user-operated?
```

## Twenty reference study

Twenty provides evidence for the architectural pattern, not a drop-in implementation:

```text
package/tarball resolution and secure extraction
manifest-driven application synchronization
metadata migration and cache/event refresh
prebuilt application files
logic execution through a separate driver/child process
remote UI isolation
```

K-Nex differs because its existing Platform Plugins are statically composed into Payload. Therefore the research explicitly separates Hot Applications from deep Platform Plugins.

## Reference fixtures

`module.sales` remains the sole first-party domain reference.

Gate 9 may introduce:

```text
one bounded Hot Application fixture using Sales-compatible host contracts
one Theme Skin fixture
a test-only schema-less extension/runtime fixture
a Docker blue/green customer topology
```

These prove infrastructure and do not authorize another domain product.

## Required real evidence

```text
contract/schema generation and invalid fixture corpus
protected hosted artifact/signature/provenance proof
real process/container runner isolation
real PostgreSQL activation/race/crash/restore
real Chromium remote UI/CSP/accessibility/skin journeys
real web/worker/runner revision convergence
real Docker gateway blue/green continuous traffic
failure injection before and after every commit/promotion boundary
```

Mocks may support unit tests but cannot satisfy the gate alone.

## Development versus production

Development may use a local watcher and unsigned source sync only under an explicit development mode. Production requires prebuilt immutable signed bundles and never runs package install scripts at activation.

## Immediate work

P9.1 freezes:

```text
extension class taxonomy
app.* and skin.* identities
Hot Application and Theme Skin manifests
bundle/file/digest/provenance shape
capability and resource budgets
install plans/receipts/generations
zero-downtime eligibility result
invalid class-crossing fixtures
```

No runner, UI engine, proxy, package, or deployment implementation is selected before those contracts and kill criteria are accepted in code.

## Expansion freeze

Before Gate 10 PASS, do not begin broad CRM/CMS or another first-party vertical. The next product layer is system settings, full extension/theme administration, official catalog operations, and Docker operations center.
