# Phase 1 Result — Minimal Deterministic Payload Composition

- **Date:** 2026-08-26
- **Gate:** Gate 1
- **Baseline:** `ae5d520d411f11387ef912505829c1321a3269cb`
- **Pull request:** [#14](https://github.com/rootkeystudio/k-nex-platform-core/pull/14)
- **Decision:** **GO PHASE 2**

## Scope proved

Phase 1 turns one exact customer application manifest and one packed Sales module into a deterministic resolved graph, five static registries, reconciled phased registration, one Payload application, one customer-owned Postgres migration, one authenticated access-controlled query, and one protected non-secret runtime inventory.

The proof uses Payload `3.88.0`, `@payloadcms/db-postgres` `3.88.0`, Node.js `24.19.0`, pnpm `11.9.0`, and digest-pinned PostgreSQL `17.6-alpine`. It does not claim a generic data-source gateway, builder/UI composition, realtime delivery, lifecycle uninstall, a second customer, or production deployment behavior.

## Completed tasks

| Task | Commit |
|---|---|
| P1.1 — framework tuple and fixture shell | `340603e` |
| P1.2 — installed package identity and manifest loader | `256b35e` |
| P1.3 — deterministic resolver | `1cb8de7` |
| P1.4 — generated graph and static registries | `8be818f` |
| P1.5 — phased registration and inventory reconciliation | `d953306` |
| P1.6 — minimal Payload application | `ced0bc0` |
| P1.7 — customer-owned migration and real Postgres boot | `b29e9fd` |
| P1.8 — authenticated query and protected runtime inventory | `052beb8` |
| P1.9 — failure corpus, reproducibility, and closeout | this closeout commit |

## Deterministic composition

The fixture loads only package exports declared in the exact lockfile entry, verifies package/manifest/version/integrity identity without executing plugin server code, and resolves a canonical graph with an explicit resolver version. Static generation emits exactly:

```text
.k-nex/generated/k-nex.resolved.json
.k-nex/generated/plugin-registry.ts
.k-nex/generated/payload-contributions.ts
.k-nex/generated/runtime-registration.ts
.k-nex/generated/environment-schema.ts
```

Two independent clean staged roots install the frozen lockfile, rebuild the generator, remove committed generated output, regenerate it, and compare every artifact byte. The verified tree digest is:

```text
sha256=bfd08aefdd8f7808b702739508c898f19d82ef61028c8551b5ee0f77e242c5c4
```

Customer config source is fingerprinted without execution. Direct environment, clock, random, network, and dynamic-import inputs are rejected for the Gate 1 surface.

## Registration and Payload proof

Registration executes the canonical phase order with phase-scoped APIs, capability-scoped services, immutable declaration snapshots, declared-versus-actual contribution reconciliation, and freeze enforcement. The packed Sales module contributes exactly one owned `sales-tasks` collection through the shallow Payload adapter.

The application uses public Payload configuration, authentication, request creation, Local API query, and migration APIs. The adapter disables development schema push and supplies the reviewed customer migration as production migrations; no Payload fork, monkey patch, or maintained private-internal dependency is used.

The protected runtime inventory binds:

```text
application ID
customer-config source artifact digest
application manifest digest
exact resolved-graph byte digest
framework and plugin package versions/integrity
expected and actual contributions
migration predecessor/current revision
```

Unauthenticated inventory receives `401`. A Payload JWT authenticates the actor, the collection query runs with `overrideAccess: false`, and the inventory response is checked for absence of the database URL, Payload secret, JWT, password, and actor email.

## Real Postgres proof

The Testcontainers acceptance uses:

```text
postgres:17.6-alpine@sha256:ef257d85f76e48da1c64832459b59fcaba1a4dac97bf5d7450c77753542eee94
```

It proves:

- empty database → reviewed current migration → ready boot;
- already-current database → migration no-op → ready boot;
- intentional migration failure → transaction rollback → non-ready process;
- incompatible revision → readiness failure;
- authenticated actor → access-controlled Sales query;
- unauthenticated actor → `403` query denial;
- unauthenticated/authenticated inventory → `401`/non-secret `200`.

## Failure corpus

| Required failure | Executable evidence |
|---|---|
| package/manifest mismatch | installed-plugin loader identity tests |
| ambiguous provider selection | resolver golden corpus `CAPABILITY_AMBIGUOUS` cases |
| required dependency cycle | resolver golden corpus canonical `REQUIRED_CYCLE` case |
| undeclared contribution | registration runtime `UNDECLARED_CONTRIBUTION` tests |
| wrong-phase registration | registration runtime `WRONG_PHASE` test |
| duplicate collection/contribution | Payload adapter and registration runtime collision tests |
| stale generated registry | static artifact check-mode stale/missing test and fixture check command |
| non-deterministic config input | hermetic customer-config rejection corpus |
| failed/incorrect migration revision | real Postgres rollback and incompatible-revision paths |
| unauthenticated query | real Payload request path returning `403` |

## Commands executed

On the pinned Node.js and pnpm versions:

```bash
pnpm install --frozen-lockfile
pnpm phase:0
pnpm gate:1
pnpm audit --audit-level high
git diff --check
git status --porcelain --untracked-files=all
```

`pnpm gate:1` builds all six packages, runs the contract and Gate 1 failure suites, verifies the committed registries, proves two-root byte reproducibility, and runs the real PostgreSQL migration/auth/inventory fixture. The high/critical audit threshold passes; the lockfile currently reports two low and three moderate advisories.

## Kill/rework assessment and decision

No Gate 1 kill/rework criterion fired:

- normalized inputs produce byte-identical graph and registries;
- Payload composition uses supported adapter and public application APIs without a deep fork;
- executable registration reconciles with static declarations;
- customer-owned migrations generate, transact, boot, and fail readiness predictably on real PostgreSQL.

ADR-0017 is promoted atomically to `executable-poc`; broader runtime, source gateway, UI, realtime, lifecycle, and production claims remain at their existing evidence levels.

**Decision: GO PHASE 2.** Gate 1 is technically complete. Phase 2 may begin with P2.1 only after PR #14 receives its grouped review and is merged under repository policy.
