# Project Status

- **Updated:** 2026-10-01
- **Phase:** Phase 13 — CRM-First Productization and Pilot Readiness (merged in PR #35; decision REWORK, automated fixture readiness only)
- **Active task:** Generated-application first-run repair — PR #37, branch `fix/generated-application-first-run`
- **State:** In progress

## Last completed

- First run: `knex:register-generation` records the image's generation and seeds the runtime projection, bootstrap seeds the first pipeline and its six Stages, and the worker takes and renews the fence its generation owns. Graphite & Paper is the default theme, so the 1.1 release declares 18 packages.
- Worker fence: `acquireWorkerFence` resumes only the holder's own lease, live or expired. Another identity's lease is refused even once it expires, because an effect claim checks the token rather than the owner; expired authority changes hands only through recovery, which advances the token.
- Sign-in: the light accent is `#a8401c` (6.15:1 under white, 5.13:1 as small text); a Composition test holds every entry pairing at WCAG AA in both color schemes.
- Gate 8: the hosted evidence check compared committed `--repo` verification records against a signer-enforced verification, but gh's `verifiedIdentity` reports the policy it enforced, so the comparison failed on `main` since `9391dc5`. Each record is now re-derived under the policy that produced it and must match exactly, and a second, signer-enforced verification must accept the identical signed statement, admit only `release-evidence.yml` on a GitHub-hosted runner, and feed the release authorities.
- Supply chain: the `repository-evidence` audit failed on advisories published since 2026-09-28, including a critical `next` RCE (GHSA-vcvr-r3jv-pc5j). `next` is 16.3.6 in the workspace and in every generated application, generated applications pin `undici@7` to 7.29.1, and the workspace overrides `undici`, `fast-uri`, `engine.io`, `brace-expansion@2`, and `@grpc/grpc-js` to patched releases older than the seven-day `minimumReleaseAge`.
- Proofs repaired, none loosened: P13.9 admission derives the package count from the carried manifest; P13.10 dates its activities in the month it runs and generates the default theme; Phase 9 static deployment packs and approves the release under test, selects `realtime.gateway` by capability version, and resumes the blue lease under the deployment lock; the Gate 5 publication theme version, the Phase 9 reclaim split, the P12.9 home marker, and the factory-lock contract test follow the 1.1 train.

## Validation

Node 24.19/pnpm 11.9, Docker PostgreSQL and Chromium, local. On this branch's latest changes: Contracts, Composition 254, and Payload adapter 320 unit suites PASS; P13.9 admission, P13.10 browser readiness on the default theme (before and after restore), P13.3 worker shutdown, the new worker-fence acquisition proof (fails against the old takeover rule), and Phase 9 static deployment (395 s) PASS; the 1.1 closure is regenerated in order and every closure check PASS, with 1.0.0 untouched. A sweep at `4b9e52e` plus its three fixes ran every other Gate 1–12 step: all unit and browser suites, Gates 2–7 and 10–12 scripts, every other `test:postgres` file, and the Phase 9 corpus without its Linux-only runtime journey PASS. With the repaired check, `check-phase-8-generated-evidence.mjs` and `gate-8.mjs` PASS against the hosted bundles; a tampered committed record and a foreign signer workflow each fail it. All ten Phase 13 corpus groups (64 proofs) PASS locally on 2026-10-01, and `validate` PASS in CI on `56572fc`. After the dependency update: `pnpm audit --audit-level high` reports no high or critical advisory; every workspace unit suite, the fixture build, Gate 1 artifacts and reproducibility, the Gate 5 storage proof, P13.3 CRM browser, and P13.10 readiness PASS; the 1.1 closure regenerated (Composition archive, three locks resolving `next` 16.3.6 and `undici` 7.29.1) and every closure check PASS.

## Next

Watch the exact-head `validate` run (pull requests run only `gate:13:focused`), then dispatch the cumulative `gate:13` on this branch: it runs only on `main` pushes or dispatch and has not completed since the 1.1 train.

## Out of Phase 13 acceptance

Phase 13 delivers the CRM product, its generated application, and attested `1.0.0 → 1.1.0` upgrade preparation, not a customer-executed upgrade. The five excluded capabilities are stated once, in the P13.9 section of `docs/implementation/phase-13-crm-first-productization.md`, which is the normative source.

## Blockers

- Limited beta remains blocked by five consecutive business days, two active human users, closed Sev-1/Sev-2 evidence, observed RTO/RPO, and product/Sales/security/operations sign-offs; the five excluded capabilities must ship or stay excluded by explicit decision.
