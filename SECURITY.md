# Security Policy

K-Nex is currently an architecture and research repository. Security issues in public contracts, generation, plugin boundaries, authorization, supply chain, or deployment guidance can affect every generated customer application and should be treated as product-security issues.

## Reporting

Do not publish secrets, credentials, customer data, or exploitable details in a public issue. Contact the repository owner privately through the security-reporting channel configured for the organization. Until a dedicated advisory workflow is configured, use a private direct contact with the repository owner.

## Supported state

No production release exists yet. Architecture decisions are tracked separately from evidence maturity in `docs/adr/evidence-registry.json`.

## Baseline controls

- exact dependency versions and committed lockfiles;
- no runtime executable package installation;
- server-side authorization for sources/actions/subscriptions;
- deterministic generated registries;
- reviewed first-party/private plugins only;
- SBOM and signed build provenance before production package distribution;
- WCAG 2.2 AA for supported UI surfaces;
- security requirements mapped to NIST SSDF, OWASP ASVS, and OWASP API Security controls.
