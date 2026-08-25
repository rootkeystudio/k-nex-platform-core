# External References

This architecture is intentionally K-Nex-specific. The following primary/reference sources support the current Payload and page-builder implementation hypothesis. They should be rechecked when implementation begins because library APIs evolve.

_Last reviewed: 2026-08-25._

## Payload

- [What is Payload?](https://payloadcms.com/docs/getting-started/what-is-payload) — application framework, admin, APIs, authentication, access control, database ownership.
- [Plugins overview](https://payloadcms.com/docs/plugins/overview) — Payload plugin model and available plugin ecosystem.
- [Building your own plugin](https://payloadcms.com/docs/plugins/build-your-own) — reusable config extension and plugin development guidance.
- [Advanced Plugin API](https://payloadcms.com/docs/plugins/plugin-api) — plugin ordering, `definePlugin`, and typed cross-plugin communication.
- [Database overview](https://payloadcms.com/docs/database/overview) — supported database architecture.
- [Postgres adapter](https://payloadcms.com/docs/database/postgres) — Postgres configuration and migration considerations.
- [Migrations](https://payloadcms.com/docs/database/migrations) — TypeScript migration workflow and commands.
- [Transactions](https://payloadcms.com/docs/database/transactions) — transaction behavior for all-or-nothing database changes.
- [Hooks overview](https://payloadcms.com/docs/hooks/overview) — lifecycle hooks and guidance for moving long-running work to jobs.
- [Jobs Queue overview](https://payloadcms.com/docs/jobs-queue/overview) — tasks, workflows, jobs, queues, scheduling, and worker execution.
- [Tasks](https://payloadcms.com/docs/jobs-queue/tasks) — task registration and retry behavior.
- [Workflows](https://payloadcms.com/docs/jobs-queue/workflows) — ordered durable task composition and resume behavior.
- [Queues](https://payloadcms.com/docs/jobs-queue/queues) — logical queues and dedicated runner strategies.
- [Indexes](https://payloadcms.com/docs/database/indexes) — index definitions and query optimization.

## Page builder

- [Puck visual page builder for Payload](https://payload.market/item/delmaredigital-payload-puck-Q4ZUOJX) — candidate integration for customer-defined Puck configuration and visual editing.
- [Puck](https://puckeditor.com/) — visual editor used by the candidate Payload integration.

## Package and repository operations

- [GitHub Packages: working with the npm registry](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-npm-registry) — private npm package publication and installation.
- [Reusing workflows](https://docs.github.com/en/actions/how-tos/sharing-automations/reusing-workflows) — reusable GitHub Actions workflow model.
- [Semantic Versioning](https://semver.org/) — intended public package versioning convention.

## Validation notes

Before coding begins, verify:

- exact supported Payload and Next.js versions;
- Payload plugin ordering and config composition APIs;
- current Puck integration package exports and license;
- GitHub Packages authentication for local, Actions, and deployment environments;
- migration generation behavior for the selected database adapter;
- WebSocket hosting constraints of the selected deployment provider.

References describe implementation candidates, not irrevocable architectural commitments. Architecture Decision Records should capture final choices after the POC.