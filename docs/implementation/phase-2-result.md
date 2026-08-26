# Phase 2 Result — Authenticated Data Sources and Output Contracts

- **Date:** 2026-08-26
- **Gate:** Gate 2
- **Baseline:** `eb46b736a1945d536f2dda0ec9309e1b6acc2c34`
- **Delivery:** direct phase commits; no pull request
- **Decision:** **GO PHASE 2A**

## Scope proved

Phase 2 adds deliberate, bounded, permission-aware data-source projections without exposing raw Payload collections or a generic query language. It proves canonical metric and table contracts, phased descriptor/handler registration, a fail-closed gateway, source/record/field authorization, bounded query controls, identity-safe caching, two Sales proof sources, and library-neutral headless client states/query identity.

The proof does not introduce the visual builder, arbitrary aggregation/grouping, persisted TanStack Query types, public source publication, realtime delivery, agent tools, or production capacity claims.

## Completed tasks

| Task | Commit |
|---|---|
| P2.1 — canonical Metric and Table schemas | `2822240` |
| P2.2 — source descriptor and handler APIs | `0a622c7` |
| P2.3 — staged data-source gateway | `0c222bb` |
| P2.4 — source, record, and field authorization | `b262973` |
| P2.5 — bounded query semantics and budgets | `7632fcf` |
| P2.6 — safe cache classifications | `a788e6a` |
| P2.7 — Sales proof sources | `2ca9555` |
| P2.8 — headless result states and query identity | `aca238f` |
| P2.9 — attack, benchmark, and closeout | this closeout commit |

## Contracts and staged gateway

`metric.scalar@1` supports exact integer, finite number, canonical decimal, money, percentage, duration, and bounded text values with strict comparison compatibility. `table.records@1` uses stable opaque field and row identities, bounded typed cells, explicit page metadata, unique fields/rows, and no extension bag.

Data-source descriptors separate source major, source-schema version, output-contract major, structural compatibility hash, and presentation revision. Executable schemas remain server-owned. Registration reconciles declared definitions and handler bindings in the existing deterministic phase model.

The gateway order is:

```text
authenticate → catalog → surface/audience → authorize → budget/parse
→ safe cache lookup → dispatch → exact source schema → canonical contract
→ defensive redaction → result budget → safe cache store → observe/serialize
```

Cancellation and timeouts return promptly even when a handler ignores its signal, while the concurrency lease remains owned by the underlying handler until it settles. Cache hits still pass authentication, authorization, parsing, and budgets before dispatch is skipped.

## Authorization, budgets, and cache identity

The policy boundary receives principal/effective actor plus explicit impersonation context and returns an opaque record scope and exact permitted field set. Missing required authority fails with insufficient permission; optional fields may be omitted. Public, authenticated, and internal audience rules fail closed before execution.

Only declared page/filter/sort operations are accepted. Platform and source ceilings cover selected fields, page size, filter/sort counts and operators, body bytes/depth, result bytes after redaction, cost, timeout/cancellation, per-effective-actor/source concurrency, and token-bucket rate/burst. Batching and undeclared query shapes are rejected.

Cache classes are `no-store`, `actor`, `authorization-context`, and `public`. Key material covers source/version/hash, presentation revision, validated input/query controls, ordered fields, record scope, surface, semantic locale/timezone, publication/feature revision, and the applicable actor/policy/public boundary, then becomes a lowercase SHA-256 digest so sensitive filters are not retained in key strings. Authorization-context reuse requires a stable permission/policy/membership fingerprint; role labels are rejected. Values enter cache only after exact validation, redaction, and result-size enforcement.

Client query identity uses the same async native-Web-Crypto digest principle without exposing raw query material or a cache-library type. Headless consumers can represent idle, loading, success, empty, forbidden, insufficient-permission, invalid-contract, rate-limited, error, stale, and refetching states.

## Sales proof

The packed Sales module registers exactly two single-output sources:

```text
sales.total-potential-revenue → metric.scalar@1
sales.tasks                   → table.records@1
```

The revenue metric aggregates canonical money values server-side in bounded pages. The task table uses stable pagination with an ID tie-breaker, selected-field projection, allowlisted title/status filtering and sorting, a required permission-sensitive revenue field, and an optional private-note field. Payload Local API calls use `overrideAccess: false`, depth zero, a capability-scoped request context, and policy-provided record scope.

The packed module declares the host contracts runtime as an exact peer. Gate 1's lockfile identity loader accepts pnpm's peer-qualified file-tarball resolution while retaining exact integrity verification. A second customer-owned migration adds the proof fields and advances readiness evidence from predecessor/current `1/2`; the full real-Postgres Gate 1 still passes.

The customer fixture also exposes one authenticated `POST /k-nex/data-source-query` vertical proof. It builds its catalog from the frozen declared-and-bound registration result, authenticates the Payload request, derives a server-owned Sales policy scope, and reuses the standard audience, authorization, budget, dispatch, exact source schema, canonical output, redaction, actor-cache, observation, and problem-detail stages. The real-PostgreSQL test proves open/done record-scope separation, required-field denial, optional-field omission, unknown-source rejection, and cross-actor cache isolation.

Sales source schemas are stricter than their canonical contract families: the metric admits only the source's USD money shape, while the table admits only declared field IDs, required fields, exact per-field cell kinds/nullability, USD revenue, and known Sales statuses. Decimal aggregation tests cover integer trailing zeros, negative values, and mixed scales.

## Attack corpus

| Required attack/evidence | Executable proof |
|---|---|
| direct source/record/field manipulation | authorization, gateway unknown-source, and Sales unknown-field tests |
| required versus optional fields | policy evaluator required-denial/optional-omission tests and Sales descriptor proof |
| cross-actor and cross-policy cache isolation | actor and authorization-context cache tests, including revision changes |
| unauthorized value absent from result/cache/log/error | pre-query field authorization, defensive redaction, cache/observation/response secret-absence tests, and bounded problem details |
| invalid source and output contract fail closed | unknown source, exact source schema, and canonical output validator tests |
| body/filter/field/page/time/cost limits | query schema and concrete budget evaluator rejection corpus |
| malformed RFC 9457 prevention | invalid code/status and oversized title/detail/correlation normalization tests |
| realistic metric/table overhead | `scripts/gate-2.mjs` validation and Sales handler query-plus-validation benchmarks |

## Representative benchmark

Runner class:

```text
Apple M1 Max, arm64, 64 GiB RAM
macOS 26.6
Node.js 24.19.0
single local process, warm cache
```

Representative bounded datasets and results from `pnpm gate:2`:

| Path | Dataset | Iterations | p50 | p95 | Accepted p95 budget |
|---|---:|---:|---:|---:|---:|
| metric contract validation | one `metric.scalar@1` money value | 500 | 0.002 ms | 0.008 ms | 5 ms |
| table contract validation | 100 rows × 4 fields | 200 | 0.286 ms | 0.746 ms | 30 ms |
| Sales table query + validation | 100 records × 4 selected fields | 100 | 0.326 ms | 0.491 ms | 40 ms |
| Sales revenue query + validation | 1,000 records in 10 server pages | 50 | 0.281 ms | 0.370 ms | 60 ms |

These measurements characterize local validation/query overhead for the bounded proof datasets. They are not production throughput, concurrency, database latency, or capacity claims. The accepted budgets are intentionally generous enough for ordinary CI runners while still detecting accidental order-of-magnitude regressions.

## Commands executed

On the pinned Node.js and pnpm versions:

```bash
pnpm install --frozen-lockfile
pnpm phase:0
pnpm gate:1
pnpm gate:2
pnpm audit --audit-level high
git diff --check
git status --porcelain --untracked-files=all
```

`pnpm gate:2` builds the repository, runs the contracts, runtime, Payload adapter, and packed Sales suites, then executes the representative benchmark with explicit p95 budgets.

## Kill/rework assessment and decision

No Gate 2 kill/rework criterion fired:

- safe actor, authorization-context, no-store, and public cache identities are explicit and tested;
- authorization precedes query execution, and only validated/redacted values enter cache or success telemetry;
- representative contract and handler overhead remains well inside the accepted budgets;
- source authors declare bounded operations and single output contracts without arbitrary user queries or raw collection exposure.

**Decision: GO PHASE 2A.** Phase 2 is technically complete. Phase 2A may begin with P2A.1 after the required full-phase Sol/high review passes.
