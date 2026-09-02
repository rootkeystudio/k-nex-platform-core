# Pre-v1 Version Normalization

## Current rule

- Every first-party K-Nex package, module, provider, theme, application, and release identity is `1.0.0` until the first public release.
- No runtime alias, compatibility shim, dual contract, or supported prior K-Nex release is added before the first release.
- Immutable deployment generations and content digests may change without inventing another package version.
- Non-`1.0.0` versions are allowed only for third-party dependencies, schema/protocol versions, neutral synthetic fixtures, and explicit rejection inputs.

## Gate 8 correction

Gate 8 contains a product-branded synthetic `0.1.0 → 0.2.x` platform line and Sales `0.9.0/1.0.1` artifacts. That modeling is incorrect before the first release and must not be treated as supported K-Nex history.

The correction is atomic: move upgrade/fleet/security-patch behavior to neutral synthetic identities; remove product-branded historical artifacts; normalize first-party package manifests and exact dependencies to `1.0.0`; regenerate package manifests, tarballs, customer locks, application bundles, SBOM/provenance, and affected evidence.

## Required follow-up

Do not mark Phase 10 ready while product-branded historical identities remain. Rerun focused Gate 8 artifact/evidence checks after regeneration, then run the full inherited gate only at phase closeout.
