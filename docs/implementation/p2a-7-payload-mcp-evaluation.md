# P2A.7 Payload MCP Plugin Evaluation

- **Date:** 2026-08-26
- **Candidate:** `@payloadcms/plugin-mcp@3.88.0`
- **License:** MIT
- **Decision:** adopt as a bounded transport adapter

## Compatibility tuple

The evaluated customer tuple is Node.js `24.19.0`, pnpm `11.9.0`, Payload `3.88.0`, Next.js `16.3.1`, React and React DOM `19.2.8`, and `@payloadcms/plugin-mcp` `3.88.0`. The plugin's exact Payload peer is satisfied. Its `mcp-handler@1.1.0` dependency declares MCP SDK `1.26.0` while the plugin itself pins SDK `1.30.0`; the workspace records this narrow upstream metadata exception and keeps strict peer checking enabled for every other peer. Build and adapter tests remain the compatibility authority.

The official documentation, installed package source and types, package metadata, integrity, and MIT license were reviewed. This evaluation follows the installed `3.88.0` API. Documentation for later plugin versions is not treated as the frozen contract.

## Bounded configuration

The adapter supplies empty `collections` and `globals`, no prompts or resources, no experimental tools, and only generated K-Nex custom tools. Each generated handler translates the Payload request into a server-authenticated K-Nex request and calls the K-Nex tool gateway. Module authors receive neither an arbitrary MCP handler nor ambient `req.payload` access.

`overrideAuth` resolves the K-Nex principal, agent client, delegation, surface, and feature context. It intersects the actor-filtered K-Nex catalog with the API key's custom-tool toggles, so a key can remove authority but cannot add a tool or expand the principal. Calls still re-enter the gateway, which reauthorizes and applies approval, idempotency, budgets, output validation, redaction, and audit.

Plugin `onEvent` is transport telemetry only. Its handler duration is bounded by the adapter ceiling; domain audit remains owned by the gateway. Internal callers may invoke the same gateway directly without an MCP loopback.

## Declared contribution inventory

| Contribution | Declared actual shape | Ownership |
|---|---|---|
| collection | `payload-mcp-api-keys` | plugin schema; customer migration |
| endpoints | `GET /api/mcp`, `POST /api/mcp` | plugin transport |
| admin UI | `MCP` collection group and per-tool narrowing controls | plugin UI, adapter access override |
| tool schemas | generated from K-Nex descriptor input schemas | adapter-only; no persisted MCP types |
| domain execution | none | K-Nex gateway |

The adapter inventory is asserted against the sanitized Payload configuration. Customer repositories must include the API-key collection in generated migrations; disabling the transport does not remove its schema contribution.

## Kill-criteria result

No kill criterion fired:

- automatic collection/global CRUD is absent when both maps are empty;
- per-request tool registration is filtered by the access map returned from `overrideAuth`;
- generated handlers have only one execution path through the K-Nex gateway;
- authentication resolves a K-Nex context and does not pass broad bearer tokens to module code;
- safe gateway envelopes are the only tool results exposed;
- plugin types remain confined to `@k-nex/payload-adapter`;
- the collection and routes are explicit, testable lifecycle contributions rather than public K-Nex contracts.

Fallback to a direct SDK or custom transport remains conditional on a future pinned plugin version violating one of these properties.
