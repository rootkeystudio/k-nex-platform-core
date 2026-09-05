# ADR-0027: Generated Administration Operator Transport

- Status: accepted
- Date: 2026-09-04
- Decision owners: K-Nex platform maintainers
- Evidence: design-only
- Entry: Phase 12 System administration closure
- Related: [ADR-0024](./0024-system-settings-and-extension-operations.md), [ADR-0025](./0025-runnable-workspace-shell-pages-and-builder.md)

## Context

Generated customer applications need the fixed System administration surface to request extension lifecycle, catalog, and operations work without granting the web/admin process deployment, Docker, build, repository-write, backup-key, or supervisor authority. Direct lifecycle projection from `/system/*` is rejected because it can fabricate a committed transition without the source-change, trusted-build, deployment-supervisor, inventory, and receipt chain required by ADR-0024 and ADR-0021.

## Decision

1. The generated application talks only to a deployment-configured private HTTPS endpoint at the fixed path `/v1/commands`. Mutual TLS is mandatory. The browser receives neither the endpoint URL nor client/server certificates.
2. The deployment owns the client certificate. A verified URI SAN is projected into a closed identity containing exactly one application ID, environment, and non-empty allowlist of command families. The operator rejects a command unless the verified identity exactly matches the command actor envelope's application/environment and permits its family.
3. V1 accepts only these closed commands: extension plan, extension execute, catalog refresh, operations backup, and operations restore drill. The transport creates no lifecycle state machine and does not admit source, artifact, build, image, migration, or inventory claims from the generated application.
4. Every command contains the existing `AdministrationActorEnvelope`, an idempotency key, a fixed audience, issued-at, expiry, and only its family-specific expected authority: extension commands carry authorization/lifecycle/inventory/extension revisions; catalog refresh carries authorization/lifecycle/catalog/inventory revisions; operations commands carry authorization/lifecycle/operations revision and inventory digest. Expected authorization/lifecycle revisions must match the envelope. The operator re-enters current PostgreSQL RBAC and authoritative family state before accepting work.
5. The canonical SHA-256 request digest is over the exact `{ command, verifiedMtlsIdentity }` value after TLS verification. Idempotency replay is valid only for that unchanged digest. Changed payloads, application/environment, command family, audience, identity, or revisions fail closed.
6. The response carries the request digest, one authoritative operation or receipt ID, result digest, and configured operator identity. Rejections use only closed safe reasons. Raw operator failures, evidence, approval artifacts, certificates, and transport configuration are unrepresentable in browser-facing contracts.

## Consequences

- System administration can compose the existing administration services through a narrow external authority boundary while retaining current PostgreSQL RBAC at the operator.
- The web/admin process remains an authenticated requester, not a deployment supervisor or lifecycle authority.
- Production migrations and the authoritative runtime inventory adapter remain separate required implementation work; this ADR does not claim their completion.

## Rejected alternatives

### Direct generated `/system/*` lifecycle writes

Rejected. They would bypass source-change, trusted-build, deployment, and receipt authority.

### Browser-to-operator transport

Rejected. It would disclose topology or credentials and permit browser-controlled service identity.

### Generic RPC or arbitrary command payload

Rejected. A mutable command vocabulary would create an unreviewed control plane and weaken revision, idempotency, and inventory fences.

## Validation

The contract proof must cover accepted authenticated requests, wrong audience, expiry, cross-tenant and disallowed-family denial, changed-payload replay denial, and forged response denial. Production closure additionally requires real private HTTPS+mTLS, a deployment-owned certificate, current PostgreSQL RBAC re-entry, authoritative inventory/revision checks, idempotent operation/receipt persistence, and generated-app browser redaction proof.
