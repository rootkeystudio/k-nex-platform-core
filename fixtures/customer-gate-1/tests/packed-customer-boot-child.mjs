import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const customerDirectory = resolve(process.argv[2]);
const customer = process.argv[3];
const mode = process.argv[4] ?? "observe";
if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u.test(customer)) throw new Error("Customer boot proof requires a canonical application ID.");

const requireFromCustomer = createRequire(resolve(customerDirectory, "package.json"));
const resolvedPackages = [
  "@k-nex/composition", "@k-nex/contracts", "@k-nex/module-sales/server", "@k-nex/payload-adapter",
  "@k-nex/runtime", "@k-nex/ui-runtime"
].map((packageName) => requireFromCustomer.resolve(packageName));
for (const resolved of resolvedPackages) {
  if (!resolved.startsWith(resolve(customerDirectory, "node_modules", ".pnpm"))) {
    throw new Error(`Customer resolved a K-Nex package outside its packed install: ${resolved}`);
  }
}

const { bootKnexApplication } = await import(pathToFileURL(resolve(customerDirectory, "dist/boot.js")));
const payload = await bootKnexApplication(`packed-${customer}`);
try {
  if (mode === "seed-prior") {
    await payload.create({ collection: "sales-tasks", data: { title: "Preserve beta renewal", status: "open", potentialRevenue: "42000", privateNote: "customer-owned" }, depth: 0, overrideAccess: true });
    await payload.create({ collection: "sales-opportunities", data: { name: "Beta expansion", stage: "qualified", value: "125000" }, depth: 0, overrideAccess: true });
    const contracts = await import(pathToFileURL(requireFromCustomer.resolve("@k-nex/module-sales/contracts")));
    const server = await import(pathToFileURL(requireFromCustomer.resolve("@k-nex/module-sales/server")));
    const application = JSON.parse(readFileSync(resolve(customerDirectory, "k-nex.app.json"), "utf8"));
    const lockDigest = `sha256:${createHash("sha256").update(readFileSync(resolve(customerDirectory, "pnpm-lock.yaml"))).digest("hex")}`;
    const artifacts = [
      ["sales.customer-schema", "customer-schema", { collections: [server.salesTasksCollection, server.salesOpportunitiesCollection].map(({ slug, fields }) => ({ slug, fields: fields.map(({ name, type }) => ({ name, type })) })), lockDigest }],
      ["sales.source", "source", { descriptor: contracts.salesTasksDescriptor }],
      ["sales.action", "action", { descriptor: contracts.salesTaskCreateDescriptor }],
      ["sales.tool", "tool", { descriptor: contracts.salesSearchTasksDescriptor }],
      ["sales.block", "block", { descriptor: contracts.salesUiBlockDescriptors[0] }],
      ["sales.theme", "theme", { preset: application.preset, theme: application.theme }],
      ["sales.template", "template", { descriptor: contracts.salesTaskPageTemplate }],
      ["sales.settings", "settings", { descriptor: contracts.salesWorkspaceSettingsDescriptor, values: server.salesDefaultSettings.values }]
    ];
    await payload.db.pool.query(`create table if not exists k_nex_upgrade_artifacts (
      artifact_id text primary key, kind text not null, revision integer not null, document jsonb not null
    )`);
    await payload.db.pool.query(`insert into k_nex_release_revision (application_id, predecessor_revision, revision, release_revision)
      values ($1, 0, 1, 'module.fixture.upgrade-0.9.0') on conflict (application_id) do nothing`, [`${customer}-sales`]);
    for (const [artifactId, kind, document] of artifacts) {
      await payload.db.pool.query("insert into k_nex_upgrade_artifacts values ($1, $2, 1, $3::jsonb)", [artifactId, kind, JSON.stringify({ ...document, revision: 1 })]);
    }
  }
  const result = await payload.find({ collection: "sales-tasks", depth: 0, limit: 1, overrideAccess: true });
  const opportunities = await payload.find({ collection: "sales-opportunities", depth: 0, limit: 1, overrideAccess: true });
  const collections = Object.keys(payload.collections).filter((slug) => slug.startsWith("sales-")).sort();
  process.stdout.write(`PACKED_CUSTOMER_BOOT ${JSON.stringify({ customer, collections, documents: result.totalDocs, opportunities: opportunities.totalDocs, resolvedPackages })}\n`);
} finally {
  const timeout = () => new Promise((resolveTimeout) => setTimeout(resolveTimeout, 2_000));
  await Promise.race([payload.destroy(), timeout()]);
  if (typeof payload.db.pool?.end === "function") await Promise.race([payload.db.pool.end(), timeout()]);
  process.exit(0);
}
