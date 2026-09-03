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
Gate 9   dynamic runtime and zero-downtime delivery         complete
Gate 10  RBAC, authorization, extension bootstrap           complete
```

## Active hypotheses

### Gate 11 — System settings and extension operations

Questions:

```text
Can schema-valid settings persist, migrate, activate, and converge without creating executable runtime control?
Can a signed GitHub catalog refresh safely reconcile every active release before acceptance?
Can administrators operate the complete extension and theme lifecycle through current RBAC and exact revisions?
Can authenticated web administration request deployment, backup, and restore drills without privileged operator credentials?
Can protected inventory, health, approval, and receipts remain truthful across crash, replay, and lost invalidation?
```

Kill criteria are in the Phase 11 plan. Web-owned Docker, repository, backup, or trust-root authority is not an experimental fallback.

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

Gate 11 reuses:

```text
the bounded Hot Application and Theme Skin fixtures
the Sales Platform Plugin reference
the existing Docker blue/green customer topology
a test-only settings/catalog/operations proof fixture
```

These prove infrastructure and do not authorize another domain product.

## Required real evidence

```text
contract/schema generation and invalid fixture corpus
real PostgreSQL settings, revision, audit, outbox, race, crash, and generation proof
bounded real HTTP signed-catalog refresh and staged/accepted reconciliation
real authenticated Chromium settings, extension, theme, and operations journeys
real web/worker/runner/operator revision convergence
Docker/repository/DB-superuser/backup-key denial from unprivileged processes
backup plus clean-restore-drill inventory receipts
failure injection before and after every settings/catalog/operation terminal boundary
```

Mocks may support unit tests but cannot satisfy the gate alone.

## Development versus production

Development may use a local watcher and unsigned source sync only under an explicit development mode. Production uses prebuilt immutable signed bundles; settings/catalog administration never runs package install scripts or downloaded migrations.

## Immediate work

P11.1 freezes:

```text
settings owner/generation, pending/effective, operation, and receipt contracts
official catalog staged/accepted refresh contracts
exact action/permission/scope/reauthentication/approval mapping
protected role baseline v3 with exact v2 predecessor
extension/theme operation presentation
projection-only operations-center request/status/receipt contracts
invalid trust, secret, lifecycle, and authority fixtures
```

No persistence, catalog transport, UI route, or operator implementation starts before those contracts and kill criteria are accepted in code.

## Expansion freeze

Before Gate 11 PASS, do not begin broad CRM/CMS or another first-party vertical. Phase 11 is system settings, full extension/theme administration, official catalog operations, and Docker operations center.
