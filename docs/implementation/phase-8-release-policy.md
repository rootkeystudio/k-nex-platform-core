# Phase 8 Package Release Policy

## Boundary

P8.1 freezes the release-time package contract. It does not claim SBOM, signed provenance, deployment, migration, or fleet evidence; P8.7–P8.9 own those proofs.

Each released package entry records:

```text
exact package name and semantic version
artifact SHA-512 integrity
package role
exact supported K-Nex/Payload/Node/pnpm/Postgres tuple
```

Ranges remain useful in plugin authoring manifests. A concrete release resolves those ranges to one exact framework tuple; package entries cannot widen or drift from it.

## Pre-v1 versioning

- Every published artifact is immutable. A changed artifact requires a new exact version.
- Breaking public, persisted, migration, source, action, tool, block, theme, or template behavior requires the next minor while the release channel is pre-v1.
- Patch releases contain compatible fixes only.
- Runtime package installation and floating customer dependencies remain prohibited.

## Support window

The policy is `current-and-one-prior-minor`:

- the current release is always supported;
- at most the immediately preceding minor in the same major line is supported;
- security fixes apply to every supported release;
- an older customer must upgrade through reviewed migrations, not dependency skipping;
- unsupported releases fail upgrade preflight with an actionable diagnostic.

Release manifests are deterministic and contain no timestamp, host path, secret, actor assertion, deployment state, or mutable registry tag.
