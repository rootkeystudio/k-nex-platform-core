# Phase 12 Review Blockers

## Generated System administration authority

**State:** Accepted architecture; implementation in progress.

ADR-0027 accepts a private HTTPS+mTLS `/v1/commands` boundary to the external operator. The generated web process remains a current-authority requester and never receives deployment, build, Docker, or repository-write authority.

The transport contract and production runtime/System administration migration exports now exist. Remaining work is the mTLS client/operator implementation, current inventory/service composition, fixed generated routes/navigation, and real PostgreSQL/HTTP/Chromium proof.

Directly projecting lifecycle rows from a generated `/system/*` handler is rejected: it would let the web process fabricate a committed transition and bypass expected source commit, build, deployment, and receipt authority.

Required implementation:

1. Implement and prove the accepted transport without exposing configuration or raw operator failures to the browser.
2. Compose existing administration services and authoritative stores; do not create a second administration stack.
3. Materialize fixed current-authority routes/navigation and the generated administration journey.

Independent Phase 12 review corrections may continue, but the phase cannot return to `Ready for phase review` while this blocker remains.
