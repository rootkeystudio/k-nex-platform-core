# ADR-0004: Manifest-Driven CLI as Application Compiler

- Status: accepted
- Date: 2026-08-25
- Decision owners: K-Nex platform maintainers
- Related: [Application manifest](../14-application-manifest.md), [CLI and project generation](../15-cli-and-project-generation.md)

## Context

Creating a customer application requires coordinated choices across modules, providers, themes, builder profiles, database, development infrastructure, Docker, environment variables, package versions, generated registries, and migrations.

A one-time template copier would help initial creation but would not safely support later plugin additions/removals, provider replacement, upgrades, or validation. A TypeScript-only configuration is flexible but difficult for a CLI to edit reliably. A JSON-only system cannot express customer-specific executable extensions.

## Decision

Use:

```text
k-nex.app.json   declarative composition and build-time options
k-nex.config.ts  programmatic customer extensions and overrides
```

Provide:

```text
create-k-nex-app  initial interactive/non-interactive project generation
k-nex              ongoing application management CLI
```

The CLI behaves as an application compiler:

```text
manifest + static plugin manifests + package lockfile + customer config
  → resolved application graph
  → package changes
  → static registries
  → environment/infrastructure templates
  → diagnostics and release inventory
```

Material commands follow plan/apply semantics and do not run production migrations implicitly.

Generated registries are deterministic and committed in V1. CI verifies freshness.

## Consequences

### Positive

- Product composition is visible and reviewable.
- Manual JSON editing and interactive CLI use remain compatible.
- Dependency/provider errors occur before deployment.
- Package, registry, environment, and infrastructure changes are planned together.
- Non-interactive creation supports automation.
- Customer-specific code remains possible without making routine package operations unparseable.

### Costs

- CLI/resolver/generator become core platform products requiring strong tests.
- Manifest schema and generated-code versions require migrations.
- Package manager and filesystem failure handling must be robust.
- JSON manifest, package files, lockfile, and generated output can drift unless CI checks them.

### Safety rules

- secret values never enter committed manifest/generated files;
- dependency resolution reads static metadata before executable imports;
- production runtime does not install packages;
- destructive purge requires explicit command, confirmation, migration, and backup policy;
- stale plans fail when repository state changes;
- generated files include a do-not-edit header.

## Alternatives considered

### Template repository only

Rejected because it does not manage lifecycle after initial creation.

### TypeScript config only

Rejected as the primary composition source because safe automated editing and canonical diffs are difficult.

### JSON only

Rejected because customer-specific executable policies, adapters, and UI overrides are legitimate requirements.

### Runtime admin marketplace

Rejected for V1 because package installation requires source control, migration, supply-chain, build, and deployment review.

## Validation or revisit trigger

Validate by generating two different customer applications, adding/removing a plugin later, replacing a provider, upgrading one customer only, and proving deterministic output across local/CI environments.

Revisit committing generated files after measuring POC merge churn and generation reliability; do not remove static generation/runtime import safety without a new ADR.
