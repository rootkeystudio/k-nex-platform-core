# Phase 12 Review Blockers

## Generated System administration authority

**State:** Resolved.

ADR-0027 accepts a private HTTPS+mTLS `/v1/commands` boundary to the external operator. The generated web process remains a current-authority requester and never receives deployment, build, Docker, or repository-write authority.

The transport contract, bounded mTLS client/server, production command handler, runtime/System administration migrations, and fixed generated access/extension/theme/settings/operations routes now exist. The deployment process initializes exact static runtime inventory only from locked application-generation, worker-fence, and host-package evidence.

Directly projecting lifecycle rows from a generated `/system/*` handler is rejected: it would let the web process fabricate a committed transition and bypass expected source commit, build, deployment, and receipt authority.

Implemented closure:

1. `NodeHttpsAdministrationOperatorServer` terminates TLS 1.3 mTLS, verifies the exact URI SAN and closed command family, bounds input, and binds responses to the request digest and operator identity.
2. `AdministrationExtensionCommandHandler` re-enters current PostgreSQL authority and inventory, then delegates to the existing `ExtensionOperatorApi` and durable runtime store.
3. `PostgresRuntimeExtensionStore.reconcileStaticHostInventory` binds the runtime projection to current static deployment and fencing evidence; it cannot fabricate lifecycle transitions.
4. The generated app proves role/grant/assignment administration, Theme Profile publication, settings reauthentication, Sales disable/re-enable, and operation inspection through real PostgreSQL, HTTP, Chromium, and a separate mTLS operator process.
5. Extension plan forms carry one opaque signed server intent bound to the current actor and exact authority/inventory revisions. Exact resubmission resolves the existing durable operation; changed or unrelated state fails closed.
6. Operator retries reuse the exact command bytes. PostgreSQL binds the execute-command digest in the same transaction as terminal lifecycle state, receipt, audit, and outbox writes; completed rows without that binding fail closed.
7. TLS 1.3 mTLS proofs cover dropped responses, cross-actor execution denial, pre-mutation process crash/restart, post-commit process crash/replay, changed-payload denial, and exactly one PostgreSQL terminal operation/receipt/audit/outbox effect.

The web process remains only a current-authority requester and receives no deployment, build, Docker, repository-write, or arbitrary inventory authority.
