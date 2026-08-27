# Phase 8 Release Evidence

P8.7 separates deterministic build inputs from hosted signing evidence. The generator emits a timestamp-free CycloneDX 1.6 SBOM and a canonical K-Nex provenance predicate binding the exact source commit, full-SHA workflow identity, application manifest, dedicated lockfile, resolved graph or composition plan, SBOM, and release artifact digest.

The release workflow uses GitHub OIDC and `actions/attest` pinned to its complete immutable commit SHA. GitHub/Sigstore supplies the hosted signature and persistence. Local contract tests separately prove Ed25519 signing, verification, and tamper rejection without committing a private key.

No SLSA level is claimed. Production maturity may be described only after the hosted workflow, repository protection, identity, and independent verification have all been audited. The current proof establishes the evidence shape, cryptographic binding, and full-SHA workflow configuration.
