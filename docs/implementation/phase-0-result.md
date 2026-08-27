# Phase 0 Result — Contract Freeze and Repository Readiness

- **Date:** 2026-08-25
- **Gate:** Gate 0
- **Baseline:** `6776a1b212cb4b905dc48fb0ae682a975d03ef77`
- **Verified `main`:** `560fd3b76c93303a16e4281e4a2516bd5c4f07b3`
- **Decision:** **GO PHASE 1**

## Scope proved

Phase 0 proves that K-Nex architecture contracts have a pinned repository toolchain, one typed Zod authoring source, deterministic generated JSON artifacts, Ajv-backed valid and invalid fixtures, stable repository diagnostics, reproducibility checks, and enforced GitHub review policy.

For identifier contracts, `executable-poc` proves generation and validation of the current pre-v1 canonical grammar plus rejection of known drift. No earlier released or persisted grammar exists, and Phase 0 does not claim backward migration compatibility.

Phase 0 does **not** prove Payload boot, resolver execution, Postgres migrations, runtime registration, authenticated queries, UI or builder behavior, realtime delivery, lifecycle operations, or deployment behavior.

## Completed work

| Task | Pull request | Merge commit | Passing CI run |
|---|---|---|---|
| P0.1 — pinned toolchain | [#5](https://github.com/rootkeystudio/k-nex-platform-core/pull/5) | [`de58dd1`](https://github.com/rootkeystudio/k-nex-platform-core/commit/de58dd1fb1b3b372e5216fc8856342cc278c678b) | [`32858825072`](https://github.com/rootkeystudio/k-nex-platform-core/actions/runs/32858825072) |
| P0.1 review handoff | [#6](https://github.com/rootkeystudio/k-nex-platform-core/pull/6) | [`4591a15`](https://github.com/rootkeystudio/k-nex-platform-core/commit/4591a1566f13c6225667b9a983ffbf1b87ee64d5) | repository review handoff |
| P0.2 — typed contract source | [#7](https://github.com/rootkeystudio/k-nex-platform-core/pull/7) | [`8bdd245`](https://github.com/rootkeystudio/k-nex-platform-core/commit/8bdd2454309188f07dde604730c4d02b34e13a4f) | [`32864689692`](https://github.com/rootkeystudio/k-nex-platform-core/actions/runs/32864689692) |
| P0.3 — fixture corpus | [#8](https://github.com/rootkeystudio/k-nex-platform-core/pull/8) | [`244ed9b`](https://github.com/rootkeystudio/k-nex-platform-core/commit/244ed9bec9cd0014278d4ab20f051b2600443119) | [`32869721752`](https://github.com/rootkeystudio/k-nex-platform-core/actions/runs/32869721752) |
| P0.4 — executable validation | [#9](https://github.com/rootkeystudio/k-nex-platform-core/pull/9) | [`b512c9c`](https://github.com/rootkeystudio/k-nex-platform-core/commit/b512c9caa553bac061c46f8cb026bad4cfac3337) | [`32879101684`](https://github.com/rootkeystudio/k-nex-platform-core/actions/runs/32879101684) |
| P0.5 — reproducibility | [#10](https://github.com/rootkeystudio/k-nex-platform-core/pull/10) | [`abc3e2d`](https://github.com/rootkeystudio/k-nex-platform-core/commit/abc3e2d910e5e68186a10481909cb0373263eaeb) | [`32882874626`](https://github.com/rootkeystudio/k-nex-platform-core/actions/runs/32882874626) |
| P0.6 — CI controls | [#11](https://github.com/rootkeystudio/k-nex-platform-core/pull/11) | [`7a0e90c`](https://github.com/rootkeystudio/k-nex-platform-core/commit/7a0e90cf766527710b16b04f0de015e544af0685) | [`32886785619`](https://github.com/rootkeystudio/k-nex-platform-core/actions/runs/32886785619) |
| P0.6 — governance verification | [#12](https://github.com/rootkeystudio/k-nex-platform-core/pull/12) | [`560fd3b`](https://github.com/rootkeystudio/k-nex-platform-core/commit/560fd3b76c93303a16e4281e4a2516bd5c4f07b3) | [`32892161929`](https://github.com/rootkeystudio/k-nex-platform-core/actions/runs/32892161929) |

## Toolchain

Direct versions are exact-pinned in [`package.json`](../../package.json), workspace package manifests, and `pnpm-lock.yaml`.

| Tool | Version |
|---|---|
| Node.js | 24.19.0 |
| pnpm | 11.9.0 |
| TypeScript | 6.0.3 |
| Zod | 4.4.3 |
| Ajv | 8.20.0 |
| ajv-formats | 3.0.1 |
| Vitest | 4.1.6 |
| Turborepo | 2.10.10 |

## Contract generation and reproducibility

The typed source is [`packages/contracts/src`](../../packages/contracts/src). [`generate.ts`](../../packages/architecture-contract-tools/src/generate.ts) converts the Zod application and plugin schemas to JSON Schema draft 2020-12 and serializes them with [`canonical-json.ts`](../../packages/contracts/src/canonical-json.ts). Canonical output is UTF-8 JSON with recursively sorted object keys, two-space indentation, and one final newline.

The committed inventory in [`contracts/generated-contracts.v1.json`](../../contracts/generated-contracts.v1.json) covers:

- `contracts/architecture-contracts.v1.json`;
- `schemas/plugin-manifest.v1.schema.json`;
- `schemas/application-manifest.v1.schema.json`.

[`reproducibility.ts`](../../packages/architecture-contract-tools/src/reproducibility.ts) stages the generator and required runtime into two unrelated temporary roots, reverses file write order, varies home, working directory, locale, timezone, and a marker environment variable, then compares every output byte. The verified output-tree digest is:

```text
sha256=792b2ab55af6b6e59852c1632f4f1ea5ca617832d7fe2a39673307bab0005eef
```

## Fixture inventory

The executable validator accepts four valid fixtures:

```text
fixtures/plugin-manifests/valid/module.sales.json
fixtures/contracts/valid/application.minimal.json
fixtures/contracts/valid/provider.realtime.socketio.json
fixtures/contracts/valid/theme.minimal.json
```

The invalid corpus contains 19 fixtures with one declared primary diagnostic each in [`expected-diagnostics.json`](../../fixtures/contracts/expected-diagnostics.json):

```text
3 application failures
11 forbidden legacy-symbol failures
5 plugin manifest or lifecycle failures
```

The suite checks exact inventory coverage, schema-valid isolation of legacy-symbol cases, stable validator/code pairs, actionable diagnostics, and ordering-independent diagnostic output.

## CI and repository governance

The repository visibility decision is **public**, which enabled repository rulesets without changing the plan tier. No license has been selected; distribution and licensing remain an explicit product decision rather than an implied permission grant.

- Ruleset `21473575` (`Protect main`) is active with no bypass actors. It requires pull requests, one approving CODEOWNER review, stale-review dismissal, resolved conversations, and the `validate` status check; deletion and non-fast-forward updates are restricted.
- Ruleset `21474044` (`Protect release tags`) is active with no bypass actors for `refs/tags/v*`; deletion and non-fast-forward updates are restricted. Signed-tag enforcement and release provenance remain later supply-chain work.
- [Issue #2](https://github.com/rootkeystudio/k-nex-platform-core/issues/2) is closed with settings and push-rejection evidence.
- Intentional-failure run [`32889179416`](https://github.com/rootkeystudio/k-nex-platform-core/actions/runs/32889179416) rejected `schemaVersion: 2` with `SCHEMA_INVALID /schemaVersion` while PR #12 remained blocked.
- The same PR passed after restoration in runs [`32889335963`](https://github.com/rootkeystudio/k-nex-platform-core/actions/runs/32889335963) and [`32889482514`](https://github.com/rootkeystudio/k-nex-platform-core/actions/runs/32889482514).
- Ordinary direct push and an actual non-fast-forward push to `main` were rejected by `GH013`.

## Commands executed

On Node.js 24.19.0 and pnpm 11.9.0:

```bash
pnpm install --frozen-lockfile
pnpm phase:0
git diff --check
git status --porcelain --untracked-files=all
```

The frozen install and `pnpm phase:0` pass on `main` at `560fd3b76c93303a16e4281e4a2516bd5c4f07b3`. The Phase 0 gate reports 25 passing Vitest tests and the reproducibility digest recorded above.

## Remaining limitations and decision

[`ADR-0014`](../adr/0014-contract-governance-and-evidence.md) now contains only the independently meaningful Gate 0 governance decisions proven by the source, fixtures, tests, reproducibility checks, CI, and repository rules recorded above. Its `executable-poc` evidence covers the current pre-v1 identity grammar and contract enforcement; it does not claim migration compatibility from a prior persisted grammar.

[`ADR-0017`](../adr/0017-deterministic-composition-and-registration-reconciliation.md) owns deterministic `.k-nex/generated/k-nex.resolved.json` and static registry generation, hermetic and fingerprinted `k-nex.config.ts`, and declared-versus-actual runtime registration and capability-access rejection. It remains `design-only` until Gate 1 proves its complete decision scope.

The project-manager review accepted this pre-v1 ADR scope correction. No alias, compatibility path, partial evidence map, or duplicate evidence registry was introduced.

**Decision: GO PHASE 1.** Phase 0's repository-contract and governance gate is complete. P1.1 may freeze the executable framework tuple and create the Gate 1 fixture shell without treating any ADR-0017 runtime or composition claim as already proven.
