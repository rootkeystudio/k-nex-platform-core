# Implementation Phase 0 — Contract Freeze and Repository Readiness

- **Status:** planned
- **Gate mapping:** Gate 0 in [`docs/30-executable-poc-gates.md`](../30-executable-poc-gates.md)
- **Baseline:** `main` at `6776a1b212cb4b905dc48fb0ae682a975d03ef77`
- **Next phase:** Phase 1 — minimal deterministic Payload composition
- **Implementation model:** the repository plan defines scope and acceptance; the local operator executes one bounded work package at a time with agentic coding

## 1. Objective

Phase 0 converts the current design-only contract freeze into an executable, reproducible, repository-enforced foundation.

The phase does **not** implement the K-Nex product. It proves that the project can define, generate, validate, review, and evolve its public architecture contracts without drift before Payload composition, data-source runtime, realtime, builder, theme, or customer-product code begins.

The required outcome is:

```text
one pinned TypeScript repository toolchain
+ one schema-authoring source
+ deterministic generated contract artifacts
+ valid and invalid fixture corpus
+ executable validation and reproducibility checks
+ enforced GitHub review/status policy
+ linked ADR evidence
= Gate 0 closed with executable evidence
```

## 2. Why this phase exists

The architecture review identified a recurring failure mode: public identities and schemas were being copied into several documents and had already diverged before implementation existed.

The remediation branch added machine-readable starting artifacts:

```text
contracts/architecture-contracts.v1.json
schemas/plugin-manifest.v1.schema.json
schemas/application-manifest.v1.schema.json
fixtures/plugin-manifests/module.logistics.driver.json
scripts/validate_repository_contracts.py
.github/workflows/architecture-contracts.yml
docs/adr/evidence-registry.json
```

These files are the Phase 0 starting point, not yet the final executable proof. The current repository still needs:

- one TypeScript authoring source instead of hand-maintained parallel schemas;
- actual JSON Schema validation with Ajv;
- an intentional invalid-fixture corpus with stable expected diagnostics;
- byte-for-byte generation checks from separate clean paths;
- a pinned Node/pnpm/lockfile toolchain;
- required branch/ruleset enforcement in GitHub settings;
- evidence promotion after the checks have passed in CI.

## 3. Scope

Phase 0 includes only:

1. repository toolchain bootstrap;
2. contract authoring and deterministic generation;
3. machine-readable schema and fixture validation;
4. canonical identity and legacy-symbol enforcement;
5. reproducibility checks;
6. documentation-link and ADR-evidence validation;
7. CI and repository governance;
8. Phase 0 evidence and closeout.

## 4. Explicit non-goals

The following work is prohibited in Phase 0:

```text
Payload application boot
Postgres runtime or migrations
plugin resolver implementation
runtime registration container
Sales/CRM domain module
source gateway or output execution
Socket.IO, Redis, outbox, jobs
Puck or another builder engine
UI shell, React primitives, themes
create-k-nex-app product scaffolding
customer application repositories
package publication to a private registry
schema-owning plugin uninstall experiments
```

A Phase 0 PR that introduces any of these must be split or rejected.

## 5. Current state and remaining work

| Capability | Current state | Phase 0 action |
|---|---|---|
| Canonical identity rules | JSON registry exists | Move authoring to typed constants/schemas and preserve serialized semantics |
| Plugin manifest schema | Handwritten JSON Schema exists | Create single Zod authoring source and generate deterministic JSON Schema |
| Application manifest schema | Handwritten JSON Schema exists | Create single Zod authoring source and generate deterministic JSON Schema |
| Valid plugin fixture | One driver fixture exists | Validate it through generated schema and add a valid application fixture |
| Invalid fixture corpus | Missing | Add intentionally invalid cases with expected diagnostic codes |
| Repository validator | Python checks syntax, links, evidence, legacy strings | Add TypeScript/Ajv validation; retain Python check until feature parity is proven |
| Deterministic generation | Documented only | Generate in two unrelated clean directories and compare bytes |
| Toolchain pinning | Architecture baseline documented | Add exact Node 24, pnpm, package manager, workspace, and lockfile |
| CI | Basic architecture check exists | Run pinned Node contract generation, fixtures, tests, and reproducibility |
| Repository protection | Source-controlled CODEOWNERS/PR template exist | Configure GitHub ruleset; close issue #2 only after manual verification |
| ADR evidence | Registry exists; ADR-0014 is design-only | Promote only after executable checks and CI links exist |

## 6. Target repository shape

Phase 0 may add the following minimal implementation structure:

```text
package.json
pnpm-workspace.yaml
pnpm-lock.yaml
turbo.json
.node-version                    exact tested Node 24 release

packages/
  contracts/
    package.json
    tsconfig.json
    src/
      identity.ts
      registration-phases.ts
      output-contracts.ts
      plugin-manifest.ts
      application-manifest.ts
      architecture-registry.ts
      index.ts

  architecture-contract-tools/
    package.json
    tsconfig.json
    src/
      canonical-json.ts
      generate.ts
      validate.ts
      validate-docs.ts
      validate-evidence.ts
      reproducibility.ts
    tests/

contracts/                       deterministic generated registry
schemas/                         deterministic generated JSON Schemas
fixtures/
  contracts/
    valid/
    invalid/
    expected-diagnostics.json

scripts/
  validate_repository_contracts.py   retained until parity and removal decision
```

Package names are internal working names until the final private package scope is proven. Phase 0 does not publish them.

## 7. Technology constraints

Use the accepted conservative baseline:

```text
Node.js 24 LTS — exact patch pinned
pnpm — exact version pinned through packageManager/Corepack
TypeScript — exact tested version
Zod 4 — schema and TypeScript authoring source
Ajv 8 + ajv-formats — generated JSON Schema validation
Vitest 4 — contract and fixture tests
Turborepo — task graph only
```

Rules:

- Do not hand-author equivalent Zod and JSON Schema definitions.
- Generate JSON Schema from the Zod source and commit the generated artifacts.
- Do not add a second schema library.
- Do not use `latest`, floating ranges, or unpinned direct dependencies.
- Do not introduce a runtime framework merely to execute build scripts.
- Use Node built-ins for canonical serialization and hashing when the implementation remains small and testable.
- Generated files must use UTF-8, LF, two-space JSON indentation, sorted object keys, and one final newline.
- No generated artifact may contain time, absolute path, hostname, random value, or secret.

## 8. Work packages

### P0.1 — Bootstrap the pinned repository toolchain

#### Goal

Create the minimum reproducible TypeScript workspace required to author and validate contracts.

#### Required changes

```text
root package.json
pnpm-workspace.yaml
pnpm-lock.yaml
turbo.json
.node-version or equivalent exact Node pin
base tsconfig files
root scripts
```

Required root commands:

```bash
pnpm contracts:generate
pnpm contracts:validate
pnpm contracts:test
pnpm contracts:reproducibility
pnpm docs:validate
pnpm phase:0
```

`pnpm phase:0` is the single local and CI entry point for the complete gate.

#### Acceptance

- A clean checkout installs with `pnpm install --frozen-lockfile`.
- The selected Node and pnpm versions are explicit and CI uses the same versions.
- No application/runtime package is introduced.
- Every direct dependency is exact-pinned.
- Root commands fail on the first failed gate and return non-zero status.

#### Agent constraints

The agent may modify only repository/tooling configuration. It must not migrate schemas or change canonical IDs in this work package.

---

### P0.2 — Establish one typed contract-authoring source

#### Goal

Represent the existing accepted contract semantics once in TypeScript/Zod and generate the committed JSON artifacts.

#### Required authoring modules

```text
identity grammar
plugin kinds and surfaces
capability/dependency references
registration phase enum
plugin lifecycle V1 rules
plugin manifest V1
application manifest V1
output-contract registry
forbidden legacy symbols
architecture registry snapshot
```

#### Required invariants

- The canonical plugin ID grammar remains hierarchical dot-separated namespace with optional hyphen inside a segment.
- The Payload database adapter remains framework configuration, not a K-Nex provider.
- Schema-owning V1 plugins cannot declare retained-schema uninstall support.
- The registration sequence remains:

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

- Initial output contracts remain:

```text
metric.scalar@1
table.records@1
series.category@1
series.time@1
options.list@1
record.summary@1
```

#### Generated artifacts

```text
contracts/architecture-contracts.v1.json
schemas/plugin-manifest.v1.schema.json
schemas/application-manifest.v1.schema.json
```

#### Acceptance

- Generation produces no semantic drift from accepted current artifacts unless an explicit ADR is added.
- TypeScript types are inferred from the same Zod schemas.
- Generated schemas compile successfully with Ajv.
- Generated files are deterministic and contain a generator header or sidecar version without time-dependent data.
- Public contract types do not import Payload, Puck, Socket.IO, ECharts, TanStack, React, or customer code.

#### Stop condition

If Zod-to-JSON-Schema conversion cannot express an accepted invariant without weakening it, the agent must stop and report the exact mismatch. It must not silently add handwritten divergent validation.

---

### P0.3 — Build the valid and invalid fixture corpus

#### Goal

Prove that accepted examples pass and known drift/failure forms fail for the expected reason.

#### Minimum valid fixtures

```text
module.logistics.driver plugin manifest
minimal customer application manifest
minimal schema-less provider manifest
minimal theme or builder manifest
```

#### Minimum invalid fixtures

The invalid corpus must include one fixture for each applicable entry in `forbiddenLegacySymbols` from `contracts/architecture-contracts.v1.json`, without repeating those deprecated symbols in active prose. It must also include:

```text
missing required lifecycle object
schema-owning plugin with uninstall=supported
invalid package version that is not exact semver
invalid capability/provider identity
application with duplicate plugin IDs
application with unsupported Payload adapter
application with provider key that does not match the selected plugin capability
unknown top-level key where the schema is closed
```

Some failures are structural JSON Schema errors; others are semantic repository checks. The expected-diagnostics file must declare the responsible validator and stable diagnostic code.

Example diagnostic vocabulary:

```text
SCHEMA_INVALID
IDENTITY_INVALID
LEGACY_SYMBOL_FORBIDDEN
DUPLICATE_PLUGIN_ID
PROVIDER_SELECTION_INVALID
LIFECYCLE_UNSUPPORTED
OUTPUT_CONTRACT_UNKNOWN
```

#### Acceptance

- Every valid fixture passes all applicable validators.
- Every invalid fixture fails.
- An invalid fixture must fail for its declared primary diagnostic, not only because of an unrelated earlier mistake.
- Test output identifies the fixture path, stable code, and concise remediation.
- Fixture ordering does not change results.

---

### P0.4 — Implement executable contract and documentation validation

#### Goal

Replace “the JSON files exist” with executable proof that schemas, fixtures, documentation constraints, and evidence records agree.

#### Validator stages

```text
1. load contract registry and generated schemas
2. compile schemas with Ajv and ajv-formats
3. validate valid fixtures
4. validate invalid fixtures and expected diagnostics
5. run semantic identity/lifecycle/provider checks
6. scan active docs and fixtures for forbidden legacy symbols
7. validate ADR evidence registry coverage and referenced paths
8. validate relative Markdown links
9. validate generated artifact constraints
10. print deterministic machine-readable and human diagnostics
```

#### Migration from the Python validator

The existing dependency-free Python script remains required until the TypeScript validator has equivalent coverage and tests. Removal is a later explicit cleanup PR after:

- both validators run in CI;
- parity is documented;
- one intentional regression is caught by both where their responsibilities overlap.

No PR may delete the Python validator merely because the new tool exists.

#### Acceptance

- `pnpm contracts:validate` executes without network access.
- Errors have stable codes and deterministic ordering.
- A deliberately introduced legacy ID, missing link, missing ADR evidence entry, or nondeterministic generated key fails CI.
- Validator tests cover malformed JSON, invalid schema, and multiple simultaneous diagnostics.
- Production secrets or environment values are never read.

---

### P0.5 — Prove generation reproducibility

#### Goal

Demonstrate that the same normalized source produces byte-identical generated artifacts regardless of checkout path and ordinary environment variation.

#### Required experiment

The reproducibility command creates two independent temporary work directories with different absolute paths and runs contract generation in both.

Compare:

```text
contracts/architecture-contracts.v1.json
schemas/plugin-manifest.v1.schema.json
schemas/application-manifest.v1.schema.json
any generated contract index/snapshot
```

Run at least with controlled differences in:

```text
absolute checkout path
TZ
locale where supported
filesystem enumeration order fixture
```

#### Forbidden generated data

```text
generatedAt
buildTimestamp
absolutePath
hostname
random ID
secret or environment value
platform-specific path separator
```

#### Acceptance

- Both output trees are byte-identical.
- Generation followed by `git diff --exit-code` is clean.
- Generated JSON key order and newline policy are tested.
- The reproducibility check produces a content digest for diagnostics but does not write that run-specific digest into the generated source files.
- Failure prints the first differing file and a useful diff.

#### Kill/rework criterion

If identical normalized sources cannot produce identical artifacts, Phase 1 cannot start. The source/generation design must be simplified before adding resolver or Payload code.

---

### P0.6 — Enforce CI and repository governance

#### Goal

Make contract protection a repository rule rather than a convention.

#### Source-controlled controls

- Keep `.github/CODEOWNERS` for contracts, schemas, fixtures, ADRs, implementation plans, and workflows.
- Keep a PR template that requires contract impact, migration notes, determinism, and validation evidence.
- Update the `Architecture contracts` workflow to run `pnpm phase:0`.
- Pin GitHub Actions by full commit SHA.
- Use `permissions: contents: read` unless a job explicitly requires more.
- Use concurrency cancellation and a bounded job timeout.
- Do not use `secrets: inherit`.

#### Manual GitHub settings

Complete and verify issue #2:

```text
PR required for main
at least one approving review
CODEOWNERS review required
Architecture contracts check required
dismiss stale approvals
conversation resolution required
force-push and branch deletion restricted
release tag protection or equivalent release workflow
```

#### Verification

- Open a temporary PR with an intentional invalid fixture and confirm merge is blocked.
- Change a CODEOWNERS-controlled contract path and confirm owner review is requested.
- Confirm ordinary direct push/force-push to `main` is rejected.
- Remove the intentional failure and confirm the same PR becomes green.
- Record screenshots or settings export references in the Phase 0 result; do not place secrets in evidence.

#### Acceptance

Issue #2 may close only after the settings and intentional-failure verification are complete.

---

### P0.7 — Close the gate and promote evidence

#### Goal

Record what was actually proven and prepare a clean handoff to Phase 1.

#### Required closeout artifact

Create:

```text
docs/implementation/phase-0-result.md
```

It must record:

```text
completed PRs and merge commits
CI run references
exact Node/pnpm/TypeScript/Zod/Ajv/Vitest tuple
commands executed
fixture inventory
reproducibility digest and method
branch/ruleset verification
remaining limitations
explicit go/rework decision
```

#### ADR evidence

Only after executable completion:

- promote ADR-0014 from `design-only` to `executable-poc`;
- link the implementation commit, validator tests, fixture corpus, and CI run;
- keep runtime/security/builder/realtime ADRs as `design-only` because Phase 0 does not prove them.

#### Acceptance

- The evidence registry contains no nonexistent path or aspirational test.
- The phase result explicitly states that no Payload/runtime behavior has been proven.
- The project manager issues a written **GO for Phase 1** or **REWORK Phase 0** decision.

## 9. Recommended PR sequence

Use small, independently reviewable pull requests.

| PR | Branch | Scope | Must remain excluded |
|---|---|---|---|
| 0A | `phase-0/toolchain-bootstrap` | pinned Node/pnpm workspace, scripts, CI skeleton | schema semantic changes |
| 0B | `phase-0/typed-contract-source` | Zod authoring, deterministic schema/registry generation | invalid fixtures, Payload code |
| 0C | `phase-0/fixture-validation` | valid/invalid corpus, Ajv/semantic validator, diagnostics | product runtime |
| 0D | `phase-0/reproducibility-governance` | clean double-generation, workflow, branch rules verification | resolver/Payload |
| 0E | `phase-0/closeout` | result document and ADR evidence promotion | new architecture decisions |

Do not combine all work into one agent session or one oversized PR. Each PR starts from current `main` after its predecessor is merged.

## 10. Agentic coding execution protocol

For every work package, give the coding agent a bounded brief containing:

```text
task ID and goal
required reading files
allowed paths
forbidden paths/features
accepted architecture constraints
required commands/tests
expected deliverables
stop/escalation conditions
```

### Required agent behavior

The agent must:

- read the named contract, schema, ADR, and phase sections before editing;
- inspect current files rather than recreate them from memory;
- preserve canonical IDs and accepted semantics;
- change only the declared paths unless it explains a necessary dependency;
- add or update tests with every behavior change;
- run the complete work-package commands;
- report changed files, test output, remaining risk, and any architecture question;
- stop instead of silently deciding a new public contract;
- never mark evidence as executable without a real passing run.

The agent must not:

- add product features “because they will be needed later”;
- refactor unrelated documentation;
- introduce floating dependencies;
- bypass failing fixtures by weakening schemas;
- auto-approve or auto-merge its own PR;
- edit generated files without changing their source generator;
- replace a stable diagnostic with arbitrary text only.

### Standard agent brief template

```md
You are implementing K-Nex Phase 0 task P0.X.

Read first:
- docs/implementation/phase-0.md
- contracts/architecture-contracts.v1.json
- relevant schema/ADR files listed by the task

Goal:
<one bounded outcome>

Allowed paths:
<explicit paths>

Forbidden:
- Payload/runtime/UI/realtime product code
- public contract changes without an ADR
- unrelated formatting/refactors

Acceptance commands:
<commands>

Return:
1. changed files and rationale
2. commands and exact outcomes
3. contract or migration impact
4. unresolved questions
5. recommendation: ready for review or blocked
```

## 11. Project-management checkpoints

After each PR, the local operator provides:

```text
PR or commit reference
diff summary
test and CI result
agent-reported limitations
any requested architecture decision
```

The project manager then returns one of:

```text
ACCEPT — merge and proceed
CHANGES REQUIRED — bounded corrections
REWORK — assumption or approach failed
ADR REQUIRED — implementation exposed a new consequential decision
```

No subsequent PR begins from an unreviewed local state.

## 12. Definition of done

Phase 0 is complete only when all statements are true:

- [ ] Exact Node 24 and pnpm versions are pinned locally and in CI.
- [ ] A frozen `pnpm-lock.yaml` exists.
- [ ] Zod is the single TypeScript/schema authoring source.
- [ ] Committed JSON Schemas and registry are deterministic generated artifacts.
- [ ] Ajv compiles and validates generated schemas.
- [ ] Valid plugin and application fixtures pass.
- [ ] Every required invalid fixture fails with the expected stable diagnostic.
- [ ] Legacy identities and superseded database/output-contract symbols fail active checks.
- [ ] ADR evidence and local Markdown links are validated.
- [ ] Two unrelated clean directories generate byte-identical output.
- [ ] Generation leaves the Git worktree clean.
- [ ] `pnpm phase:0` is the required passing CI check.
- [ ] GitHub `main` protection and CODEOWNERS review are verified; issue #2 is closed with evidence.
- [ ] `phase-0-result.md` records real evidence and limitations.
- [ ] ADR-0014 evidence is promoted only after successful implementation and CI.
- [ ] A written GO decision authorizes Phase 1.

## 13. Rework triggers

Phase 0 returns to design if any of these occur:

- accepted contract semantics cannot be represented by one typed source without handwritten divergent validators;
- generated schemas differ by path, locale, clock, or repeated clean execution;
- invalid fixtures fail for unstable or unrelated reasons;
- canonical IDs must change to make the tooling work;
- branch protection cannot require the contract gate;
- the validator needs Payload/runtime imports;
- evidence cannot be linked to repeatable commands and CI.

A rework result is a valid outcome. Do not hide it by expanding scope.

## 14. Phase 1 entry contract

Phase 1 may begin only after Phase 0 GO.

Phase 1 will receive:

```text
pinned toolchain and lockfile
typed contract package
generated schemas and canonical registry
validated fixture/diagnostic corpus
deterministic generation framework
required CI/review policy
ADR evidence discipline
```

Its scope is then limited to:

```text
one customer fixture
Payload + Postgres
contracts + composition + Payload adapter
one module
one collection
one authenticated query
one generated registry and resolved graph
one clean migration
boot inventory
```

Puck, themes, WebSocket, retained-schema uninstall, and the second customer remain excluded until their own gates.
