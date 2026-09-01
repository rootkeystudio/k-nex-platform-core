# Phase 8 Release Evidence

P8.7 emits one current `1.0.0` package-release manifest and two independently built, checked-in customer application bundles: Customer Alpha and Customer Beta. Each bundle includes its exact customer manifest, frozen lock, generated application plan/tree/build output, complete packed release closure, lock-runtime closure, and timestamp-free CycloneDX 1.6 SBOM.

The release workflow installs each customer’s own frozen dependencies before building it. GitHub OIDC attests the two application provenance predicates, the one package-release manifest predicate, and a CycloneDX SBOM attestation for each customer bundle. It downloads each hosted bundle by changing into an empty destination directory—the current `gh attestation download` command has no output-file flag—then discovers and renames the downloaded bundle before offline bundle verification.

Gate 8 reruns GitHub CLI verification and exact-compares its output with the committed verification record. It checks the signed manifest, lock, plan, generated-tree/build-output, release closure, bundle file digests, SBOM, and both CycloneDX SBOM attestations. It then derives two current-v1 runtime inventories/deployment receipts, ingests both through the fleet authority, proves clean restore/redeployment inventory identity, and proves factory idempotency. Product version transitions are not represented here; the only product release is `1.0.0`. Neutral fixture history remains the isolated place for upgrade and security-patch transition mechanics.

No SLSA level is claimed. Production maturity may be described only after the hosted workflow, repository protection, identity, and independent verification have all been audited.
