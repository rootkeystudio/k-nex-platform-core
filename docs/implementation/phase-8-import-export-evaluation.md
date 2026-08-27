# Phase 8 Payload Import/Export Evaluation

## Decision

Payload's official `@payloadcms/plugin-import-export` may be adopted later only behind the K-Nex bounded administrator-transfer contract. It is not installed by P8.4 because the lifecycle proof does not require runtime transfer UI and adding it would expand the pinned release surface before an application selects that adapter.

The current official documentation and implementation show collection-scoped CSV/JSON transfers, configurable import/export limits, create/update/upsert behavior, hooks, drafts/locales, and Local API calls with `overrideAccess: false`. K-Nex therefore requires an explicit collection allowlist, nonzero document limit, administrator permission, versioned archive envelope, encryption-key reference, and a tested read/restore path.

## Non-goals

The adapter does not replace:

- PostgreSQL backup or point-in-time recovery;
- reviewed Payload/Postgres schema migrations;
- database roles, extensions, jobs, outbox, audit, or complete runtime inventory;
- object-storage consistency;
- legal retention or legal hold;
- full disaster recovery into a clean environment.

Globals are not treated as supported transfer scope: the current implementation exposes an unused globals type field rather than a proved global-transfer path.

## P8.4 boundary

Archive/export is optional, bounded transfer evidence. Purge remains a separate destructive customer migration and requires resolved references/dependents, retention, a restore-verified versioned archive, a database backup restored into a clean environment, and explicit permission plus approval. A failed purge transaction rolls back; no archive receipt or UI action can authorize package removal or production migration by itself.

Documentation source evaluated through Context7 against the official Payload repository on 2026-08-27. The repository remains pinned to Payload 3.88.0; adoption requires compatibility verification against that exact release.
