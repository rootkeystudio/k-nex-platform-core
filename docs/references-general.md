# External References

This architecture is intentionally K-Nex-specific. External projects are implementation candidates, adapters, or supporting tools—not the source of K-Nex product boundaries.

Primary documentation should be rechecked when implementation begins and whenever a dependency is upgraded because APIs, licenses, support matrices, pricing, and hosting behavior can change.

_Last reviewed: 2026-08-25._

## Payload

### Platform and application model

- [What is Payload?](https://payloadcms.com/docs/getting-started/what-is-payload) — application framework, admin, APIs, authentication, access control, and database ownership.
- [Configuration overview](https://payloadcms.com/docs/configuration/overview) — top-level Payload configuration and application setup.
- [Admin overview](https://payloadcms.com/docs/admin/overview) — admin panel configuration and component/view customization.
- [Access control overview](https://payloadcms.com/docs/access-control/overview) — collection/global/field access functions.
- [Authentication overview](https://payloadcms.com/docs/authentication/overview) — authentication concepts and auth-enabled collections.

### Plugins and composition

- [Plugins overview](https://payloadcms.com/docs/plugins/overview) — Payload plugin model and ecosystem.
- [Building your own plugin](https://payloadcms.com/docs/plugins/build-your-own) — reusable configuration extension and plugin development guidance.
- [Advanced Plugin API](https://payloadcms.com/docs/plugins/plugin-api) — plugin ordering, `definePlugin`, and typed cross-plugin communication.

K-Nex should still own explicit contribution categories, collision ownership, capability resolution, and deterministic registration. Payload's plugin API does not replace the K-Nex plugin manifest/lifecycle model.

### Database and migrations

- [Database overview](https://payloadcms.com/docs/database/overview) — database adapter architecture.
- [Postgres adapter](https://payloadcms.com/docs/database/postgres) — Postgres configuration.
- [Migrations](https://payloadcms.com/docs/database/migrations) — TypeScript migration commands/workflow.
- [Transactions](https://payloadcms.com/docs/database/transactions) — transaction behavior and request transaction context.
- [Indexes](https://payloadcms.com/docs/database/indexes) — index definitions and query considerations.

### Hooks, jobs, and content lifecycle

- [Hooks overview](https://payloadcms.com/docs/hooks/overview) — lifecycle hooks and request context.
- [Jobs Queue overview](https://payloadcms.com/docs/jobs-queue/overview) — task, workflow, queue, schedule, and worker concepts.
- [Tasks](https://payloadcms.com/docs/jobs-queue/tasks) — task registration and retry behavior.
- [Workflows](https://payloadcms.com/docs/jobs-queue/workflows) — ordered durable task composition and resume behavior.
- [Queues](https://payloadcms.com/docs/jobs-queue/queues) — logical queues and runner strategies.
- [Versions and drafts](https://payloadcms.com/docs/versions/overview) — versions, drafts, autosave, and scheduled publishing behavior.
- [Localization](https://payloadcms.com/docs/configuration/localization) — localized field/content configuration.
- [Live Preview](https://payloadcms.com/docs/live-preview/overview) — preview integration concepts.

## Puck

### Project and core editor model

- [Puck documentation](https://puckeditor.com/docs) — modular open-source visual editor for React, custom component configuration, data ownership, and editor capabilities.
- [Puck GitHub repository](https://github.com/measuredco/puck) — source, releases, issues, and license.
- [Component configuration](https://puckeditor.com/docs/integrating-puck/component-configuration) — mapping components, renderers, and editable fields.
- [Root configuration](https://puckeditor.com/docs/integrating-puck/root-configuration) — root wrapper and document-level behavior.
- [Multi-column layouts](https://puckeditor.com/docs/integrating-puck/multi-column-layouts) — nested/slot-based layout patterns.
- [Categories](https://puckeditor.com/docs/integrating-puck/categories) — organizing component palettes.

### Editor customization

- [Composition](https://puckeditor.com/docs/extending-puck/composition) — composing editor interfaces from preview, component list, fields, and outline parts; central to the fixed K-Nex shell experiment.
- [Custom fields](https://puckeditor.com/docs/extending-puck/custom-fields) — custom editor field components.
- [UI overrides](https://puckeditor.com/docs/extending-puck/ui-overrides) — replacing editor UI internals; should be treated cautiously where APIs are experimental/evolving.
- [Theming Puck](https://puckeditor.com/docs/extending-puck/theming) — editor appearance customization. K-Nex content themes remain separate from editor chrome.
- [Viewports](https://puckeditor.com/docs/integrating-puck/viewports) — responsive preview/editing behavior.

### Data, permissions, and migration

- [External data sources](https://puckeditor.com/docs/integrating-puck/external-data-sources) — editor integration with external resources. K-Nex stores registered data-source descriptors rather than copying live business data by default.
- [Feature toggling](https://puckeditor.com/docs/integrating-puck/feature-toggling) — global, component, and dynamic editing permissions such as deletion, dragging, duplication, and editing.
- [Permissions API](https://puckeditor.com/docs/api-reference/overrides/permissions) — permission contracts used by editor feature toggling.
- [Data migration](https://puckeditor.com/docs/integrating-puck/data-migration) — migration between Puck/document/component property changes.
- [Localization](https://puckeditor.com/docs/integrating-puck/localization) — localization support within editor configuration/data.
- [React Server Components](https://puckeditor.com/docs/integrating-puck/react-server-components) — server-component integration considerations.

### Candidate Payload integration

- [Puck visual page builder for Payload](https://payload.market/item/delmaredigital-payload-puck-Q4ZUOJX) — third-party Payload/Puck integration candidate for the CMS spike.

K-Nex can wrap, reuse, or replace this package. Domain modules and canonical K-Nex documents must not depend on its private data model or exact editor routes.

## Alternative visual editor candidates

### Builder.io

- [Builder.io documentation](https://www.builder.io/c/docs/intro) — platform/editor overview.
- [Custom components](https://www.builder.io/c/docs/custom-components-setup) — registering application components.
- [Components-only mode](https://www.builder.io/c/docs/guides/components-only-mode) — restricting visual editing to registered components and reducing style/content freedom.
- [Content API](https://www.builder.io/c/docs/content-api) — retrieving Builder-managed content through its service/API.
- [Preview URL](https://www.builder.io/c/docs/guides/preview-url) — rendering an application/page inside the editor preview.

Builder.io is not the mandatory K-Nex core editor because the baseline architecture favors independently operated customer editor/data infrastructure. It can remain an optional integration when a customer deliberately accepts its account, service, API, and commercial dependencies.

### Craft.js

- [Craft.js GitHub repository](https://github.com/prevwong/craft.js) — low-level React framework for building extensible drag-and-drop page editors.
- [Craft.js documentation](https://craft.js.org/docs/overview) — editor state, nodes, connectors, and serialization concepts.

Craft.js is the primary fallback experiment if Puck cannot satisfy the fixed-shell, canonical-document, permission, accessibility, or workspace requirements without deep coupling. It carries a higher editor-product development cost because K-Nex would build more of the editor UI and behavior.

### GrapesJS

- [GrapesJS GitHub repository](https://github.com/GrapesJS/grapesjs) — open-source web builder framework.
- [GrapesJS documentation](https://grapesjs.com/docs/) — component, block, style, asset, and storage systems.

GrapesJS is more naturally aligned with HTML/CSS template, landing-page, and email-style builders than K-Nex's primary typed React business-widget model. It can be reconsidered for a dedicated template/email plugin.

## Package management and monorepo tooling

### pnpm

- [pnpm create](https://pnpm.io/cli/create) — running `create-*` project scaffolding packages.
- [pnpm workspaces](https://pnpm.io/workspaces) — workspace/monorepo package management.
- [pnpm install](https://pnpm.io/cli/install) — frozen lockfile and CI installation behavior.
- [pnpm catalogs](https://pnpm.io/catalogs) — central dependency version declarations inside a workspace, potentially useful for first-party monorepo consistency.

### Changesets

- [Changesets documentation](https://github.com/changesets/changesets) — multi-package release/version/changelog workflows.

### Semantic versioning

- [Semantic Versioning](https://semver.org/) — intended public package versioning convention.

K-Nex also versions capability, event, action/data-source, UI block, theme schema, manifest, and generated-registry contracts where package SemVer alone is insufficient.

## GitHub package and workflow operations

- [GitHub Packages: working with the npm registry](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-npm-registry) — private npm package publication and installation.
- [About permissions for GitHub Packages](https://docs.github.com/en/packages/learn-github-packages/about-permissions-for-github-packages) — repository/package access behavior.
- [Reusing workflows](https://docs.github.com/en/actions/how-tos/sharing-automations/reusing-workflows) — reusable GitHub Actions workflow model.
- [Using secrets in GitHub Actions](https://docs.github.com/en/actions/security-for-github-actions/security-guides/using-secrets-in-github-actions) — deployment/package/registry secret handling.
- [Artifact attestations](https://docs.github.com/en/actions/security-for-github-actions/using-artifact-attestations) — build provenance/attestation support where adopted.

GitHub Packages is the current recommended registry for the Phase 0 spike, not yet a final accepted decision.

## Container and runtime references

- [Docker multi-stage builds](https://docs.docker.com/build/building/multi-stage/) — reducing production image contents.
- [Docker Compose](https://docs.docker.com/compose/) — local Postgres/Redis/MinIO service composition.
- [Node.js releases](https://nodejs.org/en/about/previous-releases) — selecting an active supported Node release.

Deployment-provider-specific WebSocket, worker, filesystem, secret, and migration constraints must be evaluated after a first target is selected.

## Database and geospatial references

- [PostgreSQL documentation](https://www.postgresql.org/docs/) — database behavior, indexes, transactions, locking, partitioning, and backup/restore.
- [PostGIS documentation](https://postgis.net/documentation/) — geospatial storage/query options for tracking workloads.

PostGIS or specialized position stores are workload-dependent provider decisions, not mandatory dependencies for every K-Nex application.

## Security and supply-chain references

- [OWASP ASVS](https://owasp.org/www-project-application-security-verification-standard/) — application security verification requirements.
- [OWASP Cheat Sheet Series](https://cheatsheetseries.owasp.org/) — practical controls for authentication, authorization, XSS, CSRF, SSRF, uploads, secrets, and logging.
- [OpenSSF Scorecard](https://securityscorecards.dev/) — dependency/project supply-chain signals.
- [npm package provenance](https://docs.npmjs.com/generating-provenance-statements) — provenance when using compatible npm publishing workflows.

Security/compliance design remains customer/deployment-specific; references do not replace threat modeling, legal review, or operational testing.

## License review checklist

Before cataloging or shipping a dependency/plugin, verify:

```text
current license and exceptions
commercial and redistribution rights
source disclosure obligations
trademark restrictions
enterprise/paid feature boundaries
transitive dependency licenses
customer self-host/distribution implications
modification/fork implications
```

The K-Nex repository itself currently has no selected license and should be treated as proprietary until an explicit decision is recorded.

## Validation checklist before implementation

### Payload

- exact supported Payload/Next.js/Node versions;
- plugin ordering and configuration composition APIs;
- access/auth integration for user, driver, public-session, service, and job actors;
- Postgres migration generation/transaction behavior;
- jobs/workflows worker model;
- WebSocket hosting/deployment constraints;
- admin component and preview integration stability.

### Puck

- current package exports and license;
- canonical K-Nex document round-trip;
- composition API inside fixed shell;
- nested layout/slot behavior;
- CMS/workspace profile restrictions;
- dynamic permissions/locked components;
- server/client/RSC behavior;
- migration coverage;
- accessibility and realistic dashboard performance;
- degree of dependence on experimental override APIs.

### Package/CLI

- final package scope availability;
- GitHub Packages auth for developer, Actions, and deployment builds;
- lockfile and provenance behavior;
- CLI filesystem rollback and cross-platform process execution;
- generated registry determinism;
- secret redaction;
- package lifecycle script policy.

### Data and operations

- customer-owned final migration workflow;
- disabled/uninstalled schema retention behavior;
- backup/restore including CMS/layout/theme data;
- provider replacement and infrastructure migration;
- release/fleet inventory accuracy;
- public/private cache and storage separation.

## Reference policy

- Prefer primary project documentation and source repositories.
- Record the exact tested package versions in POC/release reports.
- Treat implementation-candidate behavior as provisional until verified by code/tests.
- Update ADR-0007 after the Payload/Puck POC with measured acceptance or rejection evidence.
- Do not infer K-Nex security, migration, or lifecycle guarantees only from a third-party feature list.
