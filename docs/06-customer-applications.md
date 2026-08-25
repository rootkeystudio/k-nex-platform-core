# Customer Applications

## Principle

Each customer product is a separate repository and deployment. Shared K-Nex behavior arrives through exact-version packages; customer differences remain explicit in manifest, assets, themes, layouts, extensions, migrations, and infrastructure.

## Customer repository owns

```text
k-nex.app.json
k-nex.config.ts
package.json + pnpm-lock.yaml
.k-nex/generated/k-nex.resolved.json and static registries
customer extensions and UI overrides
brand assets and approved fonts
CMS/workspace documents and theme profiles
customer migrations and previous-release fixtures
Docker/deployment configuration
secrets, backups, monitoring, release cadence
```

It does not contain a copied editable platform core.

## Default shape

```text
client-acme-cargo/
├── apps/platform/
├── apps/driver/                 optional
├── packages/customer-extensions/
├── packages/customer-components/
├── packages/customer-theme/
├── migrations/
├── tests/
├── infra/
├── .k-nex/generated/
├── k-nex.app.json
├── k-nex.config.ts
├── package.json
├── pnpm-lock.yaml
└── Dockerfile / docker-compose.yml
```

## Composition example

```text
module.cms
module.sales
module.visualization
module.logistics.core
module.logistics.dispatch
module.logistics.driver
provider.realtime.socketio
builder.puck
theme.minimal
theme.neobrutalism
```

The exact package names and versions are separately recorded and locked.

## Customer config

`k-nex.config.ts` is executable customer code but composition-hermetic:

```ts
export default defineCustomerConfig({
  extensions: [acmeShipmentNumberPolicy()],
  ui: {
    blocks: [acmeTrackingSummaryBlock],
    rendererOverrides: {
      'logistics.shipment-summary': AcmeShipmentSummary,
    },
  },
})
```

It may statically register customer policies, sources, actions, blocks, and overrides. It cannot use time, network, random IDs, secrets, or ambient filesystem discovery to change the plugin graph. The transitive source fingerprint is recorded in the resolved graph.

## Customer-specific promotion rule

```text
first unique need       customer extension
second similar need     compare real policies
stable common behavior  reusable module/integration
remaining differences   customer extension
```

Shared packages never branch on customer application ID.

## UI and themes

Customer code owns final brand assets and exceptional renderer/primitive overrides. Modules remain style-agnostic. Installed theme profiles can change at runtime after validation/publication; installing theme code requires a release.

Overrides rerun accessibility, source/action authorization, bundle, and compatibility tests.

## Migrations and upgrades

Each customer repository owns its final Payload migrations and upgrade fixtures. A package release provides notes/helpers, but only the final composition knows ordering and prior deployed state.

One customer can upgrade while another remains on a supported prior package tuple. Generated upgrade PRs are deliberate per customer.

## Release evidence

A deployed customer release is identified by:

```text
source commit
resolved graph and lockfile digest
SBOM
artifact/container digest
signed build provenance
migration revision
deployment receipt
runtime inventory and readiness
```

Fleet tooling derives deployed versions from this evidence, not from a manually asserted list.

## Isolation

Each customer has independent database credentials, storage scope, secrets, cache/realtime namespace, domains, backups, logs, alerts, and deployment approvals. Separate deployment reduces cross-customer blast radius but does not replace authorization inside one customer application.
