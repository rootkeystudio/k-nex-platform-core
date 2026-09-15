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
    const application = JSON.parse(readFileSync(resolve(customerDirectory, "k-nex.app.json"), "utf8"));
    const identity = { applicationId: application.application.id, environment: process.env.K_NEX_ENVIRONMENT ?? "production", ownerId: "fixture-owner", createdBy: "fixture-owner", updatedBy: "fixture-owner", revision: 1, audit: [] };
    const account = await payload.create({ collection: "sales-accounts", data: { ...identity, status: "active", name: "Beta customer" }, depth: 0, overrideAccess: true });
    const stageNamespace = Buffer.from("13f5fa89b4655a7aa19d74ed6c5d1ef4", "hex");
    const opaqueStageId = (pipelineId, semantic) => {
      const bytes = Buffer.from(createHash("sha1").update(stageNamespace).update(Buffer.from(["phase13/pipeline-stage/v1", identity.applicationId, identity.environment, String(pipelineId), semantic].join("\0"))).digest().subarray(0, 16));
      bytes[6] = (bytes[6] & 15) | 80; bytes[8] = (bytes[8] & 63) | 128;
      const hex = bytes.toString("hex");
      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    };
    const semantics = ["qualification", "discovery", "proposal", "negotiation", "won", "lost"];
    const pipeline = await payload.create({ collection: "sales-pipelines", data: { ...identity, status: "active", name: "Beta pipeline", orderedStageIds: [], isActive: true }, depth: 0, overrideAccess: true });
    const stageIds = semantics.map((semantic) => opaqueStageId(pipeline.id, semantic));
    await payload.update({ collection: "sales-pipelines", id: pipeline.id, data: { orderedStageIds: stageIds }, depth: 0, overrideAccess: true });
    for (const [position, semantic] of semantics.entries()) {
      const allowed = position < 4 ? [stageIds[position + 1], stageIds[5]] : [];
      await payload.create({ collection: "sales-pipeline-stages", data: { ...identity, status: "active", pipelineId: Number(pipeline.id), stageId: stageIds[position], name: semantic[0].toUpperCase() + semantic.slice(1), semantic, position, probabilityBasisPoints: semantic === "won" ? 10_000 : 1000, allowedTransitionStageIds: allowed, requiredFieldIds: semantic === "lost" ? ["lossReason"] : [] }, depth: 0, overrideAccess: true });
    }
    await payload.create({ collection: "sales-tasks", data: { ...identity, status: "open", archiveStatus: "active", title: "Preserve beta renewal" }, depth: 0, overrideAccess: true });
    await payload.create({ collection: "sales-opportunities", data: { ...identity, archiveStatus: "active", name: "Beta expansion", accountId: Number(account.id), pipelineId: Number(pipeline.id), stageId: stageIds[0], amount: "125000", currency: "USD" }, depth: 0, overrideAccess: true });
    const contracts = await import(pathToFileURL(requireFromCustomer.resolve("@k-nex/module-sales/contracts")));
    const server = await import(pathToFileURL(requireFromCustomer.resolve("@k-nex/module-sales/server")));
    const lockDigest = `sha256:${createHash("sha256").update(readFileSync(resolve(customerDirectory, "pnpm-lock.yaml"))).digest("hex")}`;
    const artifacts = [
      ["sales.customer-schema", "customer-schema", { collections: [server.salesTasksCollection, server.salesOpportunitiesCollection].map(({ slug, fields }) => ({ slug, fields: fields.map(({ name, type }) => ({ name, type })) })), lockDigest }],
      ["sales.source", "source", { descriptor: contracts.salesTasksDescriptor }],
      ["sales.action", "action", { descriptor: contracts.salesTaskCreateDescriptor }],
      ["sales.tool", "tool", { descriptor: contracts.salesSearchTasksDescriptor }],
      ["sales.block", "block", { descriptor: contracts.salesUiBlockDescriptors[0] }],
      ["sales.theme", "theme", { preset: application.preset, theme: application.theme }],
      ["sales.template", "template", { descriptor: contracts.salesTaskPageTemplate }],
      ["sales.settings", "settings", { descriptor: contracts.salesWorkspaceSettingsDescriptor, values: server.salesDefaultSettings }]
    ];
    const artifactMarkers = { "customer-schema": "indexContractVersion", source: "queryPolicyVersion", action: "idempotencyPolicyVersion", tool: "approvalPolicyVersion", block: "accessibilityContractVersion", theme: "tokenContractVersion", template: "requirementsVersion", settings: "settingsMigrationVersion" };
    await payload.db.pool.query(`create table if not exists k_nex_upgrade_artifacts (
      artifact_id text primary key, kind text not null, revision integer not null, document jsonb not null
    )`);
    await payload.db.pool.query(`insert into k_nex_release_revision (application_id, predecessor_revision, revision, release_revision)
      values ($1, 0, 1, 'module.fixture.upgrade-0.9.0') on conflict (application_id) do nothing`, [`${customer}-sales`]);
    for (const [artifactId, kind, document] of artifacts) {
      await payload.db.pool.query("insert into k_nex_upgrade_artifacts values ($1, $2, 2, $3::jsonb)", [artifactId, kind, JSON.stringify({ ...document, revision: 2, [artifactMarkers[kind]]: 2 })]);
    }
  }
  const result = await payload.find({ collection: "sales-tasks", depth: 0, limit: 1, overrideAccess: true });
  const opportunities = await payload.find({ collection: "sales-opportunities", depth: 0, limit: 1, overrideAccess: true });
  const collections = Object.keys(payload.collections).filter((slug) => slug.startsWith("sales-")).sort();
  await new Promise((resolveWrite, rejectWrite) => process.stdout.write(`PACKED_CUSTOMER_BOOT ${JSON.stringify({ customer, collections, documents: result.totalDocs, opportunities: opportunities.totalDocs, resolvedPackages })}\n`, (error) => error ? rejectWrite(error) : resolveWrite()));
} catch (error) {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  await new Promise((resolveWrite) => process.stderr.write(`${message}\n`, resolveWrite));
  process.exitCode = 1;
} finally {
  const timeout = () => new Promise((resolveTimeout) => setTimeout(resolveTimeout, 2_000));
  await Promise.race([payload.destroy(), timeout()]);
  if (typeof payload.db.pool?.end === "function") await Promise.race([payload.db.pool.end(), timeout()]);
  process.exit(process.exitCode ?? 0);
}
