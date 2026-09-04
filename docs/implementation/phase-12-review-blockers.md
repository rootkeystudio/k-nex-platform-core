# Phase 12 Review Blockers

## Generated System administration authority

**State:** Open P0 architecture decision.

The generated customer application cannot yet compose the required fixed System administration control plane without crossing existing authority boundaries.

`SystemExtensionAdministrationService` requires an `ExtensionOperatorApi` backed by current runtime inventory and a `StaticReleaseOperator`. Platform Plugin re-enable/update/uninstall then require the separate source-change, trusted-build, deployment-supervisor, and receipt chain defined by ADR-0024. The generated app currently emits no operator transport, trusted identity/configuration contract, inventory binding, or production migrations for that aggregate. Phase 11 settings/catalog/operations PostgreSQL schemas are fixture-owned rather than exported generated-application migrations.

Directly projecting lifecycle rows from a generated `/system/*` handler is rejected: it would let the web process fabricate a committed transition and bypass expected source commit, build, deployment, and receipt authority.

Required decision before implementation:

1. Define the generated application's authenticated transport to the external operator/supervisor.
2. Define the trusted service identity and exact request/receipt binding.
3. Export the required production schemas/migrations and current inventory adapter.
4. Then compose the existing administration services and fixed routes; do not create a second administration stack.

Independent Phase 12 review corrections may continue, but the phase cannot return to `Ready for phase review` while this blocker remains.
