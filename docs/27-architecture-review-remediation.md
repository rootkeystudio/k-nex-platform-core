# Architecture Review Disposition and Remediation

## Scope

This document records the disposition of the external architecture review performed against an earlier documentation commit. Every finding was rechecked against the current `main` branch before remediation.

Classification vocabulary:

```text
confirmed        present in the current active documentation
partial          the direction was already corrected, but stale or incomplete material remained
implementation  valid risk whose final proof belongs to an executable gate
manual-setting   valid repository/organization control that cannot be enforced by documentation alone
outdated         already fully corrected before this remediation
false-positive   not supported by the current repository or conflicts with accepted requirements
```

No material finding was discarded merely because it was uncomfortable. Several were **partial/outdated**, but none of the high-impact contract, security, lifecycle, determinism, or operational concerns was judged a complete false positive.

## Disposition table

| # | Finding | Disposition | Remediation |
|---:|---|---|---|
| 1 | Persisted plugin IDs drift between flattened and hierarchical forms | confirmed | Canonical grammar and fixture added; active docs normalized; legacy-symbol CI added. |
| 2 | Plugin manifest schema and lifecycle examples conflict | confirmed | One v1 JSON Schema and one canonical driver fixture added; schema-owning retained-data uninstall removed from V1. |
| 3 | Superseded K-Nex database-provider model remains active | partial | Payload adapter remains scaffold configuration; active docs and fleet examples are normalized; superseded ADR remains historical. |
| 4 | Legacy metric contract IDs remain | confirmed | Canonical registry uses `metric.scalar@1`; legacy symbol is forbidden in active docs. |
| 5 | Registration lifecycle differs by document | confirmed | One 11-phase lifecycle is machine-readable; source descriptors and executable handlers are separated. |
| 6 | Deterministic generation conflicts with timestamps | confirmed | Committed graph/registries are timestamp-free; CI/deployment provenance is separate. |
| 7 | Executable customer config can make generation non-hermetic | confirmed | Hermetic static-registration policy, fingerprinting, clean double-generation gate, and no network/clock/random graph inputs. |
| 8 | POC is too broad to falsify individual hypotheses | confirmed | POC replaced by independent kill gates with entry/exit/rework criteria. |
| 9 | In-process realtime conflicts with separate workers | confirmed | In-memory mode is single-process only; separate workers require Redis/backplane or database outbox relay; `doctor` must enforce topology. |
| 10 | Schema-owning retained-data uninstall is unproven | confirmed | V1 offers disable/re-enable, explicit archive/export, or purge; generic retained-schema uninstall is unsupported. |
| 11 | ADR status conflates decision with evidence | confirmed | ADR decision status remains simple; separate evidence maturity registry added. |
| 12 | Repository governance is weak | confirmed/manual-setting | CODEOWNERS, PR template, pinned CI action, and required check added; branch protection/review enforcement must be enabled in GitHub settings. |
| 13 | “Small core” has broad physical responsibilities | partial | Existing package split is formalized as contracts, composition/resolver, runtime, Payload adapter, and testing; `@k-nex/core` may be a facade, not a monolith. |
| 14 | Data-source gateway risks becoming a god service | confirmed | Gateway is an orchestration pipeline of independently tested authentication, authorization, budget, dispatch, projection, validation, cache, and observability stages. |
| 15 | Too many sources of truth lack precedence | confirmed | Desired/installed/self-description/resolved/runtime/deployed precedence and reconciliation matrix defined. |
| 16 | Capability resolver semantics are underspecified | confirmed | Explicit provider selection, prerelease/optional rules, canonical resolved graph, and golden corpus required. |
| 17 | Static manifests can diverge from runtime registration | confirmed | Declared-versus-actual contribution inventory and restricted registration context required; drift fails boot. |
| 18 | Broad service container creates ambient authority | confirmed | Plugins/jobs receive capability-scoped service contexts derived from the resolved graph. |
| 19 | Authorization-aware cache identity is incomplete | confirmed | Safe cache classes and authorization-context revision/fingerprint defined; role cache is not a default. |
| 20 | Sensitive projection may occur too late | confirmed | Required order is authorize fields, query permitted projection, validate, defensively redact, then cache/observe/serialize. |
| 21 | Silent field intersection can produce misleading UI | confirmed | Bindings distinguish required and optional fields; missing required authority yields explicit insufficient-permission state. |
| 22 | After-commit dual-write gap exists | confirmed | Event classes defined; durable integration/workflow events require transactional outbox. |
| 23 | Pub/Sub invalidation alone does not converge | confirmed | Source revisions/watermarks, reconnect resync, focus revalidation, and bounded periodic revalidation required. |
| 24 | Trusted in-process plugins enlarge supply-chain blast radius | confirmed | Protected publishing, exact integrity, SBOM, signed provenance, install-script policy, bundle checks, and fleet impact inventory required. |
| 25 | Payload is called provisional despite strategic coupling | confirmed | Payload is the strategic V1 framework; the POC tests sustainability of the composition model, not framework neutrality. |
| 26 | Serializable descriptors and executable implementations blur | confirmed | Manifest/contracts/server/browser/UI package entrypoints are physically separated. |
| 27 | Builder adapter owns engine, runtime, storage, and publication | confirmed | Split into `BuilderEngineAdapter`, `UiDocumentRuntime`, and `UiDocumentRepository`. |
| 28 | Shared CMS/workspace engine risks policy confusion | confirmed | Authority-bearing public and workspace blocks/sources/actions use separate IDs; only static/presentation renderers may be shared. |
| 29 | Theme primitive ABI is too large | confirmed | Small V1 base ABI established; complex DataGrid/date/map/command capabilities are versioned adapters. |
| 30 | Output-contract precision and extensibility gaps | partial | Exact decimals/unit policy, source families, route references, and canonical-table boundaries added. |
| 31 | Actor/locale-specific descriptor hash has high cardinality | confirmed | Structural compatibility hash separated from presentation metadata revision. |
| 32 | Multi-role layout precedence is unresolved | confirmed | Explicit layout assignments with priorities and explainable resolution; published snapshots plus constrained user patches. |
| 33 | Atomic CMS page/document publication needs a dedicated proof | confirmed/implementation | Transaction gate added before general CMS implementation. |
| 34 | Per-customer fleet operation cost is understated | confirmed | Build attestations, deployment receipts, runtime inventory, migration revision, and automated fleet collection become authoritative. |
| 35 | Reusable workflow uses mutable tag and inherited secrets | confirmed | Full commit SHA, explicit secrets, least privilege, and OIDC policy required. |
| 36 | Security principles lack testable control mapping | confirmed | NIST SSDF, OWASP ASVS, OWASP API Security, and K-Nex control IDs mapped to release gates. |
| 37 | External API error model is unspecified | confirmed | RFC 9457 Problem Details adopted with K-Nex extensions and redaction rules. |
| 38 | Gateway abuse budgets are implicit | confirmed | CSRF, body/depth/field/page/time/concurrency/rate/cost/cache budgets defined centrally. |
| 39 | Concurrent migrations lack a global fence | confirmed | Postgres advisory lock, expected predecessor revision, and stale-artifact readiness fence required. |
| 40 | Accessibility target is vague | confirmed | WCAG 2.2 AA adopted for supported surfaces with keyboard, drag alternative, focus, target-size, motion, and assistive-tech gates. |
| 41 | Inventory lacks verifiable provenance | confirmed | SBOM, artifact/lock digests, source/workflow identity, signed provenance, container digest, and deployment receipt required. |

## Findings already corrected before this branch

The review was based on an older commit. Before this remediation, the repository had already:

- moved primary database selection to Payload scaffold configuration;
- superseded the K-Nex database-provider ADR;
- adopted `metric.scalar@1` in the output-contract design;
- selected a conservative implementation package baseline.

Those findings were still treated as **partial**, because active examples and operations documents retained stale values.

## Explicit non-decisions

This remediation does not claim:

- that Payload, Puck, Socket.IO, or another package has passed its executable gate;
- that branch protection has been enabled through GitHub settings;
- that the project meets SLSA, NIST, OWASP, or WCAG merely because requirements are documented;
- that a schema-owning plugin can be uninstalled while its schema remains readable;
- that production readiness exists before executable evidence is linked.

The evidence level for every ADR remains visible in `docs/adr/evidence-registry.json`.
